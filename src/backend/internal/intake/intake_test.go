// Classification fixtures for the drop intake contract.
package intake

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

// writeFile creates one fixture file below root and returns its path.
func writeFile(t *testing.T, root, name, contents string) string {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("create fixture folder: %v", err)
	}
	if err := os.WriteFile(file, []byte(contents), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return file
}

// writeArchive creates a ZIP fixture from entry name to text.
func writeArchive(t *testing.T, file string, entries map[string]string) string {
	t.Helper()
	handle, err := os.Create(file)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}
	writer := zip.NewWriter(handle)
	for name, contents := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create archive entry: %v", err)
		}
		if _, err := entry.Write([]byte(contents)); err != nil {
			t.Fatalf("write archive entry: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive writer: %v", err)
	}
	if err := handle.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	return file
}

func TestClassifyChartFiles(t *testing.T) {
	root := t.TempDir()
	cases := []struct {
		name   string
		body   string
		format string
	}{
		{"rpe.json", `{"META":{"name":"RPE Song"},"BPMList":[]}`, FormatRPE},
		{"official.json", `{"formatVersion":3,"judgeLineList":[]}`, FormatOfficial},
		{"pec.pec", "0\nbp 0 1 0\n", FormatPEC},
		{"pec.json", "0\nbp 0 1 0\n", FormatPEC},
	}
	for _, test := range cases {
		file := writeFile(t, root, test.name, test.body)
		item := Classify(file)
		if item.Kind != KindChart || item.Format != test.format || item.Entry != file {
			t.Fatalf("%s = %#v", test.name, item)
		}
	}
	unknown := Classify(writeFile(t, root, "other.json", `{"hello":"world"}`))
	if unknown.Kind != KindUnknown || unknown.Valid {
		t.Fatalf("generic JSON = %#v", unknown)
	}
}

func TestClassifyChartFolders(t *testing.T) {
	root := t.TempDir()
	rpe := filepath.Join(root, "rpe-folder")
	writeFile(t, rpe, "info.txt", "Name: Folder Song\r\nChart: chart.json\r\n")
	writeFile(t, rpe, "chart.json", `{"META":{"name":"Folder Song"},"BPMList":[]}`)
	item := Classify(rpe)
	if item.Kind != KindChart || item.Format != FormatRPE || item.Entry != filepath.Join(rpe, "chart.json") {
		t.Fatalf("RPE folder = %#v", item)
	}

	official := filepath.Join(root, "official-folder")
	writeFile(t, official, "info.csv", "Chart,Name,Music\nChart_IN.json,Official Song,music.ogg\n")
	writeFile(t, official, "Chart_IN.json", `{"formatVersion":3,"judgeLineList":[]}`)
	item = Classify(official)
	if item.Kind != KindChart || item.Format != FormatOfficial || item.Name != "Official Song" {
		t.Fatalf("official folder = %#v", item)
	}

	wrapped := filepath.Join(root, "wrapped", "single")
	writeFile(t, wrapped, "chart.pec", "0\nbp 0 1 0\n")
	item = Classify(filepath.Join(root, "wrapped"))
	if item.Kind != KindChart || item.Format != FormatPEC {
		t.Fatalf("wrapped folder = %#v", item)
	}

	multiple := filepath.Join(root, "multiple")
	writeFile(t, multiple, "one.json", `{"META":{"name":"One"},"BPMList":[]}`)
	writeFile(t, multiple, "two.json", `{"META":{"name":"Two"},"BPMList":[]}`)
	item = Classify(multiple)
	if item.Kind != KindChart || item.Format != FormatRPE || item.Entry != multiple || len(item.Candidates) != 2 {
		t.Fatalf("multiple charts = %#v", item)
	}
}

func TestClassifyRpeRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Resources/123/chart.json", `{"META":{"name":"Root Song"},"BPMList":[]}`)
	item := Classify(root)
	if item.Kind != KindChart || item.Format != FormatRPE || item.Entry != root || item.RPEInstallation {
		t.Fatalf("RPE chart root = %#v", item)
	}

	installation := filepath.Join(root, "installation")
	writeFile(t, installation, "PhiEdit.exe", "exe")
	writeFile(t, installation, "Settings.json", `{"FpsLimit":120}`)
	writeFile(t, installation, "Resources/456/info.txt", "Name: Install Song\r\nChart: chart.json\r\nComposer: Install Composer\r\nCharter: Install Charter\r\n")
	writeFile(t, installation, "Resources/456/chart.json", `{"META":{"name":"Install Song"},"BPMList":[]}`)
	item = Classify(installation)
	if item.Kind != KindChart || item.Format != FormatRPE || item.Entry != installation || !item.RPEInstallation {
		t.Fatalf("RPE installation = %#v", item)
	}
	if item.Details == nil || !item.Details.Installation || item.Details.SettingsText == nil {
		t.Fatalf("RPE installation details = %#v", item.Details)
	}
	if len(item.Details.Charts) != 1 || item.Details.Charts[0].Composer != "Install Composer" {
		t.Fatalf("RPE chart details = %#v", item.Details.Charts)
	}

	// Resources alone is a chart root, not a native installation.
	resourcesOnly := filepath.Join(root, "resources-only")
	writeFile(t, resourcesOnly, "Resources/789/chart.json", `{"META":{"name":"Chart Only"},"BPMList":[]}`)
	if item = Classify(resourcesOnly); item.RPEInstallation {
		t.Fatalf("Resources without PhiEdit.exe = %#v", item)
	}

	wrapped := filepath.Join(root, "game")
	writeFile(t, wrapped, "rpe/PhiEdit.exe", "exe")
	writeFile(t, wrapped, "rpe/Resources/1/chart.json", `{"META":{"name":"Wrapped"},"BPMList":[]}`)
	item = Classify(wrapped)
	if item.Entry != filepath.Join(wrapped, "rpe") || !item.RPEInstallation {
		t.Fatalf("wrapped installation = %#v", item)
	}
}

