// PhiEditer (PE) installation details for the import review dialog.
//
// An old PhiEditer installation keeps its charts as PEC files at the root, its
// media under Resources, and a Settings.txt that both holds editor preferences
// and indexes every chart with Name/Song/Picture/Chart metadata. This reader
// returns that index and the media paths; conversion and library writes stay in
// the frontend importer.
package intake

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	// maxPeSettingsBytes bounds Settings.txt.
	maxPeSettingsBytes = 2 << 20
	// maxPeCharts bounds one installation scan.
	maxPeCharts = 5000
	// maxPeMediaFiles bounds the Resources lookup for one scan.
	maxPeMediaFiles = 5000
	// maxPeWrapperParents bounds the search for a wrapped installation.
	maxPeWrapperParents = 64
)

// PeChart is one PEC chart inside a PhiEditer root.
type PeChart struct {
	// Path is the absolute PEC file.
	Path string `json:"path"`
	// Folder is the file stem, used when metadata has no display name.
	Folder string `json:"folder"`
	// Name is the song title from Settings.txt, or the file stem.
	Name string `json:"name"`
	// Group is the level/group metadata line, or PhiEditer.
	Group string `json:"group"`
	// Song and Picture are the media file names Settings.txt references.
	Song    string `json:"song,omitempty"`
	Picture string `json:"picture,omitempty"`
	// SongPath and PicturePath are the resolved absolute media paths.
	SongPath    string `json:"songPath,omitempty"`
	PicturePath string `json:"picturePath,omitempty"`
	// Chart is the chart file name for display.
	Chart string `json:"chart,omitempty"`
	// Composer is the composer line from Settings.txt.
	Composer string `json:"composer,omitempty"`
	// Charter is the charter line from Settings.txt.
	Charter string `json:"charter,omitempty"`
	// Autosaves counts AutoSave_*.pec snapshots beside the chart.
	Autosaves int `json:"autosaves"`
}

// PeFolderScan is the bounded content the review dialog presents.
type PeFolderScan struct {
	Root string `json:"root"`
	// Installation is true when the root carries PhiEditer.exe and Resources.
	Installation bool `json:"installation"`
	// SettingsText is the original Settings.txt body. The frontend owns the
	// mapping from PE preference fields to editor settings.
	SettingsText *string   `json:"settingsText"`
	Charts       []PeChart `json:"charts"`
	Warnings     []string  `json:"warnings"`
}

// ReadPeFolder reads one classified PhiEditer root. It rejects non-folder paths
// and otherwise returns a partial result with warnings instead of failing the
// whole review.
func ReadPeFolder(raw string) (PeFolderScan, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(raw) > maxPathLength || strings.ContainsRune(raw, 0) {
		return PeFolderScan{}, errors.New("path is empty or invalid")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return PeFolderScan{}, errors.New("path could not be resolved")
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.IsDir() {
		return PeFolderScan{}, errors.New("path is not a readable folder")
	}
	root := effectivePeRoot(absolute)
	scan := PeFolderScan{
		Root:         root,
		Installation: isPeInstallation(root),
		Charts:       make([]PeChart, 0),
		Warnings:     make([]string, 0),
	}
	scan.SettingsText = readRpeText(findChild(root, "Settings.txt"))

	entries := parsePeSettings(scan.SettingsText)
	resources := findChild(root, "Resources")
	indexed := make(map[string]bool, len(entries))
	for _, entry := range entries {
		chart, warning := peChartFromEntry(root, resources, entry)
		if warning != "" {
			scan.Warnings = append(scan.Warnings, warning)
		}
		if chart == nil {
			continue
		}
		indexed[strings.ToLower(chart.Path)] = true
		scan.Charts = append(scan.Charts, *chart)
		if len(scan.Charts) >= maxPeCharts {
			scan.Warnings = append(scan.Warnings, "PhiEditer exposes more charts than the import can list.")
			break
		}
	}
	// A few old installs keep loose PEC files that Settings.txt does not index.
	for _, chart := range peLooseCharts(root, resources, indexed, maxPeCharts-len(scan.Charts)) {
		scan.Charts = append(scan.Charts, chart)
	}
	if len(scan.Charts) == 0 {
		scan.Warnings = append(scan.Warnings, "PhiEditer has no PEC chart this importer can read.")
	}
	return scan, nil
}

// isPeInstallation requires the native editor and its media folder.
func isPeInstallation(dir string) bool {
	editor := findChild(dir, "PhiEditer.exe")
	if editor == "" || !isRegularFile(editor) {
		return false
	}
	resources := findChild(dir, "Resources")
	return resources != "" && isDirectory(resources)
}

// peInstallationRoot returns the installation root in dir or one wrapped child.
func peInstallationRoot(dir string) string {
	if isPeInstallation(dir) {
		return dir
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	visited := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		visited++
		if visited > maxPeWrapperParents {
			break
		}
		candidate := filepath.Join(dir, entry.Name())
		if isPeInstallation(candidate) {
			return candidate
		}
	}
	return ""
}

// effectivePeRoot unwraps a dropped parent folder around one installation.
func effectivePeRoot(dir string) string {
	if isPeInstallation(dir) {
		return dir
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return dir
	}
	visited := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		visited++
		if visited > maxPeWrapperParents {
			break
		}
		candidate := filepath.Join(dir, entry.Name())
		if isPeInstallation(candidate) {
			return candidate
		}
	}
	return dir
}

// peSettingsEntry is one chart block from Settings.txt, keyed by lower-case field.
type peSettingsEntry map[string]string

