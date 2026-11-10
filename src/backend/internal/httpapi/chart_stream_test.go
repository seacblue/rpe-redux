// HTTP contract tests for the streaming chart reads and streamed commit
// sessions: frame order, random-access lines, revision refresh, and size or
// conflict handling.

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rperedux/server/internal/chartstream"
	"rperedux/server/internal/store"
)

// streamTestChart deliberately puts judgeLineList before META and includes
// non-ASCII text before the later line ranges.
func streamTestChart() string {
	return `{"judgeLineList":[{"Name":"first","notes":[{"type":1,"startTime":[0,0,1],"endTime":[1,0,1]}]},{"Name":"第二"},{"Name":"third"}],"META":{"name":"流式","song":"audio.ogg","background":"cover.png"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}],"custom":true}`
}

func createChartProject(t *testing.T, data *store.Store, chart string) *store.ProjectFull {
	t.Helper()
	project, err := data.CreateProject(context.Background(), store.CreateProjectInput{
		Name:  "stream",
		Chart: json.RawMessage(chart),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	return project
}

func decodeFrames(t *testing.T, response *http.Response) []chartstream.Frame {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("stream status %d: %s", response.StatusCode, body)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	frames, err := chartstream.DecodeFrames(body)
	if err != nil {
		t.Fatalf("decode frames: %v", err)
	}
	return frames
}

func TestChartStreamSendsHeaderIndexLinesAndEnd(t *testing.T) {
	data := testStore(t)
	chart := streamTestChart()
	project := createChartProject(t, data, chart)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/projects/" + project.ID + "/chart/stream")
	if err != nil {
		t.Fatal(err)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != chartStreamContentType {
		t.Fatalf("content type = %q", contentType)
	}
	frames := decodeFrames(t, response)
	if len(frames) != 6 {
		t.Fatalf("frames = %d, want header+index+3 lines+end", len(frames))
	}
	if frames[0].Kind != chartstream.KindHeader || frames[1].Kind != chartstream.KindIndex {
		t.Fatalf("frame order = %d/%d", frames[0].Kind, frames[1].Kind)
	}
	var header chartstream.Header
	if err := chartstream.DecodeJSONFrame(frames[0], &header); err != nil {
		t.Fatal(err)
	}
	if header.LineCount != 3 || string(header.META) == "" ||
		string(header.Extras["custom"]) != "true" {
		t.Fatalf("header = %#v", header)
	}
	var index chartstream.Index
	if err := chartstream.DecodeJSONFrame(frames[1], &index); err != nil {
		t.Fatal(err)
	}
	if index.Version != 1 || len(index.Lines) != 3 || index.TotalBytes != len(chart) {
		t.Fatalf("index = %#v", index)
	}
	scan, err := chartstream.ScanChartJSON([]byte(chart))
	if err != nil {
		t.Fatal(err)
	}
	for offset := 0; offset < 3; offset++ {
		frame := frames[2+offset]
		if frame.Kind != chartstream.KindLine {
			t.Fatalf("line frame %d kind = %d", offset, frame.Kind)
		}
		lineIndex, raw, err := chartstream.DecodeLinePayload(frame)
		if err != nil {
			t.Fatal(err)
		}
		if int(lineIndex) != offset {
			t.Fatalf("line index = %d, want %d", lineIndex, offset)
		}
		sourceRange := scan.LineRanges[offset]
		if string(raw) != chart[sourceRange.Start:sourceRange.End] {
			t.Fatalf("line %d raw = %q", offset, raw)
		}
	}
	if frames[5].Kind != chartstream.KindEnd {
		t.Fatalf("last frame kind = %d", frames[5].Kind)
	}
	var end struct {
		Digest string `json:"digest"`
		Bytes  int    `json:"bytes"`
	}
	if err := chartstream.DecodeJSONFrame(frames[5], &end); err != nil {
		t.Fatal(err)
	}
	if end.Digest == "" || end.Bytes != len(chart) {
		t.Fatalf("end frame = %#v", end)
	}
}

func TestChartStreamCanOmitLineFrames(t *testing.T) {
	data := testStore(t)
	chart := streamTestChart()
	project := createChartProject(t, data, chart)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Get(
		server.URL + "/api/projects/" + project.ID + "/chart/stream?includeLines=false")
	if err != nil {
		t.Fatal(err)
	}
	frames := decodeFrames(t, response)
	if len(frames) != 3 {
		t.Fatalf("frames = %d, want header+index+end", len(frames))
	}
	if frames[0].Kind != chartstream.KindHeader ||
		frames[1].Kind != chartstream.KindIndex ||
		frames[2].Kind != chartstream.KindEnd {
		t.Fatalf("frame order = %d/%d/%d", frames[0].Kind, frames[1].Kind, frames[2].Kind)
	}
	var end struct {
		Digest string `json:"digest"`
		Bytes  int    `json:"bytes"`
	}
	if err := chartstream.DecodeJSONFrame(frames[2], &end); err != nil {
		t.Fatal(err)
	}
	if end.Digest == "" || end.Bytes != len(chart) {
		t.Fatalf("end frame = %#v", end)
	}
}

func TestChartLinesReturnsOnlyTheRequestedRange(t *testing.T) {
	data := testStore(t)
	chart := streamTestChart()
	project := createChartProject(t, data, chart)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/projects/" + project.ID + "/chart/lines?start=1&count=2")
	if err != nil {
		t.Fatal(err)
	}
	frames := decodeFrames(t, response)
	if len(frames) != 1 || frames[0].Kind != chartstream.KindLines {
		t.Fatalf("frames = %#v", frames)
	}
	start, count, raw, err := chartstream.DecodeLinesPayload(frames[0])
	if err != nil {
		t.Fatal(err)
	}
	if start != 1 || count != 2 {
		t.Fatalf("batch = %d/%d", start, count)
	}
	var lines []map[string]any
	if err := json.Unmarshal(raw, &lines); err != nil {
		t.Fatalf("decode batch: %v: %s", err, raw)
	}
	if len(lines) != 2 || lines[0]["Name"] != "第二" || lines[1]["Name"] != "third" {
		t.Fatalf("lines = %#v", lines)
	}

	response, err = http.Get(server.URL + "/api/projects/" + project.ID + "/chart/lines?start=99&count=2")
	if err != nil {
		t.Fatal(err)
	}
	frames = decodeFrames(t, response)
	start, count, raw, err = chartstream.DecodeLinesPayload(frames[0])
	if err != nil {
		t.Fatal(err)
	}
	if start != 99 || count != 0 || string(raw) != "[]" {
		t.Fatalf("past-end batch = %d/%d/%q", start, count, raw)
	}

	response, err = http.Get(server.URL + "/api/projects/" + project.ID + "/chart/lines?count=-1")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid count status = %d", response.StatusCode)
	}
}

func TestChartLinesRebuildsAfterACommit(t *testing.T) {
	data := testStore(t)
	project := createChartProject(t, data, streamTestChart())
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/projects/" + project.ID + "/chart/lines?start=0&count=1")
	if err != nil {
		t.Fatal(err)
	}
	frames := decodeFrames(t, response)
	_, _, raw, err := chartstream.DecodeLinesPayload(frames[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "first") {
		t.Fatalf("first batch = %s", raw)
	}

	replacement := `{"META":{"name":"new"},"judgeLineList":[{"Name":"replacement"}],"BPMList":[{"bpm":120,"startTime":[0,0,1]}]}`
	if _, err := data.CommitProject(context.Background(), store.CommitProjectInput{
		ProjectID: project.ID,
		Chart:     json.RawMessage(replacement),
	}); err != nil {
		t.Fatalf("commit replacement: %v", err)
	}

	response, err = http.Get(server.URL + "/api/projects/" + project.ID + "/chart/lines?start=0&count=1")
	if err != nil {
		t.Fatal(err)
	}
	frames = decodeFrames(t, response)
	_, _, raw, err = chartstream.DecodeLinesPayload(frames[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "replacement") {
		t.Fatalf("stale batch = %s", raw)
	}
}

func TestChartLinesUsesPersistedIndexAcrossAPIInstances(t *testing.T) {
	data := testStore(t)
	chart := streamTestChart()
	project := createChartProject(t, data, chart)

	first := httptest.NewServer(NewAPI(data))
	response, err := http.Get(first.URL + "/api/projects/" + project.ID + "/chart/lines?start=0&count=1")
	if err != nil {
		t.Fatal(err)
	}
	decodeFrames(t, response)
	first.Close()

	state, err := data.ReadProjectChartState(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("read chart state: %v", err)
	}
	if !state.HasIndex {
		t.Fatal("line request did not persist the index")
	}

	second := httptest.NewServer(NewAPI(data))
	defer second.Close()
	response, err = http.Get(second.URL + "/api/projects/" + project.ID + "/chart/lines?start=1&count=1")
	if err != nil {
		t.Fatal(err)
	}
	frames := decodeFrames(t, response)
	_, _, raw, err := chartstream.DecodeLinesPayload(frames[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "第二") {
		t.Fatalf("persisted batch = %s", raw)
	}
}

func TestStreamedCommitSessionWritesChunksAndCommits(t *testing.T) {
	data := testStore(t)
	project := createChartProject(t, data, streamTestChart())
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	chart := `{"META":{"name":"流式提交"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}],"judgeLineList":[{"Name":"音符"}]}`
	beginBody := fmt.Sprintf(`{"baseRevision":%d,"name":"renamed","viewState":{"selected":1},"label":"stream","snapshot":true}`, project.Revision)
	request, err := http.NewRequest(http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/commit/begin", strings.NewReader(beginBody))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var begin struct {
		SessionID string `json:"sessionId"`
	}
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("begin status %d: %s", response.StatusCode, body)
	}
	if err := json.NewDecoder(response.Body).Decode(&begin); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if begin.SessionID == "" {
		t.Fatal("missing session id")
	}

	// Split inside the multi-byte character so chunk boundaries are not rune
	// boundaries.
	split := strings.Index(chart, "音") + 1
	for _, chunk := range [][]byte{[]byte(chart[:split]), []byte(chart[split:])} {
		request, err = http.NewRequest(http.MethodPut,
			server.URL+"/api/projects/"+project.ID+"/commit/"+begin.SessionID+"/chart",
			bytes.NewReader(chunk))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/octet-stream")
		request.Header.Set("X-Redux-Client", "1")
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("chunk status %d: %s", response.StatusCode, body)
		}
		response.Body.Close()
	}

	request, err = http.NewRequest(http.MethodPost,
		server.URL+"/api/projects/"+project.ID+"/commit/"+begin.SessionID+"/finish", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	committed := decodeAPI[store.Project](t, response, "project")
	if committed.Revision != project.Revision+1 || committed.Name != "renamed" {
		t.Fatalf("committed = %#v", committed)
	}
	stored, err := data.GetProject(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("read committed chart: %v", err)
	}
	if string(stored.Chart) != chart {
		t.Fatalf("stored chart = %q", stored.Chart)
	}

	// A finished session is single-use.
	request, _ = http.NewRequest(http.MethodPut,
		server.URL+"/api/projects/"+project.ID+"/commit/"+begin.SessionID+"/chart",
		bytes.NewReader([]byte("{}")))
	request.Header.Set("X-Redux-Client", "1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("reused session status = %d", response.StatusCode)
	}
}

func TestStreamedCommitRejectsOversizedChunk(t *testing.T) {
	data := testStore(t)
	project := createChartProject(t, data, streamTestChart())
	api := &API{
		store:          data,
		chartIndexes:   newChartIndexCache(),
		commitSessions: newCommitSessionManager(),
	}
	session, err := api.commitSessions.begin(project.ID, beginCommitRequest{})
	if err != nil {
		t.Fatalf("begin session: %v", err)
	}
	request := httptest.NewRequest(http.MethodPut, "/chunk", http.NoBody)
	request.ContentLength = maxCommitChartBytes + 1
	request.SetPathValue("id", project.ID)
	request.SetPathValue("sessionId", session.id)
	recorder := httptest.NewRecorder()
	api.handleCommitChunk(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d, want 413", recorder.Code)
	}
	if _, ok := api.commitSessions.lookup(session.id, project.ID); ok {
		t.Fatal("oversized session was left registered")
	}
}

func TestStreamedCommitRejectsInvalidChartAndStaleRevision(t *testing.T) {
	data := testStore(t)
	project := createChartProject(t, data, streamTestChart())
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	begin := func(body string) string {
		t.Helper()
		request, err := http.NewRequest(http.MethodPost,
			server.URL+"/api/projects/"+project.ID+"/commit/begin", strings.NewReader(body))
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
		if response.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("begin status %d: %s", response.StatusCode, body)
		}
		var payload struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.SessionID
	}
	put := func(sessionID, chunk string) int {
		t.Helper()
		request, err := http.NewRequest(http.MethodPut,
			server.URL+"/api/projects/"+project.ID+"/commit/"+sessionID+"/chart",
			strings.NewReader(chunk))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("X-Redux-Client", "1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		return response.StatusCode
	}
	finish := func(sessionID string) (int, string) {
		t.Helper()
		request, err := http.NewRequest(http.MethodPost,
			server.URL+"/api/projects/"+project.ID+"/commit/"+sessionID+"/finish", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("X-Redux-Client", "1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}

	for _, invalid := range []string{"{", "null", "[]"} {
		invalidSession := begin(`{}`)
		if status := put(invalidSession, invalid); status != http.StatusOK {
			t.Fatalf("invalid chunk %q status = %d", invalid, status)
		}
		status, body := finish(invalidSession)
		if status != http.StatusBadRequest || !strings.Contains(body, "invalid_chart") {
			t.Fatalf("invalid finish %q = %d %s", invalid, status, body)
		}
	}

	staleSession := begin(fmt.Sprintf(`{"baseRevision":%d}`, project.Revision+1))
	if status := put(staleSession, `{"META":{},"judgeLineList":[]}`); status != http.StatusOK {
		t.Fatalf("stale chunk status = %d", status)
	}
	status, body := finish(staleSession)
	if status != http.StatusConflict || !strings.Contains(body, "revision_conflict") {
		t.Fatalf("stale finish = %d %s", status, body)
	}

	missingRequest, _ := http.NewRequest(http.MethodPost,
		server.URL+"/api/projects/missing/commit/begin", strings.NewReader(`{}`))
	missingRequest.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(missingRequest)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("missing project status = %d", response.StatusCode)
	}
}
