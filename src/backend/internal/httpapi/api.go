// HTTP surface of the local chart-library service: health, project, and
// revision routes over the SQLite store, plus the JSON decode, status, and error
// helpers they share.

package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"rperedux/server/internal/codecell"
	"rperedux/server/internal/instances"
	"rperedux/server/internal/preferences"
	"rperedux/server/internal/store"
)

// Name and APIVersion identify the service contract.
const (
	Name       = "rpe-redux-server"
	APIVersion = 1
)

// Version is the product version reported by /api/health. The sidecar entry
// point sets it from the linker-injected build version before serving.
var Version = "dev"

// maxRequestBody caps JSON request bodies (64 MiB is the service contract).
const maxRequestBody = 64 << 20

// maxAssetBody caps a single staged blob. Music is the largest normal asset;
// 256 MiB leaves room for long tracks without an unbounded read.
const maxAssetBody = 256 << 20

// CollabHealth is the collaboration portion of the health payload. It reports
// whether the embedded room listener is enabled, whether it bound successfully,
// and which port it serves.
type CollabHealth struct {
	Enabled bool `json:"enabled"`
	OK      bool `json:"ok"`
	// Degraded is set when collaboration was requested but its listener is
	// unusable. The main service stays reachable in that state.
	Degraded bool   `json:"degraded,omitempty"`
	Port     int    `json:"port,omitempty"`
	Error    string `json:"error,omitempty"`
}

// API wires the store into an http.Handler.
type API struct {
	store          *store.Store
	instances      *instances.Hub
	collab         CollabHealth
	shutdown       func()
	origins        map[string]bool
	docs           *docsHandler
	chartIndexes   *chartIndexCache
	commitSessions *commitSessionManager
}

// NewAPI builds the HTTP handler tree. extraOrigins adds CORS origins on top of
// the built-in application origins.
func NewAPI(data *store.Store, extraOrigins ...string) http.Handler {
	return newAPI(data, instances.NewHub(), CollabHealth{}, nil, "", extraOrigins...)
}

// NewAPIWithInstances builds the same tree with a hub the host can inspect for
// idle shutdown decisions.
func NewAPIWithInstances(data *store.Store, hub *instances.Hub, extraOrigins ...string) http.Handler {
	return newAPI(data, hub, CollabHealth{}, nil, "", extraOrigins...)
}

// NewAPIWithRuntime adds the desktop-owned collaboration status and the
// graceful-shutdown hook exposed at POST /api/shutdown.
func NewAPIWithRuntime(
	data *store.Store,
	hub *instances.Hub,
	collab CollabHealth,
	shutdown func(),
	extraOrigins ...string,
) http.Handler {
	return newAPI(data, hub, collab, shutdown, "", extraOrigins...)
}

// NewAPIWithRuntimeAndDocs adds the read-only documentation directory served
// under /docs/. An empty directory leaves the route disabled.
func NewAPIWithRuntimeAndDocs(
	data *store.Store,
	hub *instances.Hub,
	collab CollabHealth,
	shutdown func(),
	docsDir string,
	extraOrigins ...string,
) http.Handler {
	return newAPI(data, hub, collab, shutdown, docsDir, extraOrigins...)
}

