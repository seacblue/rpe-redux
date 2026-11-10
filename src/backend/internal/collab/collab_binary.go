// Binary asset-chunk framing shared by upload and download streams.
//
// A binary asset message is a four-byte big-endian JSON-header length, the
// header object, and the raw chunk bytes. Control messages stay text JSON, so
// every other protocol path keeps its existing encoding.

package collab

import (
	"encoding/binary"
	"encoding/json"
	"errors"
)

// collabMaxBinaryHeader bounds the JSON header that precedes a chunk.
const collabMaxBinaryHeader = 16 << 10

// collabBinaryFrame builds one binary frame body from a header and raw bytes.
func collabBinaryFrame(header map[string]any, payload []byte) ([]byte, error) {
	encoded, err := json.Marshal(header)
	if err != nil {
		return nil, err
	}
	if len(encoded) == 0 || len(encoded) > collabMaxBinaryHeader {
		return nil, errors.New("binary asset header is invalid")
	}
	frame := make([]byte, 4+len(encoded)+len(payload))
	binary.BigEndian.PutUint32(frame[:4], uint32(len(encoded)))
	copy(frame[4:], encoded)
	copy(frame[4+len(encoded):], payload)
	return frame, nil
}

// collabParseBinaryFrame splits one binary frame body into its header fields
// and chunk bytes.
func collabParseBinaryFrame(payload []byte) (map[string]any, []byte, error) {
	if len(payload) < 4 {
		return nil, nil, errors.New("binary asset frame is too short")
	}
	length := int(binary.BigEndian.Uint32(payload[:4]))
	if length == 0 || length > collabMaxBinaryHeader || 4+length > len(payload) {
		return nil, nil, errors.New("binary asset header is invalid")
	}
	var header map[string]any
	if err := json.Unmarshal(payload[4:4+length], &header); err != nil || header == nil {
		return nil, nil, errors.New("binary asset header is not JSON")
	}
	return header, payload[4+length:], nil
}
