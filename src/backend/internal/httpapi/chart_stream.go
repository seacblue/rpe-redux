// Streaming chart reads over the local library. This file owns the frame
// response, the project line-index cache, and the random-access line endpoint;
// the frame codec and index builder live in the chartstream package.

package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"unicode/utf8"

	"rperedux/server/internal/chartstream"
	"rperedux/server/internal/store"
)

const (
	// chartStreamContentType marks the length-prefixed frame response.
	chartStreamContentType = "application/x-rpe-chart-stream"
	// defaultLineBatch is the line count used when the client omits `count`.
	defaultLineBatch = 64
	// maxLineBatch caps one random-access response.
	maxLineBatch = 1024
	// chartCacheVersion identifies the persisted cache envelope layout and the
	// line-summary schema; a bump rebuilds indexes that predate new fields.
	chartCacheVersion = 2
)

// Errors that map to distinct HTTP responses on the streaming routes.
var (
	errChartUnreadable = errors.New("stored chart cannot be indexed")
	errChartChanged    = errors.New("project chart changed while it was read")
	errChartIndexStale = errors.New("chart index does not match the stored chart")
)

// chartCacheEnvelope is the persisted chart header and line index. The
// revision and content hash make a stale cache detectable without rescanning.
type chartCacheEnvelope struct {
	Version   int                `json:"version"`
	Revision  int                `json:"revision"`
	ChartHash string             `json:"chartHash"`
	Header    chartstream.Header `json:"header"`
	Index     chartstream.Index  `json:"index"`
}

// chartCacheEntry is the in-memory form of one project's index.
type chartCacheEntry struct {
	revision  int
	chartHash string
	header    chartstream.Header
	index     chartstream.Index
}

// chartIndexCache holds line indexes keyed by project id. A project's entry is
// replaced whenever its revision or chart hash changes.
type chartIndexCache struct {
	mu      sync.Mutex
	entries map[string]chartCacheEntry
}

// newChartIndexCache builds an empty cache.
func newChartIndexCache() *chartIndexCache {
	return &chartIndexCache{entries: make(map[string]chartCacheEntry)}
}

// invalidate drops one project's cached index.
func (c *chartIndexCache) invalidate(projectID string) {
	c.mu.Lock()
	delete(c.entries, projectID)
	c.mu.Unlock()
}

// ensureChartArtifact returns the current header and line index for a project,
// rebuilding and persisting it when the cache is empty or stale. The returned
// state is the revision and hash the artifact describes.
func (a *API) ensureChartArtifact(
	ctx context.Context,
	projectID string,
) (*chartstream.Artifact, *store.ProjectChartState, error) {
	a.chartIndexes.mu.Lock()
	defer a.chartIndexes.mu.Unlock()

	for attempt := 0; attempt < 2; attempt++ {
		state, err := a.store.ReadProjectChartState(ctx, projectID)
		if err != nil {
			return nil, nil, err
		}
		if entry, ok := a.chartIndexes.entries[projectID]; ok &&
			entry.revision == state.Revision && entry.chartHash == state.ChartHash {
			return artifactFromEntry(entry), state, nil
		}
		if state.HasIndex {
			indexText, err := a.store.ReadProjectChartIndex(ctx, projectID)
			if err != nil {
				return nil, nil, err
			}
			var envelope chartCacheEnvelope
			if err := json.Unmarshal([]byte(indexText), &envelope); err == nil &&
				envelope.Version == chartCacheVersion &&
				envelope.Revision == state.Revision &&
				envelope.ChartHash == state.ChartHash &&
				envelope.Index.Version == 1 &&
				envelope.Index.TotalBytes >= 0 &&
				envelope.Index.HeaderDigest != "" &&
				len(envelope.Index.Lines) == envelope.Header.LineCount {
				entry := chartCacheEntry{
					revision:  state.Revision,
					chartHash: state.ChartHash,
					header:    normalizedHeader(envelope.Header),
					index:     envelope.Index,
				}
				a.chartIndexes.entries[projectID] = entry
				return artifactFromEntry(entry), state, nil
			}
		}

		text, textState, err := a.store.ReadProjectChartText(ctx, projectID)
		if err != nil {
			return nil, nil, err
		}
		if textState.Revision != state.Revision || textState.ChartHash != state.ChartHash {
			// A commit landed between the state read and the payload read.
			continue
		}
		artifact, err := chartstream.Build(text)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: %v", errChartUnreadable, err)
		}
		entry := chartCacheEntry{
			revision:  textState.Revision,
			chartHash: textState.ChartHash,
			header:    artifact.Header,
			index:     artifact.Index,
		}
		a.chartIndexes.entries[projectID] = entry
		envelope := chartCacheEnvelope{
			Version:   chartCacheVersion,
			Revision:  textState.Revision,
			ChartHash: textState.ChartHash,
			Header:    artifact.Header,
			Index:     artifact.Index,
		}
		if encoded, err := json.Marshal(envelope); err == nil {
			// The index is a cache; a failed write only costs a later rebuild.
			_ = a.store.SaveProjectChartIndex(
				ctx, projectID, textState.Revision, textState.ChartHash, string(encoded))
		}
		return artifact, textState, nil
	}
	return nil, nil, errChartChanged
}

