// Chart wire encoding for the collaboration room listener.
//
// Plaintext charts are JSON documents with heavy repetition, so the listener
// stores one gzip/base64 copy per accepted revision and sends that copy in a
// welcome or snapshot. Encrypted rooms keep their opaque envelope unchanged.

package collab

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Maximum decompressed chart document accepted from one room payload.
const collabMaxChartJSON = int64(512) << 20

// collabDecodeChart expands a base64 gzip chart payload into its JSON value.
func collabDecodeChart(value any) (any, error) {
	text, ok := value.(string)
	if !ok || text == "" {
		return nil, errors.New("compressed chart payload is missing")
	}
	compressed, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		return nil, fmt.Errorf("compressed chart is not base64: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("compressed chart is not gzip: %w", err)
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, collabMaxChartJSON+1))
	if err != nil {
		return nil, fmt.Errorf("compressed chart could not be read: %w", err)
	}
	if int64(len(data)) > collabMaxChartJSON {
		return nil, errors.New("chart exceeds the supported size")
	}
	var chart any
	if err := json.Unmarshal(data, &chart); err != nil {
		return nil, fmt.Errorf("chart JSON is invalid: %w", err)
	}
	return chart, nil
}

// collabEncodeChart compresses one chart value into base64 gzip JSON.
func collabEncodeChart(chart any) (string, error) {
	data, err := json.Marshal(chart)
	if err != nil {
		return "", fmt.Errorf("chart could not be serialized: %w", err)
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		return "", fmt.Errorf("chart could not be compressed: %w", err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("chart could not be compressed: %w", err)
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes()), nil
}
