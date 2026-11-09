// HTTP surface for classifying paths dropped onto the desktop window. The
// read is loopback-only because it inspects local files chosen by the caller.
package httpapi

import (
	"net/http"
	"strings"

	"rperedux/server/internal/codecell"
	"rperedux/server/internal/intake"
)

// maxIntakePaths bounds one drop inspection request.
const maxIntakePaths = 64

// intakeRequest is the POST /api/intake/classify body.
type intakeRequest struct {
	Paths []string `json:"paths"`
}

// handleClassifyIntake reports the owner and chart format for every dropped
// path, preserving input order. Per-path failures stay in the item list.
func (a *API) handleClassifyIntake(w http.ResponseWriter, r *http.Request) {
	if !codecell.LoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "loopback_required", "drop classification is only available on loopback")
		return
	}
	var req intakeRequest
	if err := decodeBody(r, &req); err != nil {
		badJSON(w)
		return
	}
	if len(req.Paths) > maxIntakePaths {
		writeError(w, http.StatusBadRequest, "too_many_paths", "at most 64 paths can be classified at once")
		return
	}
	items := make([]intake.Item, 0, len(req.Paths))
	for _, value := range req.Paths {
		if strings.TrimSpace(value) == "" {
			items = append(items, intake.Item{Path: value, Kind: intake.KindUnknown, Reason: "path is empty or invalid"})
			continue
		}
		items = append(items, intake.Classify(value))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
