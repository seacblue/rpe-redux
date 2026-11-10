// Transport coverage for binary asset chunks, blob adoption, resume chart
// skipping, and gzip transaction batches.

package collab

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

// testBinaryAssetFrame builds the binary asset header the room protocol uses.
func testBinaryAssetFrame(t *testing.T, header map[string]any, body []byte) []byte {
	t.Helper()
	encoded, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 4+len(encoded)+len(body))
	frame[0] = byte(len(encoded) >> 24)
	frame[1] = byte(len(encoded) >> 16)
	frame[2] = byte(len(encoded) >> 8)
	frame[3] = byte(len(encoded))
	copy(frame[4:], encoded)
	copy(frame[4+len(encoded):], body)
	return frame
}

// decodeTestBinaryAssetFrame splits one binary asset frame from the server.
func decodeTestBinaryAssetFrame(t *testing.T, payload []byte) (map[string]any, []byte) {
	t.Helper()
	if len(payload) < 4 {
		t.Fatalf("binary frame length = %d", len(payload))
	}
	length := int(payload[0])<<24 | int(payload[1])<<16 | int(payload[2])<<8 | int(payload[3])
	if 4+length > len(payload) {
		t.Fatalf("binary header length = %d, frame = %d", length, len(payload))
	}
	var header map[string]any
	if err := json.Unmarshal(payload[4:4+length], &header); err != nil {
		t.Fatal(err)
	}
	return header, payload[4+length:]
}

// gzipChanges encodes one change batch the way a large client transaction does.
func gzipChanges(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(encoded); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buffer.Bytes())
}

