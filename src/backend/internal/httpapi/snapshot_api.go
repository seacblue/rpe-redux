// HTTP handlers for the chart snapshot branch tree.
//
// A snapshot is an automatic or explicit backup of one chart. The list endpoint
// reports each node's time, note count, and event count so the restore dialog can
// show them without reading any chart payload; a restore applies one node as the
// project chart and records the replaced chart as a new node.

package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"rperedux/server/internal/store"
)

// snapshotRetentionDefault mirrors the `autosave-limit` settings default.
const snapshotRetentionDefault = 10

// snapshotRetentionMax mirrors the `autosave-limit` settings upper bound.
const snapshotRetentionMax = 100

// handleListSnapshots lists a project's snapshot nodes newest first.
func (a *API) handleListSnapshots(w http.ResponseWriter, r *http.Request) {
	limit, err := queryInt(r, "limit", 100)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_query", "limit must be an integer")
		return
	}
	history, err := a.store.ListChartSnapshots(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"snapshots": history.Snapshots,
		"headId":    history.HeadID,
	})
}

// createSnapshotRequest is the POST body for one node.
type createSnapshotRequest struct {
	Chart json.RawMessage `json:"chart"`
	// ParentID continues an existing branch; omitted means the project head.
	ParentID string `json:"parentId"`
	Reason   string `json:"reason"`
	Label    string `json:"label"`
	// AdvanceHead moves the head onto the new node; a restore leaves it alone.
	AdvanceHead bool `json:"advanceHead"`
	// Retain overrides the stored `autosave-limit` for this write.
	Retain int `json:"retain"`
	// Dedupe is an explicit request to skip a duplicate node. It defaults to the
	// behaviour of the reason, so an automatic backup never fills the window.
	Dedupe *bool `json:"dedupe"`
	// EditSeconds is the project's charting time when the node was taken.
	EditSeconds int `json:"editSeconds"`
}

// handleCreateSnapshot appends one node and prunes the project.
func (a *API) handleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	var req createSnapshotRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if len(req.Chart) == 0 || strings.TrimSpace(string(req.Chart)) == "null" {
		writeError(w, http.StatusBadRequest, "missing_chart", "chart is required")
		return
	}
	retain := req.Retain
	if retain <= 0 {
		retain = a.snapshotRetention(r)
	}
	reason := store.NormalizeSnapshotReason(req.Reason)
	// An automatic backup skips a write it would only duplicate, so an idle chart
	// cannot fill the retention window with copies of itself. A manual capture is
	// an explicit answer to the restore question, so it always stores what the
	// user was looking at. An explicit `dedupe` wins over both defaults.
	dedupe := reason == store.SnapshotReasonAuto
	if req.Dedupe != nil {
		dedupe = *req.Dedupe
	}
	snapshot, err := a.store.CreateChartSnapshot(r.Context(), store.CreateChartSnapshotInput{
		ProjectID:   r.PathValue("id"),
		Chart:       req.Chart,
		ParentID:    req.ParentID,
		Reason:      reason,
		Label:       req.Label,
		AdvanceHead: req.AdvanceHead,
		Dedupe:      dedupe,
		Retain:      retain,
		EditSeconds: req.EditSeconds,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeStoreError(w, err)
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_snapshot", "the snapshot could not be stored")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"snapshot": snapshot})
}

// handleGetSnapshot returns one node with its chart payload.
func (a *API) handleGetSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := a.store.GetChartSnapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshot": snapshot})
}

// handleDeleteSnapshot removes one node.
func (a *API) handleDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteChartSnapshot(r.Context(), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

// handleRestoreSnapshot applies one node as the project chart.
func (a *API) handleRestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := a.store.RestoreChartSnapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// Report the project the restore changed so the caller can reload it.
	project, err := a.store.GetProjectSummary(r.Context(), snapshot.ProjectID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"snapshot": snapshot,
		"project":  project,
	})
}

// snapshotRetention reads the configured backup count, falling back to the
// settings default and clamping to the settings range.
func (a *API) snapshotRetention(r *http.Request) int {
	raw, err := a.store.GetPreferences(r.Context())
	if err != nil {
		return snapshotRetentionDefault
	}
	var document struct {
		Settings map[string]json.RawMessage `json:"settings"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return snapshotRetentionDefault
	}
	setting, ok := document.Settings["autosave-limit"]
	if !ok {
		return snapshotRetentionDefault
	}
	// The settings registry stores numeric controls as strings, but an older
	// writer may have left a bare number.
	var number float64
	if err := json.Unmarshal(setting, &number); err == nil {
		return clampRetention(int(number))
	}
	var text string
	if err := json.Unmarshal(setting, &text); err != nil {
		return snapshotRetentionDefault
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(text))
	if err != nil {
		return snapshotRetentionDefault
	}
	return clampRetention(parsed)
}

// clampRetention keeps a configured count inside the supported range.
func clampRetention(value int) int {
	if value < 1 {
		return 1
	}
	if value > snapshotRetentionMax {
		return snapshotRetentionMax
	}
	return value
}
