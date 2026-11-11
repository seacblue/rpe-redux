// Package intake classifies the local paths a desktop drop can carry before a
// frontend chooses an importer or package surface. It reads bounded metadata
// and chart headers only; conversion, validation, and installation stay with
// the existing chart, Extension, and note-skin owners.
package intake

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Kinds returned in Item.Kind.
const (
	KindChart     = "chart"
	KindExtension = "extension"
	KindSkin      = "skin"
	KindUnknown   = "unknown"
)

// Chart formats returned in Item.Format. PEC is the PhiEdit interchange text;
// PE packages use the same format.
const (
	FormatRPE      = "rpe"
	FormatOfficial = "official"
	FormatPEC      = "pec"
)

const (
	// maxChartBytes bounds a chart or chart-bearing archive entry.
	maxChartBytes = 64 << 20
	// maxTextBytes bounds PEC text read for detection.
	maxTextBytes = 8 << 20
	// maxManifestBytes matches the Extension discovery limit.
	maxManifestBytes = 64 << 10
	// maxInfoBytes bounds a Phira info.yml read.
	maxInfoBytes = 64 << 10
	// maxArchiveEntries bounds central-directory work for one drop.
	maxArchiveEntries = 4096
	// maxArchiveChartCandidates bounds chart-header reads inside an archive.
	maxArchiveChartCandidates = 16
	// maxWrapperDepth lets a downloaded/extracted folder keep one wrapper.
	maxWrapperDepth = 2
	// maxInstallationSiblings bounds the search for an RPE root inside a parent.
	maxInstallationSiblings = 64
	// maxPathLength bounds a path accepted from the renderer.
	maxPathLength = 4096
)

// pecCommand recognises the command vocabulary that distinguishes a PEC chart
// from arbitrary numeric text.
var pecCommand = regexp.MustCompile(`(?i)^(?:bp|c[pmdraf]\w*|cv|cvelocity|n[1-4])\b`)

// extensionID matches the package-id rule the native Extension roots enforce.
var extensionID = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)

// Item is one dropped path's route decision.
type Item struct {
	// Path is the path exactly as the renderer supplied it.
	Path string `json:"path"`
	// Kind is chart, extension, skin, or unknown.
	Kind string `json:"kind"`
	// Format is rpe, official, or pec for charts.
	Format string `json:"format,omitempty"`
	// Name is a display name from chart metadata, a manifest, or info.yml.
	Name string `json:"name,omitempty"`
	// Entry is the path the route should hand to the winning owner: a chart
	// file for a single chart, otherwise the folder or archive itself.
	Entry string `json:"entry,omitempty"`
	// Candidates lists the chart files when a folder or archive contains more
	// than one supported chart.
	Candidates []string `json:"candidates,omitempty"`
	// PackageID is an Extension manifest id.
	PackageID string `json:"packageId,omitempty"`
	// RPEInstallation marks a folder whose root carries PhiEdit.exe and a
	// Resources folder. The frontend opens its review dialog before importing
	// the settings and chart folders that classification found.
	RPEInstallation bool `json:"rpeInstallation,omitempty"`
	// Details carries the settings and chart rows for a classified RPE root.
	Details *RpeFolderScan `json:"details,omitempty"`
	// Valid is false when the package shell was found but failed its basic
	// shape checks; Kind still names the owner that should explain the error.
	Valid bool `json:"valid"`
	// Reason is an English diagnostic for developers and logs.
	Reason string `json:"reason,omitempty"`
}

