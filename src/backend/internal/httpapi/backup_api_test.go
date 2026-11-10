// HTTP contract tests for the library backup routes.
package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"rperedux/server/internal/librarybackup"
	"rperedux/server/internal/store"
)

func TestBackupRoutesStatusSnapshotRestoreAndCompact(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "redux.db")
	live, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := live.CreateProject(ctx, store.CreateProjectInput{
		Name:  "Chart",
		Chart: json.RawMessage(`{"META":{"name":"A"},"judgeLineList":[]}`),
	}); err != nil {
		t.Fatal(err)
	}
	_ = live.Close()

	service, err := librarybackup.Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := service.Snapshot(ctx, "manual"); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewBackupHandler(service))
	defer server.Close()

	get := func(path string) map[string]any {
		t.Helper()
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("GET %s status = %d: %s", path, response.StatusCode, body)
		}
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload
	}
	post := func(path, body string) map[string]any {
		t.Helper()
		request, err := http.NewRequest(
			http.MethodPost,
			server.URL+path,
			strings.NewReader(body),
		)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(ClientHeader, "1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			content, _ := io.ReadAll(response.Body)
			t.Fatalf("POST %s status = %d: %s", path, response.StatusCode, content)
		}
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload
	}

	status := get("/status")
	if status["head"] == nil || status["healthy"] != true {
		t.Fatalf("status = %#v", status)
	}
	history := get("/commits?limit=10")
	if commits, ok := history["commits"].([]any); !ok || len(commits) == 0 {
		t.Fatalf("history = %#v", history)
	}
	verify := post("/verify", `{}`)
	if missing, ok := verify["missing"].([]any); ok && len(missing) != 0 {
		t.Fatalf("verify missing = %#v", missing)
	}
	restored := post("/restore", `{}`)
	if restored["reason"] != "restore" {
		t.Fatalf("restore = %#v", restored)
	}
	compacted := post("/compact", `{"keep":1}`)
	if compacted["afterCommits"] != float64(1) {
		t.Fatalf("compact = %#v", compacted)
	}
}