func TestCollabBinaryAssetChunksAndBlobAdoption(t *testing.T) {
	rooms := NewRooms()
	server := NewServer(rooms, nil, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	asset := []byte("\x89PNG\r\n\x1a\nbinary asset")
	hash := sha256Hex(asset)

	host := dialTestWS(t, httpServer.URL)
	defer host.close()
	host.sendJSON(t, map[string]any{
		"type":              "create",
		"profile":           map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":             collabTestChart(),
		"fingerprint":       "fingerprint",
		"binaryChunks":      true,
		"autoApproveEditor": true,
	})
	welcome := host.readUntil(t, "welcome")
	if welcome["binaryChunks"] != true || welcome["assetAdopt"] != true {
		t.Fatalf("transport capabilities = %v", welcome)
	}

	host.sendJSON(t, map[string]any{
		"type":      "asset-begin",
		"requestId": "upload-1",
		"name":      "cover.png",
		"hash":      hash,
		"size":      len(asset),
		"mime":      "image/png",
		"adopt":     true,
	})
	begin := host.readUntil(t, "asset-begin-result")
	if begin["adopted"] != false {
		t.Fatalf("first begin adopted = %v", begin["adopted"])
	}
	if err := host.write(collabWSOpcodeBinary, testBinaryAssetFrame(t, map[string]any{
		"type":      "asset-chunk",
		"requestId": "upload-1",
		"index":     0,
	}, asset)); err != nil {
		t.Fatal(err)
	}
	host.sendJSON(t, map[string]any{"type": "asset-commit", "requestId": "upload-1"})
	accepted := host.readUntil(t, "asset-accepted")
	assetWire, _ := accepted["asset"].(map[string]any)
	if assetWire["hash"] != hash {
		t.Fatalf("accepted asset = %v", accepted["asset"])
	}

	// The same server-global blob is attached to a second name without a
	// second upload.
	host.sendJSON(t, map[string]any{
		"type":      "asset-begin",
		"requestId": "upload-2",
		"name":      "copy.png",
		"hash":      hash,
		"size":      len(asset),
		"mime":      "image/png",
		"adopt":     true,
	})
	adopted := host.readUntil(t, "asset-begin-result")
	if adopted["adopted"] != true {
		t.Fatalf("second begin adopted = %v", adopted["adopted"])
	}

	host.sendJSON(t, map[string]any{
		"type":      "asset-request",
		"requestId": "download-1",
		"hash":      hash,
		"name":      "copy.png",
	})
	host.readUntil(t, "asset-download-begin")
	opcode, payload := host.readMessage(t)
	if opcode != collabWSOpcodeBinary {
		t.Fatalf("download opcode = %d", opcode)
	}
	header, body := decodeTestBinaryAssetFrame(t, payload)
	if header["type"] != "asset-download-chunk" || header["requestId"] != "download-1" {
		t.Fatalf("download header = %v", header)
	}
	if !bytes.Equal(body, asset) {
		t.Fatalf("download body = %q", body)
	}
	host.readUntil(t, "asset-download-end")
}

func TestCollabResumeSkipsUnchangedChart(t *testing.T) {
	rooms := NewRooms()
	server := NewServer(rooms, nil, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	host := dialTestWS(t, httpServer.URL)
	defer host.close()
	host.sendJSON(t, map[string]any{
		"type":        "create",
		"profile":     map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":       collabTestChart(),
		"fingerprint": "fingerprint",
	})
	welcome := host.readUntil(t, "welcome")
	roomID, _ := welcome["roomId"].(string)
	token, _ := welcome["resumeToken"].(string)
	if roomID == "" || token == "" {
		t.Fatalf("welcome = %v", welcome)
	}

	resumedSocket := dialTestWS(t, httpServer.URL)
	defer resumedSocket.close()
	resumedSocket.sendJSON(t, map[string]any{
		"type":         "resume",
		"roomId":       roomID,
		"token":        token,
		"binaryChunks": true,
		"hasChart":     true,
		"revision":     0,
		"fingerprint":  "fingerprint",
	})
	resumed := resumedSocket.readUntil(t, "welcome")
	if resumed["chart"] != nil || resumed["chartEncoding"] != nil {
		t.Fatalf("unchanged resume sent a chart: %v", resumed)
	}
	if resumed["binaryChunks"] != true {
		t.Fatalf("resume capabilities = %v", resumed)
	}

	staleSocket := dialTestWS(t, httpServer.URL)
	defer staleSocket.close()
	staleSocket.sendJSON(t, map[string]any{
		"type":        "resume",
		"roomId":      roomID,
		"token":       token,
		"hasChart":    true,
		"revision":    0,
		"fingerprint": "stale",
	})
	stale := staleSocket.readUntil(t, "welcome")
	if stale["chart"] == nil {
		t.Fatalf("stale resume omitted the chart: %v", stale)
	}
}

func TestCollabGzipTransactionWire(t *testing.T) {
	rooms := NewRooms()
	server := NewServer(rooms, nil, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	host := dialTestWS(t, httpServer.URL)
	defer host.close()
	host.sendJSON(t, map[string]any{
		"type":        "create",
		"profile":     map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":       collabTestChart(),
		"fingerprint": "fingerprint",
	})
	host.readUntil(t, "welcome")

	changes := []any{
		map[string]any{
			"op":     "set",
			"path":   "/META/name",
			"before": "room",
			"after":  strings.Repeat("x", 20_000),
		},
	}
	host.sendJSON(t, map[string]any{
		"type":              "transaction",
		"transactionId":     "large",
		"label":             "large edit",
		"changes":           gzipChanges(t, changes),
		"changesEncoding":   "gzip",
		"affectedObjectIds": []string{},
	})
	committed := host.readUntil(t, "committed")
	if committed["changesEncoding"] != "gzip" {
		t.Fatalf("large committed encoding = %v", committed["changesEncoding"])
	}
	wire, _ := committed["changes"].(string)
	compressed, err := base64.StdEncoding.DecodeString(wire)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(decoded), strings.Repeat("x", 20_000)) {
		t.Fatalf("decoded large changes = %s", decoded)
	}

	small := []any{
		map[string]any{"op": "set", "path": "/BPMList/0/bpm", "before": 120.0, "after": 121.0},
	}
	host.sendJSON(t, map[string]any{
		"type":              "transaction",
		"transactionId":     "small",
		"label":             "small edit",
		"changes":           small,
		"affectedObjectIds": []string{},
	})
	smallCommitted := host.readUntil(t, "committed")
	if _, ok := smallCommitted["changesEncoding"]; ok {
		t.Fatalf("small committed encoding = %v", smallCommitted["changesEncoding"])
	}
	if _, ok := smallCommitted["changes"].([]any); !ok {
		t.Fatalf("small committed changes = %T", smallCommitted["changes"])
	}
}
