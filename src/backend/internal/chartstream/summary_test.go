// Index builder tests: header shape, note/event counts, tempo conversion, line
// flags, parent/group identity, and asset names.

package chartstream

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func sampleChart() []byte {
	return []byte(`{
        "judgeLineList": [
            {
                "Name":"first","Group":3,"father":0,"id":"line-0","Texture":"line.png","attachUI":"ui.png",
                "notes":[{"type":1,"startTime":[2,0,1],"endTime":[3,0,1],"visibleTime":0.5,"hitSound":"tap.wav"}],
                "eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[6,0,1],"start":1,"end":0}]}],
                "extended":{"paintEvents":[{"startTime":[0,0,1],"endTime":[4,0,1],"start":0,"end":1}]}
            },
            {
                "Name":"second","bpmfactor":2,
                "notes":[{"type":2,"startTime":[2,0,1],"endTime":[3,0,1],"visibleTime":1}]
            },
            42
        ],
        "META":{"name":"song","song":"audio.ogg","background":"cover.png"},
        "BPMList":[{"bpm":120,"startTime":[0,0,1]},{"bpm":240,"startTime":[4,0,1]}],
        "judgeLineGroup":["g"],
        "custom":true
    }`)
}

func TestBuildChartIndexSummarizesLines(t *testing.T) {
	text := sampleChart()
	artifact, err := Build(text)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if artifact.Header.LineCount != 3 {
		t.Fatalf("line count = %d, want 3", artifact.Header.LineCount)
	}
	if string(artifact.Header.META) != `{"name":"song","song":"audio.ogg","background":"cover.png"}` {
		t.Fatalf("META = %q", artifact.Header.META)
	}
	if string(artifact.Header.JudgeLineGroup) != `["g"]` {
		t.Fatalf("judgeLineGroup = %q", artifact.Header.JudgeLineGroup)
	}
	if string(artifact.Header.Extras["custom"]) != "true" {
		t.Fatalf("extras = %#v", artifact.Header.Extras)
	}
	if artifact.Index.Version != 1 || artifact.Index.TotalBytes != len(text) || artifact.Index.Canonical {
		t.Fatalf("index header = %#v", artifact.Index)
	}
	if artifact.Index.HeaderDigest == "" {
		t.Fatal("missing header digest")
	}
	if got, want := artifact.Index.AssetNames, []string{
		"audio.ogg", "cover.png", "line.png", "tap.wav", "ui.png",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("asset names = %#v, want %#v", got, want)
	}

	first := artifact.Index.Lines[0]
	if first.NoteCount != 1 || first.EventCount != 2 {
		t.Fatalf("first counts = %d/%d", first.NoteCount, first.EventCount)
	}
	if first.StartSeconds == nil || math.Abs(*first.StartSeconds-0) > 1e-9 {
		t.Fatalf("first start = %v", first.StartSeconds)
	}
	if first.EndSeconds == nil || math.Abs(*first.EndSeconds-2.5) > 1e-9 {
		t.Fatalf("first end = %v", first.EndSeconds)
	}
	if first.Flags&LineFlagShader == 0 || first.Flags&LineFlagUnbounded != 0 {
		t.Fatalf("first flags = %d", first.Flags)
	}
	if first.Group != 3 || first.Father != 0 || first.ID != "line-0" {
		t.Fatalf("first identity = %#v", first)
	}
	if first.ByteOffset < 0 || first.ByteLength <= 0 ||
		text[first.ByteOffset] != '{' {
		t.Fatalf("first range = %d/%d", first.ByteOffset, first.ByteLength)
	}

	second := artifact.Index.Lines[1]
	if second.NoteCount != 1 || second.EventCount != 0 {
		t.Fatalf("second counts = %d/%d", second.NoteCount, second.EventCount)
	}
	if second.StartSeconds == nil || math.Abs(*second.StartSeconds-1) > 1e-9 {
		t.Fatalf("second start = %v", second.StartSeconds)
	}
	if second.EndSeconds != nil {
		t.Fatalf("second end = %v, want null", *second.EndSeconds)
	}
	if second.Flags&LineFlagUnbounded == 0 {
		t.Fatalf("second flags = %d, want unbounded", second.Flags)
	}

	invalid := artifact.Index.Lines[2]
	if invalid.Flags&LineFlagInvalid == 0 || invalid.NoteCount != 0 || invalid.Father != -1 {
		t.Fatalf("invalid line = %#v", invalid)
	}
}

