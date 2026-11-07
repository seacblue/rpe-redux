// Contract test for the Code Cell bridge handshake route.

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"rperedux/server/internal/codecell"
)

func TestCodeCellEndpointRouteReturnsTheCredentialPath(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/cell/endpoint")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("endpoint route status = %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	path, _ := body["path"].(string)
	if path == "" || body["bridge"] != codecell.BridgePath {
		t.Fatalf("endpoint route = %#v", body)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("endpoint file was not written: %v", err)
	}
}
