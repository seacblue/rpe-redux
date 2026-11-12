// RPE root details for the import review dialog.
//
// The reader reads only the bounded sidecars and the direct chart folders the
// native editor writes. Chart bytes and media stay untouched; the desktop
// document store owns opening a selected chart.
package intake

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	// maxRpeTextBytes bounds Settings.json, Hotkey.txt, UI.txt, and Info.txt.
	maxRpeTextBytes = 2 << 20
	// maxRpeChartFolders bounds one installation scan.
	maxRpeChartFolders = 5000
	// maxRpeWrapperParents bounds the search for a wrapped installation.
	maxRpeWrapperParents = 64
)

// RpeChart is one chart folder inside an RPE Resources directory.
type RpeChart struct {
	// Path is the absolute chart JSON the importer opens.
	Path string `json:"path"`
	// Folder is the chart folder name below Resources.
	Folder string `json:"folder"`
	// Name is the song title from Info.txt, or a file-name fallback.
	Name string `json:"name"`
	// Group is the collection named by Info.txt, or RPE.
	Group string `json:"group"`
	// Song and Picture are the media names Info.txt references.
	Song    string `json:"song,omitempty"`
	Picture string `json:"picture,omitempty"`
	// Chart is the chart file name for display.
	Chart string `json:"chart,omitempty"`
	// Composer is the composer field Info.txt carries.
	Composer string `json:"composer,omitempty"`
	// Charter is the charter field Info.txt carries.
	Charter string `json:"charter,omitempty"`
	// LastEdit is the RPE-sized edit timestamp from Info.txt.
	LastEdit string `json:"lastEdit,omitempty"`
	// Autosaves is the number of AutoSave_*.json snapshots beside the chart.
	Autosaves int `json:"autosaves"`
}

// RpeFolderScan is the bounded content the review dialog presents.
type RpeFolderScan struct {
	Root string `json:"root"`
	// Installation is true when the root carries PhiEdit.exe and Resources.
	Installation bool `json:"installation"`
	// SettingsText, HotkeysText, UIText, and DivisionColorText are the original
	// sidecar bodies. The frontend owns the mapping from RPE fields to editor
	// settings.
	SettingsText      *string    `json:"settingsText"`
	HotkeysText       *string    `json:"hotkeysText"`
	UIText            *string    `json:"uiText"`
	DivisionColorText *string    `json:"divisionColorText"`
	Charts            []RpeChart `json:"charts"`
	Warnings          []string   `json:"warnings"`
}

// ReadRpeFolder reads one classified RPE root. It rejects non-folder paths and
// otherwise returns a partial result with warnings instead of failing the whole
// review.
func ReadRpeFolder(raw string) (RpeFolderScan, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(raw) > maxPathLength || strings.ContainsRune(raw, 0) {
		return RpeFolderScan{}, errors.New("path is empty or invalid")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return RpeFolderScan{}, errors.New("path could not be resolved")
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return RpeFolderScan{}, errors.New("path is not a readable folder")
	}
	root := effectiveRpeRoot(absolute)
	scan := RpeFolderScan{
		Root:         root,
		Installation: isRpeInstallation(root),
		Charts:       make([]RpeChart, 0),
		Warnings:     make([]string, 0),
	}
	scan.SettingsText = readRpeText(findChild(root, "Settings.json"))
	if scan.SettingsText == nil {
		scan.SettingsText = readRpeText(findChild(root, "Settings.txt"))
	}
	scan.HotkeysText = readRpeText(findChild(root, "Hotkey.txt"))
	scan.UIText = readRpeText(findChild(root, "UI.txt"))
	if scan.UIText == nil {
		scan.UIText = readRpeText(findChild(root, "UI.json"))
	}
	scan.DivisionColorText = readRpeText(findChild(root, "division_color.txt"))

	directories := make([]string, 0, 5)
	for _, name := range []string{"Resources", "Charts"} {
		if directory := findChild(root, name); directory != "" && isDirectory(directory) {
			directories = append(directories, directory)
		}
	}
	// A folder dropped directly from Resources/<id> is a single-chart root.
	directories = append(directories, root)

	seen := make(map[string]struct{}, len(directories))
	for _, directory := range directories {
		key, err := filepath.Abs(directory)
		if err != nil {
			key = directory
		}
		if _, visited := seen[key]; visited {
			continue
		}
		seen[key] = struct{}{}
		entries, err := os.ReadDir(directory)
		if err != nil {
			scan.Warnings = append(scan.Warnings, "Could not read "+directory)
			continue
		}
		count := 0
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			count++
			if count > maxRpeChartFolders {
				scan.Warnings = append(scan.Warnings, "The RPE folder contains more than 5000 chart folders.")
				break
			}
			if chart, ok := rpeChartEntry(filepath.Join(directory, entry.Name())); ok {
				scan.Charts = append(scan.Charts, chart)
			}
		}
	}
	sort.Slice(scan.Charts, func(left, right int) bool {
		leftGroup := strings.ToLower(scan.Charts[left].Group)
		rightGroup := strings.ToLower(scan.Charts[right].Group)
		if leftGroup != rightGroup {
			return leftGroup < rightGroup
		}
		leftName := strings.ToLower(scan.Charts[left].Name)
		rightName := strings.ToLower(scan.Charts[right].Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return scan.Charts[left].Path < scan.Charts[right].Path
	})
	return scan, nil
}