// Classify inspects one dropped path and returns its route decision. Missing,
// non-local, and unsupported paths return KindUnknown with a diagnostic instead
// of an error so one bad item cannot fail a multi-path drop.
func Classify(raw string) Item {
	item := Item{Path: raw, Kind: KindUnknown}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || len(raw) > maxPathLength || strings.ContainsRune(raw, 0) {
		item.Reason = "path is empty or invalid"
		return item
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		item.Reason = "path could not be resolved"
		return item
	}
	info, err := os.Stat(absolute)
	if err != nil {
		item.Reason = "path does not exist or cannot be read"
		return item
	}
	if info.IsDir() {
		return classifyDirectory(absolute, absolute, 0)
	}
	if !info.Mode().IsRegular() {
		item.Reason = "path is not a regular file or folder"
		return item
	}
	return classifyFile(absolute)
}

// classifyFile routes one regular file by its extension and content.
func classifyFile(file string) Item {
	switch strings.ToLower(filepath.Ext(file)) {
	case ".zip", ".pez":
		return classifyArchive(file)
	case ".json":
		data, err := readBoundedFile(file, maxChartBytes)
		if err != nil {
			return unknown(file, "chart JSON could not be read")
		}
		format, name, ok := detectJSONChart(data)
		if !ok {
			// A Re:PhiEdit PEC export can use a .json extension.
			format, name, ok = detectPEC(data)
		}
		if !ok {
			return unknown(file, "JSON file is not an RPE, official, or PEC chart")
		}
		return chartItem(file, file, format, name, nil, "chart file")
	case ".pec", ".txt":
		data, err := readBoundedFile(file, maxTextBytes)
		if err != nil {
			return unknown(file, "chart text could not be read")
		}
		format, name, ok := detectPEC(data)
		if !ok {
			return unknown(file, "text file is not a PhiEdit PEC chart")
		}
		return chartItem(file, file, format, name, nil, "PhiEdit PEC chart")
	default:
		return unknown(file, "unsupported file extension")
	}
}

// classifyDirectory routes one folder. The order matters: a package manifest
// identifies an Extension even when it carries JSON data, and a valid chart
// identifies a chart folder even when an info.yml provides its metadata.
func classifyDirectory(original, dir string, depth int) Item {
	if root := rpeInstallationRoot(dir); root != "" {
		item := chartItem(original, root, FormatRPE, "", nil, "RPE installation")
		item.RPEInstallation = true
		return withRpeDetails(item, root)
	}
	if manifest := findChild(dir, "manifest.json"); manifest != "" {
		return classifyExtension(original, manifest, dir)
	}
	if hasChartRoot(dir) {
		return withRpeDetails(chartItem(original, dir, FormatRPE, "", nil, "RPE chart root"), dir)
	}
	chart, format, name, candidates := findChartInDirectory(dir)
	if chart != "" {
		if len(candidates) > 1 {
			return chartItem(original, dir, format, name, candidates, "multiple charts")
		}
		return chartItem(original, chart, format, name, nil, formatReason(format)+" chart folder")
	}
	if info := findChild(dir, "info.yml"); info != "" {
		data, err := readBoundedFile(info, maxInfoBytes)
		if err != nil {
			return Item{
				Path: original, Kind: KindSkin, Entry: dir, Valid: false,
				Reason: "info.yml could not be read",
			}
		}
		name, ok := skinName(data)
		reason := "Phira note-skin package"
		if !ok {
			reason = "info.yml has no package name"
		}
		return Item{
			Path: original, Kind: KindSkin, Entry: dir, Name: name, Valid: ok, Reason: reason,
		}
	}
	if depth < maxWrapperDepth {
		if child := singleSubdirectory(dir); child != "" {
			return classifyDirectory(original, child, depth+1)
		}
	}
	return unknown(original, "folder does not contain a chart, Extension manifest, or Phira info.yml")
}

