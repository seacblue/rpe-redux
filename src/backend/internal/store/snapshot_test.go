// Store-level regression tests for the chart snapshot branch tree.
package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// snapshotChart builds a chart with a countable note and event so the summary
// columns can be asserted.
func snapshotChart(name string) json.RawMessage {
	return json.RawMessage(`{"META":{"name":"` + name + `","charter":"a"},"judgeLineList":[` +
		`{"notes":[{"type":1,"startTime":[0,0,1]},{"type":1,"startTime":[1,0,1]}],` +
		`"moveXEvents":[{"startTime":[0,0,1],"endTime":[1,0,1],"start":0,"end":1}]}]}`)
}

func TestChartSnapshotsRecordTheChartingTimeTheyWereTakenAt(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	// The time is the project's own figure at the moment of the backup, so a
	// backup list can say how much work the node represents.
	node := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("timed"),
		Reason:      SnapshotReasonManual,
		AdvanceHead: true,
		EditSeconds: 3600,
	})
	if node.EditSeconds != 3600 {
		t.Fatalf("created node edit seconds = %d, want 3600", node.EditSeconds)
	}

	// The list projection must carry the same figure, because that is what the
	// restore dialog reads.
	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(history.Snapshots) != 1 || history.Snapshots[0].EditSeconds != 3600 {
		t.Fatalf("listed edit seconds = %v, want 3600", history.Snapshots)
	}

	// A single read goes through its own scan, so it can disagree with the list.
	full, err := store.GetChartSnapshot(ctx, node.ID)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if full.EditSeconds != 3600 {
		t.Fatalf("read edit seconds = %d, want 3600", full.EditSeconds)
	}
}

func TestChartSnapshotsFormAParentChainAndTrackTheHead(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	first := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("one"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
	})
	if first.ParentID != "" {
		t.Fatalf("first parent = %q, want empty", first.ParentID)
	}
	if first.NoteCount != 2 || first.EventCount != 1 {
		t.Fatalf("counts = %d/%d, want 2/1", first.NoteCount, first.EventCount)
	}

	second := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("two"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
	})
	if second.ParentID != first.ID {
		t.Fatalf("second parent = %q, want %q", second.ParentID, first.ID)
	}

	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if history.HeadID != second.ID {
		t.Fatalf("head = %q, want %q", history.HeadID, second.ID)
	}
	if len(history.Snapshots) != 2 {
		t.Fatalf("snapshots = %d, want 2", len(history.Snapshots))
	}
	// Newest first.
	if history.Snapshots[0].ID != second.ID || history.Snapshots[1].ID != first.ID {
		t.Fatalf("order = %v", history.Snapshots)
	}
}

func TestChartSnapshotParentMustBelongToTheSameProject(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)
	other, err := store.CreateProject(ctx, CreateProjectInput{Name: "other", Chart: testChart("other")})
	if err != nil {
		t.Fatalf("create other project: %v", err)
	}
	foreign := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID: other.ID,
		Chart:     snapshotChart("foreign"),
	})

	_, err = store.CreateChartSnapshot(ctx, CreateChartSnapshotInput{
		ProjectID: project.ID,
		Chart:     snapshotChart("local"),
		ParentID:  foreign.ID,
	})
	if err == nil {
		t.Fatal("expected a cross-project parent to be rejected")
	}
}

