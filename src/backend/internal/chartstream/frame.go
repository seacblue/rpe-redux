// Binary frame codec for chart streams. A frame is a little-endian u32 payload
// length, one kind byte, and a payload; payloads stay raw JSON so line text is
// never re-encoded by the transport.

package chartstream

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// FrameKind identifies the payload carried by one chart stream frame.
type FrameKind uint8

// Frame kinds shared with the TypeScript chart stream codec.
const (
	KindHeader  FrameKind = 1
	KindIndex   FrameKind = 2
	KindLine    FrameKind = 3
	KindLines   FrameKind = 4
	KindEffects FrameKind = 5
	KindBlock   FrameKind = 6
	KindEnd     FrameKind = 7
	KindError   FrameKind = 8
)

// Frame is one decoded chart stream frame.
type Frame struct {
	Kind    FrameKind
	Payload []byte
}

// EncodeFrame prefixes a payload with its little-endian length and kind byte.
func EncodeFrame(kind FrameKind, payload []byte) []byte {
	frame := make([]byte, 5+len(payload))
	binary.LittleEndian.PutUint32(frame[0:4], uint32(len(payload)))
	frame[4] = byte(kind)
	copy(frame[5:], payload)
	return frame
}

// AppendFrame appends one encoded frame to dst.
func AppendFrame(dst []byte, kind FrameKind, payload []byte) []byte {
	start := len(dst)
	dst = append(dst, make([]byte, 5+len(payload))...)
	binary.LittleEndian.PutUint32(dst[start:start+4], uint32(len(payload)))
	dst[start+4] = byte(kind)
	copy(dst[start+5:], payload)
	return dst
}

// WriteFrame writes one encoded frame to w.
func WriteFrame(w io.Writer, kind FrameKind, payload []byte) error {
	_, err := w.Write(EncodeFrame(kind, payload))
	return err
}

// WriteJSONFrame marshals value and writes it as one frame.
func WriteJSONFrame(w io.Writer, kind FrameKind, value any) error {
	frame, err := EncodeJSONFrame(kind, value)
	if err != nil {
		return err
	}
	_, err = w.Write(frame)
	return err
}

// WriteLineFrame streams a kind 3 frame without copying the raw line text.
func WriteLineFrame(w io.Writer, index uint32, raw []byte) error {
	var prefix [9]byte
	binary.LittleEndian.PutUint32(prefix[0:4], uint32(4+len(raw)))
	prefix[4] = byte(KindLine)
	binary.LittleEndian.PutUint32(prefix[5:9], index)
	if _, err := w.Write(prefix[:]); err != nil {
		return err
	}
	_, err := w.Write(raw)
	return err
}

// WriteLinesFrame streams a kind 4 frame without copying the raw array text.
func WriteLinesFrame(w io.Writer, start, count uint32, raw []byte) error {
	var prefix [13]byte
	binary.LittleEndian.PutUint32(prefix[0:4], uint32(8+len(raw)))
	prefix[4] = byte(KindLines)
	binary.LittleEndian.PutUint32(prefix[5:9], start)
	binary.LittleEndian.PutUint32(prefix[9:13], count)
	if _, err := w.Write(prefix[:]); err != nil {
		return err
	}
	_, err := w.Write(raw)
	return err
}

// EncodeJSONFrame marshals value as one JSON payload and wraps it in a frame.
func EncodeJSONFrame(kind FrameKind, value any) ([]byte, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode %d frame: %w", kind, err)
	}
	return EncodeFrame(kind, payload), nil
}

// EncodeLineFrame encodes one raw line as a kind 3 frame.
func EncodeLineFrame(index uint32, raw []byte) []byte {
	payload := make([]byte, 4+len(raw))
	binary.LittleEndian.PutUint32(payload[0:4], index)
	copy(payload[4:], raw)
	return EncodeFrame(KindLine, payload)
}

// EncodeLinesFrame encodes a line batch as a kind 4 frame.
func EncodeLinesFrame(start, count uint32, raw []byte) []byte {
	payload := make([]byte, 8+len(raw))
	binary.LittleEndian.PutUint32(payload[0:4], start)
	binary.LittleEndian.PutUint32(payload[4:8], count)
	copy(payload[8:], raw)
	return EncodeFrame(KindLines, payload)
}

// DecodeLinePayload reads a kind 3 payload as a line index and raw JSON text.
func DecodeLinePayload(frame Frame) (uint32, []byte, error) {
	if frame.Kind != KindLine || len(frame.Payload) < 4 {
		return 0, nil, fmt.Errorf("not a line frame")
	}
	return binary.LittleEndian.Uint32(frame.Payload[0:4]), frame.Payload[4:], nil
}

// DecodeLinesPayload reads a kind 4 payload as start, count, and raw JSON text.
func DecodeLinesPayload(frame Frame) (uint32, uint32, []byte, error) {
	if frame.Kind != KindLines || len(frame.Payload) < 8 {
		return 0, 0, nil, fmt.Errorf("not a lines frame")
	}
	start := binary.LittleEndian.Uint32(frame.Payload[0:4])
	count := binary.LittleEndian.Uint32(frame.Payload[4:8])
	return start, count, frame.Payload[8:], nil
}

// DecodeJSONFrame decodes a JSON frame payload into dst.
func DecodeJSONFrame(frame Frame, dst any) error {
	if err := json.Unmarshal(frame.Payload, dst); err != nil {
		return fmt.Errorf("decode %d frame: %w", frame.Kind, err)
	}
	return nil
}

// DecodeFrames reads every complete frame from data. A truncated trailing frame
// is reported as an error.
func DecodeFrames(data []byte) ([]Frame, error) {
	decoder := &Decoder{}
	frames, err := decoder.Push(data)
	if err != nil {
		return nil, err
	}
	if decoder.Pending() != 0 {
		return nil, fmt.Errorf("truncated chart frame: %d bytes pending", decoder.Pending())
	}
	return frames, nil
}

// Decoder incrementally reassembles frames from arbitrarily split chunks.
type Decoder struct {
	buffer []byte
}

// Push appends one chunk and returns every frame it completed.
func (d *Decoder) Push(chunk []byte) ([]Frame, error) {
	if len(chunk) > 0 {
		d.buffer = append(d.buffer, chunk...)
	}
	frames := make([]Frame, 0)
	offset := 0
	for len(d.buffer)-offset >= 5 {
		length := binary.LittleEndian.Uint32(d.buffer[offset : offset+4])
		if uint64(len(d.buffer)-offset) < uint64(5)+uint64(length) {
			break
		}
		kind := FrameKind(d.buffer[offset+4])
		payload := make([]byte, int(length))
		copy(payload, d.buffer[offset+5:offset+5+int(length)])
		frames = append(frames, Frame{Kind: kind, Payload: payload})
		offset += 5 + int(length)
	}
	if offset > 0 {
		d.buffer = append([]byte(nil), d.buffer[offset:]...)
	}
	return frames, nil
}

// Pending reports how many trailing bytes do not form a complete frame.
func (d *Decoder) Pending() int {
	return len(d.buffer)
}

// JoinFrames concatenates encoded frames for tests and buffered writers.
func JoinFrames(frames ...[]byte) []byte {
	return bytes.Join(frames, nil)
}
