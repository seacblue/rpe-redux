// Store tests for the additive chart-index migration and byte-range reads.

package store

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"rperedux/server/internal/chartstream"
)

// columnExists reports whether a table has one column.
func columnExists(t *testing.T, store *Store, table, column string) bool {
	t.Helper()
	query := `SELECT COUNT(*) FROM pragma_table_info('` + table + `') WHERE name = ?`
	var count int
	if err := store.db.QueryRow(query, column).Scan(&count); err != nil {
		t.Fatalf("inspect %s.%s: %v", table, column, err)
	}
	return count > 0
}

func TestChartIndexMigrationIsAdditive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	data, err := Open(path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	project := createTestProject(t, data)
	before, err := data.GetProject(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("read project: %v", err)
	}
	if !columnExists(t, data, "projects", "chart_index") ||
		!columnExists(t, data, "revisions", "chart_index") {
		t.Fatal("fresh schema is missing chart_index")
	}

	// Simulate a library created before the cache column existed.
	if _, err := data.db.Exec(`ALTER TABLE projects DROP COLUMN chart_index`); err != nil {
		t.Fatalf("drop projects.chart_index: %v", err)
	}
	if _, err := data.db.Exec(`ALTER TABLE revisions DROP COLUMN chart_index`); err != nil {
		t.Fatalf("drop revisions.chart_index: %v", err)
	}
	if err := data.Close(); err != nil {
		t.Fatalf("close store: %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	defer reopened.Close()
	if !columnExists(t, reopened, "projects", "chart_index") ||
		!columnExists(t, reopened, "revisions", "chart_index") {
		t.Fatal("migration did not add chart_index")
	}
	after, err := reopened.GetProject(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("read migrated project: %v", err)
	}
	if string(after.Chart) != string(before.Chart) {
		t.Fatalf("chart changed during migration: %q -> %q", before.Chart, after.Chart)
	}
	if after.Revision != before.Revision {
		t.Fatalf("revision changed during migration: %d -> %d", before.Revision, after.Revision)
	}
	state, err := reopened.ReadProjectChartState(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("read chart state: %v", err)
	}
	if state.HasIndex {
		t.Fatal("existing row gained an index")
	}
}

func TestReadProjectChartSliceUsesByteOffsets(t *testing.T) {
	data := testStore(t)
	chart := json.RawMessage(`{"META":{"name":"谱面"},"judgeLineList":[{"Name":"第一"},{"Name":"second"},{"Name":"third"}]}`)
	project, err := data.CreateProject(context.Background(), CreateProjectInput{Name: "slice", Chart: chart})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	scan, err := chartstream.ScanChartJSON([]byte(chart))
	if err != nil {
		t.Fatalf("scan chart: %v", err)
	}
	if len(scan.LineRanges) != 3 {
		t.Fatalf("lines = %d", len(scan.LineRanges))
	}
	for index, sourceRange := range scan.LineRanges {
		slice, err := data.ReadProjectChartSlice(context.Background(), project.ID,
			int64(sourceRange.Start), int64(sourceRange.End-sourceRange.Start))
		if err != nil {
			t.Fatalf("read line %d: %v", index, err)
		}
		if string(slice) != string(chart[sourceRange.Start:sourceRange.End]) {
			t.Fatalf("line %d = %q, want %q", index, slice, chart[sourceRange.Start:sourceRange.End])
		}
	}
	if _, err := data.ReadProjectChartSlice(context.Background(), project.ID, -1, 1); err == nil {
		t.Fatal("negative offset was accepted")
	}
}

func TestSaveProjectChartIndexOnlyMatchesTheBuiltRevision(t *testing.T) {
	data := testStore(t)
	project := createTestProject(t, data)
	ctx := context.Background()
	state, err := data.ReadProjectChartState(ctx, project.ID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	if err := data.SaveProjectChartIndex(ctx, project.ID, state.Revision, state.ChartHash, `{"cached":true}`); err != nil {
		t.Fatalf("save index: %v", err)
	}
	updated, err := data.ReadProjectChartState(ctx, project.ID)
	if err != nil {
		t.Fatalf("read updated state: %v", err)
	}
	if !updated.HasIndex {
		t.Fatal("index was not stored")
	}
	index, err := data.ReadProjectChartIndex(ctx, project.ID)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	if index != `{"cached":true}` {
		t.Fatalf("index = %q", index)
	}
	if err := data.SaveProjectChartIndex(ctx, project.ID, state.Revision+1, state.ChartHash, `{"stale":true}`); err != nil {
		t.Fatalf("save stale index: %v", err)
	}
	unchanged, err := data.ReadProjectChartState(ctx, project.ID)
	if err != nil {
		t.Fatalf("read unchanged state: %v", err)
	}
	index, err = data.ReadProjectChartIndex(ctx, project.ID)
	if err != nil {
		t.Fatalf("read unchanged index: %v", err)
	}
	if index != `{"cached":true}` {
		t.Fatalf("stale write replaced index: %q", index)
	}
	if unchanged.Revision != state.Revision {
		t.Fatalf("index write changed revision: %d -> %d", state.Revision, unchanged.Revision)
	}
}
