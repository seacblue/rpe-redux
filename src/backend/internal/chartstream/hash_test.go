// Canonical hash tests: determinism, id independence, and parity with the
// TypeScript chart content hash fixtures.

package chartstream

import (
	"encoding/json"
	"testing"
)

func decodeFixture(t *testing.T, raw string) any {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return value
}

func TestLineContentFingerprintIgnoresObjectIds(t *testing.T) {
	withIDs := decodeFixture(t, `{
        "Name":"Line 1","Group":2,"father":0,"id":"line-a",
        "notes":[{"type":1,"startTime":[1,0,1],"endTime":[1,1,2],"id":"note-a","visibleTime":2,"hitSound":"tap.wav"}],
        "eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[2,0,1],"start":1,"end":0,"id":"ev-a"}]}],
        "extended":{"paintEvents":[{"startTime":[0,0,1],"endTime":[1,0,1],"start":0,"end":1}]}
    }`)
	withoutIDs := decodeFixture(t, `{
        "Name":"Line 1","Group":2,"father":0,"id":"other-line",
        "notes":[{"type":1,"startTime":[1,0,1],"endTime":[1,1,2],"id":"other-note","visibleTime":2,"hitSound":"tap.wav"}],
        "eventLayers":[{"alphaEvents":[{"startTime":[0,0,1],"endTime":[2,0,1],"start":1,"end":0,"id":"other-ev"}]}],
        "extended":{"paintEvents":[{"startTime":[0,0,1],"endTime":[1,0,1],"start":0,"end":1}]}
    }`)
	if got, want := LineContentFingerprint(withIDs), "10ab28ab"; got != want {
		t.Fatalf("line digest = %s, want %s", got, want)
	}
	if got := LineContentFingerprint(withoutIDs); got != "10ab28ab" {
		t.Fatalf("digest depends on ids: %s", got)
	}
}

func TestContentFingerprintSortsKeys(t *testing.T) {
	left := decodeFixture(t, `{"b":[1,2,3],"a":{"y":null,"x":"z"}}`)
	right := decodeFixture(t, `{"a":{"x":"z","y":null},"b":[1,2,3]}`)
	if got, want := ContentFingerprint(left, false), ContentFingerprint(right, false); got != want {
		t.Fatalf("key order changed digest: %s != %s", got, want)
	}
}

func TestLineContentFingerprintMatchesComplexFixture(t *testing.T) {
	line := decodeFixture(t, `{
        "a":1e21,
        "b":0.000001,
        "c":-0,
        "d":"音😀",
        "e":[true,false,null,{"id":"x","v":123456789012345680000}],
        "f":{"z":[],"y":{}}
    }`)
	if got, want := LineContentFingerprint(line), "6b15108a"; got != want {
		t.Fatalf("complex digest = %s, want %s", got, want)
	}
}

func TestLineContentFingerprintMatchesEscapedStrings(t *testing.T) {
	line := decodeFixture(t, `{"s":"quote \" backslash \\ newline \n tab \t control \u0001 slash /","arr":["a","b"]}`)
	if got, want := LineContentFingerprint(line), "b280eefb"; got != want {
		t.Fatalf("escaped digest = %s, want %s", got, want)
	}
}

func TestHeaderContentFingerprintMatchesFixture(t *testing.T) {
	header := decodeFixture(t, `{
        "META":{"name":"Song","id":"meta-id"},
        "BPMList":[{"bpm":120,"startTime":[0,0,1]}],
        "judgeLineList":[],
        "custom":true,
        "nested":{"b":[1,2,3],"a":null}
    }`).(map[string]any)
	if got, want := HeaderContentFingerprint(header), "d76a7b02"; got != want {
		t.Fatalf("header digest = %s, want %s", got, want)
	}
}

func TestCombineContentFingerprintMatchesFixture(t *testing.T) {
	if got, want := CombineContentFingerprint("deadbeef", []string{"00000001", "00000002"}), "76803532"; got != want {
		t.Fatalf("combined digest = %s, want %s", got, want)
	}
}

func TestJSNumbersUseECMAScriptFormatting(t *testing.T) {
	cases := []struct {
		value float64
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{1.5, "1.5"},
		{1e21, "1e+21"},
		{1e20, "100000000000000000000"},
		{1e-6, "0.000001"},
		{1e-7, "1e-7"},
		{123456789012345680000, "123456789012345680000"},
		{1.2345678901234568e-5, "0.000012345678901234568"},
		{-2.5, "-2.5"},
	}
	for _, testCase := range cases {
		if got := jsNumberString(testCase.value); got != testCase.want {
			t.Fatalf("jsNumberString(%v) = %q, want %q", testCase.value, got, testCase.want)
		}
	}
}

func TestHashTextMatchesFixture(t *testing.T) {
	if got, want := hashText("abc", hashSeed), uint32(0x1a47e90b); got != want {
		t.Fatalf("hashText = %08x, want %08x", got, want)
	}
}
