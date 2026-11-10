// HTTP surface for the library snapshot store. The existing settings page
// continues to own portable .sqlite export/import; these routes expose the
// automatic history, restore, verification, and retention commands.
package httpapi

import (
	"io"
	"net/http"
	"strconv"

	"rperedux/server/internal/librarybackup"
)

// NewBackupHandler returns the /api/library/backups subtree.
func NewBackupHandler(service *librarybackup.Service, extraOrigins ...string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		status, err := service.Status(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_error", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, status)
	})
	mux.HandleFunc("POST /snapshots", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Reason string `json:"reason"`
		}
		if err := decodeBody(r, &request); err != nil && err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		if request.Reason == "" {
			request.Reason = "manual"
		}
		commit, err := service.Snapshot(r.Context(), request.Reason)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_snapshot_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, commit)
	})
	mux.HandleFunc("GET /commits", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		history, err := service.History(r.Context(), limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_error", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"commits": history})
	})
	mux.HandleFunc("POST /restore", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			CommitID string `json:"commitId"`
		}
		if err := decodeBody(r, &request); err != nil && err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		var (
			commit librarybackup.CommitSummary
			err    error
		)
		if request.CommitID == "" {
			commit, err = service.RestoreLatest(r.Context())
		} else {
			commit, err = service.Restore(r.Context(), request.CommitID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_restore_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, commit)
	})
	mux.HandleFunc("POST /verify", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			CommitID string `json:"commitId"`
		}
		if err := decodeBody(r, &request); err != nil && err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		report, err := service.Verify(r.Context(), request.CommitID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_verify_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, report)
	})
	mux.HandleFunc("POST /compact", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Keep int `json:"keep"`
		}
		if err := decodeBody(r, &request); err != nil && err != io.EOF {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		report, err := service.Compact(r.Context(), request.Keep)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "backup_compact_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, report)
	})
	return withCORS(methodGuard(mux), originSet(extraOrigins))
}