// classifyExtension validates the package shell without installing it.
func classifyExtension(original, manifestPath, root string) Item {
	item := Item{
		Path: original, Kind: KindExtension, Entry: root, Valid: false,
		Reason: "Extension manifest could not be read",
	}
	data, err := readBoundedFile(manifestPath, maxManifestBytes)
	if err != nil {
		return item
	}
	var manifest struct {
		ID    string          `json:"id"`
		Name  json.RawMessage `json:"name"`
		Entry string          `json:"entry"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		item.Reason = "Extension manifest is not a JSON object"
		return item
	}
	if !extensionID.MatchString(manifest.ID) {
		item.Reason = "Extension manifest id is missing or invalid"
		return item
	}
	item.PackageID = manifest.ID
	item.Name = packageName(manifest.Name)
	item.Valid = true
	item.Reason = "Extension package"
	if manifest.Entry != "" {
		entry, ok := safeRelativePath(manifest.Entry)
		if !ok || !isRegularFile(filepath.Join(root, filepath.FromSlash(entry))) {
			item.Valid = false
			item.Reason = "Extension entry is missing or unsafe"
		}
	}
	return item
}

// classifyArchive inspects a ZIP or PEZ central directory without extracting it.
func classifyArchive(file string) Item {
	reader, err := zip.OpenReader(file)
	if err != nil {
		return unknown(file, "archive could not be opened")
	}
	defer reader.Close()

	entries := make(map[string]*zip.File, len(reader.File))
	names := make([]string, 0, len(reader.File))
	for index, entry := range reader.File {
		if index >= maxArchiveEntries {
			break
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		name := normalizeArchiveName(entry.Name)
		if name == "" {
			continue
		}
		entries[name] = entry
		names = append(names, name)
	}

	if manifest := shallowest(names, "manifest.json", 1); manifest != "" {
		return classifyExtensionArchive(file, manifest, entries[manifest], entries)
	}

	var candidates []string
	for _, name := range names {
		if strings.Count(name, "/") > 2 || !isChartArchiveEntry(name) {
			continue
		}
		candidates = append(candidates, name)
	}
	sort.Strings(candidates)
	if len(candidates) > maxArchiveChartCandidates {
		candidates = candidates[:maxArchiveChartCandidates]
	}
	var (
		chartName string
		format    string
		name      string
		valid     []string
	)
	for _, candidate := range candidates {
		entry := entries[candidate]
		if entry.UncompressedSize64 > maxChartBytes {
			continue
		}
		data, err := readZipEntry(entry, maxChartBytes)
		if err != nil {
			continue
		}
		var ok bool
		switch strings.ToLower(path.Ext(candidate)) {
		case ".json":
			format, name, ok = detectJSONChart(data)
			if !ok {
				// A Re:PhiEdit PEC export can use a .json extension.
				format, name, ok = detectPEC(data)
			}
		case ".pec", ".txt":
			format, name, ok = detectPEC(data)
		}
		if !ok {
			continue
		}
		valid = append(valid, candidate)
		if chartName == "" {
			chartName = candidate
			if name == "" {
				name = archiveChartStem(candidate)
			}
		}
	}

	if chartName == "" {
		if info := shallowest(names, "info.yml", 1); info != "" {
			data, err := readZipEntry(entries[info], maxInfoBytes)
			if err != nil {
				return Item{
					Path: file, Kind: KindSkin, Entry: file, Valid: false,
					Reason: "info.yml could not be read",
				}
			}
			skin, ok := skinName(data)
			reason := "Phira note-skin package"
			if !ok {
				reason = "info.yml has no package name"
			}
			return Item{
				Path: file, Kind: KindSkin, Entry: file, Name: skin, Valid: ok, Reason: reason,
			}
		}
		return unknown(file, "archive does not contain a supported chart, Extension manifest, or Phira info.yml")
	}
	return chartItem(file, file, format, name, valid, "chart archive")
}

// classifyExtensionArchive validates a manifest kept inside an archive.
func classifyExtensionArchive(file, manifestName string, manifest *zip.File, entries map[string]*zip.File) Item {
	item := Item{
		Path: file, Kind: KindExtension, Entry: file, Valid: false,
		Reason: "Extension manifest could not be read",
	}
	data, err := readZipEntry(manifest, maxManifestBytes)
	if err != nil {
		return item
	}
	var parsed struct {
		ID    string          `json:"id"`
		Name  json.RawMessage `json:"name"`
		Entry string          `json:"entry"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		item.Reason = "Extension manifest is not a JSON object"
		return item
	}
	if !extensionID.MatchString(parsed.ID) {
		item.Reason = "Extension manifest id is missing or invalid"
		return item
	}
	item.PackageID = parsed.ID
	item.Name = packageName(parsed.Name)
	item.Valid = true
	item.Reason = "Extension package archive (" + manifestName + ")"
	if parsed.Entry != "" {
		entry, ok := safeRelativePath(parsed.Entry)
		prefix := strings.TrimSuffix(manifestName, "manifest.json")
		if !ok || entries[prefix+entry] == nil {
			item.Valid = false
			item.Reason = "Extension entry is missing or unsafe"
		}
	}
	return item
}

