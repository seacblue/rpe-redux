// Verifies the byte-level chart metadata scanner against a full decode of the
// same source, including the event-layer layout that the previous reader missed.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// chartEventTracksNamed lists the event arrays counted by the reference reader.
func chartEventTracksNamed() []string {
	return []string{
		"moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents", "speedEvents",
		"scaleXEvents", "scaleYEvents", "colorEvents", "paintEvents", "textEvents",
		"inclineEvents", "gifEvents",
	}
}

// decodeChartMeta is the whole-document reader the scanner replaced. It stays as
// the reference answer so a layout the scanner mishandles fails a test instead of
// silently persisting wrong totals.
func decodeChartMeta(chart []byte) chartMeta {
	var m chartMeta
	var root map[string]any
	if json.Unmarshal(chart, &root) != nil {
		return m
	}
	meta, _ := root["META"].(map[string]any)
	lineList, _ := root["judgeLineList"].([]any)
	sum := 0
	found := false
	for _, line := range lineList {
		record, ok := line.(map[string]any)
		if !ok {
			continue
		}
		if notes, ok := record["notes"].([]any); ok {
			found = true
			sum += len(notes)
		}
		layers := []any{}
		if eventLayers, ok := record["eventLayers"].([]any); ok {
			layers = append(layers, eventLayers...)
		}
		if extended, present := record["extended"]; present {
			layers = append(layers, extended)
		}
		for _, layer := range layers {
			layerRecord, ok := layer.(map[string]any)
			if !ok {
				continue
			}
			for _, track := range chartEventTracksNamed() {
				if events, ok := layerRecord[track].([]any); ok {
					m.EventCount += len(events)
				}
			}
		}
		// Charts written before event layers stored the same tracks on the line.
		for _, track := range chartEventTracksNamed() {
			if events, ok := record[track].([]any); ok {
				m.EventCount += len(events)
			}
		}
	}
	if found {
		m.NoteCount = sum
	} else if meta != nil {
		m.NoteCount = metaInt(meta["numOfNotes"])
	}
	if meta != nil {
		m.Charter = metaString(meta["charter"])
		m.Composer = metaString(meta["composer"])
		m.Level = metaString(meta["level"])
		m.Background = metaString(meta["background"])
		m.Song = metaString(meta["song"])
	}
	return m
}

// assertMetaEqual compares every stored field of two summaries.
func assertMetaEqual(t *testing.T, label string, got, want chartMeta) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: scanner=%+v decode=%+v", label, got, want)
	}
}

// readChartMetaPair scans a chart and requires the reference reader to accept it.
func readChartMetaPair(t *testing.T, chart []byte) (chartMeta, chartMeta) {
	t.Helper()
	got, ok := readChartMeta(chart)
	if !ok {
		t.Fatal("readChartMeta rejected a valid chart")
	}
	return got, decodeChartMeta(chart)
}

// TestReadChartMetaMatchesDecodeForEventLayers covers the layer layout current
// editors write, where tracks live inside `eventLayers`.
func TestReadChartMetaMatchesDecodeForEventLayers(t *testing.T) {
	chart := []byte(`{
		"META": {"charter": "A", "composer": 7, "level": "IN", "background": "b.png", "song": "s.mp3", "numOfNotes": 99},
		"judgeLineList": [
			{
				"notes": [{"type": 1}, {"type": 2}],
				"eventLayers": [
					{"moveXEvents": [{}, {}], "alphaEvents": [{}]},
					{"moveYEvents": [{}]}
				],
				"extended": {"inclineEvents": [{}], "scaleXEvents": [{}, {}, {}]}
			},
			{"notes": [{"type": 3}], "eventLayers": [{"rotateEvents": [{}, {}]}]}
		]
	}`)
	got, want := readChartMetaPair(t, chart)
	assertMetaEqual(t, "eventLayers chart", got, want)
	if want.NoteCount != 3 || want.EventCount != 10 {
		t.Fatalf("reference counts drifted: notes=%d events=%d", want.NoteCount, want.EventCount)
	}
}

// TestReadChartMetaMatchesDecodeForLegacyTracks covers charts whose event tracks
// sit directly on the line.
func TestReadChartMetaMatchesDecodeForLegacyTracks(t *testing.T) {
	chart := []byte(`{
		"META": {"charter": "B", "numOfNotes": 4},
		"judgeLineList": [
			{"notes": [{"type": 1}], "moveXEvents": [{}, {}], "alphaEvents": [{}]},
			{"notes": [{"type": 2}], "speedEvents": [{}]}
		]
	}`)
	got, want := readChartMetaPair(t, chart)
	assertMetaEqual(t, "legacy chart", got, want)
	if want.EventCount != 4 {
		t.Fatalf("reference events = %d, want 4", want.EventCount)
	}
}

