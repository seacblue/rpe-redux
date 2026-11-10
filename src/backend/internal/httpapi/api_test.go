// HTTP contract tests for the asset staging, commit conflict, and range path.
package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rperedux/server/internal/store"
)

func decodeAPI[T any](t *testing.T, response *http.Response, envelope string) T {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if response.StatusCode >= 300 {
		t.Fatalf("status %d: %s", response.StatusCode, body)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		t.Fatalf("decode envelope: %v: %s", err, body)
	}
	var out T
	if err := json.Unmarshal(root[envelope], &out); err != nil {
		t.Fatalf("decode %s: %v: %s", envelope, err, body)
	}
	return out
}

func TestMutationRequiresTheApplicationClientHeader(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Post(
		server.URL+"/api/projects",
		"text/plain",
		bytes.NewBufferString(`{"name":"csrf","chart":{}}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("headerless mutation status = %d, want 403", response.StatusCode)
	}
}

func TestAssetAPIStagesCommitsAndServesRanges(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	createBody := bytes.NewBufferString(`{"name":"api","chart":{"META":{"name":"api"},"BPMList":[],"judgeLineList":[]}}`)
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/projects", createBody)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	project := decodeAPI[store.Project](t, response, "project")

	payload := []byte("0123456789")
	request, err = http.NewRequest(
		http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/assets?name=music.mp3",
		bytes.NewReader(payload),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	asset := decodeAPI[store.Asset](t, response, "asset")

	commit := fmt.Sprintf(
		`{"baseRevision":%d,"chart":{"META":{"name":"api"},"BPMList":[],"judgeLineList":[]},"assets":[{"name":"music.mp3","hash":%q}]}`,
		project.Revision,
		asset.Hash,
	)
	request, err = http.NewRequest(
		http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/commit",
		stringsReader(commit),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	committed := decodeAPI[store.Project](t, response, "project")
	if committed.Revision != project.Revision+1 {
		t.Fatalf("revision = %d, want %d", committed.Revision, project.Revision+1)
	}

	request, _ = http.NewRequest(
		http.MethodGet,
		server.URL+"/api/projects/"+project.ID+"/assets/music.mp3",
		nil,
	)
	request.Header.Set("Range", "bytes=2-5")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Fatalf("range status = %d body = %q", response.StatusCode, body)
	}

	request, _ = http.NewRequest(http.MethodGet, server.URL+"/api/assets/"+asset.Hash, nil)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !bytes.Equal(body, payload) {
		t.Fatalf("hash read status = %d body = %q", response.StatusCode, body)
	}

	request, err = http.NewRequest(
		http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/commit",
		stringsReader(commit),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("stale commit status = %d, want 409", response.StatusCode)
	}
	var errorBody struct {
		Error struct {
			Code            string `json:"code"`
			CurrentRevision int    `json:"currentRevision"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&errorBody); err != nil {
		t.Fatal(err)
	}
	if errorBody.Error.Code != "revision_conflict" ||
		errorBody.Error.CurrentRevision != committed.Revision {
		t.Fatalf("error = %#v", errorBody)
	}
}

// stringsReader avoids importing strings solely for one request body.
func stringsReader(value string) io.Reader {
	return bytes.NewBufferString(value)
}
