// Revision pagination must stay on the first response's materialized snapshot.

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"rperedux/server/internal/store"
)

func TestRevisionSnapshotKeepsPagesConsistent(t *testing.T) {
	data := testStore(t)
	project, err := data.CreateProject(context.Background(), store.CreateProjectInput{
		Name:  "snapshot",
		Chart: json.RawMessage(`{"META":{"name":"snapshot"},"BPMList":[],"judgeLineList":[]}`),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	for _, label := range []string{"one", "two", "three"} {
		if _, err := data.CreateRevision(context.Background(), store.CreateRevisionInput{
			ProjectID: project.ID,
			Chart:     json.RawMessage(`{"META":{"name":"revision"},"BPMList":[],"judgeLineList":[]}`),
			Label:     label,
		}); err != nil {
			t.Fatalf("create revision: %v", err)
		}
	}
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	var first struct {
		Revisions     []store.RevisionSummary `json:"revisions"`
		Total         int                     `json:"total"`
		SnapshotToken string                  `json:"snapshotToken"`
	}
	response, err := http.Get(server.URL + "/api/projects/" + project.ID + "/revisions?limit=2")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(response.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if first.Total != 3 || len(first.Revisions) != 2 || first.SnapshotToken == "" {
		t.Fatalf("first page = %+v", first)
	}

	if _, err := data.CreateRevision(context.Background(), store.CreateRevisionInput{
		ProjectID: project.ID,
		Chart:     json.RawMessage(`{"META":{"name":"new"},"BPMList":[],"judgeLineList":[]}`),
		Label:     "four",
	}); err != nil {
		t.Fatalf("create later revision: %v", err)
	}

	var second struct {
		Revisions     []store.RevisionSummary `json:"revisions"`
		Total         int                     `json:"total"`
		SnapshotToken string                  `json:"snapshotToken"`
	}
	response, err = http.Get(server.URL + "/api/projects/" + project.ID +
		"/revisions?limit=2&offset=2&snapshotToken=" + first.SnapshotToken)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(response.Body).Decode(&second); err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if second.Total != 3 || len(second.Revisions) != 1 || second.SnapshotToken != first.SnapshotToken {
		t.Fatalf("second page = %+v", second)
	}
	if second.Revisions[0].ID == "" {
		t.Fatal("second page lost the original tail")
	}

	response, err = http.Get(server.URL + "/api/projects/" + project.ID + "/revisions?snapshotToken=missing")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusGone {
		t.Fatalf("missing token status = %d, want 410", response.StatusCode)
	}
}