// artifactFromEntry rebuilds the streaming view of one cache entry.
func artifactFromEntry(entry chartCacheEntry) *chartstream.Artifact {
	return &chartstream.Artifact{
		Header: normalizedHeader(entry.header),
		Index:  normalizedIndex(entry.index),
	}
}

// normalizedHeader guarantees the header's extras object is always present.
func normalizedHeader(header chartstream.Header) chartstream.Header {
	if header.Extras == nil {
		header.Extras = make(map[string]json.RawMessage)
	}
	return header
}

// normalizedIndex guarantees the index arrays encode as [] rather than null.
func normalizedIndex(index chartstream.Index) chartstream.Index {
	if index.Lines == nil {
		index.Lines = []chartstream.LineSummary{}
	}
	if index.AssetNames == nil {
		index.AssetNames = []string{}
	}
	return index
}

// loadChartForStream reads the artifact and the exact chart text it describes.
// A concurrent commit invalidates the cache and retries once.
func (a *API) loadChartForStream(
	ctx context.Context,
	projectID string,
) (*chartstream.Artifact, *store.ProjectChartState, []byte, error) {
	artifact, state, err := a.ensureChartArtifact(ctx, projectID)
	if err != nil {
		return nil, nil, nil, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		text, textState, err := a.store.ReadProjectChartText(ctx, projectID)
		if err != nil {
			return nil, nil, nil, err
		}
		if textState.Revision == state.Revision && textState.ChartHash == state.ChartHash &&
			len(text) == artifact.Index.TotalBytes {
			return artifact, textState, text, nil
		}
		a.chartIndexes.invalidate(projectID)
		artifact, state, err = a.ensureChartArtifact(ctx, projectID)
		if err != nil {
			return nil, nil, nil, err
		}
	}
	return nil, nil, nil, errChartChanged
}

// isChartStreamPath reports whether a URL belongs to an unbounded binary
// response that must not be buffered by the framework error rewriter.
func isChartStreamPath(urlPath string) bool {
	return strings.HasSuffix(urlPath, "/chart/stream") ||
		strings.HasSuffix(urlPath, "/chart/lines")
}

// handleChartStream writes the header, index, every line, and the end frame.
func (a *API) handleChartStream(w http.ResponseWriter, r *http.Request) {
	artifact, _, text, err := a.loadChartForStream(r.Context(), r.PathValue("id"))
	if err != nil {
		writeChartStreamError(w, err)
		return
	}
	if !utf8.Valid(text) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_chart", "the stored chart is not valid UTF-8")
		return
	}

	w.Header().Set("Content-Type", chartStreamContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	writer := bufio.NewWriterSize(w, 64<<10)

	if err := chartstream.WriteJSONFrame(writer, chartstream.KindHeader, artifact.Header); err != nil {
		return
	}
	if err := chartstream.WriteJSONFrame(writer, chartstream.KindIndex, artifact.Index); err != nil {
		return
	}
	includeLines := r.URL.Query().Get("includeLines") != "false"
	digests := make([]string, len(artifact.Index.Lines))
	for offset, summary := range artifact.Index.Lines {
		if summary.Index != offset {
			_ = writer.Flush()
			writeChartErrorFrame(writer, "chart_index_stale", "the chart index does not match the stored chart")
			_ = writer.Flush()
			return
		}
		start := summary.ByteOffset
		end := start + summary.ByteLength
		if start < 0 || end < start || end > len(text) {
			_ = writer.Flush()
			writeChartErrorFrame(writer, "chart_index_stale", "the chart index does not match the stored chart")
			_ = writer.Flush()
			return
		}
		digests[offset] = summary.Digest
		if !includeLines {
			continue
		}
		raw := text[start:end]
		if !utf8.Valid(raw) {
			_ = writer.Flush()
			writeChartErrorFrame(writer, "invalid_chart", "a chart line is not valid UTF-8")
			_ = writer.Flush()
			return
		}
		if err := chartstream.WriteLineFrame(writer, uint32(offset), raw); err != nil {
			return
		}
	}
	endPayload := map[string]any{
		"digest": chartstream.CombineContentFingerprint(artifact.Index.HeaderDigest, digests),
		"bytes":  len(text),
	}
	if err := chartstream.WriteJSONFrame(writer, chartstream.KindEnd, endPayload); err != nil {
		return
	}
	_ = writer.Flush()
}

