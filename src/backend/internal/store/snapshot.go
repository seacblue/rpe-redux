// Chart snapshot history: the append-only branch tree behind automatic backups.
//
// A snapshot is a full chart payload plus the asset manifest in effect when it
// was taken, so restoring one never depends on a later commit having kept the
// bytes. Nodes hang off a parent node, and `chart_snapshot_heads` records the
// node a project last restored or captured. Restoring reads a node, writes it
// back as the project's chart, and appends the pre-restore chart as a sibling
// node so returning to it is another ordinary restore rather than an undo.

package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Snapshot reason values. The reason tells the history list why a node exists;
// it never changes retention.
const (
	// SnapshotReasonAuto is an automatic backup taken while the chart was dirty.
	SnapshotReasonAuto = "auto"
	// SnapshotReasonRestore is the chart that was replaced by a restore.
	SnapshotReasonRestore = "restore"
	// SnapshotReasonManual is an explicit capture from the restore dialog.
	SnapshotReasonManual = "manual"
)

// snapshotReasonAllowed pins the reason values the service accepts.
var snapshotReasonAllowed = map[string]bool{
	SnapshotReasonAuto:    true,
	SnapshotReasonRestore: true,
	SnapshotReasonManual:  true,
}

// ChartSnapshot is one stored node in a project's snapshot tree without its
// chart payload.
type ChartSnapshot struct {
	ID         string `json:"id"`
	ProjectID  string `json:"projectId"`
	ParentID   string `json:"parentId,omitempty"`
	Reason     string `json:"reason"`
	Label      string `json:"label"`
	CreatedAt  string `json:"createdAt"`
	Size       int    `json:"size"`
	NoteCount  int    `json:"noteCount"`
	EventCount int    `json:"eventCount"`
	// EditSeconds is how long the project had been charted when this node was
	// taken. A node from before the field existed reports zero.
	EditSeconds int `json:"editSeconds"`
}

// ChartSnapshotFull augments a node with the verbatim chart JSON.
type ChartSnapshotFull struct {
	ChartSnapshot
	Chart json.RawMessage `json:"chart"`
}

// ChartSnapshotHistory is a project's snapshot tree with its current head.
type ChartSnapshotHistory struct {
	Snapshots []ChartSnapshot `json:"snapshots"`
	HeadID    string          `json:"headId,omitempty"`
}

// CreateChartSnapshotInput describes one node to append.
type CreateChartSnapshotInput struct {
	ProjectID string
	Chart     []byte
	// ParentID is the node this snapshot continues from; empty continues the
	// project's current head. `AdvanceHead` decides which node becomes head.
	ParentID string
	// Assets replaces the snapshot manifest. Nil copies the project's current
	// manifest, which is what an automatic backup wants.
	Assets []AssetMapping
	Reason string
	Label  string
	// AdvanceHead moves the project head onto the new node. A restore does not:
	// the chart it reinstates becomes the head by being committed.
	AdvanceHead bool
	// Dedupe returns the current head instead of appending when the new chart and
	// manifest are identical to it. An automatic backup sets this so an idle chart
	// cannot fill the retention window with copies of itself.
	Dedupe bool
	// Retain keeps only the newest N nodes for the project when positive.
	Retain int
	// EditSeconds is the project's charting time when the node was taken, so a
	// backup list can show how much work it represents.
	EditSeconds int
}

// chartSnapshotColumns is the shared summary projection.
const chartSnapshotColumns = `id, project_id, COALESCE(parent_id, ''), reason, label,
    created_at, size, note_count, event_count, edit_seconds`

// NormalizeSnapshotReason returns a supported reason, defaulting to an automatic
// backup for an unknown value instead of rejecting the write.
func NormalizeSnapshotReason(reason string) string {
	return normalizeSnapshotReason(reason)
}

// normalizeSnapshotReason falls back to an automatic backup for an unknown
// reason instead of rejecting a write.
func normalizeSnapshotReason(reason string) string {
	reason = strings.TrimSpace(reason)
	if snapshotReasonAllowed[reason] {
		return reason
	}
	return SnapshotReasonAuto
}

