// Verifies that a streamed commit stages beside the library instead of relying
// on the system temp directory, which a packaged account may not be able to
// write to.
package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestCommitStagingRootSitsBesideTheLibrary covers the directory the API picks.
func TestCommitStagingRootSitsBesideTheLibrary(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "user-data", "redux.db")
	want := filepath.Join(dir, "user-data", "commit-staging")
	if got := commitStagingRoot(db); got != want {
		t.Fatalf("commitStagingRoot = %q, want %q", got, want)
	}
	if got := commitStagingRoot(""); got != "" {
		t.Fatalf("commitStagingRoot of an unknown path = %q, want empty", got)
	}
}

// TestBeginStagesUnderTheLibraryDirectory covers a manager whose preferred
// staging root exists, so an upload never touches the system temp directory.
func TestBeginStagesUnderTheLibraryDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), stagingDirName)
	manager := newCommitSessionManager()
	manager.setStagingRoot(root)
	session, err := manager.begin("project-1", beginCommitRequest{})
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer manager.forget(session)
	if filepath.Dir(session.dir) != root {
		t.Fatalf("session staged in %q, want a child of %q", session.dir, root)
	}
	if info, err := os.Stat(session.path); err != nil || info.Size() != 0 {
		t.Fatalf("session file unavailable: %v", err)
	}
}

// TestBeginFallsBackWhenTheStagingRootIsUnusable covers a preferred root that
// cannot be created, so the system temp directory still serves the upload.
func TestBeginFallsBackWhenTheStagingRootIsUnusable(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newCommitSessionManager()
	manager.setStagingRoot(filepath.Join(blocker, "nested"))
	session, err := manager.begin("project-2", beginCommitRequest{})
	if err != nil {
		t.Fatalf("begin did not fall back: %v", err)
	}
	defer manager.forget(session)
	if session.path == "" {
		t.Fatal("session has no staging file")
	}
}

// TestBeginReportsTheRejectedDirectory covers the diagnostic a bare 500 hid.
func TestBeginReportsTheRejectedDirectory(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := newCommitSessionManager()
	manager.setStagingRoot(filepath.Join(blocker, "nested"))
	t.Setenv("TMPDIR", filepath.Join(blocker, "also-unusable"))
	t.Setenv("TEMP", filepath.Join(blocker, "also-unusable"))
	t.Setenv("TMP", filepath.Join(blocker, "also-unusable"))
	_, err := manager.begin("project-3", beginCommitRequest{})
	if err == nil {
		t.Skip("the system temp directory is writable here")
	}
	if !strings.Contains(err.Error(), "staging root") {
		t.Fatalf("error does not name the staging root: %v", err)
	}
}