// newAPI assembles the route table shared by the public constructors.
func newAPI(
	data *store.Store,
	hub *instances.Hub,
	collab CollabHealth,
	shutdown func(),
	docsDir string,
	extraOrigins ...string,
) http.Handler {
	a := &API{
		store:          data,
		instances:      hub,
		collab:         collab,
		shutdown:       shutdown,
		origins:        originSet(extraOrigins),
		docs:           newDocsHandler(docsDir),
		chartIndexes:   newChartIndexCache(),
		commitSessions: newCommitSessionManager(),
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.handleHealth)
	mux.HandleFunc("POST /api/intake/classify", a.handleClassifyIntake)
	mux.HandleFunc("GET /api/cell/endpoint", a.handleCodeCellEndpoint)
	mux.HandleFunc("POST /api/shutdown", a.handleShutdown)
	mux.HandleFunc("GET /api/instances", a.handleListInstances)
	mux.HandleFunc("POST /api/instances/register", a.handleRegisterInstance)
	mux.HandleFunc("POST /api/instances/heartbeat", a.handleHeartbeatInstance)
	mux.HandleFunc("POST /api/instances/leave", a.handleLeaveInstance)
	mux.HandleFunc("POST /api/instances/clear", a.handleClearInstance)
	mux.HandleFunc("POST /api/instances/prune", a.handlePruneInstances)
	mux.HandleFunc("POST /api/occupancy/acquire", a.handleAcquireDocument)
	mux.HandleFunc("POST /api/occupancy/release", a.handleReleaseDocument)
	mux.HandleFunc("POST /api/occupancy/clear-backend", a.handleClearDocument)
	mux.HandleFunc("POST /api/occupancy/reconcile", a.handleReconcileDocument)
	mux.HandleFunc("GET /api/projects", a.handleListProjects)
	mux.HandleFunc("POST /api/projects", a.handleCreateProject)
	mux.HandleFunc("GET /api/projects/{id}", a.handleGetProject)
	mux.HandleFunc("GET /api/projects/{id}/summary", a.handleGetProjectSummary)
	mux.HandleFunc("PATCH /api/projects/{id}", a.handlePatchProject)
	mux.HandleFunc("DELETE /api/projects/{id}", a.handleDeleteProject)
	mux.HandleFunc("POST /api/projects/{id}/commit", a.handleCommitProject)
	mux.HandleFunc("POST /api/projects/{id}/commit/begin", a.handleBeginCommit)
	mux.HandleFunc("PUT /api/projects/{id}/commit/{sessionId}/chart", a.handleCommitChunk)
	mux.HandleFunc("POST /api/projects/{id}/commit/{sessionId}/finish", a.handleCommitFinish)
	mux.HandleFunc("GET /api/projects/{id}/chart/stream", a.handleChartStream)
	mux.HandleFunc("GET /api/projects/{id}/chart/lines", a.handleChartLines)
	mux.HandleFunc("POST /api/projects/{id}/duplicate", a.handleDuplicateProject)
	mux.HandleFunc("GET /api/projects/{id}/assets", a.handleListAssets)
	mux.HandleFunc("POST /api/projects/{id}/assets", a.handleStageAsset)
	mux.HandleFunc("GET /api/projects/{id}/assets/{name...}", a.handleReadAsset)
	mux.HandleFunc("GET /api/projects/{id}/revisions", a.handleListRevisions)
	mux.HandleFunc("POST /api/projects/{id}/revisions", a.handleCreateRevision)
	mux.HandleFunc("GET /api/revisions/{id}", a.handleGetRevision)
	mux.HandleFunc("DELETE /api/revisions/{id}", a.handleDeleteRevision)
	mux.HandleFunc("GET /api/preferences", a.handleGetPreferences)
	mux.HandleFunc("GET /api/preferences/endpoint", a.handlePreferencesEndpoint)
	mux.HandleFunc("PUT /api/preferences", a.handlePutPreferences)
	mux.HandleFunc("POST /api/maintenance/checkpoint", a.handleCheckpoint)
	mux.Handle(docsRoute, a.docs)
	mux.Handle(docsRoute+"/", a.docs)

	return withCORS(methodGuard(mux), a.origins)
}

