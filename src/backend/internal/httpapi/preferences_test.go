// HTTP contract tests for the preference write credential, section allowlist,
// and per-section JSON shapes.

package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"

	"rperedux/server/internal/preferences"
)

// preferencePut sends one PUT /api/preferences request with the client header
// and an optional write token.
func preferencePut(t *testing.T, url, token, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodPut, url+"/api/preferences", bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(ClientHeader, "1")
	if token != "" {
		request.Header.Set(preferences.TokenHeader, token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

// errorCode returns the service error code from a failed response.
func errorCode(t *testing.T, response *http.Response) string {
	t.Helper()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode error envelope: %v: %s", err, body)
	}
	return payload.Error.Code
}

func TestPreferencesWriteRequiresTheProcessToken(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(NewAPI(store))
	defer server.Close()

	token, err := preferences.Token()
	if err != nil {
		t.Fatal(err)
	}
	body := `{"values":{"language":"en"}}`
	response := preferencePut(t, server.URL, "", body)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("tokenless write status = %d, want 401", response.StatusCode)
	}
	if code := errorCode(t, response); code != "preference_token_required" {
		t.Fatalf("tokenless write code = %q", code)
	}
	if response := preferencePut(t, server.URL, "not-the-token", body); response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong-token write status = %d, want 401", response.StatusCode)
	}
	if response := preferencePut(t, server.URL, token, body); response.StatusCode != http.StatusOK {
		t.Fatalf("authorized write status = %d, want 200", response.StatusCode)
	}
}

func TestPreferencesWriteRejectsUnknownAndMalformedSections(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(NewAPI(store))
	defer server.Close()

	token, err := preferences.Token()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		body string
	}{
		{"unknown section", `{"values":{"language":"en","shellCommand":"rm -rf"}}`},
		{"settings is not an object", `{"values":{"settings":"enabled"}}`},
		{"language is not a string", `{"values":{"language":1}}`},
		{"consent switch is not boolean", `{"values":{"settings":{"code-execution-enabled":"yes"}}}`},
	}
	for _, test := range cases {
		response := preferencePut(t, server.URL, token, test.body)
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", test.name, response.StatusCode)
		}
		if code := errorCode(t, response); code != "invalid_values" {
			t.Fatalf("%s code = %q, want invalid_values", test.name, code)
		}
	}
	stored, err := store.GetPreferences(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if string(stored) != "{}" {
		t.Fatalf("rejected writes changed preferences: %s", stored)
	}
}

func TestPreferencesWriteAcceptsKnownSectionsAndTokenFile(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(NewAPI(store))
	defer server.Close()

	path, err := preferences.EnsureEndpoint(store.Path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("endpoint mode = %o, want 600", info.Mode().Perm())
		}
	}
	var endpoint preferences.Endpoint
	if err := json.Unmarshal(data, &endpoint); err != nil {
		t.Fatalf("decode endpoint file: %v: %s", err, data)
	}
	token, err := preferences.Token()
	if err != nil {
		t.Fatal(err)
	}
	if endpoint.Version != preferences.EndpointVersion || endpoint.Token != token ||
		endpoint.Header != preferences.TokenHeader || endpoint.Preferences != "/api/preferences" {
		t.Fatalf("endpoint file = %#v", endpoint)
	}

	body := `{"values":{"language":"en","clipboard":[],"valueMeta":{"version":0,"modified":{}},"settings":{"code-execution-enabled":true,"autosave-limit":"4"}}}`
	if response := preferencePut(t, server.URL, token, body); response.StatusCode != http.StatusOK {
		t.Fatalf("valid write status = %d, want 200", response.StatusCode)
	}
	objectClipboard := `{"values":{"language":"en","clipboard":{"version":1,"entries":[],"current":{"notes":[],"events":[]},"activeId":null},"settings":{"code-execution-enabled":true,"autosave-limit":"4"}}}`
	if response := preferencePut(t, server.URL, token, objectClipboard); response.StatusCode != http.StatusOK {
		t.Fatalf("versioned clipboard write status = %d, want 200", response.StatusCode)
	}

	response, err := http.Get(server.URL + "/api/preferences")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload struct {
		Values map[string]json.RawMessage `json:"values"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := json.Unmarshal(payload.Values["settings"], &settings); err != nil {
		t.Fatal(err)
	}
	if settings["code-execution-enabled"] != true || settings["autosave-limit"] != "4" {
		t.Fatalf("stored settings = %#v", settings)
	}
}

func TestPreferencesEndpointRouteReportsTheCredentialFile(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(NewAPI(store))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/preferences/endpoint")
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
	if path == "" || body["header"] != preferences.TokenHeader {
		t.Fatalf("endpoint route = %#v", body)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("endpoint file was not written: %v", err)
	}
}