func TestRestoringASnapshotKeepsTheReplacedChartAndDropsItsAssets(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	early := stage(t, store, project.ID, "early.png", "early bytes")
	earlyManifest := []AssetMapping{{Name: early.Name, Hash: early.Hash}}
	committed, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID:    project.ID,
		BaseRevision: &project.Revision,
		Chart:        snapshotChart("early"),
		Assets:       &earlyManifest,
	})
	if err != nil {
		t.Fatalf("commit early chart: %v", err)
	}
	target := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   committed.ID,
		Chart:       snapshotChart("early"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
	})

	// A later save replaces both the chart and its single asset.
	late := stage(t, store, committed.ID, "late.png", "late bytes")
	lateManifest := []AssetMapping{{Name: late.Name, Hash: late.Hash}}
	if _, err := store.CommitProject(ctx, CommitProjectInput{
		ProjectID:    committed.ID,
		BaseRevision: &committed.Revision,
		Chart:        snapshotChart("late"),
		Assets:       &lateManifest,
	}); err != nil {
		t.Fatalf("commit late chart: %v", err)
	}

	if _, err := store.RestoreChartSnapshot(ctx, target.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}

	restored, err := store.GetProject(ctx, committed.ID)
	if err != nil {
		t.Fatalf("reload project: %v", err)
	}
	if got := extractMeta(restored.Chart).Charter; got != "a" {
		t.Fatalf("restored charter = %q", got)
	}
	if !bytesContain(restored.Chart, "early") {
		t.Fatalf("restored chart = %s", restored.Chart)
	}

	assets, err := store.ListProjectAssets(ctx, committed.ID)
	if err != nil {
		t.Fatalf("list assets: %v", err)
	}
	if len(assets) != 1 || assets[0].Name != "early.png" {
		t.Fatalf("restored assets = %#v", assets)
	}

	// The chart the restore replaced stays reachable as a restore node.
	history, err := store.ListChartSnapshots(ctx, committed.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	var replaced *ChartSnapshot
	for index := range history.Snapshots {
		if history.Snapshots[index].Reason == SnapshotReasonRestore {
			replaced = &history.Snapshots[index]
		}
	}
	if replaced == nil {
		t.Fatal("restore did not record the replaced chart")
	}
	if history.HeadID != target.ID {
		t.Fatalf("head after restore = %q, want the restored node %q", history.HeadID, target.ID)
	}
	full, err := store.GetChartSnapshot(ctx, replaced.ID)
	if err != nil {
		t.Fatalf("read replaced chart: %v", err)
	}
	if !bytesContain(full.Chart, "late") {
		t.Fatalf("replaced chart = %s", full.Chart)
	}
	// Restoring the replaced node returns to the chart the restore left behind,
	// which is how a user undoes a restore.
	if _, err := store.RestoreChartSnapshot(ctx, replaced.ID); err != nil {
		t.Fatalf("restore back: %v", err)
	}
	back, err := store.GetProject(ctx, committed.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !bytesContain(back.Chart, "late") {
		t.Fatalf("chart after restore back = %s", back.Chart)
	}
	assets, err = store.ListProjectAssets(ctx, committed.ID)
	if err != nil {
		t.Fatalf("list assets after restore back: %v", err)
	}
	if len(assets) != 1 || assets[0].Name != "late.png" {
		t.Fatalf("assets after restore back = %#v", assets)
	}
}

func TestRestoringAnIdenticalChartDoesNotAppendADuplicateNode(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	// The project already holds the chart the snapshot captures.
	project, err := store.CreateProject(ctx, CreateProjectInput{
		Name:  "same",
		Chart: snapshotChart("same"),
	})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	target := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID: project.ID,
		Chart:     snapshotChart("same"),
	})
	if _, err := store.RestoreChartSnapshot(ctx, target.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	for _, snapshot := range history.Snapshots {
		if snapshot.Reason == SnapshotReasonRestore {
			t.Fatalf("recorded a restore node for an identical chart: %#v", snapshot)
		}
	}
}

