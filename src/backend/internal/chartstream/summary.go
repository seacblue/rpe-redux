// Builds the streaming chart header and per-line index from one scanned chart
// source. A line is parsed once here, summarized, and discarded; the summary
// carries the counts, time bounds, parent/group identity, and content digest
// needed by paging, rendering, and save without retaining note objects.

package chartstream

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Line flags used by paged rendering, conversion, and diagnostics.
const (
	LineFlagInvalid   = 1 << 0
	LineFlagUnbounded = 1 << 1
	LineFlagStatic    = 1 << 2
	LineFlagShader    = 1 << 3
	LineFlagNoise     = 1 << 4
	LineFlagConvert   = 1 << 5
)

// eventTracks mirrors the chart vocabulary's ordinary and extended tracks.
var eventTracks = []string{
	"moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents", "speedEvents",
	"scaleXEvents", "scaleYEvents", "colorEvents", "paintEvents", "textEvents",
	"inclineEvents", "gifEvents",
}

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER, used when validating
// beat triples and marking an unbounded activity interval.
const maxSafeInteger = 1<<53 - 1

// LineSummary is one line's index entry; it never contains note or event
// objects. Intervals are disjoint activity ranges used by paged time windows.
type LineSummary struct {
	Index        int      `json:"index"`
	ByteOffset   int      `json:"byteOffset"`
	ByteLength   int      `json:"byteLength"`
	NoteCount    int      `json:"noteCount"`
	EventCount   int      `json:"eventCount"`
	StartSeconds *float64 `json:"startSeconds"`
	EndSeconds   *float64 `json:"endSeconds"`
	// Intervals are disjoint activity ranges used by paged time windows.
	Intervals [][2]float64 `json:"intervals,omitempty"`
	Digest    string       `json:"digest"`
	Flags     int          `json:"flags"`
	Group     float64      `json:"group"`
	Father    float64      `json:"father"`
	ID        string       `json:"id,omitempty"`
}

// Index is the complete line index for one chart source.
type Index struct {
	Version      int           `json:"version"`
	HeaderDigest string        `json:"headerDigest"`
	Lines        []LineSummary `json:"lines"`
	AssetNames   []string      `json:"assetNames"`
	TotalBytes   int           `json:"totalBytes"`
	Canonical    bool          `json:"canonical"`
}

// Header is the non-line part of a chart, sufficient to build a tempo map and
// the editor surfaces.
type Header struct {
	META           json.RawMessage            `json:"META"`
	BPMList        json.RawMessage            `json:"BPMList"`
	JudgeLineGroup json.RawMessage            `json:"judgeLineGroup,omitempty"`
	BlockAreaList  json.RawMessage            `json:"blockAreaList,omitempty"`
	Effects        json.RawMessage            `json:"effects,omitempty"`
	ShaderEvents   json.RawMessage            `json:"shaderEvents,omitempty"`
	Markers        json.RawMessage            `json:"markers,omitempty"`
	Extras         map[string]json.RawMessage `json:"extras"`
	LineCount      int                        `json:"lineCount"`
}

// Artifact is one scanned chart: its header, line index, and source ranges.
type Artifact struct {
	Header Header
	Index  Index
	Ranges []Range
}

// BpmEntry is one validated tempo point.
type BpmEntry struct {
	BPM  float64
	Beat float64
}

// TempoPoint is one sorted tempo point with its elapsed seconds.
type TempoPoint struct {
	Beat           float64
	SecondsPerBeat float64
	Seconds        float64
}

// TempoMap converts beats to seconds across a chart's BPMList.
type TempoMap struct {
	Points []TempoPoint
}