func TestClassifyPackages(t *testing.T) {
	root := t.TempDir()
	extension := filepath.Join(root, "extension")
	writeFile(t, extension, "manifest.json", `{"id":"demo.package","name":{"en":"Demo"},"entry":"index.js"}`)
	writeFile(t, extension, "index.js", "export default {};")
	item := Classify(extension)
	if item.Kind != KindExtension || !item.Valid || item.PackageID != "demo.package" || item.Name != "Demo" {
		t.Fatalf("Extension = %#v", item)
	}

	broken := filepath.Join(root, "broken")
	writeFile(t, broken, "manifest.json", `{"id":"demo.package","entry":"missing.js"}`)
	item = Classify(broken)
	if item.Kind != KindExtension || item.Valid {
		t.Fatalf("broken Extension = %#v", item)
	}

	skin := filepath.Join(root, "skin")
	writeFile(t, skin, "info.yml", "name: \"Test Skin\"\nauthor: Someone\n")
	writeFile(t, skin, "click.png", "png")
	item = Classify(skin)
	if item.Kind != KindSkin || !item.Valid || item.Name != "Test Skin" || item.Entry != skin {
		t.Fatalf("skin = %#v", item)
	}
}

func TestClassifyArchives(t *testing.T) {
	root := t.TempDir()
	extension := writeArchive(t, filepath.Join(root, "extension.zip"), map[string]string{
		"manifest.json": `{"id":"demo.archive","name":"Archived","entry":"index.js"}`,
		"index.js":      "export default {};",
	})
	item := Classify(extension)
	if item.Kind != KindExtension || !item.Valid || item.PackageID != "demo.archive" {
		t.Fatalf("Extension archive = %#v", item)
	}
	broken := writeArchive(t, filepath.Join(root, "broken-extension.zip"), map[string]string{
		"manifest.json": `{"id":"demo.broken","entry":"missing.js"}`,
	})
	if item = Classify(broken); item.Kind != KindExtension || item.Valid {
		t.Fatalf("broken Extension archive = %#v", item)
	}

	skin := writeArchive(t, filepath.Join(root, "skin.zip"), map[string]string{
		"Skin/info.yml":  "name: Packed Skin\n",
		"Skin/click.png": "png",
	})
	item = Classify(skin)
	if item.Kind != KindSkin || !item.Valid || item.Name != "Packed Skin" {
		t.Fatalf("skin archive = %#v", item)
	}

	official := writeArchive(t, filepath.Join(root, "official.zip"), map[string]string{
		"info.csv":   "Chart,Name\nchart.json,Archive Song\n",
		"chart.json": `{"formatVersion":3,"judgeLineList":[]}`,
	})
	item = Classify(official)
	if item.Kind != KindChart || item.Format != FormatOfficial || item.Entry != official {
		t.Fatalf("official archive = %#v", item)
	}

	pez := writeArchive(t, filepath.Join(root, "chart.pez"), map[string]string{
		"chart.json": `{"META":{"name":"PEZ Song"},"BPMList":[]}`,
	})
	item = Classify(pez)
	if item.Kind != KindChart || item.Format != FormatRPE || item.Name != "PEZ Song" {
		t.Fatalf("PEZ archive = %#v", item)
	}
}

func TestClassifyRejectsMissingAndUnknownPaths(t *testing.T) {
	if item := Classify(""); item.Kind != KindUnknown || item.Valid {
		t.Fatalf("empty path = %#v", item)
	}
	if item := Classify(filepath.Join(t.TempDir(), "missing")); item.Kind != KindUnknown || item.Valid {
		t.Fatalf("missing path = %#v", item)
	}
	root := t.TempDir()
	writeFile(t, root, "readme.txt", "not a chart\n")
	if item := Classify(root); item.Kind != KindUnknown {
		t.Fatalf("unknown folder = %#v", item)
	}
}
