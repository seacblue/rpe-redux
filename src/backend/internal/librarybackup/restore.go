// Restore a committed snapshot into the live library. The normal path builds a
// standalone database and replaces only the library tables in one transaction;
// host-local recovery tables stay untouched.
package librarybackup

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"rperedux/server/internal/store"
)

// restoreCommitLocked restores one validated commit. The caller holds s.mu.
func (s *Service) restoreCommitLocked(ctx context.Context, target *headResult) error {
	temp, err := os.CreateTemp(filepath.Join(s.backupDir, "tmp"), "restore-*.sqlite")
	if err != nil {
		return fmt.Errorf("create restore database: %w", err)
	}
	tempPath := temp.Name()
	_ = temp.Close()
	_ = os.Remove(tempPath)
	defer func() {
		_ = os.Remove(tempPath)
		_ = os.Remove(tempPath + "-wal")
		_ = os.Remove(tempPath + "-shm")
	}()

	// Let the store create the current schema, then fill it through a normal
	// connection. A fresh temp file has no projects table, so opening it does
	// not create a pre-migration copy.
	created, err := store.Open(tempPath)
	if err != nil {
		return fmt.Errorf("create restore schema: %w", err)
	}
	_ = created.Close()

	if err := s.fillRestoreDatabase(ctx, tempPath, target); err != nil {
		return err
	}
	if err := checkIntegrity(ctx, tempPath); err != nil {
		return fmt.Errorf("restore database failed integrity check: %w", err)
	}
	if err := s.replaceLibrary(ctx, tempPath, target.commit); err != nil {
		return err
	}
	return nil
}

