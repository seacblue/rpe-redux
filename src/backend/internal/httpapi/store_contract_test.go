// HTTP contract tests for store failures surfaced by project routes.

package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rperedux/server/internal/store"
)

// TestStoreFailuresCarryDatabaseOrigin keeps the SQLite-to-frontend bridge
// explicit even when the driver returns an implementation-specific message.
func TestStoreFailuresCarryDatabaseOrigin(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		wantCode   string
		wantStatus int
	}{
		{
			name:       "generic database failure",
			err:        errors.New("foreign key failure"),
			wantCode:   "database_error",
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "storage failure",
			err:        errors.New("database or disk is full"),
			wantCode:   "storage_error",
			wantStatus: http.StatusInsufficientStorage,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			writeStoreError(recorder, test.err)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			var payload errorBody
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode error: %v", err)
			}
			if payload.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", payload.Error.Code, test.wantCode)
			}
			if payload.Error.Source != "database" {
				t.Fatalf("source = %q, want database", payload.Error.Source)
			}
			if payload.Error.Retryable {
				t.Fatal("database failure should not be retryable by default")
			}
		})
	}
}

// TestCommitAndDeleteErrorCodesRemainStable pins the HTTP contract around the
// asset race fix: an unknown blob is still invalid_commit and a missing
// project is still not_found.
func TestCommitAndDeleteErrorCodesRemainStable(t *testing.T) {
	data := testStore(t)
	project, err := data.CreateProject(t.Context(), store.CreateProjectInput{
		Name:  "project",
		Chart: json.RawMessage(`{"META":{"name":"missing"},"BPMList":[],"judgeLineList":[]}`),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	body := fmt.Sprintf(`{"chart":%s,"assets":[{"name":"missing.png","hash":%q}]}`,
		project.Chart, strings.Repeat("0", 64))
	request, err := http.NewRequest(http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/commit", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown blob status = %d, want 400", response.StatusCode)
	}
	var commitError errorBody
	if err := json.NewDecoder(response.Body).Decode(&commitError); err != nil {
		t.Fatalf("decode commit error: %v", err)
	}
	if commitError.Error.Code != "invalid_commit" {
		t.Fatalf("unknown blob code = %q, want invalid_commit", commitError.Error.Code)
	}

	request, err = http.NewRequest(http.MethodDelete,
		server.URL+"/api/projects/missing-project", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("missing project delete status = %d, want 404", response.StatusCode)
	}
	var deleteError errorBody
	if err := json.NewDecoder(response.Body).Decode(&deleteError); err != nil {
		t.Fatalf("decode delete error: %v", err)
	}
	if deleteError.Error.Code != "not_found" {
		t.Fatalf("missing project code = %q, want not_found", deleteError.Error.Code)
	}
}
