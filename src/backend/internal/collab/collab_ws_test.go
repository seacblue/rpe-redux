// End-to-end transport test for the embedded room: upgrade, approval,
// transaction broadcast, locks, and chunked asset transfer.

package collab

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Frame opcodes asserted by the raw test client.
const (
	collabWSOpcodeText  = 0x1
	collabWSOpcodeClose = 0x8
)

type testWS struct {
	conn   net.Conn
	reader *bufio.Reader
}

func dialTestWS(t *testing.T, serverURL string) *testWS {
	t.Helper()
	parsed, err := url.Parse(serverURL)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.Dial("tcp", parsed.Host)
	if err != nil {
		t.Fatal(err)
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		t.Fatal(err)
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	if _, err := fmt.Fprintf(
		conn,
		"GET /rooms HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
			"Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n",
		parsed.Host,
		key,
	); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("websocket status = %d", response.StatusCode)
	}
	return &testWS{conn: conn, reader: reader}
}

func (w *testWS) close() {
	_ = w.conn.Close()
}

func (w *testWS) write(opcode byte, payload []byte) error {
	_ = w.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	header := []byte{0x80 | opcode}
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, 0x80|byte(length))
	case length < 65536:
		header = append(header, 0x80|126, 0, 0)
		binary.BigEndian.PutUint16(header[len(header)-2:], uint16(length))
	default:
		header = append(header, 0x80|127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(header[len(header)-8:], uint64(length))
	}
	mask := []byte{0x12, 0x34, 0x56, 0x78}
	header = append(header, mask...)
	masked := make([]byte, len(payload))
	for index, value := range payload {
		masked[index] = value ^ mask[index%4]
	}
	if _, err := w.conn.Write(append(header, masked...)); err != nil {
		return err
	}
	return nil
}

func (w *testWS) sendJSON(t *testing.T, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.write(collabWSOpcodeText, payload); err != nil {
		t.Fatal(err)
	}
}

