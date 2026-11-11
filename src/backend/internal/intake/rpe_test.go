// Fixtures for the bounded RPE installation scan behind the review dialog.
package intake

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadRpeFolderReadsSettingsAndChartMetadata(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "PhiEdit.exe", "exe")
	writeFile(t, root, "Settings.json", `{"FpsLimit":120,"Language":"zh.txt"}`)
	writeFile(t, root, "Hotkey.txt", "AddTap A\n")
	writeFile(t, root, "UI.txt", "GridColor1=#FF0000\n")
	writeFile(t, root, "Resources/12345/info.txt",
		"#\r\nName: Test Song\r\nChart: 12345.json\r\nGroup: WIP\r\nSong: song.mp3\r\nComposer: Composer Name\r\nCharter: Charter Name\r\n")
	writeFile(t, root, "Resources/12345/12345.json", `{"META":{"name":"Test Song"},"BPMList":[]}`)
	writeFile(t, root, "Resources/12345/AutoSave_1.json", "{}")
	writeFile(t, root, "Resources/12345/AutoSave_2.json", "{}")
	writeFile(t, root, "Resources/Texture/line.png", "png")

	scan, err := ReadRpeFolder(root)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if !scan.Installation {
		t.Fatal("installation marker was not reported")
	}
	if scan.SettingsText == nil || *scan.SettingsText != `{"FpsLimit":120,"Language":"zh.txt"}` {
		t.Fatalf("settings = %#v", scan.SettingsText)
	}
	if scan.HotkeysText == nil || *scan.HotkeysText != "AddTap A\n" {
		t.Fatalf("hotkeys = %#v", scan.HotkeysText)
	}
	if len(scan.Charts) != 1 {
		t.Fatalf("charts = %#v", scan.Charts)
	}
	chart := scan.Charts[0]
	if chart.Name != "Test Song" || chart.Composer != "Composer Name" || chart.Charter != "Charter Name" {
		t.Fatalf("chart metadata = %#v", chart)
	}
	if chart.Group != "WIP" || chart.Song != "song.mp3" || chart.Autosaves != 2 {
		t.Fatalf("chart fields = %#v", chart)
	}
	if chart.Path != filepath.Join(root, "Resources", "12345", "12345.json") {
		t.Fatalf("chart path = %q", chart.Path)
	}
}

func TestReadRpeFolderFallsBackToTheFolderStem(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "Resources/777/777.json", "{}")
	writeFile(t, root, "Resources/Texture/line.png", "png")

	scan, err := ReadRpeFolder(root)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if scan.Installation {
		t.Fatal("a chart root without PhiEdit.exe is not an installation")
	}
	if len(scan.Charts) != 1 {
		t.Fatalf("charts = %#v", scan.Charts)
	}
	if scan.Charts[0].Name != "777" || scan.Charts[0].Group != "RPE" {
		t.Fatalf("chart = %#v", scan.Charts[0])
	}
	if scan.SettingsText != nil || scan.HotkeysText != nil {
		t.Fatalf("missing sidecars should stay nil: %#v", scan)
	}
}

func TestReadRpeFolderRejectsNonFolders(t *testing.T) {
	file := writeFile(t, t.TempDir(), "chart.json", "{}")
	if _, err := ReadRpeFolder(file); err == nil {
		t.Fatal("a file path must be rejected")
	}
	if _, err := ReadRpeFolder(""); err == nil {
		t.Fatal("an empty path must be rejected")
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("fixture missing: %v", err)
	}
}
