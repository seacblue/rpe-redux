// Streaming commit sessions for the library. A large chart is uploaded in
// bounded chunks to a temporary file, then committed through the existing store
// boundary so the 64 MiB JSON request cap never applies to the chart payload.

package httpapi

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"rperedux/server/internal/store"
)

const (
	// maxCommitChartBytes caps one streamed chart payload.
	maxCommitChartBytes int64 = 512 << 20
	// commitSessionTTL reclaims temp files left by an abandoned upload.
	commitSessionTTL = time.Hour
	// commitCopyBuffer bounds one disk write.
	commitCopyBuffer = 1 << 20
)

// beginCommitRequest is the POST /commit/begin body. The chart itself arrives
// through the following chunk requests.
type beginCommitRequest struct {
	BaseRevision *int                  `json:"baseRevision"`
	Name         *string               `json:"name"`
	Assets       *[]store.AssetMapping `json:"assets"`
	ViewState    *json.RawMessage      `json:"viewState"`
	AssetFolders *[]string             `json:"assetFolders"`
	Label        string                `json:"label"`
	Snapshot     bool                  `json:"snapshot"`
}

// commitSession is one in-flight upload. Its mutex serializes chunk appends and
// the finish read; the manager's mutex only guards the session map.
type commitSession struct {
	id        string
	projectID string
	dir       string
	path      string
	request   beginCommitRequest
	created   time.Time

	mu     sync.Mutex
	size   int64
	closed bool
}

// commitSessionManager owns the process-local upload sessions.
type commitSessionManager struct {
	mu       sync.Mutex
	sessions map[string]*commitSession
}

// newCommitSessionManager builds an empty manager.
func newCommitSessionManager() *commitSessionManager {
	return &commitSessionManager{sessions: make(map[string]*commitSession)}
}

// newCommitSessionID returns an unguessable session identifier.
func newCommitSessionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
}

// begin creates one temp file and registers a session for it.
func (m *commitSessionManager) begin(projectID string, request beginCommitRequest) (*commitSession, error) {
	m.sweep(time.Now().Add(-commitSessionTTL))
	id, err := newCommitSessionID()
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "rpe-redux-commit-")
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "chart.json")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	if err := file.Close(); err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	session := &commitSession{
		id:        id,
		projectID: projectID,
		dir:       dir,
		path:      path,
		request:   request,
		created:   time.Now(),
	}
	m.mu.Lock()
	m.sessions[id] = session
	m.mu.Unlock()
	return session, nil
}

// lookup returns a session for one project without consuming it.
func (m *commitSessionManager) lookup(id, projectID string) (*commitSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok || session.projectID != projectID {
		return nil, false
	}
	return session, true
}

// take removes and returns a session for one project.
func (m *commitSessionManager) take(id, projectID string) (*commitSession, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, ok := m.sessions[id]
	if !ok || session.projectID != projectID {
		return nil, false
	}
	delete(m.sessions, id)
	return session, true
}

// forget removes a session from the map and deletes its temp directory. The
// caller must already own the session mutex or have marked the session closed.
func (m *commitSessionManager) forget(session *commitSession) {
	m.mu.Lock()
	if current, ok := m.sessions[session.id]; ok && current == session {
		delete(m.sessions, session.id)
	}
	m.mu.Unlock()
	_ = os.RemoveAll(session.dir)
}

// sweep removes sessions older than cutoff. Expired files are deleted outside
// the map lock.
func (m *commitSessionManager) sweep(cutoff time.Time) {
	expired := make([]*commitSession, 0)
	m.mu.Lock()
	for id, session := range m.sessions {
		if session.created.Before(cutoff) {
			delete(m.sessions, id)
			expired = append(expired, session)
		}
	}
	m.mu.Unlock()
	for _, session := range expired {
		session.mu.Lock()
		session.closed = true
		session.mu.Unlock()
		_ = os.RemoveAll(session.dir)
	}
}

// handleBeginCommit starts a streamed commit session.
func (a *API) handleBeginCommit(w http.ResponseWriter, r *http.Request) {
	var request beginCommitRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	projectID := r.PathValue("id")
	if _, err := a.store.GetProjectSummary(r.Context(), projectID); err != nil {
		writeStoreError(w, err)
		return
	}
	session, err := a.commitSessions.begin(projectID, request)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_unavailable", "the commit session could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sessionId": session.id})
}

