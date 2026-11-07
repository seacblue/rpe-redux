// Code Cell HTTP transport tests for browser origin handling and loopback policy.
package codecell

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCellCORSAllowsTauriOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/cell/endpoint", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Origin", "http://tauri.localhost")
	response := httptest.NewRecorder()

	server := NewServer(t.TempDir() + "/redux.db")
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("Tauri endpoint status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://tauri.localhost" {
		t.Fatalf("allow-origin = %q", got)
	}
}

func TestCellCORSRejectsForeignOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/cell/endpoint", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Origin", "https://example.com")
	response := httptest.NewRecorder()

	server := NewServer(t.TempDir() + "/redux.db")
	server.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("foreign endpoint status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("foreign allow-origin = %q", got)
	}
}

func TestCellCORSPrefightIsHandledForTauriOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/api/cell/run", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Origin", "https://tauri.localhost")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()

	server := NewServer(t.TempDir() + "/redux.db")
	server.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "https://tauri.localhost" {
		t.Fatalf("preflight allow-origin = %q", got)
	}
}