func (s *Service) fillRestoreDatabase(ctx context.Context, path string, target *headResult) error {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(15000)&_pragma=foreign_keys(ON)")
	if err != nil {
		return fmt.Errorf("open restore database: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	treeRaw, err := s.objects.read(kindTree, target.commit.Tree)
	if err != nil {
		return err
	}
	var tree Tree
	if err := json.Unmarshal(treeRaw, &tree); err != nil {
		return fmt.Errorf("decode snapshot tree: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin restore fill: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, item := range tree.Projects {
		manifestRaw, err := s.objects.read(kindProject, item.Manifest)
		if err != nil {
			return err
		}
		var manifest ProjectManifest
		if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
			return fmt.Errorf("decode project %s: %w", item.ID, err)
		}
		if err := s.writeRestoreProject(ctx, tx, manifest); err != nil {
			return err
		}
	}

	currentPreferences := s.livePreferences(ctx)
	snapshotPreferences, err := s.objects.read(kindPreferences, target.commit.Preferences)
	if err != nil {
		return err
	}
	merged, err := mergePreferences(currentPreferences, snapshotPreferences)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		string(merged), target.commit.CreatedAt); err != nil {
		return fmt.Errorf("write restored preferences: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
        INSERT OR REPLACE INTO library_meta (key, value) VALUES ('database_id', ?)`,
		target.commit.DatabaseID); err != nil {
		return fmt.Errorf("write restored database id: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
        INSERT OR REPLACE INTO library_meta (key, value) VALUES ('schema_origin', 'go')`); err != nil {
		return fmt.Errorf("write restored schema origin: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit restore fill: %w", err)
	}
	return nil
}

func (s *Service) writeRestoreProject(ctx context.Context, tx *sql.Tx, manifest ProjectManifest) error {
	chart, err := s.objects.read(kindChart, manifest.Chart)
	if err != nil {
		return err
	}
	eventCount := store.CountChartEvents(chart)
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO projects
            (id, name, grp, archived, charter, composer, level, note_count, event_count,
             edit_seconds, chart, size, revision, chart_hash, view_state, asset_folders,
             background, song, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		manifest.ID, manifest.Name, manifest.Group, boolInt(manifest.Archived),
		manifest.Charter, manifest.Composer, manifest.Level, manifest.NoteCount, eventCount,
		manifest.EditSeconds, string(chart), len(chart), manifest.Revision, manifest.Chart.Hash,
		string(validJSON(manifest.ViewState, "{}")), string(validJSON(manifest.AssetFolders, "[]")),
		manifest.Background, manifest.Song, manifest.CreatedAt, manifest.UpdatedAt); err != nil {
		return fmt.Errorf("insert restored project %s: %w", manifest.ID, err)
	}
	for _, asset := range manifest.Assets {
		bytes, err := s.objects.read(kindAsset, ObjectRef{Hash: asset.Hash, Encoding: asset.Encoding, Size: asset.Size})
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT OR IGNORE INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
            VALUES (?, ?, ?, ?, '', '')`,
			asset.Hash, len(bytes), bytes, manifest.UpdatedAt); err != nil {
			return fmt.Errorf("insert restored asset %s: %w", asset.Name, err)
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO project_assets (project_id, name, hash, updated_at)
            VALUES (?, ?, ?, ?)`,
			manifest.ID, asset.Name, asset.Hash, manifest.UpdatedAt); err != nil {
			return fmt.Errorf("insert restored project asset %s: %w", asset.Name, err)
		}
	}
	revisionsRaw, err := s.objects.read(kindRevisions, manifest.Revisions)
	if err != nil {
		return err
	}
	var revisions RevisionSet
	if err := json.Unmarshal(revisionsRaw, &revisions); err != nil {
		return fmt.Errorf("decode revisions for %s: %w", manifest.ID, err)
	}
	for _, revision := range revisions.Revisions {
		chart, err := s.objects.read(kindChart, revision.Chart)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO revisions (id, project_id, label, chart, size, chart_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
			revision.ID, manifest.ID, revision.Label, string(chart), len(chart),
			revision.Chart.Hash, revision.CreatedAt); err != nil {
			return fmt.Errorf("insert restored revision %s: %w", revision.ID, err)
		}
		for _, asset := range revision.Assets {
			bytes, err := s.objects.read(kindAsset, ObjectRef{Hash: asset.Hash, Encoding: asset.Encoding, Size: asset.Size})
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
                INSERT OR IGNORE INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
                VALUES (?, ?, ?, ?, '', '')`,
				asset.Hash, len(bytes), bytes, revision.CreatedAt); err != nil {
				return fmt.Errorf("insert restored revision asset %s: %w", asset.Name, err)
			}
			if _, err := tx.ExecContext(ctx, `
                INSERT INTO revision_assets (revision_id, name, hash) VALUES (?, ?, ?)`,
				revision.ID, asset.Name, asset.Hash); err != nil {
				return fmt.Errorf("insert restored revision asset %s: %w", asset.Name, err)
			}
		}
	}
	return nil
}

// replaceLibrary copies the restored tables over the live library in one
// transaction. recovery_* and other host tables are intentionally untouched.
func (s *Service) replaceLibrary(ctx context.Context, sourcePath string, commit *Commit) error {
	db, err := sql.Open("sqlite", s.dbPath+"?_pragma=busy_timeout(15000)&_pragma=foreign_keys(ON)")
	if err != nil {
		return fmt.Errorf("open live library for restore: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	escaped := strings.ReplaceAll(sourcePath, "'", "''")
	if _, err := db.ExecContext(ctx, "ATTACH DATABASE '"+escaped+"' AS snapshot"); err != nil {
		return fmt.Errorf("attach restore database: %w", err)
	}
	defer func() { _, _ = db.ExecContext(context.Background(), "DETACH DATABASE snapshot") }()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin library restore: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range []string{
		`DELETE FROM revision_assets`,
		`DELETE FROM revisions`,
		`DELETE FROM project_assets`,
		`DELETE FROM projects`,
		`DELETE FROM assets`,
		`DELETE FROM library_meta`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("clear live library: %w", err)
		}
	}
	for _, statement := range []string{
		`INSERT INTO assets SELECT * FROM snapshot.assets`,
		`INSERT INTO projects SELECT * FROM snapshot.projects`,
		`INSERT INTO project_assets SELECT * FROM snapshot.project_assets`,
		`INSERT INTO revisions SELECT * FROM snapshot.revisions`,
		`INSERT INTO revision_assets SELECT * FROM snapshot.revision_assets`,
		`INSERT INTO library_meta SELECT * FROM snapshot.library_meta`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("copy restored library: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR REPLACE INTO preferences (id, data, updated_at)
         SELECT id, data, updated_at FROM snapshot.preferences`); err != nil {
		return fmt.Errorf("copy restored preferences: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit library restore: %w", err)
	}
	return nil
}

func (s *Service) livePreferences(ctx context.Context) []byte {
	var raw string
	if err := s.readDB.QueryRowContext(ctx, `SELECT data FROM preferences WHERE id = 1`).Scan(&raw); err != nil {
		return []byte("{}")
	}
	return []byte(raw)
}

func checkIntegrity(ctx context.Context, path string) error {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(15000)")
	if err != nil {
		return err
	}
	defer db.Close()
	var result string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("%s", result)
	}
	return nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