// handleCommitChunk appends one raw chart chunk to the session's temp file.
func (a *API) handleCommitChunk(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	session, ok := a.commitSessions.lookup(r.PathValue("sessionId"), projectID)
	if !ok {
		writeError(w, http.StatusNotFound, "session_not_found", "the commit session does not exist")
		return
	}

	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		writeError(w, http.StatusNotFound, "session_not_found", "the commit session does not exist")
		return
	}
	remaining := maxCommitChartBytes - session.size
	if remaining < 0 {
		session.closed = true
		session.mu.Unlock()
		a.commitSessions.forget(session)
		writeError(w, http.StatusRequestEntityTooLarge, "chart_too_large", "the chart exceeds the streamed size limit")
		return
	}
	if r.ContentLength > remaining {
		session.closed = true
		session.mu.Unlock()
		a.commitSessions.forget(session)
		writeError(w, http.StatusRequestEntityTooLarge, "chart_too_large", "the chart exceeds the streamed size limit")
		return
	}

	file, err := os.OpenFile(session.path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		session.closed = true
		session.mu.Unlock()
		a.commitSessions.forget(session)
		writeError(w, http.StatusInternalServerError, "session_unavailable", "the commit session could not be written")
		return
	}
	body := http.MaxBytesReader(w, r.Body, remaining+1)
	written, copyErr := io.CopyBuffer(file, body, make([]byte, commitCopyBuffer))
	closeErr := file.Close()
	session.size += written
	tooLarge := session.size > maxCommitChartBytes
	var maxBytesError *http.MaxBytesError
	if errors.As(copyErr, &maxBytesError) {
		tooLarge = true
	}
	if tooLarge || copyErr != nil || closeErr != nil {
		session.closed = true
		session.mu.Unlock()
		a.commitSessions.forget(session)
		if tooLarge {
			writeError(w, http.StatusRequestEntityTooLarge, "chart_too_large", "the chart exceeds the streamed size limit")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_chunk", "the chart chunk could not be written")
		return
	}
	total := session.size
	session.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"bytes": total})
}

// handleCommitFinish validates the completed chart and commits it atomically.
func (a *API) handleCommitFinish(w http.ResponseWriter, r *http.Request) {
	session, ok := a.commitSessions.take(r.PathValue("sessionId"), r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "session_not_found", "the commit session does not exist")
		return
	}
	defer func() { _ = os.RemoveAll(session.dir) }()

	session.mu.Lock()
	if session.closed {
		session.mu.Unlock()
		writeError(w, http.StatusNotFound, "session_not_found", "the commit session does not exist")
		return
	}
	session.closed = true
	size := session.size
	data, readErr := os.ReadFile(session.path)
	session.mu.Unlock()

	if readErr != nil {
		writeError(w, http.StatusInternalServerError, "session_unavailable", "the commit session could not be read")
		return
	}
	if int64(len(data)) != size || int64(len(data)) > maxCommitChartBytes {
		writeError(w, http.StatusInternalServerError, "session_corrupt", "the commit session is incomplete")
		return
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		writeError(w, http.StatusBadRequest, "missing_chart", "chart is required")
		return
	}
	if trimmed[0] != '{' || !json.Valid(trimmed) {
		writeError(w, http.StatusBadRequest, "invalid_chart", "chart must be a valid JSON object")
		return
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &object); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_chart", "chart must be a JSON object")
		return
	}

	project, err := a.store.CommitProject(r.Context(), store.CommitProjectInput{
		ProjectID:    r.PathValue("id"),
		BaseRevision: session.request.BaseRevision,
		Name:         session.request.Name,
		Chart:        json.RawMessage(trimmed),
		Assets:       session.request.Assets,
		ViewState:    session.request.ViewState,
		AssetFolders: session.request.AssetFolders,
		Label:        session.request.Label,
		Snapshot:     session.request.Snapshot,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		var conflict *store.RevisionConflictError
		if errors.As(err, &conflict) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_commit", "the chart could not be committed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project})
}
