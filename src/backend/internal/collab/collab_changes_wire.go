// Gzip wire encoding for large plaintext transaction batches.
//
// A batch at or below the threshold travels as the original JSON array. Larger
// batches become a base64 gzip string tagged `changesEncoding: "gzip"`, which
// both room servers and the client decode before applying.

package collab

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
)

// collabChangesGzipThreshold is the serialized size above which a batch is
// compressed. Small edits keep the lower latency of an uncompressed array.
const collabChangesGzipThreshold = 16 << 10

// collabMaxChangesJSON bounds one decompressed change batch.
const collabMaxChangesJSON = int64(512) << 20

// collabDecodeChangesWire expands a base64 gzip change batch.
func collabDecodeChangesWire(value any) ([]collabChange, error) {
	text, ok := value.(string)
	if !ok {
		return nil, errors.New("compressed changes are not text")
	}
	compressed, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, errors.New("compressed changes are not base64")
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, errors.New("compressed changes are not gzip")
	}
	defer reader.Close()
	decoded, err := io.ReadAll(io.LimitReader(reader, collabMaxChangesJSON+1))
	if err != nil {
		return nil, errors.New("compressed changes could not be expanded")
	}
	if int64(len(decoded)) > collabMaxChangesJSON {
		return nil, errors.New("compressed changes exceed the supported size")
	}
	var changes []collabChange
	if err := json.Unmarshal(decoded, &changes); err != nil || changes == nil {
		return nil, errors.New("compressed changes are not a change array")
	}
	return changes, nil
}

// collabEncodeChangesWire compresses one plaintext batch when it is large
// enough to benefit, returning the wire value and its encoding tag.
func collabEncodeChangesWire(value any) (any, string) {
	canonical := collabCanonical(value)
	if len(canonical) <= collabChangesGzipThreshold {
		return value, ""
	}
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestSpeed)
	if err != nil {
		return value, ""
	}
	if _, err := writer.Write([]byte(canonical)); err != nil {
		_ = writer.Close()
		return value, ""
	}
	if err := writer.Close(); err != nil {
		return value, ""
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes()), "gzip"
}