// CreateChartSnapshot appends one node, optionally advancing the project head,
// and prunes the project to the requested retention.
func (s *Store) CreateChartSnapshot(
	ctx context.Context,
	in CreateChartSnapshotInput,
) (*ChartSnapshot, error) {
	chart, err := normalizeChart(in.Chart)
	if err != nil {
		return nil, err
	}
	meta := extractMeta(chart)
	hash := sha256Hex(chart)
	reason := normalizeSnapshotReason(in.Reason)

	id, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate snapshot id: %w", err)
	}
	now := nowString()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE id = ?`, in.ProjectID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("verify project: %w", err)
	}
	if exists == 0 {
		return nil, ErrNotFound
	}

	parent := strings.TrimSpace(in.ParentID)
	head, err := chartSnapshotHead(ctx, tx, in.ProjectID)
	if err != nil {
		return nil, err
	}
	if parent == "" {
		parent = head
	}
	if parent != "" {
		// A parent from another project would splice two trees together.
		var owner string
		err := tx.QueryRowContext(ctx,
			`SELECT project_id FROM chart_snapshots WHERE id = ?`, parent).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("load snapshot parent: %w", err)
		}
		if owner != in.ProjectID {
			return nil, fmt.Errorf("snapshot parent belongs to another project")
		}
	}

	assets := in.Assets
	if assets == nil {
		current, err := projectAssetManifest(ctx, tx, in.ProjectID)
		if err != nil {
			return nil, err
		}
		assets = current
	}

	// A repeat of the head's own content adds nothing and would push real history
	// out of the retention window, so it returns the existing node. The comparison
	// is the stored chart hash plus the recorded manifest, not the reason, so an
	// untouched autosave after a restore does not duplicate the restored node.
	if in.Dedupe && parent != "" && parent == head {
		same, err := chartSnapshotMatches(ctx, tx, parent, hash, assets)
		if err != nil {
			return nil, err
		}
		if same {
			if err := tx.Commit(); err != nil {
				return nil, fmt.Errorf("commit snapshot: %w", err)
			}
			return s.GetChartSnapshotSummary(ctx, parent)
		}
	}

	if _, err := tx.ExecContext(ctx, `
        INSERT INTO chart_snapshots
            (id, project_id, parent_id, reason, label, chart, size, chart_hash,
             note_count, event_count, edit_seconds, created_at)
        VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.ProjectID, parent, reason, strings.TrimSpace(in.Label),
		string(chart), len(chart), hash, meta.NoteCount, meta.EventCount,
		max(in.EditSeconds, 0), now); err != nil {
		return nil, fmt.Errorf("insert snapshot: %w", err)
	}

	if err := snapshotChartAssets(ctx, tx, id, assets); err != nil {
		return nil, err
	}
	if in.AdvanceHead {
		if err := setChartSnapshotHead(ctx, tx, in.ProjectID, id, now); err != nil {
			return nil, err
		}
	}
	if in.Retain > 0 {
		if err := pruneChartSnapshots(ctx, tx, in.ProjectID, in.Retain); err != nil {
			return nil, err
		}
	}
	// A pruned node may have owned the only reference to some bytes.
	if err := gcAssets(ctx, tx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit snapshot: %w", err)
	}
	return s.GetChartSnapshotSummary(ctx, id)
}

// ListChartSnapshots returns a project's nodes newest first together with the
// current head.
func (s *Store) ListChartSnapshots(
	ctx context.Context,
	projectID string,
	limit int,
) (*ChartSnapshotHistory, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE id = ?`, projectID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("verify project: %w", err)
	}
	if exists == 0 {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `
        SELECT `+chartSnapshotColumns+`
        FROM chart_snapshots WHERE project_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	defer rows.Close()

	out := make([]ChartSnapshot, 0)
	for rows.Next() {
		snapshot, err := scanChartSnapshot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, snapshot)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate snapshots: %w", err)
	}
	head, err := chartSnapshotHeadRead(ctx, s.db, projectID)
	if err != nil {
		return nil, err
	}
	return &ChartSnapshotHistory{Snapshots: out, HeadID: head}, nil
}

// GetChartSnapshotSummary loads one node without its payload.
func (s *Store) GetChartSnapshotSummary(ctx context.Context, id string) (*ChartSnapshot, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+chartSnapshotColumns+` FROM chart_snapshots WHERE id = ?`, id)
	snapshot, err := scanChartSnapshot(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}

// GetChartSnapshot loads one node with its chart payload.
func (s *Store) GetChartSnapshot(ctx context.Context, id string) (*ChartSnapshotFull, error) {
	var (
		snapshot ChartSnapshot
		parent   string
		chart    string
	)
	err := s.db.QueryRowContext(ctx, `
        SELECT `+chartSnapshotColumns+`, chart
        FROM chart_snapshots WHERE id = ?`, id).
		Scan(&snapshot.ID, &snapshot.ProjectID, &parent, &snapshot.Reason,
			&snapshot.Label, &snapshot.CreatedAt, &snapshot.Size,
			&snapshot.NoteCount, &snapshot.EventCount, &snapshot.EditSeconds, &chart)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load snapshot: %w", err)
	}
	snapshot.ParentID = parent
	return &ChartSnapshotFull{
		ChartSnapshot: snapshot,
		Chart:         json.RawMessage(chart),
	}, nil
}

