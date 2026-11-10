// Snapshot construction: a consistent read transaction is turned into
// content-addressed project, revision, and preference objects.
package librarybackup

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
)

type projectRow struct {
	ID           string
	Name         string
	Group        string
	Archived     bool
	Charter      string
	Composer     string
	Level        string
	Background   string
	Song         string
	NoteCount    int
	Revision     int
	ViewState    json.RawMessage
	AssetFolders json.RawMessage
	CreatedAt    string
	UpdatedAt    string
	ChartHash    string
}

type revisionRow struct {
	ID        string
	ProjectID string
	Label     string
	ChartHash string
	Size      int64
	CreatedAt string
}

// snapshotLocked builds and publishes one commit. The caller holds s.mu.
func (s *Service) snapshotLocked(ctx context.Context, reason string) (*headResult, error) {
	commit, err := s.buildCommit(ctx, reason)
	if err != nil {
		return nil, err
	}
	ref, _, err := s.objects.writeJSON(kindCommit, commit)
	if err != nil {
		return nil, fmt.Errorf("write commit: %w", err)
	}
	if _, err := s.writeRef(ref.Hash); err != nil {
		return nil, fmt.Errorf("write ref: %w", err)
	}
	return &headResult{commitID: ref.Hash, commit: commit}, nil
}

// buildCommit reads the library and returns a commit whose referenced objects
// have already been published.
func (s *Service) buildCommit(ctx context.Context, reason string) (*Commit, error) {
	s.objects.cleanTemp()
	tx, err := s.readDB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin library read: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	parent := ""
	if head, err := s.readHead(ctx); err == nil && head != nil {
		parent = head.commitID
	}
	databaseID := s.databaseID(ctx, tx)
	preferencesRaw := s.preferences(ctx, tx)
	portable, err := portablePreferences(preferencesRaw)
	if err != nil {
		return nil, err
	}
	preferencesRef, _, err := s.objects.writeJSON(kindPreferences, json.RawMessage(portable))
	if err != nil {
		return nil, fmt.Errorf("write preferences: %w", err)
	}

	projects, err := s.projectRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	projectAssets, err := s.projectAssetMap(ctx, tx)
	if err != nil {
		return nil, err
	}
	revisions, err := s.revisionRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	revisionAssets, err := s.revisionAssetMap(ctx, tx)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]int64)
	stats := SnapshotStats{Projects: len(projects)}
	add := func(ref ObjectRef) {
		key := ref.Hash
		if _, ok := seen[key]; !ok {
			seen[key] = ref.Size
			stats.Objects++
			stats.RawBytes += ref.Size
		}
	}
	add(preferencesRef)

	byProjectRevisions := make(map[string][]RevisionRecord)
	for _, revision := range revisions {
		chart, err := s.revisionChart(ctx, tx, revision)
		if err != nil {
			return nil, err
		}
		add(chart)
		assets := make([]AssetRef, 0, len(revisionAssets[revision.ID]))
		for _, asset := range revisionAssets[revision.ID] {
			ref, err := s.assetRef(ctx, tx, asset.Hash)
			if err != nil {
				return nil, err
			}
			add(ref)
			assets = append(assets, AssetRef{
				Name:     asset.Name,
				Hash:     ref.Hash,
				Encoding: ref.Encoding,
				Size:     ref.Size,
			})
		}
		byProjectRevisions[revision.ProjectID] = append(byProjectRevisions[revision.ProjectID], RevisionRecord{
			ID:        revision.ID,
			Label:     revision.Label,
			CreatedAt: revision.CreatedAt,
			Size:      revision.Size,
			Chart:     chart,
			Assets:    assets,
		})
		stats.Revisions++
	}

	tree := Tree{Format: TreeFormat, Version: 1, Projects: make([]TreeItem, 0, len(projects))}
	for _, project := range projects {
		chart, err := s.projectChart(ctx, tx, project)
		if err != nil {
			return nil, err
		}
		add(chart)
		assets := make([]AssetRef, 0, len(projectAssets[project.ID]))
		for _, asset := range projectAssets[project.ID] {
			ref, err := s.assetRef(ctx, tx, asset.Hash)
			if err != nil {
				return nil, err
			}
			add(ref)
			assets = append(assets, AssetRef{
				Name:     asset.Name,
				Hash:     ref.Hash,
				Encoding: ref.Encoding,
				Size:     ref.Size,
			})
			stats.Assets++
		}
		revisionSet := RevisionSet{
			Format:    RevisionsFormat,
			Version:   1,
			ProjectID: project.ID,
			Revisions: byProjectRevisions[project.ID],
		}
		if revisionSet.Revisions == nil {
			revisionSet.Revisions = []RevisionRecord{}
		}
		revisionsRef, _, err := s.objects.writeJSON(kindRevisions, revisionSet)
		if err != nil {
			return nil, fmt.Errorf("write revisions for %s: %w", project.ID, err)
		}
		add(revisionsRef)
		manifest := ProjectManifest{
			Format:       ProjectFormat,
			Version:      1,
			ID:           project.ID,
			Name:         project.Name,
			Group:        project.Group,
			Archived:     project.Archived,
			Charter:      project.Charter,
			Composer:     project.Composer,
			Level:        project.Level,
			Background:   project.Background,
			Song:         project.Song,
			NoteCount:    project.NoteCount,
			Revision:     project.Revision,
			ViewState:    validJSON(project.ViewState, "{}"),
			AssetFolders: validJSON(project.AssetFolders, "[]"),
			CreatedAt:    project.CreatedAt,
			UpdatedAt:    project.UpdatedAt,
			Chart:        chart,
			Assets:       assets,
			Revisions:    revisionsRef,
		}
		if manifest.Assets == nil {
			manifest.Assets = []AssetRef{}
		}
		manifestRef, _, err := s.objects.writeJSON(kindProject, manifest)
		if err != nil {
			return nil, fmt.Errorf("write project %s: %w", project.ID, err)
		}
		add(manifestRef)
		tree.Projects = append(tree.Projects, TreeItem{ID: project.ID, Manifest: manifestRef})
	}
	sort.Slice(tree.Projects, func(left, right int) bool {
		return tree.Projects[left].ID < tree.Projects[right].ID
	})
	treeRef, _, err := s.objects.writeJSON(kindTree, tree)
	if err != nil {
		return nil, fmt.Errorf("write tree: %w", err)
	}
	add(treeRef)

	commit := &Commit{
		Format:           CommitFormat,
		Version:          1,
		Parent:           parent,
		Reason:           reason,
		CreatedAt:        now(),
		SchemaVersion:    SchemaVersion,
		AppVersion:       s.appVersion,
		SourceHost:       s.sourceHost,
		DatabaseID:       databaseID,
		PreferencePolicy: PreferencePolicy,
		Tree:             treeRef,
		Preferences:      preferencesRef,
		Stats:            stats,
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit library read: %w", err)
	}
	return commit, nil
}