// methodGuard re-renders ServeMux's plain-text 404/405 responses as the
// contractual JSON error envelope.
//
// Application handlers always go through writeJSON/writeError, so they set an
// application/json content type; anything else with an error status can only
// have come from the framework and is safe to replace.
func methodGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Media responses can be hundreds of megabytes and support Range. The
		// buffering recorder exists only to rewrite framework 404/405 text, and
		// assets are already served by an application handler with JSON errors.
		// The documentation handler writes its own JSON errors and must stream
		// files instead of buffering them. Chart stream and line responses are
		// also unbounded binary payloads, so they bypass the recorder too.
		if strings.Contains(r.URL.Path, "/assets/") || isDocsPath(r.URL.Path) ||
			((r.Method == http.MethodGet || r.Method == http.MethodHead) && isChartStreamPath(r.URL.Path)) {
			next.ServeHTTP(w, r)
			return
		}
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)

		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		frameworkError := (status == http.StatusNotFound || status == http.StatusMethodNotAllowed) &&
			!strings.HasPrefix(rec.header().Get("Content-Type"), "application/json")
		if !frameworkError {
			rec.flush()
			return
		}

		code, message := "not_found", "no such resource"
		if status == http.StatusMethodNotAllowed {
			code = "method_not_allowed"
			message = "method " + r.Method + " is not allowed for this resource"
		}
		body, _ := json.Marshal(errorBody{Error: errorDetail{Code: code, Message: message}})
		w.Header().Del("Content-Length")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_, _ = w.Write(body)
	})
}

// statusRecorder captures the status code and body so framework-generated
// error text can be replaced with a JSON envelope before anything is sent.
type statusRecorder struct {
	http.ResponseWriter
	status int
	body   []byte
}

// WriteHeader records the first status code and ignores later calls.
func (s *statusRecorder) WriteHeader(code int) {
	if s.status != 0 {
		return
	}
	s.status = code
}

// Write buffers the body and records an implicit 200 status.
func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	s.body = append(s.body, b...)
	return len(b), nil
}

// header exposes the underlying header map for content-type inspection.
func (s *statusRecorder) header() http.Header { return s.ResponseWriter.Header() }

// flush commits the buffered response to the real writer.
func (s *statusRecorder) flush() {
	if s.status != 0 {
		s.ResponseWriter.WriteHeader(s.status)
	}
	if len(s.body) > 0 {
		_, _ = s.ResponseWriter.Write(s.body)
	}
}

// writeJSON writes a JSON success envelope with no-store caching.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "failed to encode response")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// errorBody is the contractual error envelope.
type errorBody struct {
	Error errorDetail `json:"error"`
}

// errorDetail is one machine-readable error code and its message.
type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeError emits {"error":{"code":...,"message":...}}.
func writeError(w http.ResponseWriter, status int, code, message string) {
	body, _ := json.Marshal(errorBody{Error: errorDetail{Code: code, Message: message}})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// writeStoreError maps store sentinels onto HTTP statuses.
func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found")
		return
	}
	var conflict *store.RevisionConflictError
	if errors.As(err, &conflict) {
		body, _ := json.Marshal(map[string]any{
			"error": map[string]any{
				"code":            "revision_conflict",
				"message":         "the project changed since it was loaded",
				"currentRevision": conflict.CurrentRevision,
			},
		})
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write(body)
		return
	}
	if isStorageError(err) {
		writeError(w, http.StatusInsufficientStorage, "storage_error", "the local database could not be written")
		return
	}
	writeError(w, http.StatusInternalServerError, "internal_error", "internal server error")
}

// isStorageError reports whether err looks like a full or unwritable database.
func isStorageError(err error) bool {
	message := strings.ToLower(err.Error())
	for _, marker := range []string{
		"database or disk is full",
		"no space left",
		"disk i/o error",
		"readonly database",
		"unable to open database file",
		"database is locked",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

// decodeBody reads and decodes a JSON request body. A completely empty body is
// reported as such so handlers can return 400 without guessing.
func decodeBody(r *http.Request, dst any) error {
	if r.Body == nil {
		return io.EOF
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, maxRequestBody))
	if err := dec.Decode(dst); err != nil {
		return err
	}
	// Reject trailing garbage so malformed payloads fail loudly.
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("unexpected trailing content in request body")
	}
	return nil
}

// badJSON reports a request body that is not a valid JSON object.
func badJSON(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "invalid_json", "request body must be a valid JSON object")
}

// queryInt parses an optional integer query parameter, returning def when absent.
func queryInt(r *http.Request, key string, def int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return def, nil
	}
	return strconv.Atoi(raw)
}

