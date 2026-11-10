// Frame codec tests: little-endian layout, split boundaries, and the line
// payload layouts shared with the TypeScript decoder.

package chartstream

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestFrameLayoutIsLittleEndian(t *testing.T) {
	frame := EncodeFrame(KindHeader, []byte(`{"META":{}}`))
	if got := binary.LittleEndian.Uint32(frame[0:4]); got != uint32(len(frame)-5) {
		t.Fatalf("length prefix = %d, want %d", got, len(frame)-5)
	}
	if frame[4] != byte(KindHeader) {
		t.Fatalf("kind = %d, want %d", frame[4], KindHeader)
	}
	if string(frame[5:]) != `{"META":{}}` {
		t.Fatalf("payload = %q", frame[5:])
	}
}

func TestFrameRoundTripAndSplitChunks(t *testing.T) {
	header, err := EncodeJSONFrame(KindHeader, map[string]any{"META": map[string]any{"name": "A"}})
	if err != nil {
		t.Fatal(err)
	}
	line := EncodeLineFrame(3, []byte(`{"Name":"Line 3"}`))
	lines := EncodeLinesFrame(4, 2, []byte(`[{"Name":"A"},{"Name":"B"}]`))
	all := JoinFrames(header, line, lines)

	decoder := &Decoder{}
	frames := make([]Frame, 0)
	for _, value := range all {
		part, err := decoder.Push([]byte{value})
		if err != nil {
			t.Fatalf("push byte: %v", err)
		}
		frames = append(frames, part...)
	}
	if len(frames) != 3 {
		t.Fatalf("frames = %d, want 3", len(frames))
	}
	if decoder.Pending() != 0 {
		t.Fatalf("pending = %d, want 0", decoder.Pending())
	}
	var decodedHeader map[string]any
	if err := DecodeJSONFrame(frames[0], &decodedHeader); err != nil {
		t.Fatal(err)
	}
	meta, _ := decodedHeader["META"].(map[string]any)
	if meta["name"] != "A" {
		t.Fatalf("header = %#v", decodedHeader)
	}
	index, raw, err := DecodeLinePayload(frames[1])
	if err != nil {
		t.Fatal(err)
	}
	if index != 3 || string(raw) != `{"Name":"Line 3"}` {
		t.Fatalf("line = %d %q", index, raw)
	}
	start, count, batch, err := DecodeLinesPayload(frames[2])
	if err != nil {
		t.Fatal(err)
	}
	if start != 4 || count != 2 || string(batch) != `[{"Name":"A"},{"Name":"B"}]` {
		t.Fatalf("lines = %d %d %q", start, count, batch)
	}
}

func TestDecodeFramesRejectsTruncatedTail(t *testing.T) {
	frame := EncodeFrame(KindEnd, []byte(`{"bytes":1}`))
	if _, err := DecodeFrames(frame[:len(frame)-1]); err == nil {
		t.Fatal("truncated frame was accepted")
	}
}

func TestWriteLineFrameMatchesEncodedLineFrame(t *testing.T) {
	raw := []byte(`{"Name":"音符"}`)
	var buffer bytes.Buffer
	if err := WriteLineFrame(&buffer, 7, raw); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buffer.Bytes(), EncodeLineFrame(7, raw)) {
		t.Fatal("streamed line frame differs from the encoded frame")
	}
	var buffer2 bytes.Buffer
	if err := WriteLinesFrame(&buffer2, 2, 1, []byte(`[1]`)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buffer2.Bytes(), EncodeLinesFrame(2, 1, []byte(`[1]`))) {
		t.Fatal("streamed lines frame differs from the encoded frame")
	}
}

func TestEncodeJSONFrameIsValidJSON(t *testing.T) {
	frame, err := EncodeJSONFrame(KindIndex, map[string]any{"version": 1, "lines": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(frame[5:], &value); err != nil {
		t.Fatal(err)
	}
	if value["version"] != float64(1) {
		t.Fatalf("payload = %#v", value)
	}
}