func (s *Service) databaseID(ctx context.Context, tx *sql.Tx) string {
	var value string
	_ = tx.QueryRowContext(ctx,
		`SELECT value FROM library_meta WHERE key = 'database_id'`).Scan(&value)
	return value
}

func (s *Service) preferences(ctx context.Context, tx *sql.Tx) []byte {
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT data FROM preferences WHERE id = 1`).Scan(&raw)
	if err != nil || raw == "" {
		return []byte("{}")
	}
	return []byte(raw)
}

func (s *Service) projectRows(ctx context.Context, tx *sql.Tx) ([]projectRow, error) {
	rows, err := tx.QueryContext(ctx, `
        SELECT id, name, grp, archived, charter, composer, level, background, song,
               note_count, revision, view_state, asset_folders, created_at, updated_at,
               chart_hash
          FROM projects ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list projects for snapshot: %w", err)
	}
	defer rows.Close()
	out := make([]projectRow, 0)
	for rows.Next() {
		var project projectRow
		var archived int
		var viewState, assetFolders string
		if err := rows.Scan(&project.ID, &project.Name, &project.Group, &archived,
			&project.Charter, &project.Composer, &project.Level, &project.Background,
			&project.Song, &project.NoteCount, &project.Revision, &viewState,
			&assetFolders, &project.CreatedAt, &project.UpdatedAt, &project.ChartHash); err != nil {
			return nil, fmt.Errorf("scan project for snapshot: %w", err)
		}
		project.Archived = archived != 0
		project.ViewState = json.RawMessage(viewState)
		project.AssetFolders = json.RawMessage(assetFolders)
		out = append(out, project)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects for snapshot: %w", err)
	}
	return out, nil
}