// TestReadChartMetaFallsBackToMetaNotes covers a chart with no line arrays.
func TestReadChartMetaFallsBackToMetaNotes(t *testing.T) {
	chart := []byte(`{"META": {"charter": "C", "numOfNotes": 42}, "judgeLineList": []}`)
	got, want := readChartMetaPair(t, chart)
	assertMetaEqual(t, "empty line list", got, want)
	if got.NoteCount != 42 {
		t.Fatalf("note fallback = %d, want 42", got.NoteCount)
	}
}

// TestReadChartMetaSkipsUnrelatedValues covers scalars, nested objects, and
// escaped strings the scanner must step over without losing its place.
func TestReadChartMetaSkipsUnrelatedValues(t *testing.T) {
	chart := []byte(`{
		"BPMList": [{"bpm": 120, "startTime": [0, 0, 1]}],
		"chartTime": 1.5,
		"xybind": true,
		"multiLineString": "a \"quoted\" \\ value",
		"META": {"charter": "D", "numOfNotes": 1},
		"judgeLineList": [
			{"Name": "line", "father": -1, "notes": [{"type": 1, "above": 1}],
			 "eventLayers": [{"paintEvents": [{"x": [1, 2, 3]}]}]}
		]
	}`)
	got, want := readChartMetaPair(t, chart)
	assertMetaEqual(t, "mixed values", got, want)
}

// TestReadChartMetaReadsTrailingMeta covers META appearing after the line list.
func TestReadChartMetaReadsTrailingMeta(t *testing.T) {
	chart := []byte(`{"judgeLineList": [{"notes": [{}]}], "META": {"charter": "Z", "song": "late.mp3"}}`)
	got, want := readChartMetaPair(t, chart)
	assertMetaEqual(t, "trailing META", got, want)
	if got.Charter != "Z" || got.Song != "late.mp3" {
		t.Fatalf("trailing META lost: %+v", got)
	}
}

// TestScanChartRejectsMalformedJSON keeps a damaged document from persisting a
// partial summary.
func TestScanChartRejectsMalformedJSON(t *testing.T) {
	cases := []string{
		``,
		`{`,
		`{"judgeLineList": [{"notes": [}}`,
		`{"judgeLineList": [}`,
		`{"META": {"charter": "A"}`,
		`[]`,
		`{"judgeLineList": [], "trailing": }`,
	}
	for _, chart := range cases {
		if _, ok := readChartMeta([]byte(chart)); ok {
			t.Fatalf("accepted malformed chart: %q", chart)
		}
	}
}

// TestReadChartMetaHandlesByteOrderMark covers the mark editors sometimes write.
func TestReadChartMetaHandlesByteOrderMark(t *testing.T) {
	chart := []byte("\xEF\xBB\xBF" + `{"META": {"charter": "E"}, "judgeLineList": [{"notes": [{}, {}]}]}`)
	got, ok := readChartMeta(chart)
	if !ok {
		t.Fatal("readChartMeta rejected a chart with a byte-order mark")
	}
	if got.Charter != "E" || got.NoteCount != 2 {
		t.Fatalf("got %+v", got)
	}
}

// TestReadChartMetaMatchesDecodeForFixtures runs the scanner over every
// committed fixture and any chart named by REDUX_CHART_META_FIXTURE, so a real
// large chart can be compared with a full decode outside the repository.
func TestReadChartMetaMatchesDecodeForFixtures(t *testing.T) {
	for _, path := range chartMetaFixturePaths() {
		chart, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		got, want := readChartMetaPair(t, chart)
		assertMetaEqual(t, filepath.Base(path), got, want)
	}
}

// chartMetaFixturePaths lists the fixtures the scanner is compared against.
func chartMetaFixturePaths() []string {
	paths := []string{filepath.Join("..", "..", "..", "test", "fixtures", "smoke.json")}
	if extra := os.Getenv("REDUX_CHART_META_FIXTURE"); extra != "" {
		paths = append(paths, extra)
	}
	return paths
}

// TestScanChartAllocatesFarLessThanDecode guards the reason the scanner exists:
// decoding a chart must not be the path a library write takes.
func TestScanChartAllocatesFarLessThanDecode(t *testing.T) {
	for _, path := range chartMetaFixturePaths() {
		chart, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		decodeAlloc := testing.AllocsPerRun(3, func() { _ = decodeChartMeta(chart) })
		scanAlloc := testing.AllocsPerRun(3, func() { _, _ = readChartMeta(chart) })
		if scanAlloc > decodeAlloc {
			t.Fatalf("%s: scanner allocated %v per run, decode %v", filepath.Base(path), scanAlloc, decodeAlloc)
		}
	}
}