// NewTempoMap validates and sorts entries, precomputing elapsed seconds.
func NewTempoMap(entries []BpmEntry) (*TempoMap, error) {
	if len(entries) == 0 {
		return nil, fmt.Errorf("BPMList must not be empty")
	}
	points := make([]TempoPoint, 0, len(entries))
	for index, entry := range entries {
		if math.IsNaN(entry.BPM) || math.IsInf(entry.BPM, 0) || entry.BPM <= 0 {
			return nil, fmt.Errorf("BPMList[%d].bpm must be a positive number", index)
		}
		if math.IsNaN(entry.Beat) || math.IsInf(entry.Beat, 0) {
			return nil, fmt.Errorf("BPMList[%d].startTime must be finite", index)
		}
		points = append(points, TempoPoint{
			Beat:           entry.Beat,
			SecondsPerBeat: 60 / entry.BPM,
		})
	}
	sort.SliceStable(points, func(left, right int) bool {
		return points[left].Beat < points[right].Beat
	})
	previousBeat := 0.0
	previousSeconds := 0.0
	previousRate := points[0].SecondsPerBeat
	for index := range points {
		point := &points[index]
		point.Seconds = previousSeconds + (point.Beat-previousBeat)*previousRate
		previousBeat = point.Beat
		previousSeconds = point.Seconds
		previousRate = point.SecondsPerBeat
	}
	return &TempoMap{Points: points}, nil
}

// defaultTempo is the fallback used when a chart has no usable BPMList.
func defaultTempo() *TempoMap {
	return &TempoMap{Points: []TempoPoint{{Beat: 0, SecondsPerBeat: 0.5, Seconds: 0}}}
}

// CheckFactor treats a non-finite or near-zero line factor as normal speed.
func (t *TempoMap) CheckFactor(factor float64) float64 {
	if math.IsNaN(factor) || math.IsInf(factor, 0) || math.Abs(factor) < 0.001 {
		return 1
	}
	return factor
}

// Seconds returns chart seconds at beat, scaled by factor.
func (t *TempoMap) Seconds(beat, factor float64) float64 {
	rate := t.CheckFactor(factor)
	index := sort.Search(len(t.Points), func(index int) bool {
		return t.Points[index].Beat > beat
	}) - 1
	if index < 0 {
		index = 0
	}
	point := t.Points[index]
	return (point.Seconds + (beat-point.Beat)*point.SecondsPerBeat) * rate
}

// beatValue converts a beat triple or number to its numeric value. It is used
// for note and event times, where the chart format accepts either a triple or a
// plain number.
func beatValue(value any) (float64, bool) {
	switch value.(type) {
	case []any, []float64:
		return beatTupleValue(value)
	default:
		return toNumber(value)
	}
}

// beatTupleValue converts a beat triple to its numeric value.
func beatTupleValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case []any:
		parts := make([]float64, len(typed))
		for index, part := range typed {
			number, ok := beatPart(part)
			if !ok {
				return 0, false
			}
			parts[index] = number
		}
		return beatPartsValue(parts)
	case []float64:
		return beatPartsValue(typed)
	default:
		return 0, false
	}
}

// beatPart accepts only numeric JSON values inside a beat triple.
func beatPart(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

// beatPartsValue validates a beat triple and returns its value.
func beatPartsValue(parts []float64) (float64, bool) {
	if len(parts) != 3 {
		return 0, false
	}
	for _, part := range parts {
		if !isSafeInteger(part) {
			return 0, false
		}
	}
	if parts[2] <= 0 {
		return 0, false
	}
	return parts[0] + parts[1]/parts[2], true
}

// isSafeInteger reports whether value is an exactly representable integer.
func isSafeInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) &&
		math.Trunc(value) == value && math.Abs(value) <= maxSafeInteger
}

// toNumber applies JavaScript Number() coercion to a decoded JSON value.
func toNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		trimmed := trimJSSpace(typed)
		if trimmed == "" {
			return 0, true
		}
		parsed, err := parseJSNumber(trimmed)
		return parsed, err == nil
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case nil:
		return 0, true
	default:
		return math.NaN(), false
	}
}

// trimJSSpace trims the whitespace JavaScript's Number() ignores.
func trimJSSpace(value string) string {
	return strings.Trim(value, " \t\n\r\v\f")
}

// parseJSNumber accepts the decimal and hexadecimal forms Number() accepts.
func parseJSNumber(value string) (float64, error) {
	if len(value) > 2 && value[0] == '0' && (value[1] == 'x' || value[1] == 'X') {
		parsed, err := strconv.ParseUint(value[2:], 16, 64)
		if err != nil {
			return math.NaN(), err
		}
		return float64(parsed), nil
	}
	return strconv.ParseFloat(value, 64)
}