func TestSnapshotRetentionPrunesTheOldestNodesAndReclaimsTheirAssets(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	// Each node owns a distinct blob so pruning can be observed in `assets`.
	for index := 0; index < 4; index++ {
		name := "asset-" + string(rune('a'+index)) + ".png"
		asset := stage(t, store, project.ID, name, "bytes-"+name)
		manifest := []AssetMapping{{Name: asset.Name, Hash: asset.Hash}}
		mustSnapshot(t, store, CreateChartSnapshotInput{
			ProjectID:   project.ID,
			Chart:       snapshotChart(name),
			Assets:      manifest,
			AdvanceHead: true,
			Retain:      2,
		})
	}

	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(history.Snapshots) != 2 {
		t.Fatalf("snapshots = %d, want 2 after retention", len(history.Snapshots))
	}

	var blobs int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets`).Scan(&blobs); err != nil {
		t.Fatalf("count assets: %v", err)
	}
	if blobs != 2 {
		t.Fatalf("assets = %d, want 2 after pruning", blobs)
	}
}

func TestDeletingAProjectRemovesItsSnapshotTree(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)
	mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("one"),
		AdvanceHead: true,
	})
	if err := store.DeleteProject(ctx, project.ID); err != nil {
		t.Fatalf("delete project: %v", err)
	}
	for table, query := range map[string]string{
		"chart_snapshots":      `SELECT COUNT(*) FROM chart_snapshots`,
		"chart_snapshot_heads": `SELECT COUNT(*) FROM chart_snapshot_heads`,
	} {
		var count int
		if err := store.db.QueryRowContext(ctx, query).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s rows = %d after project delete", table, count)
		}
	}
}

func TestDeletingASnapshotDetachesItsChildrenInsteadOfLosingThem(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)
	first := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("one"),
		AdvanceHead: true,
	})
	second := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("two"),
		AdvanceHead: true,
	})
	if err := store.DeleteChartSnapshot(ctx, first.ID); err != nil {
		t.Fatalf("delete snapshot: %v", err)
	}
	survivor, err := store.GetChartSnapshotSummary(ctx, second.ID)
	if err != nil {
		t.Fatalf("read survivor: %v", err)
	}
	if survivor.ParentID != "" {
		t.Fatalf("survivor parent = %q, want empty", survivor.ParentID)
	}
}

func TestMissingSnapshotAndProjectAreNotFound(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	if _, err := store.RestoreChartSnapshot(ctx, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore missing = %v, want ErrNotFound", err)
	}
	history, err := store.ListChartSnapshots(ctx, "missing", 0)
	if !errors.Is(err, ErrNotFound) || history != nil {
		t.Fatalf("list missing = %v, %v", history, err)
	}
}

func TestAutomaticBackupSkipsAnIdenticalHeadButAManualOneStores(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	first := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("same"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
		Dedupe:      true,
	})
	// An unchanged chart must not append, or an idle editor would evict the real
	// history it is supposed to keep.
	repeat := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("same"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
		Dedupe:      true,
	})
	if repeat.ID != first.ID {
		t.Fatalf("automatic backup appended a duplicate node: %q != %q", repeat.ID, first.ID)
	}
	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(history.Snapshots) != 1 {
		t.Fatalf("snapshots = %d after an identical automatic backup, want 1", len(history.Snapshots))
	}

	// A manual capture is the user's explicit answer, so it always stores.
	manual, err := store.CreateChartSnapshot(ctx, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("same"),
		Reason:      SnapshotReasonManual,
		AdvanceHead: true,
	})
	if err != nil {
		t.Fatalf("manual snapshot: %v", err)
	}
	if manual.ID == first.ID {
		t.Fatal("a manual capture of the same chart must still be recorded")
	}

	// A different chart always appends, dedupe or not.
	changed := mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       snapshotChart("different"),
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
		Dedupe:      true,
	})
	if changed.ID == manual.ID {
		t.Fatal("a changed chart must append a new node")
	}
}

func TestDedupeComparesTheManifestNotJustTheChart(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	project := createTestProject(t, store)

	chart := snapshotChart("same")
	early := stage(t, store, project.ID, "early.png", "early bytes")
	mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       chart,
		Assets:      []AssetMapping{{Name: early.Name, Hash: early.Hash}},
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
		Dedupe:      true,
	})

	// Same chart text, different resource bytes: this is a real change to what a
	// restore would produce, so it must be recorded.
	late := stage(t, store, project.ID, "early.png", "different bytes")
	mustSnapshot(t, store, CreateChartSnapshotInput{
		ProjectID:   project.ID,
		Chart:       chart,
		Assets:      []AssetMapping{{Name: late.Name, Hash: late.Hash}},
		Reason:      SnapshotReasonAuto,
		AdvanceHead: true,
		Dedupe:      true,
	})
	history, err := store.ListChartSnapshots(ctx, project.ID, 0)
	if err != nil {
		t.Fatalf("list snapshots: %v", err)
	}
	if len(history.Snapshots) != 2 {
		t.Fatalf("snapshots = %d, want 2 when the manifest changed", len(history.Snapshots))
	}
}

func mustSnapshot(t *testing.T, store *Store, in CreateChartSnapshotInput) *ChartSnapshot {
	t.Helper()
	snapshot, err := store.CreateChartSnapshot(context.Background(), in)
	if err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	return snapshot
}

// bytesContain reports whether a chart payload names a chart.
func bytesContain(value []byte, needle string) bool {
	return bytes.Contains(value, []byte(needle))
}
