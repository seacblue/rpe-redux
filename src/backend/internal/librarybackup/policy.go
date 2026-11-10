// Portable preference filtering. Host-local sections never leave the host;
// per-key maps drop consent switches, host-scoped rows, application-data file
// references, and extension-private values.
package librarybackup

import (
	"encoding/json"
	"fmt"
	"strings"
)

var portableSections = map[string]bool{
	"shortcuts":     true,
	"settings":      true,
	"values":        true,
	"appearance":    true,
	"icons":         true,
	"noteSkin":      true,
	"language":      true,
	"trajectory":    true,
	"multiEdit":     true,
	"lineSelection": true,
	"sampler":       true,
	"welcome":       true,
	"onboarding":    true,
	"rpe":           true,
}

// excludedSettingKeys are consent switches, host-scoped rows, and file
// references. They must be re-chosen on the destination host.
var excludedSettingKeys = map[string]bool{
	"code-execution-enabled":          true,
	"extensions-disclaimer-accepted":  true,
	"window-display-mode":             true,
	"window-resolution":               true,
	"frontend-port":                   true,
	"backend-port":                    true,
	"ai-port":                         true,
	"custom-background":               true,
	"autosave-enabled":                true,
	"autosave-seconds":                true,
	"autosave-limit":                  true,
	"session-restore":                 true,
	"update-auto-check":               true,
	"update-download-policy":          true,
	"update-prereleases":              true,
	"update-verify":                   true,
	"help-docs":                       true,
	"open-data-folder":                true,
	"library-backup-auto":             true,
	"library-backup-interval-seconds": true,
}

func excludedPreferenceKey(key string) bool {
	return excludedSettingKeys[key] ||
		strings.HasPrefix(key, "extension.") ||
		strings.HasPrefix(key, "mod.")
}

// portablePreferences turns the live preference document into the snapshot
// object. Unknown sections are omitted so a future host-local addition cannot
// silently become portable.
func portablePreferences(raw []byte) ([]byte, error) {
	document, err := decodeObject(raw)
	if err != nil {
		return nil, err
	}
	filtered := make(map[string]json.RawMessage)
	for section, value := range document {
		if !portableSections[section] {
			continue
		}
		if section == "settings" || section == "values" {
			value, err = filterKeyMap(value)
			if err != nil {
				return nil, fmt.Errorf("filter preference section %s: %w", section, err)
			}
		}
		filtered[section] = value
	}
	payload, err := json.Marshal(Preferences{
		Format:   PreferencesFormat,
		Version:  1,
		Policy:   PreferencePolicy,
		Sections: filtered,
	})
	if err != nil {
		return nil, fmt.Errorf("encode portable preferences: %w", err)
	}
	return payload, nil
}

// mergePreferences overlays the portable sections from a snapshot on the
// current host document. settings and values merge per key; other portable
// sections replace. Host-local sections stay untouched.
func mergePreferences(current, snapshot []byte) ([]byte, error) {
	host, err := decodeObject(current)
	if err != nil {
		return nil, err
	}
	var portable Preferences
	if err := json.Unmarshal(snapshot, &portable); err != nil {
		return nil, fmt.Errorf("decode snapshot preferences: %w", err)
	}
	for section, value := range portable.Sections {
		if !portableSections[section] {
			continue
		}
		if section == "settings" || section == "values" {
			currentMap, err := decodeObject(host[section])
			if err != nil {
				currentMap = make(map[string]json.RawMessage)
			}
			snapshotMap, err := decodeObject(value)
			if err != nil {
				return nil, fmt.Errorf("decode snapshot %s: %w", section, err)
			}
			for key, entry := range snapshotMap {
				if !excludedPreferenceKey(key) {
					currentMap[key] = entry
				}
			}
			merged, err := json.Marshal(currentMap)
			if err != nil {
				return nil, err
			}
			host[section] = merged
			continue
		}
		host[section] = value
	}
	merged, err := json.Marshal(host)
	if err != nil {
		return nil, fmt.Errorf("encode merged preferences: %w", err)
	}
	return merged, nil
}

func decodeObject(raw []byte) (map[string]json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return make(map[string]json.RawMessage), nil
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &document); err != nil {
		return nil, fmt.Errorf("preferences must be a JSON object: %w", err)
	}
	if document == nil {
		document = make(map[string]json.RawMessage)
	}
	return document, nil
}

func filterKeyMap(raw []byte) ([]byte, error) {
	values, err := decodeObject(raw)
	if err != nil {
		return nil, err
	}
	filtered := make(map[string]json.RawMessage, len(values))
	for key, value := range values {
		if !excludedPreferenceKey(key) {
			filtered[key] = value
		}
	}
	return json.Marshal(filtered)
}
