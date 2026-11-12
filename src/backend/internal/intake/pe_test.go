// Fixtures for the old PhiEditer installation scan behind the import review.
package intake

import (
	"os"
	"path/filepath"
	"testing"
)

// peFixtureDir returns the checked-in PhiEditer installation this suite reads.
func peFixtureDir(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "test", "fixtures", "pe"))
	if err != nil {
		t.Fatalf("fixture path: %v", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		t.Fatalf("fixture missing: %v", err)
	}
	return root
}

// copyPeFixture copies the installation into a temp directory for tests that
// need a disposable root.
func copyPeFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.CopyFS(root, os.DirFS(peFixtureDir(t))); err != nil {
		t.Fatalf("copy fixture: %v", err)
	}
	return root
}

func TestReadPeFolderReadsSettingsIndexAndMedia(t *testing.T) {
	root := copyPeFixture(t)

	scan, err := ReadPeFolder(root)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if !scan.Installation {
		t.Fatal("installation marker was not reported")
	}
	if scan.SettingsText == nil {
		t.Fatal("Settings.txt was not read")
	}
	if len(scan.Charts) != 3 {
		t.Fatalf("charts = %#v", scan.Charts)
	}
	first := scan.Charts[0]
	if first.Name != "Chart One" || first.Group != "IN Lv.11" {
		t.Fatalf("chart metadata = %#v", first)
	}
	if first.Composer != "Composer One" || first.Charter != "Charter One" {
		t.Fatalf("chart credits = %#v", first)
	}
	if filepath.Base(first.SongPath) != "one.mp3" || filepath.Base(first.PicturePath) != "one.jpg" {
		t.Fatalf("media paths = %q, %q", first.SongPath, first.PicturePath)
	}
	if scan.Charts[1].SongPath == "" || scan.Charts[1].PicturePath == "" {
		t.Fatalf("second chart media = %#v", scan.Charts[1])
	}
	// A PEC that Settings.txt does not index is still offered, with media
	// guessed from its stem.
	loose := scan.Charts[2]
	if loose.Name != "loose" || loose.Group != "PhiEditer" {
		t.Fatalf("loose chart = %#v", loose)
	}
	if filepath.Base(loose.SongPath) != "loose.mp3" || loose.PicturePath != "" {
		t.Fatalf("loose media = %#v", loose)
	}
}

func TestReadPeFolderFindsAWrapperChild(t *testing.T) {
	root := t.TempDir()
	inner := filepath.Join(root, "PhiEditer v0.1.9.2")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatalf("wrapper folder: %v", err)
	}
	if err := os.CopyFS(inner, os.DirFS(peFixtureDir(t))); err != nil {
		t.Fatalf("copy fixture: %v", err)
	}

	scan, err := ReadPeFolder(root)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if scan.Root != inner {
		t.Fatalf("root = %q, want %q", scan.Root, inner)
	}
	if !scan.Installation || len(scan.Charts) != 3 {
		t.Fatalf("scan = %#v", scan)
	}
}

func TestReadPeFolderRejectsNonFolders(t *testing.T) {
	file := writeFile(t, t.TempDir(), "chart.pec", "bp 0.000 120.000")
	if _, err := ReadPeFolder(file); err == nil {
		t.Fatal("a file path must be rejected")
	}
	if _, err := ReadPeFolder(""); err == nil {
		t.Fatal("an empty path must be rejected")
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("fixture missing: %v", err)
	}
}

func TestClassifyPhiEditerRootOpensItsReview(t *testing.T) {
	root := copyPeFixture(t)

	item := Classify(root)
	if item.Kind != KindChart || !item.PEInstallation || item.RPEInstallation {
		t.Fatalf("classification = %#v", item)
	}
	if item.PeDetails == nil || len(item.PeDetails.Charts) != 3 {
		t.Fatalf("details = %#v", item.PeDetails)
	}
}