// rpeInstallationRoot returns the folder that carries PhiEdit.exe plus a
// Resources folder. A wrapper named `rpe` is accepted so dropping the parent
// game folder routes to the same installation.
func rpeInstallationRoot(dir string) string {
	if isRpeInstallation(dir) {
		return dir
	}
	if preferred := findChild(dir, "rpe"); preferred != "" && isRpeInstallation(preferred) {
		return preferred
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
		if visited > maxInstallationSiblings {
			break
		}
		candidate := filepath.Join(dir, entry.Name())
		if isRpeInstallation(candidate) {
			return candidate
		}
	}
	return ""
}

// withRpeDetails attaches the parsed rows a review dialog needs. A failed read
// keeps the classification itself valid, so the owner can still explain why the
// folder could not be inspected.
func withRpeDetails(item Item, root string) Item {
	if scan, err := ReadRpeFolder(root); err == nil {
		item.Details = &scan
		item.RPEInstallation = scan.Installation
	}
	return item
}

// isRpeInstallation requires both native markers: a regular PhiEdit.exe file
// and a Resources directory. Either one alone is not enough.
func isRpeInstallation(dir string) bool {
	executable := findChild(dir, "PhiEdit.exe")
	resources := findChild(dir, "Resources")
	return executable != "" && isRegularFile(executable) &&
		resources != "" && isDirectory(resources)
}

// hasChartRoot reports whether dir carries an RPE Resources or Charts child
// with at least one chart folder.
func hasChartRoot(dir string) bool {
	for _, name := range []string{"Resources", "Charts"} {
		root := findChild(dir, name)
		if root == "" || !isDirectory(root) {
			continue
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		visited := 0
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			visited++
			if visited > 5000 {
				break
			}
			if chart, _, _, _ := findChartInDirectory(filepath.Join(root, entry.Name())); chart != "" {
				return true
			}
		}
	}
	return false
}

// findChartInDirectory returns one parsed chart and every supported candidate.
func findChartInDirectory(dir string) (string, string, string, []string) {
	if reference := sidecarChartReference(dir); reference != "" {
		candidate := filepath.Join(dir, filepath.FromSlash(reference))
		if isRegularFile(candidate) {
			if format, name, ok := detectChartFile(candidate); ok {
				if name == "" {
					name = sidecarName(dir)
				}
				return candidate, format, name, nil
			}
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", "", nil
	}
	var paths []string
	for _, entry := range entries {
		if entry.IsDir() || !isChartText(entry.Name()) || isServiceChartName(entry.Name()) {
			continue
		}
		paths = append(paths, filepath.Join(dir, entry.Name()))
	}
	sort.Strings(paths)
	var chart, format, name string
	var candidates []string
	for _, candidate := range paths {
		detected, detectedName, ok := detectChartFile(candidate)
		if !ok {
			continue
		}
		candidates = append(candidates, candidate)
		if chart == "" {
			chart, format, name = candidate, detected, detectedName
		}
	}
	if chart != "" && name == "" {
		name = sidecarName(dir)
	}
	return chart, format, name, candidates
}

// sidecarChartReference resolves the chart file an info sidecar names.
func sidecarChartReference(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if entry.IsDir() || !isSidecar(entry.Name()) {
			continue
		}
		data, err := readBoundedFile(filepath.Join(dir, entry.Name()), maxInfoBytes)
		if err != nil {
			continue
		}
		if reference := parseChartReference(entry.Name(), data); reference != "" {
			return reference
		}
	}
	return ""
}

