// HTTP handlers for frontend instance leases and document occupancy.

package httpapi

import (
	"net/http"
	"strings"
)

// instanceRegisterRequest is the POST /api/instances/register body.
type instanceRegisterRequest struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	FrontendPort int    `json:"frontendPort"`
	PID          int    `json:"pid"`
}

// instanceIDRequest names a frontend instance.
type instanceIDRequest struct {
	ID string `json:"id"`
}

// documentKeyRequest identifies a document lock and its holder.
type documentKeyRequest struct {
	DocumentKey  string `json:"documentKey"`
	InstanceID   string `json:"instanceId"`
	ChartName    string `json:"chartName"`
	Label        string `json:"label"`
	FrontendPort int    `json:"frontendPort"`
}

// handleListInstances returns the live instance and lock listing.
func (a *API) handleListInstances(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.instances.List())
}

// handleRegisterInstance creates or refreshes an instance lease.
func (a *API) handleRegisterInstance(w http.ResponseWriter, r *http.Request) {
	var request instanceRegisterRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	request.ID = strings.TrimSpace(request.ID)
	if request.ID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "instance id is required")
		return
	}
	instance := a.instances.Register(
		request.ID,
		strings.TrimSpace(request.Label),
		request.PID,
		request.FrontendPort,
	)
	writeJSON(w, http.StatusOK, map[string]any{
		"backendId": a.instances.BackendID(),
		"instance":  instance,
	})
}

// handleHeartbeatInstance refreshes an instance lease and reports an unknown id.
func (a *API) handleHeartbeatInstance(w http.ResponseWriter, r *http.Request) {
	var request instanceIDRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	if !a.instances.Heartbeat(strings.TrimSpace(request.ID)) {
		writeError(w, http.StatusNotFound, "instance_unknown", "the frontend instance is no longer registered")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleLeaveInstance removes an instance and returns the remaining count.
func (a *API) handleLeaveInstance(w http.ResponseWriter, r *http.Request) {
	var request instanceIDRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	remaining := a.instances.Leave(strings.TrimSpace(request.ID))
	writeJSON(w, http.StatusOK, map[string]any{"remaining": remaining})
}

// handleClearInstance drops every lock owned by an instance.
func (a *API) handleClearInstance(w http.ResponseWriter, r *http.Request) {
	var request instanceIDRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	cleared := a.instances.ClearInstanceLocks(strings.TrimSpace(request.ID))
	writeJSON(w, http.StatusOK, map[string]any{"cleared": cleared})
}

// handlePruneInstances prunes expired leases and returns the live listing.
func (a *API) handlePruneInstances(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.instances.List())
}

// handleAcquireDocument claims a document or returns the current owner.
func (a *API) handleAcquireDocument(w http.ResponseWriter, r *http.Request) {
	var request documentKeyRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	request.DocumentKey = strings.TrimSpace(request.DocumentKey)
	request.InstanceID = strings.TrimSpace(request.InstanceID)
	if request.DocumentKey == "" || request.InstanceID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "documentKey and instanceId are required")
		return
	}
	owner, acquired := a.instances.Acquire(
		request.DocumentKey,
		request.InstanceID,
		strings.TrimSpace(request.Label),
		strings.TrimSpace(request.ChartName),
		request.FrontendPort,
	)
	if !acquired {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]any{
				"code":    "occupied",
				"message": "the document is open in another frontend instance",
				"details": map[string]any{
					"backendId": a.instances.BackendID(),
					"owner":     owner,
				},
			},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"backendId": a.instances.BackendID(),
		"owner":     owner,
	})
}

// handleReleaseDocument releases a document lock held by the caller.
func (a *API) handleReleaseDocument(w http.ResponseWriter, r *http.Request) {
	var request documentKeyRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	released := a.instances.Release(strings.TrimSpace(request.DocumentKey), strings.TrimSpace(request.InstanceID))
	writeJSON(w, http.StatusOK, map[string]any{"released": released})
}

// handleClearDocument force-releases a document lock by key.
func (a *API) handleClearDocument(w http.ResponseWriter, r *http.Request) {
	var request documentKeyRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	cleared := a.instances.ClearDocument(strings.TrimSpace(request.DocumentKey))
	writeJSON(w, http.StatusOK, map[string]any{"cleared": cleared})
}

// handleReconcileDocument reports whether a document is free for the caller.
func (a *API) handleReconcileDocument(w http.ResponseWriter, r *http.Request) {
	var request documentKeyRequest
	if err := decodeBody(r, &request); err != nil {
		badJSON(w)
		return
	}
	owner, available := a.instances.Reconcile(
		strings.TrimSpace(request.DocumentKey),
		strings.TrimSpace(request.InstanceID),
	)
	writeJSON(w, http.StatusOK, map[string]any{
		"backendId": a.instances.BackendID(),
		"available": available,
		"owner":     owner,
	})
}