// writeChartErrorFrame reports a failure that happened after the response
// status and first frames were already sent.
func writeChartErrorFrame(writer *bufio.Writer, code, message string) {
	_ = chartstream.WriteJSONFrame(writer, chartstream.KindError, map[string]string{
		"code":    code,
		"message": message,
		"path":    "",
	})
}

// handleChartLines returns one kind 4 frame covering the requested line range.
func (a *API) handleChartLines(w http.ResponseWriter, r *http.Request) {
	start, err := queryInt(r, "start", 0)
	if err != nil || start < 0 {
		writeError(w, http.StatusBadRequest, "invalid_query", "start must be a non-negative integer")
		return
	}
	count, err := queryInt(r, "count", defaultLineBatch)
	if err != nil || count < 0 {
		writeError(w, http.StatusBadRequest, "invalid_query", "count must be a non-negative integer")
		return
	}
	if count > maxLineBatch {
		count = maxLineBatch
	}
	raw, actualStart, actualCount, err := a.readLineBatch(r.Context(), r.PathValue("id"), start, count)
	if err != nil {
		writeChartStreamError(w, err)
		return
	}
	w.Header().Set("Content-Type", chartStreamContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = chartstream.WriteLinesFrame(w, uint32(actualStart), uint32(actualCount), raw)
}

// readLineBatch reads only the requested byte span and verifies every line
// boundary against the cached summaries. A stale cache is rebuilt once.
func (a *API) readLineBatch(
	ctx context.Context,
	projectID string,
	start, count int,
) ([]byte, int, int, error) {
	for attempt := 0; attempt < 2; attempt++ {
		artifact, _, err := a.ensureChartArtifact(ctx, projectID)
		if err != nil {
			return nil, 0, 0, err
		}
		lines := artifact.Index.Lines
		if count == 0 || start >= len(lines) {
			return []byte("[]"), start, 0, nil
		}
		actual := count
		if remaining := len(lines) - start; actual > remaining {
			actual = remaining
		}
		first := lines[start]
		last := lines[start+actual-1]
		spanStart := int64(first.ByteOffset)
		spanEnd := int64(last.ByteOffset + last.ByteLength)
		if spanStart < 0 || spanEnd < spanStart || spanEnd > int64(artifact.Index.TotalBytes) {
			a.chartIndexes.invalidate(projectID)
			continue
		}
		data, err := a.store.ReadProjectChartSlice(ctx, projectID, spanStart, spanEnd-spanStart)
		if err != nil {
			return nil, 0, 0, err
		}
		if int64(len(data)) != spanEnd-spanStart || !utf8.Valid(data) {
			a.chartIndexes.invalidate(projectID)
			continue
		}
		wrapped := make([]byte, 0, len(data)+2)
		wrapped = append(wrapped, '[')
		wrapped = append(wrapped, data...)
		wrapped = append(wrapped, ']')
		ranges, scanErr := chartstream.ScanArrayRanges(wrapped)
		raw := make([][]byte, actual)
		valid := true
		if scanErr == nil && len(ranges) == actual {
			for offset := 0; offset < actual; offset++ {
				// The wrapper array adds one byte before the source span.
				expectedStart := 1 + lines[start+offset].ByteOffset - first.ByteOffset
				expectedLength := lines[start+offset].ByteLength
				if ranges[offset].Start != expectedStart ||
					ranges[offset].End-ranges[offset].Start != expectedLength {
					valid = false
					break
				}
				raw[offset] = wrapped[ranges[offset].Start:ranges[offset].End]
			}
		} else {
			// An invalid line can make the wrapped span unscannable. The
			// revision/hash match already tied these offsets to this text, so
			// return the raw slices after checking their bounds.
			for offset := 0; offset < actual; offset++ {
				relative := lines[start+offset].ByteOffset - first.ByteOffset
				length := lines[start+offset].ByteLength
				if relative < 0 || length < 0 || relative+length > len(data) {
					valid = false
					break
				}
				raw[offset] = data[relative : relative+length]
			}
		}
		if !valid {
			a.chartIndexes.invalidate(projectID)
			continue
		}
		joined := bytes.Join(raw, []byte(","))
		payload := make([]byte, 0, len(joined)+2)
		payload = append(payload, '[')
		payload = append(payload, joined...)
		payload = append(payload, ']')
		return payload, start, actual, nil
	}
	return nil, 0, 0, errChartIndexStale
}

// writeChartStreamError maps streaming failures onto the JSON error envelope.
func writeChartStreamError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeStoreError(w, err)
	case errors.Is(err, errChartUnreadable):
		writeError(w, http.StatusUnprocessableEntity, "invalid_chart", "the stored chart could not be indexed")
	case errors.Is(err, errChartChanged):
		writeError(w, http.StatusConflict, "chart_changed", "the project changed while it was read")
	case errors.Is(err, errChartIndexStale):
		writeError(w, http.StatusInternalServerError, "chart_index_stale", "the chart index does not match the stored chart")
	default:
		writeStoreError(w, err)
	}
}