// secondsOfField converts a present beat field to seconds. A missing field is
// treated as NaN, matching Number(undefined); an explicit null becomes zero,
// matching Number(null).
func secondsOfField(record map[string]any, key string, tempo *TempoMap, factor float64) (float64, bool) {
	value, present := record[key]
	if !present {
		return 0, false
	}
	return secondsOf(value, tempo, factor)
}

// secondsOf converts a beat value to seconds, reporting false when the value is
// malformed or non-finite.
func secondsOf(value any, tempo *TempoMap, factor float64) (float64, bool) {
	beat, ok := beatValue(value)
	if !ok || math.IsNaN(beat) || math.IsInf(beat, 0) {
		return 0, false
	}
	seconds := tempo.Seconds(beat, factor)
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, false
	}
	return seconds, true
}

// bounds accumulates finite time values for one line.
type bounds struct {
	start float64
	end   float64
	timed bool
}

// extend adds one finite time to the bounds.
func (b *bounds) extend(seconds float64, ok bool) {
	if !ok || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return
	}
	if !b.timed {
		b.start = seconds
		b.end = seconds
		b.timed = true
		return
	}
	b.start = math.Min(b.start, seconds)
	b.end = math.Max(b.end, seconds)
}

// addInterval records one finite activity range.
func addInterval(intervals *[][2]float64, start float64, startOK bool, end float64, endOK bool) {
	if !startOK || !endOK || math.IsNaN(start) || math.IsInf(start, 0) ||
		math.IsNaN(end) || math.IsInf(end, 0) {
		return
	}
	*intervals = append(*intervals, [2]float64{math.Max(0, start), math.Max(start, end)})
}

// mergeIntervals sorts and merges overlapping activity ranges.
func mergeIntervals(intervals [][2]float64) [][2]float64 {
	if len(intervals) <= 1 {
		return intervals
	}
	ordered := append([][2]float64(nil), intervals...)
	sort.Slice(ordered, func(left, right int) bool {
		if ordered[left][0] != ordered[right][0] {
			return ordered[left][0] < ordered[right][0]
		}
		return ordered[left][1] < ordered[right][1]
	})
	merged := [][2]float64{ordered[0]}
	for _, interval := range ordered[1:] {
		current := &merged[len(merged)-1]
		if interval[0] <= current[1] {
			current[1] = math.Max(current[1], interval[1])
			continue
		}
		merged = append(merged, interval)
	}
	return merged
}

// lineFactor reads the line's bpmfactor with the tempo map's fallback rule.
func lineFactor(line map[string]any) float64 {
	value, ok := toNumber(line["bpmfactor"])
	if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 1
	}
	return value
}