// handleHealth reports service identity, project count, the sidecar version,
// whether the embedded collaboration listener is usable, and whether the
// documentation site is mounted.
func (a *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	_, total, err := a.store.ListProjects(r.Context(), store.ListProjectsInput{Archived: "all", Limit: 1})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	collab := a.collab
	collab.Degraded = collab.Enabled && !collab.OK
	degraded := collab.Degraded
	writeJSON(w, http.StatusOK, map[string]any{
		"name":       Name,
		"api":        APIVersion,
		"ok":         !degraded,
		"degraded":   degraded,
		"projects":   total,
		"instances":  a.instances.CountForHealth(),
		"backendId":  a.instances.BackendID(),
		"db":         a.store.Path,
		"version":    Version,
		"collabPort": collab.Port,
		"collab":     collab,
		"docs":       a.docs.available(),
	})
}

// handleCodeCellEndpoint reports the path of the bridge handshake file without
// exposing its token. The token stays in the user's data directory and travels
// from the desktop host to the editor over the native file bridge.
func (a *API) handleCodeCellEndpoint(w http.ResponseWriter, r *http.Request) {
	if !codecell.LoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "loopback_required", "the Code Cell endpoint is only available on loopback")
		return
	}
	if !codecell.OriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_denied", "the Code Cell endpoint rejects browser origins")
		return
	}
	path, err := codecell.EnsureEndpoint(a.store.Path)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "codecell_endpoint_unavailable", "the Code Cell bridge credential is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "bridge": codecell.BridgePath})
}

// handleShutdown asks the desktop-owned sidecar to stop gracefully. The route
// stays loopback-only because the main listener may be exposed for rooms.
func (a *API) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if !codecell.LoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "loopback_required", "shutdown is only available on loopback")
		return
	}
	if a.shutdown == nil {
		writeError(w, http.StatusServiceUnavailable, "shutdown_unavailable", "shutdown control is not available")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "shuttingDown": true})
	a.shutdown()
}

// handleListProjects serves the filtered, paginated project listing.
func (a *API) handleListProjects(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, err := queryInt(r, "limit", 100)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_query", "limit must be an integer")
		return
	}
	offset, err := queryInt(r, "offset", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_query", "offset must be an integer")
		return
	}
	archived := strings.ToLower(strings.TrimSpace(q.Get("archived")))
	if archived == "" {
		archived = "all"
	}
	if archived != "all" && archived != "true" && archived != "false" {
		writeError(w, http.StatusBadRequest, "invalid_query", "archived must be one of all|true|false")
		return
	}
	sort := strings.ToLower(strings.TrimSpace(q.Get("sort")))
	if sort == "" {
		sort = "updated"
	}
	switch sort {
	case "created", "updated", "name", "composer", "charter":
	default:
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_query",
			"sort must be one of created|updated|name|composer|charter",
		)
		return
	}
	direction := strings.ToLower(strings.TrimSpace(q.Get("direction")))
	if direction == "" {
		direction = "desc"
	}
	if direction != "asc" && direction != "desc" {
		writeError(w, http.StatusBadRequest, "invalid_query", "direction must be asc or desc")
		return
	}

	projects, total, err := a.store.ListProjects(r.Context(), store.ListProjectsInput{
		Search:    q.Get("search"),
		Group:     q.Get("group"),
		Archived:  archived,
		Sort:      sort,
		Direction: direction,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects, "total": total})
}

// createProjectRequest is the POST /api/projects body.
type createProjectRequest struct {
	Name  *string         `json:"name"`
	Group string          `json:"group"`
	Chart json.RawMessage `json:"chart"`
}