// effectiveRpeRoot descends one wrapper when the selected parent contains an
// installation, matching the native host so a dropped game folder still opens
// its `rpe` child.
func effectiveRpeRoot(root string) string {
	if isRpeInstallation(root) {
		return root
	}
	if preferred := findChild(root, "rpe"); preferred != "" && isRpeInstallation(preferred) {
		return preferred
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return root
	}
	visited := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		visited++
		if visited > maxRpeWrapperParents {
			break
		}
		candidate := filepath.Join(root, entry.Name())
		if isRpeInstallation(candidate) {
			return candidate
		}
	}
	return root
}

// rpeChartEntry builds one chart row and ignores service folders without a
// chart file.
func rpeChartEntry(folder string) (RpeChart, bool) {
	info := readRpeInfo(findChild(folder, "info.txt"))
	chart := findRpeChart(folder, info)
	if chart == "" {
		return RpeChart{}, false
	}
	folderName := filepath.Base(folder)
	chartName := filepath.Base(chart)
	name := strings.TrimSpace(info["name"])
	if name == "" {
		name = strings.TrimSuffix(chartName, filepath.Ext(chartName))
	}
	if name == "" || name == "." {
		name = folderName
	}
	group := strings.TrimSpace(info["group"])
	if group == "" || group == "-" {
		group = "RPE"
	}
	return RpeChart{
		Path:      chart,
		Folder:    folderName,
		Name:      name,
		Group:     group,
		Song:      strings.TrimSpace(info["song"]),
		Picture:   strings.TrimSpace(info["picture"]),
		Chart:     chartName,
		Composer:  firstNonEmpty(info["composer"], info["artist"]),
		Charter:   firstNonEmpty(info["charter"], info["mapper"]),
		LastEdit:  strings.TrimSpace(info["lastedittime"]),
		Autosaves: countRpeAutosaves(folder),
	}, true
}

// readRpeInfo parses the colon-separated fields of Info.txt into lower-case
// keys.
func readRpeInfo(path string) map[string]string {
	fields := make(map[string]string)
	text, err := readBoundedFile(path, maxRpeTextBytes)
	if err != nil {
		return fields
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(text), "\uFEFF", ""), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	return fields
}

// findRpeChart resolves the chart file Info.txt names, then the folder stem,
// then the only remaining JSON file.
func findRpeChart(folder string, info map[string]string) string {
	if reference, ok := safeRelativePath(info["chart"]); ok {
		candidate := filepath.Join(folder, filepath.FromSlash(reference))
		if isRegularFile(candidate) {
			return candidate
		}
	}
	stem := filepath.Base(folder)
	if candidate := findChild(folder, stem+".json"); candidate != "" && isRegularFile(candidate) {
		return candidate
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return ""
	}
	candidates := make([]string, 0, 2)
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		lower := strings.ToLower(entry.Name())
		if strings.HasPrefix(lower, "autosave_") || isServiceChartName(entry.Name()) {
			continue
		}
		candidates = append(candidates, filepath.Join(folder, entry.Name()))
	}
	sort.Strings(candidates)
	if len(candidates) == 1 {
		return candidates[0]
	}
	return ""
}

// countRpeAutosaves counts snapshots without reading their bytes.
func countRpeAutosaves(folder string) int {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, "AutoSave_") && strings.EqualFold(filepath.Ext(name), ".json") {
			count++
		}
	}
	return count
}

// firstNonEmpty returns the first trimmed non-empty value.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// readRpeText reads one bounded sidecar, returning nil when it is absent or
// too large.
func readRpeText(path string) *string {
	if path == "" {
		return nil
	}
	data, err := readBoundedFile(path, maxRpeTextBytes)
	if err != nil {
		return nil
	}
	text := strings.TrimPrefix(string(data), "\uFEFF")
	return &text
}
