// Preference document validation and the per-process write credential.
//
// The durable preference blob is a public HTTP read but a privileged write:
// enabling code cells changes the local trust boundary. PUT therefore
// accepts only the known top-level sections with their declared JSON shapes and
// requires the token written to a private file beside the SQLite database. The
// desktop frontend reads that file through the native host; a browser origin
// never receives the token.

package preferences

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	// endpointFileName is the handshake file the desktop frontend
	// reads before it writes preferences. It sits beside redux.db.
	endpointFileName = "preferences-endpoint.json"
	EndpointVersion  = 1
	// TokenHeader carries the write token. Authorization: Bearer is
	// accepted as well for native clients that prefer standard credentials.
	TokenHeader = "X-Redux-Preference-Token"
)

// Endpoint is the on-disk handshake record. The token is regenerated
// for every sidecar process; the file is written with owner-only permissions.
type Endpoint struct {
	Version     int    `json:"version"`
	Token       string `json:"token"`
	Header      string `json:"header"`
	Preferences string `json:"preferences"`
}

// preferencesCredential caches the random write token for this process. A
// failed generation is cached too so preference writes fail closed.
var preferencesCredential struct {
	once  sync.Once
	token string
	err   error
}

// Token returns the current process's preference-write token.
func Token() (string, error) {
	preferencesCredential.once.Do(func() {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			preferencesCredential.err = err
			return
		}
		preferencesCredential.token = base64.RawURLEncoding.EncodeToString(raw)
	})
	return preferencesCredential.token, preferencesCredential.err
}

// EnsureEndpoint writes the handshake file beside the database and
// returns its absolute path. Every process start replaces the file, so a token
// from an earlier sidecar cannot authorize a later write.
func EnsureEndpoint(dbPath string) (string, error) {
	token, err := Token()
	if err != nil {
		return "", fmt.Errorf("generate preference token: %w", err)
	}
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return "", err
	}
	path := filepath.Join(filepath.Dir(absolute), endpointFileName)
	payload, err := json.Marshal(Endpoint{
		Version:     EndpointVersion,
		Token:       token,
		Header:      TokenHeader,
		Preferences: "/api/preferences",
	})
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, append(payload, '\n'), 0o600); err != nil {
		return "", err
	}
	// Enforce the mode when the file already existed with broader permissions.
	_ = os.Chmod(path, 0o600)
	return path, nil
}

// preferenceSectionRule declares the JSON shape one top-level section accepts.
type preferenceSectionRule struct {
	kind     string
	nullable bool
}

const (
	preferenceObject = "object"
	preferenceArray  = "array"
	preferenceString = "string"
)

// preferenceSections mirrors the frontend PREFERENCE_SECTIONS catalog. Unknown
// keys are rejected so the HTTP surface cannot grow hidden storage.
var preferenceSections = map[string]preferenceSectionRule{
	"shortcuts":      {kind: preferenceObject},
	"noteSkin":       {kind: preferenceString},
	"clipboard":      {kind: preferenceArray, nullable: true},
	"appearance":     {kind: preferenceString},
	"icons":          {kind: preferenceString},
	"settings":       {kind: preferenceObject},
	"settingsWindow": {kind: preferenceObject, nullable: true},
	"values":         {kind: preferenceObject, nullable: true},
	"layout":         {kind: preferenceObject},
	"library":        {kind: preferenceObject},
	"trajectory":     {kind: preferenceObject},
	"multiEdit":      {kind: preferenceObject},
	"server":         {kind: preferenceString, nullable: true},
	"collaboration":  {kind: preferenceObject, nullable: true},
	"language":       {kind: preferenceString, nullable: true},
	"session":        {kind: preferenceObject, nullable: true},
	"lineSelection":  {kind: preferenceObject, nullable: true},
	"sampler":        {kind: preferenceObject, nullable: true},
	"welcome":        {kind: preferenceObject, nullable: true},
	"onboarding":     {kind: preferenceObject, nullable: true},
	"rpe":            {kind: preferenceObject, nullable: true},
	"dialogs":        {kind: preferenceObject},
}

// preferenceBooleanSettings are consent switches whose value must stay boolean.
// The write token is the authorization boundary for the whole settings section.
var preferenceBooleanSettings = map[string]bool{
	"code-execution-enabled": true,
}

// ValidateDocument checks the section allowlist and each section's
// declared shape. It accepts the whole document the frontend already sends.
func ValidateDocument(values json.RawMessage) error {
	trimmed := bytes.TrimSpace(values)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &document); err != nil || document == nil {
		return errors.New("values must be a JSON object")
	}
	for name, raw := range document {
		rule, ok := preferenceSections[name]
		if !ok {
			return fmt.Errorf("unknown preference section %q", name)
		}
		if err := validatePreferenceValue(name, raw, rule); err != nil {
			return err
		}
	}
	return nil
}

// validatePreferenceValue enforces one section's shape and the boolean consent
// switches inside the settings object.
func validatePreferenceValue(name string, raw json.RawMessage, rule preferenceSectionRule) error {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		if rule.nullable {
			return nil
		}
		return fmt.Errorf("preference section %q must be a %s", name, rule.kind)
	}
	switch rule.kind {
	case preferenceString:
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("preference section %q must be a string", name)
		}
	case preferenceArray:
		var value []json.RawMessage
		if err := json.Unmarshal(raw, &value); err != nil || value == nil {
			return fmt.Errorf("preference section %q must be an array", name)
		}
	case preferenceObject:
		var value map[string]json.RawMessage
		if err := json.Unmarshal(raw, &value); err != nil || value == nil {
			return fmt.Errorf("preference section %q must be an object", name)
		}
		if name == "settings" {
			for key, entry := range value {
				if key == "" {
					return errors.New("settings keys must not be empty")
				}
				if !preferenceBooleanSettings[key] {
					continue
				}
				var enabled bool
				if err := json.Unmarshal(entry, &enabled); err != nil {
					return fmt.Errorf("setting %q must be true or false", key)
				}
			}
		}
	}
	return nil
}

// TokenValid compares a supplied write token without leaking timing. The token
// may arrive in the dedicated header, as a query parameter, or as a bearer
// credential.
func TokenValid(r *http.Request) bool {
	expected, err := Token()
	if err != nil || expected == "" {
		return false
	}
	supplied := strings.TrimSpace(r.Header.Get(TokenHeader))
	if supplied == "" {
		supplied = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	if supplied == "" {
		const bearer = "Bearer "
		if authorization := r.Header.Get("Authorization"); strings.HasPrefix(authorization, bearer) {
			supplied = strings.TrimSpace(strings.TrimPrefix(authorization, bearer))
		}
	}
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(expected)) == 1
}