// handleCreateProject creates a project from a minimal descriptor.
func (a *API) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req createProjectRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if req.Name == nil || strings.TrimSpace(*req.Name) == "" {
		writeError(w, http.StatusBadRequest, "missing_name", "name is required and must not be blank")
		return
	}
	if len(req.Chart) > 0 && strings.TrimSpace(string(req.Chart)) != "null" {
		if !json.Valid(req.Chart) {
			writeError(w, http.StatusBadRequest, "invalid_chart", "chart must be a valid JSON object")
			return
		}
		var object map[string]json.RawMessage
		if err := json.Unmarshal(req.Chart, &object); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_chart", "chart must be a valid JSON object")
			return
		}
	}
	project, err := a.store.CreateProject(r.Context(), store.CreateProjectInput{
		Name:  *req.Name,
		Group: req.Group,
		Chart: req.Chart,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project": project})
}

// handleGetProject returns one project with its chart.
func (a *API) handleGetProject(w http.ResponseWriter, r *http.Request) {
	project, err := a.store.GetProject(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project})
}

// handleGetProjectSummary returns project metadata without the chart payload.
func (a *API) handleGetProjectSummary(w http.ResponseWriter, r *http.Request) {
	project, err := a.store.GetProjectSummary(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project})
}

// patchProjectRequest uses pointers so absent keys stay unchanged.
type patchProjectRequest struct {
	Name     *string          `json:"name"`
	Group    *string          `json:"group"`
	Archived *bool            `json:"archived"`
	Chart    *json.RawMessage `json:"chart"`
}

// handlePatchProject applies a partial update.
func (a *API) handlePatchProject(w http.ResponseWriter, r *http.Request) {
	var req patchProjectRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if req.Name == nil && req.Group == nil && req.Archived == nil && req.Chart == nil {
		writeError(w, http.StatusBadRequest, "empty_update", "request body must contain at least one of name, group, archived, chart")
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) == "" {
		writeError(w, http.StatusBadRequest, "invalid_name", "name must not be blank")
		return
	}
	if req.Chart != nil && !json.Valid(*req.Chart) {
		writeError(w, http.StatusBadRequest, "invalid_chart", "chart must be a valid JSON object")
		return
	}
	project, err := a.store.UpdateProject(r.Context(), r.PathValue("id"), store.UpdateProjectInput{
		Name:     req.Name,
		Group:    req.Group,
		Archived: req.Archived,
		Chart:    req.Chart,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_update", "the update could not be applied")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": project})
}

// handleDeleteProject deletes a project and its revisions.
func (a *API) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteProject(r.Context(), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// commitProjectRequest is the atomic library-save body. `chart` is spelled as
// raw JSON so the renderer can send its worker-produced text unchanged.
type commitProjectRequest struct {
	BaseRevision *int                  `json:"baseRevision"`
	Name         *string               `json:"name"`
	Chart        json.RawMessage       `json:"chart"`
	Assets       *[]store.AssetMapping `json:"assets"`
	ViewState    *json.RawMessage      `json:"viewState"`
	AssetFolders *[]string             `json:"assetFolders"`
	Label        string                `json:"label"`
	Snapshot     bool                  `json:"snapshot"`
}

// handleCommitProject saves a chart and its complete asset manifest in one
// transaction, refusing a stale base revision.
func (a *API) handleCommitProject(w http.ResponseWriter, r *http.Request) {
	var req commitProjectRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if len(req.Chart) == 0 || strings.TrimSpace(string(req.Chart)) == "null" {
		writeError(w, http.StatusBadRequest, "missing_chart", "chart is required")
		return
	}
	project, err := a.store.CommitProject(r.Context(), store.CommitProjectInput{
		ProjectID:    r.PathValue("id"),
		BaseRevision: req.BaseRevision,
		Name:         req.Name,
		Chart:        req.Chart,
		Assets:       req.Assets,
		ViewState:    req.ViewState,
		AssetFolders: req.AssetFolders,
		Label:        req.Label,
		Snapshot:     req.Snapshot,
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

// duplicateProjectRequest names the copy.
type duplicateProjectRequest struct {
	Name string `json:"name"`
}

// handleDuplicateProject copies a project's chart and asset manifest.
func (a *API) handleDuplicateProject(w http.ResponseWriter, r *http.Request) {
	var req duplicateProjectRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	project, err := a.store.DuplicateProject(r.Context(), r.PathValue("id"), req.Name)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_duplicate", "the project could not be duplicated")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"project": project})
}

// handleListAssets returns the project's asset manifest.
func (a *API) handleListAssets(w http.ResponseWriter, r *http.Request) {
	if _, err := a.store.GetProjectSummary(r.Context(), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	assets, err := a.store.ListProjectAssets(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets})
}

// handleStageAsset stores one blob without attaching it; the following commit
// replaces the manifest atomically.
func (a *API) handleStageAsset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "missing_name", "asset name is required")
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxAssetBody+1)
	data, err := io.ReadAll(body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "asset_too_large", "asset exceeds the size limit")
		return
	}
	if len(data) > maxAssetBody {
		writeError(w, http.StatusRequestEntityTooLarge, "asset_too_large", "asset exceeds the size limit")
		return
	}
	asset, err := a.store.StageAsset(r.Context(), r.PathValue("id"), name, data)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_asset", "the asset request was rejected")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"asset": asset, "staged": true})
}

