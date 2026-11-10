// Snapshot, restore, retention, and debounce tests for the library backup
// service.
package librarybackup

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"rperedux/server/internal/store"
)

func testChart(name string) json.RawMessage {
	return json.RawMessage(`{"META":{"name":"` + name + `"},"BPMList":[{"bpm":120,"startTime":[0,0,1]}],"judgeLineList":[]}`)
}

func TestSnapshotRestoreAndCompact(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "redux.db")
	live, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open live store: %v", err)
	}
	project, err := live.CreateProject(ctx, store.CreateProjectInput{
		Name:  "Chart",
		Chart: testChart("A"),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	asset, err := live.StageAsset(ctx, project.ID, "cover.png", []byte("same asset bytes"))
	if err != nil {
		t.Fatalf("stage asset: %v", err)
	}
	manifest := []store.AssetMapping{{Name: asset.Name, Hash: asset.Hash}}
	if _, err := live.CommitProject(ctx, store.CommitProjectInput{
		ProjectID: project.ID,
		Chart:     testChart("A"),
		Assets:    &manifest,
		Snapshot:  true,
		Label:     "v1",
	}); err != nil {
		t.Fatalf("commit project: %v", err)
	}
	if _, err := live.PutPreferences(ctx, json.RawMessage(`{
        "settings":{"theme":"dark","code-execution-enabled":true},
        "library":{"/tmp/chart.json":"project-id"},
        "clipboard":["secret"],
        "language":"zh-CN"
    }`)); err != nil {
		t.Fatalf("save preferences: %v", err)
	}

	service, err := Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatalf("open backup service: %v", err)
	}
	defer service.Close()

	first, err := service.Snapshot(ctx, "manual")
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
	if first.Stats.Projects != 1 || first.Stats.Assets != 1 || first.Stats.Revisions != 1 {
		t.Fatalf("first stats = %+v", first.Stats)
	}
	head, err := service.head(ctx)
	if err != nil || head == nil {
		t.Fatalf("first head = %#v, err = %v", head, err)
	}
	preferences, err := service.objects.read(kindPreferences, head.commit.Preferences)
	if err != nil {
		t.Fatalf("read preferences object: %v", err)
	}
	var portable Preferences
	if err := json.Unmarshal(preferences, &portable); err != nil {
		t.Fatalf("decode preferences object: %v", err)
	}
	if _, ok := portable.Sections["library"]; ok {
		t.Fatal("host-local library section leaked into snapshot")
	}
	if _, ok := portable.Sections["clipboard"]; ok {
		t.Fatal("clipboard section leaked into snapshot")
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(portable.Sections["settings"], &settings); err != nil {
		t.Fatalf("decode portable settings: %v", err)
	}
	if _, ok := settings["code-execution-enabled"]; ok {
		t.Fatal("consent setting leaked into snapshot")
	}
	if _, ok := settings["theme"]; !ok {
		t.Fatal("portable setting is missing")
	}

	// The asset object is content-addressed and survives a second snapshot.
	assetPath := filepath.Join(dir, "library-history", "objects", asset.Hash)
	if _, err := os.Stat(assetPath); err != nil {
		t.Fatalf("asset object missing: %v", err)
	}
	if _, err := live.CommitProject(ctx, store.CommitProjectInput{
		ProjectID: project.ID,
		Chart:     testChart("B"),
		Assets:    &manifest,
		Snapshot:  true,
		Label:     "v2",
	}); err != nil {
		t.Fatalf("second commit: %v", err)
	}
	second, err := service.Snapshot(ctx, "manual")
	if err != nil {
		t.Fatalf("second snapshot: %v", err)
	}
	if second.ID == first.ID {
		t.Fatal("second snapshot reused the first commit")
	}
	if _, err := os.Stat(assetPath); err != nil {
		t.Fatalf("asset object disappeared after second snapshot: %v", err)
	}

	// Add a host-local auxiliary table. Restoring the library must leave it.
	aux, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := aux.Exec(`CREATE TABLE recovery_drafts (id TEXT PRIMARY KEY, chart TEXT); INSERT INTO recovery_drafts VALUES ('draft', 'keep me')`); err != nil {
		t.Fatal(err)
	}
	_ = aux.Close()

	restored, err := service.Restore(ctx, first.ID)
	if err != nil {
		t.Fatalf("restore first snapshot: %v", err)
	}
	if restored.Reason != "restore" {
		t.Fatalf("restore commit reason = %q", restored.Reason)
	}
	if current, err := live.GetProject(ctx, project.ID); err != nil {
		t.Fatalf("read restored project: %v", err)
	} else if string(current.Chart) != string(testChart("A")) {
		t.Fatalf("restored chart = %s, want A", current.Chart)
	}
	restoredPreferencesRaw, err := live.GetPreferences(ctx)
	if err != nil {
		t.Fatalf("read restored preferences: %v", err)
	}
	var restoredPreferences map[string]json.RawMessage
	if err := json.Unmarshal(restoredPreferencesRaw, &restoredPreferences); err != nil {
		t.Fatalf("decode restored preferences: %v", err)
	}
	if _, ok := restoredPreferences["library"]; !ok {
		t.Fatal("host-local library preference was not preserved")
	}
	_ = live.Close()

	verifyDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open restored store: %v", err)
	}
	defer verifyDB.Close()
	var draft string
	if err := verifyDB.QueryRow(`SELECT chart FROM recovery_drafts WHERE id = 'draft'`).Scan(&draft); err != nil {
		t.Fatalf("recovery table was not preserved: %v", err)
	}
	if draft != "keep me" {
		t.Fatalf("recovery draft = %q", draft)
	}

	report, err := service.Verify(ctx, "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if len(report.Missing) != 0 || len(report.Corrupt) != 0 {
		t.Fatalf("verify report = %+v", report)
	}

	compacted, err := service.Compact(ctx, 1)
	if err != nil {
		t.Fatalf("compact: %v", err)
	}
	if compacted.AfterCommits != 1 {
		t.Fatalf("compacted commits = %d, want 1", compacted.AfterCommits)
	}
	history, err := service.History(ctx, 10)
	if err != nil {
		t.Fatalf("history after compact: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history after compact = %d, want 1", len(history))
	}
	if _, err := service.Verify(ctx, ""); err != nil {
		t.Fatalf("verify after compact: %v", err)
	}
}