// sidecarName reads a display name from an info sidecar.
func sidecarName(dir string) string {
	for _, name := range []string{"info.txt", "info.yml", "info.yaml", "info.csv"} {
		file := findChild(dir, name)
		if file == "" {
			continue
		}
		data, err := readBoundedFile(file, maxInfoBytes)
		if err != nil {
			continue
		}
		if value := parseName(name, data); value != "" {
			return value
		}
	}
	return ""
}

// parseChartReference reads Chart from info.txt, info.yml, or info.csv.
func parseChartReference(name string, data []byte) string {
	text := strings.TrimPrefix(string(data), "\uFEFF")
	if strings.EqualFold(filepath.Ext(name), ".csv") {
		lines := nonEmptyLines(text)
		if len(lines) < 2 {
			return ""
		}
		headers := strings.Split(lines[0], ",")
		values := strings.Split(lines[len(lines)-1], ",")
		for index, header := range headers {
			if strings.EqualFold(strings.TrimSpace(header), "chart") && index < len(values) {
				if value, ok := safeRelativePath(values[index]); ok {
					return value
				}
			}
		}
		return ""
	}
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(key), "chart") {
			continue
		}
		if cleaned, ok := safeRelativePath(value); ok {
			return cleaned
		}
	}
	return ""
}

// parseName reads a display name from one metadata sidecar.
func parseName(name string, data []byte) string {
	text := strings.TrimPrefix(string(data), "\uFEFF")
	if strings.EqualFold(filepath.Ext(name), ".csv") {
		lines := nonEmptyLines(text)
		if len(lines) < 2 {
			return ""
		}
		headers := strings.Split(lines[0], ",")
		values := strings.Split(lines[len(lines)-1], ",")
		for index, header := range headers {
			if strings.EqualFold(strings.TrimSpace(header), "name") && index < len(values) {
				return cleanValue(values[index])
			}
		}
		return ""
	}
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(key), "name") {
			continue
		}
		if cleaned := cleanValue(value); cleaned != "" {
			return cleaned
		}
	}
	return ""
}

// skinName reads the display name from a Phira info.yml.
func skinName(data []byte) (string, bool) {
	text := strings.TrimPrefix(string(data), "\uFEFF")
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(key), "name") {
			continue
		}
		if cleaned := cleanValue(value); cleaned != "" {
			return cleaned, true
		}
	}
	return "", false
}

// packageName reads an Extension manifest name in either plain-string or
// localized-object form.
func packageName(raw json.RawMessage) string {
	var text string
	if len(raw) > 0 && json.Unmarshal(raw, &text) == nil {
		return strings.TrimSpace(text)
	}
	var values map[string]string
	if len(raw) > 0 && json.Unmarshal(raw, &values) == nil {
		for _, key := range []string{"en", "zh", "zh-CN", "zh-TW"} {
			if value := strings.TrimSpace(values[key]); value != "" {
				return value
			}
		}
	}
	return ""
}

// detectChartFile reads one chart candidate and returns its format and name.
func detectChartFile(file string) (string, string, bool) {
	switch strings.ToLower(filepath.Ext(file)) {
	case ".json":
		data, err := readBoundedFile(file, maxChartBytes)
		if err != nil {
			return "", "", false
		}
		if format, name, ok := detectJSONChart(data); ok {
			return format, name, true
		}
		// A Re:PhiEdit PEC export can use a .json extension.
		return detectPEC(data)
	case ".pec", ".txt":
		data, err := readBoundedFile(file, maxTextBytes)
		if err != nil {
			return "", "", false
		}
		return detectPEC(data)
	default:
		return "", "", false
	}
}