// handleReadAsset serves exact blob bytes with Range support so audio seeking
// works without materialising the whole track in the renderer.
func (a *API) handleReadAsset(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	asset, reader, err := a.store.OpenProjectAsset(r.Context(), r.PathValue("id"), name)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_asset", "the asset request was rejected")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("ETag", `"`+asset.Hash+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if contentType := mime.TypeByExtension(path.Ext(asset.Name)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, asset.Name, time.Time{}, reader)
}

// handleListRevisions lists a project's snapshots newest first.
func (a *API) handleListRevisions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := a.store.GetProject(r.Context(), id); err != nil {
		writeStoreError(w, err)
		return
	}
	limit, err := queryInt(r, "limit", 50)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_query", "limit must be an integer")
		return
	}
	revisions, err := a.store.ListRevisions(r.Context(), id, limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revisions})
}

// createRevisionRequest is the POST body for a snapshot.
type createRevisionRequest struct {
	Chart json.RawMessage `json:"chart"`
	Label string          `json:"label"`
}

// handleCreateRevision stores a new chart snapshot.
func (a *API) handleCreateRevision(w http.ResponseWriter, r *http.Request) {
	var req createRevisionRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	revision, err := a.store.CreateRevision(r.Context(), store.CreateRevisionInput{
		ProjectID: r.PathValue("id"),
		Chart:     req.Chart,
		Label:     req.Label,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_revision", "the revision could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"revision": revision})
}

// handleGetRevision returns one snapshot with its chart.
func (a *API) handleGetRevision(w http.ResponseWriter, r *http.Request) {
	revision, err := a.store.GetRevision(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision})
}

// handleDeleteRevision removes one snapshot.
func (a *API) handleDeleteRevision(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteRevision(r.Context(), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// handleGetPreferences returns the stored preferences object.
func (a *API) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	values, err := a.store.GetPreferences(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": values})
}

// putPreferencesRequest replaces the whole preferences object.
type putPreferencesRequest struct {
	Values *json.RawMessage `json:"values"`
}

// handlePutPreferences stores a validated preferences object. The write token
// is the capability boundary for consent-changing settings.
func (a *API) handlePutPreferences(w http.ResponseWriter, r *http.Request) {
	if !a.preferenceWriteAllowed(r) {
		writeError(w, http.StatusUnauthorized, "preference_token_required", "a preference write token is required")
		return
	}
	var req putPreferencesRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if req.Values == nil {
		writeError(w, http.StatusBadRequest, "missing_values", "values is required")
		return
	}
	if err := preferences.ValidateDocument(*req.Values); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_values", err.Error())
		return
	}
	values, err := a.store.PutPreferences(r.Context(), *req.Values)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_values", "preferences could not be stored")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"values": values})
}

// handleCheckpoint makes the SQLite file safe for the native backup command.
func (a *API) handleCheckpoint(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Checkpoint(r.Context()); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