// isRecord reports whether value is a JSON object.
func isRecord(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

// SummarizeLine parses one line summary without retaining any note or event
// object.
func SummarizeLine(line any, index int, tempo *TempoMap, byteOffset, byteLength int) LineSummary {
	digest := LineContentFingerprint(line)
	record, ok := isRecord(line)
	if !ok {
		return LineSummary{
			Index:      index,
			ByteOffset: byteOffset,
			ByteLength: byteLength,
			Digest:     digest,
			Flags:      LineFlagInvalid | LineFlagUnbounded,
			Father:     -1,
		}
	}

	factor := lineFactor(record)
	var lineBounds bounds
	intervals := make([][2]float64, 0)
	noteCount := 0
	eventCount := 0
	hasAlphaEvents := false
	lastAlphaEndSet := false
	lastAlphaEnd := 0.0
	lastAlphaEndValue := math.NaN()
	hasShader := false

	notes, _ := record["notes"].([]any)
	noteCount = len(notes)
	for _, note := range notes {
		noteRecord, ok := isRecord(note)
		if !ok {
			continue
		}
		start, startOK := secondsOfField(noteRecord, "startTime", tempo, factor)
		end, endOK := secondsOfField(noteRecord, "endTime", tempo, factor)
		lineBounds.extend(start, startOK)
		lineBounds.extend(end, endOK)
		visibleValue, visiblePresent := noteRecord["visibleTime"]
		visibleTime, visibleOK := 999999.0, true
		if visiblePresent && visibleValue != nil {
			visibleTime, visibleOK = toNumber(visibleValue)
		}
		if startOK && visibleOK && !math.IsNaN(visibleTime) && !math.IsInf(visibleTime, 0) {
			lineBounds.extend(start-visibleTime, true)
			addInterval(&intervals, start-visibleTime, true, end, endOK)
		} else {
			addInterval(&intervals, start, startOK, end, endOK)
		}
	}

	layers := make([]any, 0)
	if eventLayers, ok := record["eventLayers"].([]any); ok {
		layers = append(layers, eventLayers...)
	}
	if extended, present := record["extended"]; present {
		layers = append(layers, extended)
	}
	for _, layer := range layers {
		layerRecord, ok := isRecord(layer)
		if !ok {
			continue
		}
		for _, track := range eventTracks {
			events, ok := layerRecord[track].([]any)
			if !ok {
				continue
			}
			eventCount += len(events)
			if track == "paintEvents" && len(events) > 0 {
				hasShader = true
			}
			for _, event := range events {
				eventRecord, ok := isRecord(event)
				if !ok {
					continue
				}
				start, startOK := secondsOfField(eventRecord, "startTime", tempo, factor)
				end, endOK := secondsOfField(eventRecord, "endTime", tempo, factor)
				lineBounds.extend(start, startOK)
				lineBounds.extend(end, endOK)
				addInterval(&intervals, start, startOK, end, endOK)
				if track == "alphaEvents" {
					hasAlphaEvents = true
					if endOK && (!lastAlphaEndSet || end >= lastAlphaEnd) {
						lastAlphaEnd = end
						lastAlphaEndSet = true
						if raw, present := eventRecord["end"]; present {
							lastAlphaEndValue, _ = toNumber(raw)
						} else {
							lastAlphaEndValue = math.NaN()
						}
					}
				}
			}
		}
	}

	unbounded := !hasAlphaEvents || !lastAlphaEndSet ||
		math.IsNaN(lastAlphaEndValue) || math.IsInf(lastAlphaEndValue, 0) ||
		lastAlphaEndValue > 0
	flags := 0
	if unbounded {
		flags |= LineFlagUnbounded
	}
	if !lineBounds.timed {
		flags |= LineFlagStatic
	}
	if hasShader {
		flags |= LineFlagShader
	}
	if _, present := record["_reduxNoiseLine"]; present {
		flags |= LineFlagNoise
	}

	var startSeconds *float64
	if lineBounds.timed {
		value := math.Max(0, lineBounds.start)
		startSeconds = &value
	}
	var endSeconds *float64
	if !unbounded && lineBounds.timed {
		value := math.Max(lineBounds.start, lineBounds.end)
		endSeconds = &value
	}
	if unbounded {
		from := 0.0
		if lastAlphaEndSet {
			from = math.Max(0, lastAlphaEnd)
		}
		intervals = append(intervals, [2]float64{from, float64(maxSafeInteger)})
	}

	group := 0.0
	if value, ok := toNumber(record["Group"]); ok && !math.IsNaN(value) && !math.IsInf(value, 0) {
		group = value
	}
	father := -1.0
	switch value := record["father"].(type) {
	case nil:
		father = -1
	case string:
		if value != "" {
			if number, ok := toNumber(value); ok && !math.IsNaN(number) && !math.IsInf(number, 0) {
				father = number
			}
		}
	default:
		if number, ok := toNumber(value); ok && !math.IsNaN(number) && !math.IsInf(number, 0) {
			father = number
		}
	}

	summary := LineSummary{
		Index:        index,
		ByteOffset:   byteOffset,
		ByteLength:   byteLength,
		NoteCount:    noteCount,
		EventCount:   eventCount,
		StartSeconds: startSeconds,
		EndSeconds:   endSeconds,
		Intervals:    mergeIntervals(intervals),
		Digest:       digest,
		Flags:        flags,
		Group:        group,
		Father:       father,
	}
	if id, ok := record["id"].(string); ok {
		summary.ID = id
	}
	return summary
}

// parseBPMList reads a raw BPMList into validated tempo entries.
func parseBPMList(raw json.RawMessage) ([]BpmEntry, error) {
	var entries []struct {
		BPM       float64 `json:"bpm"`
		StartTime any     `json:"startTime"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	out := make([]BpmEntry, 0, len(entries))
	for index, entry := range entries {
		beat, ok := beatTupleValue(entry.StartTime)
		if !ok || math.IsNaN(beat) || math.IsInf(beat, 0) {
			return nil, fmt.Errorf("BPMList[%d].startTime is not a beat", index)
		}
		out = append(out, BpmEntry{BPM: entry.BPM, Beat: beat})
	}
	return out, nil
}

// tempoFromHeader builds the tempo map, falling back to 120 BPM when the header
// has no usable BPMList.
func tempoFromHeader(raw json.RawMessage) *TempoMap {
	entries, err := parseBPMList(raw)
	if err != nil || len(entries) == 0 {
		return defaultTempo()
	}
	tempo, err := NewTempoMap(entries)
	if err != nil {
		return defaultTempo()
	}
	return tempo
}

// collectAssetNames adds one parsed line's asset references to names.
func collectAssetNames(line any, names map[string]struct{}) {
	record, ok := isRecord(line)
	if !ok {
		return
	}
	for _, field := range []string{"Texture", "attachUI"} {
		if value, ok := record[field].(string); ok {
			names[value] = struct{}{}
		}
	}
	notes, ok := record["notes"].([]any)
	if !ok {
		return
	}
	for _, note := range notes {
		noteRecord, ok := isRecord(note)
		if !ok {
			continue
		}
		for _, field := range []string{"hitSound", "hitsound"} {
			if value, ok := noteRecord[field].(string); ok {
				names[value] = struct{}{}
			}
		}
	}
}

// headerFromScan builds the streaming header from the scanner's raw values.
func headerFromScan(scan *Scan) Header {
	header := Header{
		META:      json.RawMessage("{}"),
		BPMList:   json.RawMessage("[]"),
		Extras:    make(map[string]json.RawMessage),
		LineCount: len(scan.LineRanges),
	}
	for key, raw := range scan.HeaderRaw {
		switch key {
		case "META":
			if isJSONObject(raw) {
				header.META = raw
			}
		case "BPMList":
			if isJSONArray(raw) {
				header.BPMList = raw
			}
		case "judgeLineGroup":
			if isJSONArray(raw) {
				header.JudgeLineGroup = raw
			}
		case "blockAreaList":
			if isJSONArray(raw) {
				header.BlockAreaList = raw
			}
		case "effects":
			if isJSONArray(raw) {
				header.Effects = raw
			}
		case "shaderEvents":
			if isJSONArray(raw) {
				header.ShaderEvents = raw
			}
		case "markers":
			if isJSONArray(raw) {
				header.Markers = raw
			}
		default:
			header.Extras[key] = raw
		}
	}
	return header
}

// Build scans one chart source into its header and line index.
//
// Every line is parsed once so counts and digests are exact; the parsed object
// is discarded immediately and never retained by the index.
func Build(text []byte) (*Artifact, error) {
	scan, err := ScanChartJSON(text)
	if err != nil {
		return nil, err
	}
	header := headerFromScan(scan)
	values, err := scan.HeaderValues()
	if err != nil {
		return nil, err
	}
	tempo := tempoFromHeader(header.BPMList)

	names := make(map[string]struct{})
	var meta map[string]any
	if err := json.Unmarshal(header.META, &meta); err == nil {
		for _, field := range []string{"song", "background"} {
			if value, ok := meta[field].(string); ok {
				names[value] = struct{}{}
			}
		}
	}

	lines := make([]LineSummary, len(scan.LineRanges))
	for index, sourceRange := range scan.LineRanges {
		var line any
		if err := json.Unmarshal(text[sourceRange.Start:sourceRange.End], &line); err != nil {
			line = nil
		}
		collectAssetNames(line, names)
		lines[index] = SummarizeLine(line, index, tempo, sourceRange.Start, sourceRange.End-sourceRange.Start)
	}

	assetNames := make([]string, 0, len(names))
	for name := range names {
		assetNames = append(assetNames, name)
	}
	sort.Slice(assetNames, func(left, right int) bool {
		return compareUTF16(assetNames[left], assetNames[right]) < 0
	})

	return &Artifact{
		Header: header,
		Index: Index{
			Version:      1,
			HeaderDigest: HeaderContentFingerprint(values),
			Lines:        lines,
			AssetNames:   assetNames,
			TotalBytes:   len(text),
			Canonical:    false,
		},
		Ranges: scan.LineRanges,
	}, nil
}