// DeleteChartSnapshot removes one node. Children keep their rows and lose the
// parent link, so a tree degrades into a list instead of losing history.
func (s *Store) DeleteChartSnapshot(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM chart_snapshots WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete snapshot: %w", err)
	}
	removed, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete snapshot: %w", err)
	}
	if removed == 0 {
		return ErrNotFound
	}
	if err := gcAssets(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete snapshot: %w", err)
	}
	return nil
}

// RestoreChartSnapshot makes one node the project's chart.
//
// The chart currently on the project is appended as a `restore` node first, so
// the chart a restore replaces stays reachable in the tree. The head then moves
// onto the restored node, so the next backup continues from it: a restore is a
// fork, and restoring the recorded node returns to the branch that was left.
func (s *Store) RestoreChartSnapshot(
	ctx context.Context,
	snapshotID string,
) (*ChartSnapshot, error) {
	snapshot, err := s.GetChartSnapshot(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin restore: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var (
		currentChart       string
		currentHash        string
		currentRevision    int
		currentName        string
		currentCharter     string
		currentComposer    string
		currentLevel       string
		currentBackground  string
		currentThumbnail   string
		currentSong        string
		currentEditSeconds int
	)
	err = tx.QueryRowContext(ctx, `
        SELECT chart, chart_hash, revision, name, charter, composer, level,
               background, thumbnail, song, edit_seconds
        FROM projects WHERE id = ?`, snapshot.ProjectID).
		Scan(&currentChart, &currentHash, &currentRevision, &currentName,
			&currentCharter, &currentComposer, &currentLevel,
			&currentBackground, &currentThumbnail, &currentSong,
			&currentEditSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}

	now := nowString()
	restoredHash := sha256Hex(snapshot.Chart)
	// Keep the chart this restore replaces. An identical chart adds nothing and
	// would repeat the same node on every restore of the same target.
	if sha256Hex([]byte(currentChart)) != restoredHash {
		pre, err := newID()
		if err != nil {
			return nil, fmt.Errorf("generate restore snapshot id: %w", err)
		}
		replacedHash := sha256Hex([]byte(currentChart))
		meta := extractMeta([]byte(currentChart))
		head, err := chartSnapshotHead(ctx, tx, snapshot.ProjectID)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO chart_snapshots
                (id, project_id, parent_id, reason, label, chart, size, chart_hash,
                 note_count, event_count, edit_seconds, created_at)
            VALUES (?, ?, NULLIF(?, ''), ?, '', ?, ?, ?, ?, ?, ?, ?)`,
			pre, snapshot.ProjectID, head, SnapshotReasonRestore,
			currentChart, len(currentChart), replacedHash,
			meta.NoteCount, meta.EventCount, currentEditSeconds, now); err != nil {
			return nil, fmt.Errorf("record replaced chart: %w", err)
		}
		currentAssets, err := projectAssetManifest(ctx, tx, snapshot.ProjectID)
		if err != nil {
			return nil, err
		}
		if err := snapshotChartAssets(ctx, tx, pre, currentAssets); err != nil {
			return nil, err
		}
	}

	meta := extractMeta(snapshot.Chart)
	if _, err := tx.ExecContext(ctx, `
        UPDATE projects SET
            chart = ?, size = ?, chart_hash = ?, revision = ?,
            charter = ?, composer = ?, level = ?,
            note_count = ?, event_count = ?, chart_index = '',
            updated_at = ?
        WHERE id = ?`,
		string(snapshot.Chart), len(snapshot.Chart), sha256Hex(snapshot.Chart),
		currentRevision+1, meta.Charter, meta.Composer, meta.Level,
		meta.NoteCount, meta.EventCount, now, snapshot.ProjectID); err != nil {
		return nil, fmt.Errorf("restore project chart: %w", err)
	}

	// The restored chart's assets become the project manifest. Every snapshot
	// stores the complete manifest it was taken with, so this restores the
	// resource set of that moment; a name added later is not part of it.
	var assets []AssetMapping
	rows, err := tx.QueryContext(ctx,
		`SELECT name, hash FROM chart_snapshot_assets WHERE snapshot_id = ? ORDER BY name`,
		snapshotID)
	if err != nil {
		return nil, fmt.Errorf("load snapshot assets: %w", err)
	}
	for rows.Next() {
		var asset AssetMapping
		if err := rows.Scan(&asset.Name, &asset.Hash); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan snapshot asset: %w", err)
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate snapshot assets: %w", err)
	}
	rows.Close()
	if err := replaceProjectAssets(ctx, tx, snapshot.ProjectID, assets, now); err != nil {
		return nil, err
	}
	if err := setChartSnapshotHead(ctx, tx, snapshot.ProjectID, snapshotID, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit restore: %w", err)
	}
	return s.GetChartSnapshotSummary(ctx, snapshotID)
}

// chartSnapshotMatches reports whether one node already holds this chart and
// manifest, which makes a new node a duplicate of existing history.
func chartSnapshotMatches(
	ctx context.Context,
	tx *sql.Tx,
	snapshotID string,
	hash string,
	assets []AssetMapping,
) (bool, error) {
	var storedHash string
	err := tx.QueryRowContext(ctx,
		`SELECT chart_hash FROM chart_snapshots WHERE id = ?`, snapshotID).Scan(&storedHash)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read snapshot hash: %w", err)
	}
	if storedHash != hash {
		return false, nil
	}
	var recorded []AssetMapping
	rows, err := tx.QueryContext(ctx,
		`SELECT name, hash FROM chart_snapshot_assets WHERE snapshot_id = ? ORDER BY name`,
		snapshotID)
	if err != nil {
		return false, fmt.Errorf("read snapshot assets: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var asset AssetMapping
		if err := rows.Scan(&asset.Name, &asset.Hash); err != nil {
			return false, fmt.Errorf("scan snapshot asset: %w", err)
		}
		recorded = append(recorded, asset)
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate snapshot assets: %w", err)
	}
	return sameAssetManifest(recorded, assets), nil
}

// scanChartSnapshot reads one `chartSnapshotColumns` row.
func scanChartSnapshot(row interface {
	Scan(dest ...any) error
}) (ChartSnapshot, error) {
	var snapshot ChartSnapshot
	if err := row.Scan(&snapshot.ID, &snapshot.ProjectID, &snapshot.ParentID,
		&snapshot.Reason, &snapshot.Label, &snapshot.CreatedAt, &snapshot.Size,
		&snapshot.NoteCount, &snapshot.EventCount, &snapshot.EditSeconds); err != nil {
		return ChartSnapshot{}, err
	}
	return snapshot, nil
}

// chartSnapshotHead reads a project head inside a transaction.
func chartSnapshotHead(ctx context.Context, tx *sql.Tx, projectID string) (string, error) {
	var id string
	err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(snapshot_id, '') FROM chart_snapshot_heads WHERE project_id = ?`,
		projectID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load snapshot head: %w", err)
	}
	return id, nil
}

// chartSnapshotHeadRead reads a project head from a queryer.
func chartSnapshotHeadRead(
	ctx context.Context,
	db interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	projectID string,
) (string, error) {
	var id string
	err := db.QueryRowContext(ctx,
		`SELECT COALESCE(snapshot_id, '') FROM chart_snapshot_heads WHERE project_id = ?`,
		projectID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load snapshot head: %w", err)
	}
	return id, nil
}

// setChartSnapshotHead points a project at one node.
func setChartSnapshotHead(ctx context.Context, tx *sql.Tx, projectID, snapshotID, now string) error {
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO chart_snapshot_heads (project_id, snapshot_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
            snapshot_id = excluded.snapshot_id, updated_at = excluded.updated_at`,
		projectID, snapshotID, now); err != nil {
		return fmt.Errorf("store snapshot head: %w", err)
	}
	return nil
}

// snapshotChartAssets records which blobs a node used.
//
// Attaching a blob to a snapshot ends any staging lease on it: the bytes are now
// referenced, so pruning the snapshot is the only thing that may reclaim them.
func snapshotChartAssets(
	ctx context.Context,
	tx *sql.Tx,
	snapshotID string,
	assets []AssetMapping,
) error {
	for _, asset := range assets {
		name, err := cleanAssetName(asset.Name)
		if err != nil {
			return err
		}
		var exists int
		if err := tx.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM assets WHERE hash = ?`, asset.Hash).Scan(&exists); err != nil {
			return fmt.Errorf("verify asset %q: %w", name, err)
		}
		if exists == 0 {
			return fmt.Errorf("asset %q references unknown blob %s", name, asset.Hash)
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE assets SET staged_at = '', staged_by = ''
             WHERE hash = ? AND staged_at != ''`, asset.Hash); err != nil {
			return fmt.Errorf("release asset lease for %q: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO chart_snapshot_assets (snapshot_id, name, hash)
            VALUES (?, ?, ?)
            ON CONFLICT(snapshot_id, name) DO UPDATE SET hash = excluded.hash`,
			snapshotID, name, asset.Hash); err != nil {
			return fmt.Errorf("snapshot asset %q: %w", name, err)
		}
	}
	return nil
}

// pruneChartSnapshots keeps only the newest `limit` nodes of one project.
func pruneChartSnapshots(ctx context.Context, tx *sql.Tx, projectID string, limit int) error {
	if _, err := tx.ExecContext(ctx, `
        DELETE FROM chart_snapshots
        WHERE project_id = ?1
          AND id NOT IN (
            SELECT id FROM chart_snapshots
            WHERE project_id = ?1
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?2
          )`, projectID, limit); err != nil {
		return fmt.Errorf("prune snapshots: %w", err)
	}
	return nil
}