func (w *testWS) readMessage(t *testing.T) (byte, []byte) {
	t.Helper()
	_ = w.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	header := make([]byte, 2)
	if _, err := io.ReadFull(w.reader, header); err != nil {
		t.Fatal(err)
	}
	opcode := header[0] & 0x0f
	length := uint64(header[1] & 0x7f)
	switch length {
	case 126:
		extended := make([]byte, 2)
		if _, err := io.ReadFull(w.reader, extended); err != nil {
			t.Fatal(err)
		}
		length = uint64(binary.BigEndian.Uint16(extended))
	case 127:
		extended := make([]byte, 8)
		if _, err := io.ReadFull(w.reader, extended); err != nil {
			t.Fatal(err)
		}
		length = binary.BigEndian.Uint64(extended)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(w.reader, payload); err != nil {
		t.Fatal(err)
	}
	return opcode, payload
}

func (w *testWS) readUntil(t *testing.T, messageType string) map[string]any {
	t.Helper()
	for attempts := 0; attempts < 30; attempts++ {
		opcode, payload := w.readMessage(t)
		if opcode == collabWSOpcodeClose {
			t.Fatalf("socket closed while waiting for %s", messageType)
		}
		if opcode != collabWSOpcodeText {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			t.Fatalf("decode %s: %v: %s", messageType, err, payload)
		}
		if message["type"] == messageType {
			return message
		}
	}
	t.Fatalf("did not receive %s", messageType)
	return nil
}

func TestCollabWebSocketApprovalTransactionsLocksAndAssets(t *testing.T) {
	rooms := NewRooms()
	server := NewServer(rooms, nil, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	health, err := http.Get(httpServer.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer health.Body.Close()
	if health.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d", health.StatusCode)
	}

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
	invite, _ := welcome["invite"].(string)
	if roomID == "" || invite == "" {
		t.Fatalf("welcome = %v", welcome)
	}
	if locks, ok := welcome["locks"].([]any); !ok || len(locks) != 0 {
		t.Fatalf("welcome locks = %v", welcome["locks"])
	}
	hostToken, _ := welcome["resumeToken"].(string)
	if hostToken == "" {
		t.Fatal("host resume token is empty")
	}

	editor := dialTestWS(t, httpServer.URL)
	defer editor.close()
	editor.sendJSON(t, map[string]any{
		"type":    "join",
		"roomId":  roomID,
		"invite":  invite,
		"profile": map[string]any{"name": "Editor", "color": "#00ff00"},
	})
	editor.readUntil(t, "waiting")
	pending := host.readUntil(t, "pending")
	requestID, _ := pending["requestId"].(string)
	if requestID == "" {
		t.Fatal("join request id is empty")
	}
	host.sendJSON(t, map[string]any{
		"type":      "approve",
		"requestId": requestID,
		"allow":     true,
		"role":      "editor",
	})
	host.readUntil(t, "pending-cleared")
	editorWelcome := editor.readUntil(t, "welcome")
	if editorWelcome["role"] != "editor" {
		t.Fatalf("editor role = %v", editorWelcome["role"])
	}

	editor.sendJSON(t, map[string]any{
		"type":          "transaction",
		"transactionId": "tx-1",
		"baseRevision":  0,
		"label":         "rename",
		"changes": []any{
			map[string]any{"op": "set", "path": "/META/name", "before": "room", "after": "next"},
		},
	})
	committed := editor.readUntil(t, "committed")
	if committed["revision"] != 1.0 {
		t.Fatalf("committed = %v", committed)
	}
	hostCommitted := host.readUntil(t, "committed")
	if hostCommitted["transactionId"] != "tx-1" {
		t.Fatalf("host committed = %v", hostCommitted)
	}

	editor.sendJSON(t, map[string]any{
		"type":      "lock-request",
		"requestId": "lock-1",
		"ids":       []any{"line:line"},
		"ttlMs":     15000,
	})
	lockResult := editor.readUntil(t, "lock-result")
	if lockResult["granted"] != true {
		t.Fatalf("lock result = %v", lockResult)
	}

	assetBytes := []byte("\x89PNG\r\n\x1a\nasset")
	assetHash := sha256Hex(assetBytes)
	editor.sendJSON(t, map[string]any{
		"type":      "asset-begin",
		"requestId": "upload-1",
		"name":      "cover.png",
		"hash":      assetHash,
		"size":      len(assetBytes),
		"mime":      "image/png",
	})
	editor.sendJSON(t, map[string]any{
		"type":      "asset-chunk",
		"requestId": "upload-1",
		"index":     0,
		"data":      base64.StdEncoding.EncodeToString(assetBytes),
	})
	editor.sendJSON(t, map[string]any{"type": "asset-commit", "requestId": "upload-1"})
	accepted := editor.readUntil(t, "asset-accepted")
	asset, _ := accepted["asset"].(map[string]any)
	if asset["hash"] != assetHash {
		t.Fatalf("asset accepted = %v", accepted)
	}

	host.sendJSON(t, map[string]any{
		"type":      "asset-request",
		"requestId": "download-1",
		"hash":      assetHash,
		"name":      "cover.png",
	})
	begin := host.readUntil(t, "asset-download-begin")
	if begin["totalChunks"] != 1.0 {
		t.Fatalf("download begin = %v", begin)
	}
	chunk := host.readUntil(t, "asset-download-chunk")
	data, _ := chunk["data"].(string)
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil || string(decoded) != string(assetBytes) {
		t.Fatalf("download chunk = %q, %v", decoded, err)
	}
	host.readUntil(t, "asset-download-end")
}

func sendTestAsset(t *testing.T, socket *testWS, requestID, name, mime string, bytes []byte) {
	t.Helper()
	socket.sendJSON(t, map[string]any{
		"type":      "asset-begin",
		"requestId": requestID,
		"name":      name,
		"hash":      sha256Hex(bytes),
		"size":      len(bytes),
		"mime":      mime,
	})
	socket.sendJSON(t, map[string]any{
		"type":      "asset-chunk",
		"requestId": requestID,
		"index":     0,
		"data":      base64.StdEncoding.EncodeToString(bytes),
	})
	socket.sendJSON(t, map[string]any{"type": "asset-commit", "requestId": requestID})
}

func TestCollabWebSocketAssetReplacementIsHostOnly(t *testing.T) {
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
	invite, _ := welcome["invite"].(string)
	hostMemberID, _ := welcome["memberId"].(string)

	editor := dialTestWS(t, httpServer.URL)
	defer editor.close()
	editor.sendJSON(t, map[string]any{
		"type":    "join",
		"roomId":  roomID,
		"invite":  invite,
		"profile": map[string]any{"name": "Editor", "color": "#00ff00"},
	})
	editor.readUntil(t, "waiting")
	pending := host.readUntil(t, "pending")
	host.sendJSON(t, map[string]any{
		"type":      "approve",
		"requestId": pending["requestId"],
		"allow":     true,
		"role":      "editor",
	})
	host.readUntil(t, "pending-cleared")
	editor.readUntil(t, "welcome")

	original := []byte("\x89PNG\r\n\x1a\noriginal")
	sendTestAsset(t, editor, "upload-original", "cover.png", "image/png", original)
	editor.readUntil(t, "asset-accepted")
	// Drain the approval and first-manifest broadcasts so the failed
	// replacement below can be checked for silence.
	host.readUntil(t, "members")
	host.readUntil(t, "asset-accepted")
	host.readUntil(t, "asset-manifest")

	replacement := []byte("\x89PNG\r\n\x1a\nreplacement")
	replacementHash := sha256Hex(replacement)
	sendTestAsset(t, editor, "upload-replace", "cover.png", "image/png", replacement)
	editorReplacementAccepted := false
	for attempts := 0; attempts < 5; attempts++ {
		accepted := editor.readUntil(t, "asset-accepted")
		asset, _ := accepted["asset"].(map[string]any)
		if asset["name"] == "cover.png" && asset["hash"] == replacementHash {
			editorReplacementAccepted = true
			break
		}
	}
	if !editorReplacementAccepted {
		t.Fatal("editor replacement was not accepted")
	}

	sendTestAsset(t, editor, "upload-new", "extra.png", "image/png", replacement)
	editor.readUntil(t, "asset-accepted")

	sendTestAsset(t, host, "host-replace", "cover.png", "image/png", original)
	hostReplacementAccepted := false
	for attempts := 0; attempts < 5; attempts++ {
		accepted := host.readUntil(t, "asset-accepted")
		asset, _ := accepted["asset"].(map[string]any)
		if asset["name"] == "cover.png" && asset["hash"] == sha256Hex(original) {
			hostReplacementAccepted = true
			break
		}
	}
	if !hostReplacementAccepted {
		t.Fatal("host replacement was not accepted")
	}
	room := rooms.roomForMember(hostMemberID)
	if room == nil {
		t.Fatal("host room missing")
	}
	if manifest := rooms.assetManifest(room); len(manifest) != 2 {
		t.Fatalf("manifest = %v", manifest)
	}
}

func TestCollabOriginAllowsDesktopAndRejectsWebPages(t *testing.T) {
	allowed := []string{"", "tauri://localhost", "http://tauri.localhost", "http://127.0.0.1:4173", "https://localhost"}
	for _, origin := range allowed {
		if !collabOriginAllowed(origin) {
			t.Fatalf("origin %q should be allowed", origin)
		}
	}
	rejected := []string{"https://example.com", "http://192.168.1.20:4173", "file://"}
	for _, origin := range rejected {
		if collabOriginAllowed(origin) {
			t.Fatalf("origin %q should be rejected", origin)
		}
	}
}

func TestCollabUpgradeRateLimitClosesTheWindow(t *testing.T) {
	server := &Server{upgrades: map[string]collabRateWindow{}}
	for attempt := 0; attempt < collabUpgradeLimit; attempt++ {
		if !server.allowUpgrade("203.0.113.5:5000") {
			t.Fatalf("attempt %d should be allowed", attempt)
		}
	}
	if server.allowUpgrade("203.0.113.5:5000") {
		t.Fatal("attempt above the limit should be rejected")
	}
	if !server.allowUpgrade("203.0.113.6:5000") {
		t.Fatal("a different address keeps its own window")
	}
}

func TestCollabUpgradeRateLimitKeepsForwardedClientsIsolated(t *testing.T) {
	server := &Server{upgrades: map[string]collabRateWindow{}}
	headers := func(address string) http.Header {
		return http.Header{"X-Forwarded-For": []string{address}}
	}
	for attempt := 0; attempt < collabUpgradeLimit; attempt++ {
		if !server.allowUpgradeRequest("127.0.0.1:5000", headers("198.51.100.7")) {
			t.Fatalf("client attempt %d should be allowed", attempt)
		}
	}
	if server.allowUpgradeRequest("127.0.0.1:5000", headers("198.51.100.7")) {
		t.Fatal("one forwarded client exhausted its budget")
	}
	if !server.allowUpgradeRequest("127.0.0.1:5000", headers("198.51.100.8")) {
		t.Fatal("a different forwarded client should keep its own window")
	}
	// A direct client cannot escape the aggregate window by forging a header.
	for attempt := 0; attempt < collabUpgradeLimit; attempt++ {
		if !server.allowUpgradeRequest("203.0.113.9:5000", headers("198.51.100.99")) {
			t.Fatalf("direct attempt %d should be allowed", attempt)
		}
	}
	if server.allowUpgradeRequest("203.0.113.9:5000", headers("198.51.100.100")) {
		t.Fatal("a forged forwarded header bypassed the direct window")
	}
}

// expectNoMessage fails when the socket delivers anything before the deadline.
func (w *testWS) expectNoMessage(t *testing.T, wait time.Duration) {
	t.Helper()
	_ = w.conn.SetReadDeadline(time.Now().Add(wait))
	header := make([]byte, 2)
	if _, err := io.ReadFull(w.reader, header); err != nil {
		var netErr net.Error
		if errors.As(err, &netErr) && netErr.Timeout() {
			return
		}
		t.Fatalf("read while expecting silence: %v", err)
	}
	t.Fatalf("unexpected websocket message header %v", header)
}

func TestCollabWebSocketReplayIsNotRebroadcast(t *testing.T) {
	rooms := NewRooms()
	server := NewServer(rooms, nil, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	host := dialTestWS(t, httpServer.URL)
	defer host.close()
	host.sendJSON(t, map[string]any{
		"type":              "create",
		"profile":           map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":             collabTestChart(),
		"fingerprint":       "replay",
		"autoApproveEditor": true,
	})
	welcome := host.readUntil(t, "welcome")
	roomID, _ := welcome["roomId"].(string)
	invite, _ := welcome["invite"].(string)

	editor := dialTestWS(t, httpServer.URL)
	defer editor.close()
	editor.sendJSON(t, map[string]any{
		"type":    "join",
		"roomId":  roomID,
		"invite":  invite,
		"profile": map[string]any{"name": "Editor", "color": "#00ff00"},
	})
	editor.readUntil(t, "welcome")
	host.readUntil(t, "members")

	transaction := map[string]any{
		"type":          "transaction",
		"transactionId": "tx-replay",
		"label":         "rename",
		"changes": []any{
			map[string]any{"op": "set", "path": "/META/name", "before": "room", "after": "once"},
		},
	}
	editor.sendJSON(t, transaction)
	editor.readUntil(t, "committed")
	host.readUntil(t, "committed")
	editor.sendJSON(t, transaction)
	editor.readUntil(t, "committed")
	host.expectNoMessage(t, 300*time.Millisecond)
}

func TestCollabWebSocketHostCloseNotifiesAndPersistsDeletion(t *testing.T) {
	rooms := NewRooms()
	persister := NewPersister(t.TempDir(), rooms, nil)
	server := NewServer(rooms, persister, nil)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	host := dialTestWS(t, httpServer.URL)
	defer host.close()
	host.sendJSON(t, map[string]any{
		"type":              "create",
		"profile":           map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":             collabTestChart(),
		"fingerprint":       "close",
		"autoApproveEditor": true,
	})
	welcome := host.readUntil(t, "welcome")
	roomID, _ := welcome["roomId"].(string)
	invite, _ := welcome["invite"].(string)

	guest := dialTestWS(t, httpServer.URL)
	defer guest.close()
	guest.sendJSON(t, map[string]any{
		"type":    "join",
		"roomId":  roomID,
		"invite":  invite,
		"profile": map[string]any{"name": "Guest", "color": "#00ff00"},
	})
	guest.readUntil(t, "welcome")
	host.readUntil(t, "members")

	host.sendJSON(t, map[string]any{"type": "close-room"})
	if closed := host.readUntil(t, "room-closed"); closed["reason"] != "host_closed" {
		t.Fatalf("host close = %v", closed)
	}
	if closed := guest.readUntil(t, "room-closed"); closed["reason"] != "host_closed" {
		t.Fatalf("guest close = %v", closed)
	}
	if rooms.roomCount() != 0 {
		t.Fatalf("rooms = %d", rooms.roomCount())
	}
	var state collabState
	deadline := time.Now().Add(2 * time.Second)
	for {
		raw, err := os.ReadFile(filepath.Join(persister.dir, "rooms.json"))
		if err == nil {
			if err := json.Unmarshal(raw, &state); err == nil && len(state.Rooms) == 0 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("persisted room was not deleted: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestCollabWebSocketCreateIsLimitedPerConnection(t *testing.T) {
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
		"fingerprint": "first",
	})
	host.readUntil(t, "welcome")
	host.sendJSON(t, map[string]any{
		"type":        "create",
		"profile":     map[string]any{"name": "Host", "color": "#ffffff"},
		"chart":       collabTestChart(),
		"fingerprint": "second",
	})
	rejected := host.readUntil(t, "error")
	if rejected["code"] != "already_in_room" {
		t.Fatalf("second create = %v", rejected)
	}
	if rooms.roomCount() != 1 {
		t.Fatalf("rooms = %d", rooms.roomCount())
	}
}