// parsePeSettings splits Settings.txt into chart blocks. The leading preference
// block (before the first `#` separator) is ignored here because the frontend
// maps those keys.
func parsePeSettings(text *string) []peSettingsEntry {
	entries := make([]peSettingsEntry, 0)
	if text == nil {
		return entries
	}
	inSettings := true
	var current peSettingsEntry
	for _, raw := range strings.Split(strings.ReplaceAll(*text, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") {
			if current != nil && len(current) > 0 {
				entries = append(entries, current)
			}
			current = make(peSettingsEntry)
			inSettings = false
			continue
		}
		separator := strings.Index(line, ":")
		if separator <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:separator]))
		value := strings.TrimSpace(line[separator+1:])
		if key == "" || inSettings {
			continue
		}
		if current == nil {
			current = make(peSettingsEntry)
		}
		current[key] = value
	}
	if current != nil && len(current) > 0 {
		entries = append(entries, current)
	}
	return entries
}

// peChartFromEntry resolves one Settings.txt block into a chart row.
func peChartFromEntry(root, resources string, entry peSettingsEntry) (*PeChart, string) {
	chartName := strings.TrimSpace(entry["chart"])
	if chartName == "" {
		return nil, ""
	}
	safe, ok := safeRelativePath(strings.ReplaceAll(chartName, "\\", "/"))
	if !ok {
		return nil, "PhiEditer chart path is outside the installation: " + chartName
	}
	chartPath := filepath.Join(root, filepath.FromSlash(safe))
	if !isRegularFile(chartPath) {
		return nil, "PhiEditer chart file is missing: " + chartName
	}
	stem := strings.TrimSuffix(filepath.Base(chartPath), filepath.Ext(chartPath))
	chart := &PeChart{
		Path:     chartPath,
		Folder:   stem,
		Name:     firstNonEmpty(entry["name"], stem),
		Group:    firstNonEmpty(entry["level"], "PhiEditer"),
		Song:     strings.TrimSpace(entry["song"]),
		Picture:  strings.TrimSpace(entry["picture"]),
		Chart:    filepath.Base(chartPath),
		Composer: strings.TrimSpace(entry["composer"]),
		Charter:  strings.TrimSpace(entry["charter"]),
	}
	chart.SongPath = peMediaPath(resources, chart.Song)
	chart.PicturePath = peMediaPath(resources, chart.Picture)
	chart.Autosaves = peAutosaveCount(root, stem)
	return chart, ""
}

// peLooseCharts finds PEC files Settings.txt does not index. Media are guessed
// from the file stem, matching the external importer's fallback behavior.
func peLooseCharts(root, resources string, indexed map[string]bool, limit int) []PeChart {
	if limit <= 0 {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	charts := make([]PeChart, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".pec") {
			continue
		}
		if strings.HasPrefix(strings.ToLower(entry.Name()), "autosave_") {
			continue
		}
		path := filepath.Join(root, entry.Name())
		if indexed[strings.ToLower(path)] {
			continue
		}
		stem := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		chart := PeChart{
			Path:        path,
			Folder:      stem,
			Name:        stem,
			Group:       "PhiEditer",
			Chart:       entry.Name(),
			SongPath:    peMediaPathByStem(resources, stem, true),
			PicturePath: peMediaPathByStem(resources, stem, false),
		}
		if chart.SongPath != "" {
			chart.Song = filepath.Base(chart.SongPath)
		}
		if chart.PicturePath != "" {
			chart.Picture = filepath.Base(chart.PicturePath)
		}
		charts = append(charts, chart)
		if len(charts) >= limit {
			break
		}
	}
	sort.SliceStable(charts, func(left, right int) bool {
		return charts[left].Name < charts[right].Name
	})
	return charts
}

// peMediaPath resolves one Settings.txt media file below Resources.
func peMediaPath(resources, name string) string {
	if resources == "" || name == "" {
		return ""
	}
	base := filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if base == "" || base == "." || base == ".." {
		return ""
	}
	candidate := filepath.Join(resources, base)
	if isRegularFile(candidate) {
		return candidate
	}
	return peMediaPathByStem(resources, strings.TrimSuffix(base, filepath.Ext(base)), false)
}

// peMediaPathByStem finds the first audio/image below Resources whose name
// contains the chart stem, used when Settings.txt has no media reference.
func peMediaPathByStem(resources, stem string, audio bool) string {
	if resources == "" || stem == "" {
		return ""
	}
	entries, err := os.ReadDir(resources)
	if err != nil {
		return ""
	}
	needle := strings.ToLower(stem)
	visited := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		visited++
		if visited > maxPeMediaFiles {
			break
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		matchesKind := isPeAudio(ext)
		if !audio {
			matchesKind = isPeImage(ext)
		}
		if !matchesKind || !strings.Contains(strings.ToLower(name), needle) {
			continue
		}
		return filepath.Join(resources, name)
	}
	return ""
}

// peAutosaveCount counts PE's AutoSave_*.pec files for one chart stem.
func peAutosaveCount(root, stem string) int {
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0
	}
	count := 0
	prefix := "autosave_" + strings.ToLower(stem)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.ToLower(entry.Name())
		if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".pec") {
			count++
		}
	}
	return count
}

// isPeAudio reports the audio extensions the importer attaches as chart assets.
func isPeAudio(extension string) bool {
	switch extension {
	case ".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm":
		return true
	default:
		return false
	}
}

// isPeImage reports the image extensions the importer attaches as chart assets.
func isPeImage(extension string) bool {
	switch extension {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif":
		return true
	default:
		return false
	}
}