type assetMapping struct {
	Name string
	Hash string
}

func (s *Service) projectAssetMap(ctx context.Context, tx *sql.Tx) (map[string][]assetMapping, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT project_id, name, hash FROM project_assets ORDER BY project_id, name`)
	if err != nil {
		return nil, fmt.Errorf("list project assets for snapshot: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]assetMapping)
	for rows.Next() {
		var projectID string
		var asset assetMapping
		if err := rows.Scan(&projectID, &asset.Name, &asset.Hash); err != nil {
			return nil, fmt.Errorf("scan project asset for snapshot: %w", err)
		}
		out[projectID] = append(out[projectID], asset)
	}
	return out, rows.Err()
}

func (s *Service) revisionRows(ctx context.Context, tx *sql.Tx) ([]revisionRow, error) {
	rows, err := tx.QueryContext(ctx, `
        SELECT id, project_id, label, chart_hash, size, created_at
          FROM revisions ORDER BY project_id, created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("list revisions for snapshot: %w", err)
	}
	defer rows.Close()
	out := make([]revisionRow, 0)
	for rows.Next() {
		var revision revisionRow
		if err := rows.Scan(&revision.ID, &revision.ProjectID, &revision.Label,
			&revision.ChartHash, &revision.Size, &revision.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan revision for snapshot: %w", err)
		}
		out = append(out, revision)
	}
	return out, rows.Err()
}

func (s *Service) revisionAssetMap(ctx context.Context, tx *sql.Tx) (map[string][]assetMapping, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT revision_id, name, hash FROM revision_assets ORDER BY revision_id, name`)
	if err != nil {
		return nil, fmt.Errorf("list revision assets for snapshot: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]assetMapping)
	for rows.Next() {
		var revisionID string
		var asset assetMapping
		if err := rows.Scan(&revisionID, &asset.Name, &asset.Hash); err != nil {
			return nil, fmt.Errorf("scan revision asset for snapshot: %w", err)
		}
		out[revisionID] = append(out[revisionID], asset)
	}
	return out, rows.Err()
}

func (s *Service) projectChart(ctx context.Context, tx *sql.Tx, project projectRow) (ObjectRef, error) {
	if validObjectName(project.ChartHash) {
		if ref, ok := readExisting(s.objects.objectPath(kindChart, project.ChartHash), project.ChartHash); ok {
			return ref, nil
		}
	}
	var chart string
	if err := tx.QueryRowContext(ctx, `SELECT chart FROM projects WHERE id = ?`, project.ID).Scan(&chart); err != nil {
		return ObjectRef{}, fmt.Errorf("read chart for %s: %w", project.ID, err)
	}
	return s.objects.write(kindChart, []byte(chart))
}

func (s *Service) revisionChart(ctx context.Context, tx *sql.Tx, revision revisionRow) (ObjectRef, error) {
	if validObjectName(revision.ChartHash) {
		if ref, ok := readExisting(s.objects.objectPath(kindChart, revision.ChartHash), revision.ChartHash); ok {
			return ref, nil
		}
	}
	var chart string
	if err := tx.QueryRowContext(ctx, `SELECT chart FROM revisions WHERE id = ?`, revision.ID).Scan(&chart); err != nil {
		return ObjectRef{}, fmt.Errorf("read chart for revision %s: %w", revision.ID, err)
	}
	return s.objects.write(kindChart, []byte(chart))
}

func (s *Service) assetRef(ctx context.Context, tx *sql.Tx, hash string) (ObjectRef, error) {
	if validObjectName(hash) {
		if ref, ok := readExisting(s.objects.objectPath(kindAsset, hash), hash); ok {
			return ref, nil
		}
	}
	var bytes []byte
	if err := tx.QueryRowContext(ctx, `SELECT bytes FROM assets WHERE hash = ?`, hash).Scan(&bytes); err != nil {
		return ObjectRef{}, fmt.Errorf("read asset %s: %w", hash, err)
	}
	return s.objects.write(kindAsset, bytes)
}

func validJSON(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(fallback)
	}
	return value
}