// detectJSONChart mirrors the two root shapes the frontend already accepts.
func detectJSONChart(data []byte) (string, string, bool) {
	var root map[string]json.RawMessage
	if json.Unmarshal(data, &root) != nil {
		return "", "", false
	}
	meta, hasMeta := root["META"]
	bpm, hasBPM := root["BPMList"]
	if hasMeta && isJSONObject(meta) && hasBPM && isJSONArray(bpm) {
		var header map[string]any
		name := ""
		if json.Unmarshal(meta, &header) == nil {
			name, _ = header["name"].(string)
		}
		return FormatRPE, strings.TrimSpace(name), true
	}
	lines, hasLines := root["judgeLineList"]
	version, hasVersion := root["formatVersion"]
	if hasLines && isJSONArray(lines) && hasVersion && isJSONScalar(version) {
		if !hasMeta || !isJSONObject(meta) {
			return FormatOfficial, "", true
		}
	}
	return "", "", false
}

// detectPEC reports whether the text starts with a numeric time and carries a
// PhiEdit command line.
func detectPEC(data []byte) (string, string, bool) {
	text := strings.TrimPrefix(string(data), "\uFEFF")
	foundNumber := false
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "//") || strings.HasPrefix(line, "#") {
			continue
		}
		if !foundNumber {
			if _, err := strconv.ParseFloat(line, 64); err != nil {
				return "", "", false
			}
			foundNumber = true
			continue
		}
		if pecCommand.MatchString(line) {
			return FormatPEC, "", true
		}
	}
	return "", "", false
}

// chartItem builds a chart result and falls back to the entry stem for a name.
func chartItem(original, entry, format, name string, candidates []string, reason string) Item {
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(entry), filepath.Ext(entry))
	}
	return Item{
		Path:       original,
		Kind:       KindChart,
		Format:     format,
		Name:       name,
		Entry:      entry,
		Candidates: candidates,
		Valid:      true,
		Reason:     reason,
	}
}

// unknown builds the unsupported result.
func unknown(original, reason string) Item {
	return Item{Path: original, Kind: KindUnknown, Valid: false, Reason: reason}
}

// formatReason names a chart format for the diagnostic reason.
func formatReason(format string) string {
	switch format {
	case FormatRPE:
		return "RPE"
	case FormatOfficial:
		return "Phigros official"
	case FormatPEC:
		return "PhiEdit PEC"
	default:
		return "chart"
	}
}

// readBoundedFile reads at most limit bytes and rejects larger files upfront.
func readBoundedFile(file string, limit int64) ([]byte, error) {
	info, err := os.Stat(file)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("file is not a regular file or exceeds the limit")
	}
	handle, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	data, err := io.ReadAll(io.LimitReader(handle, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("file exceeds the limit")
	}
	return data, nil
}

// readZipEntry reads one bounded archive entry.
func readZipEntry(file *zip.File, limit int64) ([]byte, error) {
	if file.UncompressedSize64 > uint64(limit) {
		return nil, errors.New("archive entry exceeds the limit")
	}
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("archive entry exceeds the limit")
	}
	return data, nil
}

// normalizeArchiveName converts ZIP separators, removes one leading ./ and
// rejects traversal.
func normalizeArchiveName(name string) string {
	cleaned := path.Clean(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") ||
		strings.HasPrefix(cleaned, "/") || strings.ContainsRune(cleaned, 0) {
		return ""
	}
	return cleaned
}

// shallowest returns the shortest-depth matching entry at or above maxDepth.
func shallowest(names []string, base string, maxDepth int) string {
	best := ""
	for _, name := range names {
		if !strings.EqualFold(path.Base(name), base) || strings.Count(name, "/") > maxDepth {
			continue
		}
		if best == "" || strings.Count(name, "/") < strings.Count(best, "/") ||
			(strings.Count(name, "/") == strings.Count(best, "/") && name < best) {
			best = name
		}
	}
	return best
}

// archiveChartStem is the display fallback for a chart inside an archive.
func archiveChartStem(name string) string {
	base := path.Base(name)
	return strings.TrimSuffix(base, path.Ext(base))
}

// isChartText matches the chart text extensions the external scanner accepts.
func isChartText(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".json", ".pec", ".txt":
		return true
	default:
		return false
	}
}

