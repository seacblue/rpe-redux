// Conservative import memory estimates shared by the native chart scanners.
package intake

import (
	"os"
	"path/filepath"
)

const (
	importMemoryFloor = int64(16 << 20)
	importMemoryScale = int64(2)
	importMemoryCap   = int64(2 << 30)
)

// estimateImportBytes accounts for decoded and staged copies, not just file
// bytes. The cap keeps the JSON value safely representable in JavaScript.
func estimateImportBytes(paths ...string) int64 {
	seen := make(map[string]struct{}, len(paths))
	var raw int64
	for _, path := range paths {
		if path == "" {
			continue
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			absolute = path
		}
		if _, ok := seen[absolute]; ok {
			continue
		}
		seen[absolute] = struct{}{}
		info, err := os.Stat(absolute)
		if err == nil && info.Mode().IsRegular() {
			raw += info.Size()
		}
	}
	estimate := raw*importMemoryScale + importMemoryFloor
	if estimate < importMemoryFloor {
		return importMemoryFloor
	}
	if estimate > importMemoryCap {
		return importMemoryCap
	}
	return estimate
}

// estimateImportFolderBytes sums direct chart-folder files, including media
// kept beside an RPE chart, while ignoring nested service directories.
func estimateImportFolderBytes(folder string) int64 {
	entries, err := os.ReadDir(folder)
	if err != nil {
		return estimateImportBytes()
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		paths = append(paths, filepath.Join(folder, entry.Name()))
	}
	return estimateImportBytes(paths...)
}
