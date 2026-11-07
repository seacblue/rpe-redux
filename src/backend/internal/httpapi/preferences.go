// HTTP handlers for the durable preference blob and its write credential.

package httpapi

import (
	"net/http"

	"rperedux/server/internal/codecell"
	"rperedux/server/internal/config"
	"rperedux/server/internal/preferences"
)

// preferenceWriteAllowed accepts the write token, or a local Vite origin while
// the sidecar is running in development. Production never adds those origins to
// the allowlist, so the second path is unreachable there.
func (a *API) preferenceWriteAllowed(r *http.Request) bool {
	if preferences.TokenValid(r) {
		return true
	}
	origin, ok := originInSet(r.Header.Get("Origin"), a.origins)
	if !ok || origin == "" {
		return false
	}
	for _, candidate := range config.DevOrigins {
		if normalized, ok := normalizeOrigin(candidate); ok && normalized == origin {
			return true
		}
	}
	return false
}

// handlePreferencesEndpoint reports the handshake-file path and header name
// without exposing the token itself. It is loopback-only and follows the same
// origin allowlist as the rest of the API.
func (a *API) handlePreferencesEndpoint(w http.ResponseWriter, r *http.Request) {
	if !codecell.LoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "loopback_required", "the preference endpoint is only available on loopback")
		return
	}
	if _, ok := originInSet(r.Header.Get("Origin"), a.origins); !ok {
		writeError(w, http.StatusForbidden, "origin_denied", "the preference endpoint rejects this origin")
		return
	}
	path, err := preferences.EnsureEndpoint(a.store.Path)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "preferences_endpoint_unavailable", "the preference write credential is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":        path,
		"header":      preferences.TokenHeader,
		"preferences": "/api/preferences",
	})
}