// isChartArchiveEntry excludes package metadata and service files.
func isChartArchiveEntry(name string) bool {
	base := path.Base(name)
	if !isChartText(base) || isServiceChartName(base) {
		return false
	}
	return !strings.EqualFold(base, "manifest.json")
}

// isSidecar matches the metadata sidecars the external importer merges.
func isSidecar(name string) bool {
	switch strings.ToLower(name) {
	case "info.yml", "info.yaml", "info.txt", "info.csv":
		return true
	default:
		return false
	}
}

// isServiceChartName excludes files that are never a chart candidate.
func isServiceChartName(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, "autosave_") ||
		strings.HasPrefix(lower, "chartlist") ||
		strings.HasPrefix(lower, "info.") ||
		strings.HasPrefix(lower, "readme") ||
		strings.HasPrefix(lower, "license") ||
		strings.HasPrefix(lower, "changelog") ||
		strings.HasPrefix(lower, "credits") ||
		lower == "extra.json" ||
		lower == "settings.json" ||
		lower == "config.json" ||
		lower == "expression.json" ||
		lower == "custom_background.json" ||
		lower == "manifest.json"
}

// safeRelativePath accepts a package-relative POSIX path.
func safeRelativePath(value string) (string, bool) {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if value == "" || len(value) > 512 || strings.ContainsRune(value, 0) {
		return "", false
	}
	value = strings.ReplaceAll(value, "\\", "/")
	if strings.HasPrefix(value, "/") || strings.Contains(value, ":") {
		return "", false
	}
	cleaned := path.Clean(value)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}
	for _, segment := range strings.Split(cleaned, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", false
		}
	}
	return cleaned, true
}

// cleanValue trims whitespace and one pair of wrapping quotes.
func cleanValue(value string) string {
	cleaned := strings.TrimSpace(value)
	cleaned = strings.Trim(cleaned, "\"'")
	return strings.TrimSpace(cleaned)
}

// nonEmptyLines returns the trimmed non-empty lines of a sidecar.
func nonEmptyLines(text string) []string {
	lines := make([]string, 0, 16)
	for _, line := range strings.Split(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	return lines
}

// findChild resolves one case-insensitive direct child path.
func findChild(dir, name string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), name) {
			return filepath.Join(dir, entry.Name())
		}
	}
	return ""
}

// singleSubdirectory returns the only directory directly under dir.
func singleSubdirectory(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	found := ""
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if found != "" {
			return ""
		}
		found = filepath.Join(dir, entry.Name())
	}
	return found
}

// isDirectory reports whether file is a directory.
func isDirectory(file string) bool {
	info, err := os.Stat(file)
	return err == nil && info.IsDir()
}

// isRegularFile reports whether file is a regular file.
func isRegularFile(file string) bool {
	info, err := os.Stat(file)
	return err == nil && info.Mode().IsRegular()
}

// isJSONObject reports whether raw starts an object.
func isJSONObject(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return strings.HasPrefix(trimmed, "{")
}

// isJSONArray reports whether raw starts an array.
func isJSONArray(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return strings.HasPrefix(trimmed, "[")
}

// isJSONScalar reports whether raw is a JSON string or number.
func isJSONScalar(raw json.RawMessage) bool {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	switch value.(type) {
	case string, float64:
		return true
	default:
		return false
	}
}
