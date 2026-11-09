// Handshake tests for the embedded collaboration server: protocol revisions are
// no longer negotiated, while a join and resume require the same product
// version as the room.

package collab

import (
	"net/http/httptest"
	"testing"
)

func TestCollabHostMustCloseInsteadOfLeaving(t *testing.T) {
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
		"fingerprint": "host-leave",
	})
	host.readUntil(t, "welcome")

	host.sendJSON(t, map[string]any{"type": "leave"})
	failure := host.readUntil(t, "error")
	if failure["code"] != "host_must_close" {
		t.Fatalf("host leave = %v", failure)
	}

	host.sendJSON(t, map[string]any{"type": "close-room"})
	if closed := host.readUntil(t, "room-closed"); closed["reason"] != "host_closed" {
		t.Fatalf("host close = %v", closed)
	}
}

func TestCollabVersionRequiresExactProductMatch(t *testing.T) {
	room := &collabRoom{AppVersion: "1.0.7"}
	if failure := collabVersionFailure(room, "1.0.7"); failure != nil {
		t.Fatalf("same version = %v", failure)
	}
	for _, clientVersion := range []string{"1.0.6", "1.0.8", ""} {
		failure := collabVersionFailure(room, clientVersion)
		if failure == nil || failure.Code != "version_mismatch" {
			t.Fatalf("client %q = %v", clientVersion, failure)
		}
	}
	if failure := collabVersionFailure(&collabRoom{}, ""); failure != nil {
		t.Fatalf("empty versions = %v", failure)
	}
}

func TestCollabWebSocketNeedsNoProtocolVersionButRequiresSameProductVersion(t *testing.T) {
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
		"fingerprint":       "version",
		"appVersion":        "1.0.7",
		"autoApproveEditor": true,
	})
	welcome := host.readUntil(t, "welcome")
	if _, present := welcome["protocolVersion"]; present {
		t.Fatalf("welcome still advertises a protocol version: %v", welcome)
	}
	roomID, _ := welcome["roomId"].(string)
	invite, _ := welcome["invite"].(string)
	token, _ := welcome["resumeToken"].(string)
	if roomID == "" || invite == "" || token == "" {
		t.Fatalf("welcome = %v", welcome)
	}

	join := func(version string) map[string]any {
		socket := dialTestWS(t, httpServer.URL)
		defer socket.close()
		socket.sendJSON(t, map[string]any{
			"type":       "join",
			"roomId":     roomID,
			"invite":     invite,
			"profile":    map[string]any{"name": "Guest", "color": "#00ff00"},
			"appVersion": version,
		})
		return socket.readUntil(t, "rejected")
	}
	if rejected := join("1.0.8"); rejected["reason"] != "version_mismatch" {
		t.Fatalf("join mismatch = %v", rejected)
	}
	matching := dialTestWS(t, httpServer.URL)
	defer matching.close()
	matching.sendJSON(t, map[string]any{
		"type":       "join",
		"roomId":     roomID,
		"invite":     invite,
		"profile":    map[string]any{"name": "Guest", "color": "#00ff00"},
		"appVersion": "1.0.7",
	})
	if joined := matching.readUntil(t, "welcome"); joined["roomId"] != roomID {
		t.Fatalf("matching join = %v", joined)
	}

	resume := func(version string) map[string]any {
		socket := dialTestWS(t, httpServer.URL)
		defer socket.close()
		socket.sendJSON(t, map[string]any{
			"type":       "resume",
			"roomId":     roomID,
			"token":      token,
			"appVersion": version,
		})
		return socket.readUntil(t, "rejected")
	}
	if rejected := resume("1.0.6"); rejected["reason"] != "version_mismatch" {
		t.Fatalf("resume mismatch = %v", rejected)
	}

	inspect := func(version string) map[string]any {
		socket := dialTestWS(t, httpServer.URL)
		defer socket.close()
		socket.sendJSON(t, map[string]any{
			"type":       "inspect-room",
			"roomId":     roomID,
			"invite":     invite,
			"appVersion": version,
		})
		return socket.readUntil(t, "rejected")
	}
	if rejected := inspect("1.0.8"); rejected["reason"] != "version_mismatch" {
		t.Fatalf("inspect mismatch = %v", rejected)
	}
}
