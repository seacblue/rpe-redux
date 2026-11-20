// HTTP contract tests for the chart snapshot branch tree.
package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"rperedux/server/internal/store"
)

// snapshotHTTPChange sends one JSON mutation with the application client header.
func snapshotHTTPChange(
	t *testing.T,
	server *httptest.Server,
	method, path string,
	body string,
) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, server.URL+path, bytes.NewBufferString(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestSnapshotAPIStoresListsReadsAndRestores(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	created, err := data.CreateProject(t.Context(), store.CreateProjectInput{
		Name:  "snapshots",
		Chart: json.RawMessage(`{"META":{"name":"snapshots"},"judgeLineList":[]}`),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	first := decodeAPI[store.ChartSnapshot](t,
		snapshotHTTPChange(t, server, http.MethodPost, "/api/projects/"+created.ID+"/snapshots",
			`{"chart":{"META":{"name":"snapshots"},"judgeLineList":[{"notes":[{"type":1}],"moveXEvents":[{"startTime":[0,0,1]}]}]},"reason":"auto","advanceHead":true}`),
		"snapshot")
	if first.NoteCount != 1 || first.EventCount != 1 {
		t.Fatalf("counts = %d/%d, want 1/1", first.NoteCount, first.EventCount)
	}

	second := decodeAPI[store.ChartSnapshot](t,
		snapshotHTTPChange(t, server, http.MethodPost, "/api/projects/"+created.ID+"/snapshots",
			`{"chart":{"META":{"name":"snapshots"},"judgeLineList":[{"notes":[{"type":1},{"type":1}],"moveXEvents":[]}]},"advanceHead":true}`),
		"snapshot")
	if second.ParentID != first.ID {
		t.Fatalf("second parent = %q, want %q", second.ParentID, first.ID)
	}

	// The list carries the head and the summary columns the dialog renders.
	listResponse, err := http.Get(server.URL + "/api/projects/" + created.ID + "/snapshots")
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Snapshots []store.ChartSnapshot `json:"snapshots"`
		HeadID    string                `json:"headId"`
	}
	var envelope map[string]json.RawMessage
	if err := json.NewDecoder(listResponse.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	listResponse.Body.Close()
	if err := json.Unmarshal(envelope["snapshots"], &list.Snapshots); err != nil {
		t.Fatalf("decode snapshots: %v", err)
	}
	if err := json.Unmarshal(envelope["headId"], &list.HeadID); err != nil {
		t.Fatalf("decode head: %v", err)
	}
	if list.HeadID != second.ID {
		t.Fatalf("head = %q, want %q", list.HeadID, second.ID)
	}
	if len(list.Snapshots) != 2 {
		t.Fatalf("snapshots = %d, want 2", len(list.Snapshots))
	}
	if list.Snapshots[0].ID != second.ID {
		t.Fatalf("list is not newest first: %#v", list.Snapshots)
	}

	readResponse, err := http.Get(server.URL + "/api/snapshots/" + first.ID)
	if err != nil {
		t.Fatal(err)
	}
	full := decodeAPI[struct {
		Chart json.RawMessage `json:"chart"`
	}](t, readResponse, "snapshot")
	if !bytes.Contains(full.Chart, []byte(`"moveXEvents"`)) {
		t.Fatalf("snapshot chart = %s", full.Chart)
	}

	restoreResponse := snapshotHTTPChange(t, server, http.MethodPost,
		"/api/snapshots/"+first.ID+"/restore", "")
	restored := decodeAPI[store.Project](t, restoreResponse, "project")
	if restored.NoteCount != 1 {
		t.Fatalf("restored note count = %d, want 1", restored.NoteCount)
	}
}

func TestSnapshotAPIRetentionUsesTheStoredSetting(t *testing.T) {
	data := testStore(t)
	ctx := t.Context()
	if _, err := data.PutPreferences(ctx, json.RawMessage(
		`{"settings":{"autosave-limit":"2"}}`)); err != nil {
		t.Fatalf("store preferences: %v", err)
	}
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	created, err := data.CreateProject(ctx, store.CreateProjectInput{
		Name:  "retained",
		Chart: json.RawMessage(`{"META":{},"judgeLineList":[]}`),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	for index := 0; index < 3; index++ {
		snapshotHTTPChange(t, server, http.MethodPost, "/api/projects/"+created.ID+"/snapshots",
			`{"chart":{"META":{"name":"`+string(rune('a'+index))+`"},"judgeLineList":[]},"advanceHead":true}`).
			Body.Close()
	}
	history, err := data.ListChartSnapshots(ctx, created.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(history.Snapshots) != 2 {
		t.Fatalf("snapshots = %d, want 2 from the stored setting", len(history.Snapshots))
	}
}

func TestSnapshotAPIMissingResourcesReturnNotFound(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	for _, target := range []string{
		"/api/projects/missing/snapshots",
		"/api/snapshots/missing",
	} {
		response, err := http.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404", target, response.StatusCode)
		}
		response.Body.Close()
	}

	response := snapshotHTTPChange(t, server, http.MethodPost,
		"/api/snapshots/missing/restore", "")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("restore status = %d, want 404", response.StatusCode)
	}
	response.Body.Close()
}

func TestSnapshotAPIRejectsAMissingChart(t *testing.T) {
	data := testStore(t)
	ctx := t.Context()
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	created, err := data.CreateProject(ctx, store.CreateProjectInput{
		Name:  "empty",
		Chart: json.RawMessage(`{"META":{},"judgeLineList":[]}`),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	response := snapshotHTTPChange(t, server, http.MethodPost,
		"/api/projects/"+created.ID+"/snapshots", `{"reason":"auto"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
	response.Body.Close()
}
