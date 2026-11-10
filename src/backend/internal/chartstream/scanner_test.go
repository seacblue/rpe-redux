// Scanner tests: line ranges before META, nested values, byte offsets, and
// malformed sources.

package chartstream

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestScanChartJSONFindsLinesBeforeMETA(t *testing.T) {
	text := []byte(`{
        "judgeLineList": [
            {"Name":"first","notes":[{"type":1,"startTime":[0,0,1]}]},
            {"Name":"second","eventLayers":[{"alphaEvents":[]}]}
        ],
        "META":{"name":"song"},
        "BPMList":[{"bpm":120,"startTime":[0,0,1]}]
    }`)
	scan, err := ScanChartJSON(text)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(scan.LineRanges) != 2 {
		t.Fatalf("lines = %d, want 2", len(scan.LineRanges))
	}
	for index, sourceRange := range scan.LineRanges {
		var line map[string]any
		if err := json.Unmarshal(text[sourceRange.Start:sourceRange.End], &line); err != nil {
			t.Fatalf("line %d is not a JSON object: %v", index, err)
		}
	}
	if string(text[scan.LineRanges[0].Start:scan.LineRanges[0].End]) !=
		`{"Name":"first","notes":[{"type":1,"startTime":[0,0,1]}]}` {
		t.Fatalf("first range = %q", text[scan.LineRanges[0].Start:scan.LineRanges[0].End])
	}
	if string(scan.HeaderRaw["META"]) != `{"name":"song"}` {
		t.Fatalf("META raw = %q", scan.HeaderRaw["META"])
	}
	if len(scan.KeyOrder) != 3 || scan.KeyOrder[0] != "judgeLineList" {
		t.Fatalf("key order = %#v", scan.KeyOrder)
	}
}

func TestScanChartJSONHandlesNestedValuesAndStrings(t *testing.T) {
	text := []byte(`{"judgeLineList":[{"Name":"a]b}c","notes":[]}],"META":{"name":"x"},` +
		`"custom":{"array":[[1,2],{"k":"v"}],"number":-1.5e+3,"bool":true,"nil":null}}`)
	scan, err := ScanChartJSON(text)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(scan.LineRanges) != 1 {
		t.Fatalf("lines = %d", len(scan.LineRanges))
	}
	if string(scan.HeaderRaw["custom"]) != `{"array":[[1,2],{"k":"v"}],"number":-1.5e+3,"bool":true,"nil":null}` {
		t.Fatalf("custom raw = %q", scan.HeaderRaw["custom"])
	}
}

func TestScanChartJSONUsesByteOffsets(t *testing.T) {
	text := []byte(`{"META":{"name":"谱面"},"judgeLineList":[{"Name":"音符"}]}`)
	scan, err := ScanChartJSON(text)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(scan.LineRanges) != 1 {
		t.Fatalf("lines = %d", len(scan.LineRanges))
	}
	sourceRange := scan.LineRanges[0]
	if string(text[sourceRange.Start:sourceRange.End]) != `{"Name":"音符"}` {
		t.Fatalf("range = %q", text[sourceRange.Start:sourceRange.End])
	}
	if sourceRange.Start != strings.Index(string(text), `{"Name"`) {
		t.Fatalf("byte offset = %d, want %d", sourceRange.Start, strings.Index(string(text), `{"Name"`))
	}
}

func TestScanChartJSONSkipsBOMWithoutShiftingOffsets(t *testing.T) {
	text := append([]byte{0xEF, 0xBB, 0xBF}, []byte(`{"judgeLineList":[{"Name":"a"}],"META":{}}`)...)
	scan, err := ScanChartJSON(text)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(scan.LineRanges) != 1 {
		t.Fatalf("lines = %d", len(scan.LineRanges))
	}
	sourceRange := scan.LineRanges[0]
	if string(text[sourceRange.Start:sourceRange.End]) != `{"Name":"a"}` {
		t.Fatalf("range = %q", text[sourceRange.Start:sourceRange.End])
	}
}

func TestScanChartJSONRejectsTrailingContent(t *testing.T) {
	if _, err := ScanChartJSON([]byte(`{"judgeLineList":[]} garbage`)); err == nil {
		t.Fatal("trailing content was accepted")
	}
	if _, err := ScanChartJSON([]byte(`{"judgeLineList":[{"Name":"a"}`)); err == nil {
		t.Fatal("unterminated line array was accepted")
	}
}

func TestScanArrayRangesPreservesWhitespaceBetweenElements(t *testing.T) {
	text := []byte(" [ {\"a\":1} ,\n {\"b\":[2]} ] ")
	ranges, err := ScanArrayRanges(text)
	if err != nil {
		t.Fatalf("scan array: %v", err)
	}
	if len(ranges) != 2 {
		t.Fatalf("ranges = %d", len(ranges))
	}
	if string(text[ranges[0].Start:ranges[0].End]) != `{"a":1}` ||
		string(text[ranges[1].Start:ranges[1].End]) != `{"b":[2]}` {
		t.Fatalf("ranges = %#v", ranges)
	}
}