func TestLineSummaryMergesActivityIntervals(t *testing.T) {
	text := []byte(`{
        "judgeLineList":[
            {
                "notes":[{"startTime":[0,0,1],"endTime":[1,0,1],"visibleTime":0}],
                "eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[4,0,1],"end":0}]}]
            },
            {
                "notes":[{"startTime":[100,0,1],"endTime":[101,0,1],"visibleTime":0}],
                "eventLayers":[{"alphaEvents":[{"startTime":[100,0,1],"endTime":[104,0,1],"end":0}]}]
            }
        ],
        "META":{},
        "BPMList":[{"bpm":60,"startTime":[0,0,1]}]
    }`)
	artifact, err := Build(text)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	first := artifact.Index.Lines[0]
	if want := [][2]float64{{0, 4}}; !reflect.DeepEqual(first.Intervals, want) {
		t.Fatalf("first intervals = %#v, want %#v", first.Intervals, want)
	}
	second := artifact.Index.Lines[1]
	if want := [][2]float64{{100, 104}}; !reflect.DeepEqual(second.Intervals, want) {
		t.Fatalf("second intervals = %#v, want %#v", second.Intervals, want)
	}
}

func TestBuildChartIndexUsesTempoChangesAndBPMFactor(t *testing.T) {
	tempo, err := NewTempoMap([]BpmEntry{{BPM: 120, Beat: 0}, {BPM: 240, Beat: 4}})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		beat   float64
		factor float64
		want   float64
	}{
		{2, 1, 1},
		{6, 1, 2.5},
		{6, 2, 5},
		{6, 0.0001, 2.5},
	}
	for _, testCase := range cases {
		if got := tempo.Seconds(testCase.beat, testCase.factor); math.Abs(got-testCase.want) > 1e-9 {
			t.Fatalf("seconds(%v, %v) = %v, want %v", testCase.beat, testCase.factor, got, testCase.want)
		}
	}
}

func TestBuildChartIndexMatchesTypeScriptDigests(t *testing.T) {
	text := []byte(`{"judgeLineList":[{"Name":"first","notes":[{"type":1,"startTime":[0,0,1],"endTime":[1,0,1]}]},{"Name":"第二"},{"Name":"third"}],"META":{"name":"流式","song":"audio.ogg","background":"cover.png"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}],"custom":true}`)
	artifact, err := Build(text)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if got, want := artifact.Index.HeaderDigest, "96fce53f"; got != want {
		t.Fatalf("header digest = %s, want %s", got, want)
	}
	digests := make([]string, len(artifact.Index.Lines))
	for index, line := range artifact.Index.Lines {
		digests[index] = line.Digest
	}
	want := []string{"8e874793", "a149958e", "deb3f20c"}
	if !reflect.DeepEqual(digests, want) {
		t.Fatalf("line digests = %#v, want %#v", digests, want)
	}
}

func TestStaticLineIsBoundedAndUnboundedFlags(t *testing.T) {
	text := []byte(`{
        "judgeLineList":[
            {"Name":"static"},
            {"Name":"closed","eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[1,0,1],"end":0}]}]},
            {"Name":"open","eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[1,0,1],"end":1}]}]}
        ],
        "META":{},"BPMList":[{"bpm":120,"startTime":[0,0,1]}]
    }`)
	artifact, err := Build(text)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	static := artifact.Index.Lines[0]
	if static.Flags&LineFlagStatic == 0 || static.Flags&LineFlagUnbounded == 0 {
		t.Fatalf("static flags = %d", static.Flags)
	}
	if static.StartSeconds != nil || static.EndSeconds != nil {
		t.Fatalf("static bounds = %v/%v", static.StartSeconds, static.EndSeconds)
	}
	closed := artifact.Index.Lines[1]
	if closed.Flags&LineFlagUnbounded != 0 || closed.EndSeconds == nil {
		t.Fatalf("closed flags = %d, end = %v", closed.Flags, closed.EndSeconds)
	}
	open := artifact.Index.Lines[2]
	if open.Flags&LineFlagUnbounded == 0 || open.EndSeconds != nil {
		t.Fatalf("open flags = %d, end = %v", open.Flags, open.EndSeconds)
	}
}

func TestHeaderDefaultsForMissingFields(t *testing.T) {
	artifact, err := Build([]byte(`{"judgeLineList":[]}`))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if string(artifact.Header.META) != "{}" || string(artifact.Header.BPMList) != "[]" {
		t.Fatalf("header defaults = %q / %q", artifact.Header.META, artifact.Header.BPMList)
	}
	if artifact.Header.Extras == nil || len(artifact.Header.Extras) != 0 {
		t.Fatalf("extras = %#v", artifact.Header.Extras)
	}
	if artifact.Index.Lines == nil || len(artifact.Index.Lines) != 0 {
		t.Fatalf("lines = %#v", artifact.Index.Lines)
	}
	if artifact.Index.AssetNames == nil {
		t.Fatal("asset names must encode as []")
	}
	encoded, err := json.Marshal(artifact.Index)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" {
		t.Fatal("empty index did not encode")
	}
}