func TestBackupSettingsControlPolicy(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "redux.db")
	live, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	if _, err := live.CreateProject(ctx, store.CreateProjectInput{Name: "Chart", Chart: testChart("A")}); err != nil {
		t.Fatal(err)
	}
	if _, err := live.PutPreferences(ctx, json.RawMessage(`{
        "settings": {
            "library-backup-auto": false,
            "library-backup-interval-seconds": 45
        }
    }`)); err != nil {
		t.Fatal(err)
	}
	service, err := Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	policy := service.Policy()
	if policy.Auto {
		t.Fatal("automatic snapshots should be disabled by the setting")
	}
	if policy.MaxDelaySeconds != 45 || policy.DebounceSeconds != 20 {
		t.Fatalf("policy = %+v", policy)
	}

	hook := make(chan struct{}, 1)
	live.SetPreferenceHook(func() { hook <- struct{}{} })
	if _, err := live.PutPreferences(ctx, json.RawMessage(`{
        "settings": {
            "library-backup-auto": true,
            "library-backup-interval-seconds": 90
        }
    }`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-hook:
	case <-time.After(2 * time.Second):
		t.Fatal("preference hook did not run")
	}
	service.RefreshPolicy()
	policy = service.Policy()
	if !policy.Auto || policy.MaxDelaySeconds != 90 {
		t.Fatalf("updated policy = %+v", policy)
	}
}

func TestOpenResumesADirtyMarkerAfterCrash(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "redux.db")
	live, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := live.CreateProject(ctx, store.CreateProjectInput{Name: "Chart", Chart: testChart("A")}); err != nil {
		t.Fatal(err)
	}
	_ = live.Close()

	service, err := Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatal(err)
	}
	service.markDirty()
	service.Close()

	reopened, err := Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopened.mu.Lock()
	dirty := reopened.dirty
	reopened.mu.Unlock()
	if !dirty {
		t.Fatal("dirty marker was not adopted on open")
	}
	if err := reopened.runOnce(ctx, time.Now()); err != nil {
		t.Fatalf("flush dirty marker: %v", err)
	}
	head, err := reopened.head(ctx)
	if err != nil || head == nil {
		t.Fatalf("dirty marker was not flushed: head=%v err=%v", head, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "library-history", "dirty.json")); !os.IsNotExist(err) {
		t.Fatalf("dirty marker still exists: %v", err)
	}
}

func TestRunOnceHonorsMaxDelayUnderContinuousEdits(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "redux.db")
	live, err := store.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := live.CreateProject(ctx, store.CreateProjectInput{Name: "Chart", Chart: testChart("A")}); err != nil {
		t.Fatal(err)
	}
	_ = live.Close()

	service, err := Open(dbPath, filepath.Join(dir, "library-history"), "test", "go")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	policy := DefaultPolicy()
	policy.PollSeconds = 1
	policy.DebounceSeconds = 60
	policy.MaxDelaySeconds = 120
	if err := service.SetPolicy(policy); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	service.mu.Lock()
	service.dirty = true
	service.dirtySince = now.Add(-121 * time.Second)
	service.lastChange = now
	service.lastVersion = service.currentDataVersion()
	service.mu.Unlock()

	if err := service.runOnce(ctx, now); err != nil {
		t.Fatalf("run once: %v", err)
	}
	head, err := service.head(ctx)
	if err != nil || head == nil {
		t.Fatalf("max-delay snapshot did not run: head=%v err=%v", head, err)
	}
	if head.commit.Reason != "auto" {
		t.Fatalf("max-delay reason = %q, want auto", head.commit.Reason)
	}
}
