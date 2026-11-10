// SQLite persistence for the chart library: the v1 schema, projects, and
// immutable revisions, including the row mapping and transaction helpers.

package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("not found")

// RevisionConflictError reports an optimistic-concurrency miss. The caller can
// retry against CurrentRevision after deciding how to merge the local chart.
type RevisionConflictError struct {
	CurrentRevision int
}

// Error reports the revision the caller must reload before retrying.
func (e *RevisionConflictError) Error() string {
	return fmt.Sprintf("chart revision changed (%d)", e.CurrentRevision)
}

// schemaVersion is the library layout this build creates and expects. Older
// databases are not migrated wholesale, but initSchema adds columns that can
// be introduced without rewriting existing rows.
const schemaVersion = 1

// timeLayout is the canonical timestamp format (RFC3339, UTC).
const timeLayout = time.RFC3339

// Project is a stored chart-library entry without its chart payload.
//
// Revision increments only when the chart, its asset manifest, or the stored
// workspace state changes. Metadata-only edits leave it alone so a save can use
// it as an optimistic-concurrency token without fighting renames.
type Project struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Group    string `json:"group"`
	Archived bool   `json:"archived"`
	Charter  string `json:"charter"`
	Composer string `json:"composer"`
	Level    string `json:"level"`

	// Background and Song are asset names resolved at write time so a library
	// listing can draw the cover and preview the music without loading the chart
	// payload.
	Background   string          `json:"background"`
	Song         string          `json:"song"`
	NoteCount    int             `json:"noteCount"`
	Revision     int             `json:"revision"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
	Size         int             `json:"size"`
	ViewState    json.RawMessage `json:"viewState,omitempty"`
	AssetFolders []string        `json:"assetFolders,omitempty"`
}

// Asset is a content-addressed blob owned by the asset table.
type Asset struct {
	Name string `json:"name"`
	Hash string `json:"hash"`
	Size int    `json:"size"`
}

// AssetMapping attaches a staged blob to a project by name.
type AssetMapping struct {
	Name string `json:"name"`
	Hash string `json:"hash"`
}

// ProjectFull augments a Project with the verbatim chart JSON object.
type ProjectFull struct {
	Project
	Chart json.RawMessage `json:"chart"`
}

// Revision is a stored version snapshot; Chart is the verbatim JSON object.
type Revision struct {
	ID        string          `json:"id"`
	ProjectID string          `json:"projectId"`
	Label     string          `json:"label"`
	CreatedAt string          `json:"createdAt"`
	Size      int             `json:"size"`
	Chart     json.RawMessage `json:"chart"`
}

// RevisionSummary is a Revision without its payload.
type RevisionSummary struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Label     string `json:"label"`
	CreatedAt string `json:"createdAt"`
	Size      int    `json:"size"`
}

// Store owns the SQLite connection and all persistence operations.
type Store struct {
	db   *sql.DB
	Path string
}

// Open opens (creating if needed) the SQLite database at path, applying the
// required PRAGMAs and creating the v1 schema.
func Open(path string) (*Store, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve db path: %w", err)
	}
	if dir := filepath.Dir(abs); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

	// A plain filename keeps Windows drive paths native. The sqlite driver
	// removes the query suffix before opening the file and still consumes the
	// underscore-prefixed pragmas.
	dsn := abs + "?" + strings.Join([]string{
		"_pragma=journal_mode(WAL)",
		"_pragma=busy_timeout(15000)",
		"_pragma=foreign_keys(ON)",
		"_pragma=synchronous(NORMAL)",
	}, "&")

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// A single writer removes SQLITE_BUSY races between concurrent handlers.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	s := &Store{db: db, Path: abs}
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	if err := s.initSchema(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the database handle.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// initSchema creates the v1 library schema when it is absent and applies the
// additive columns this build expects. It does not migrate an older layout.
func (s *Store) initSchema(ctx context.Context) error {
	const schema = `
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    grp           TEXT NOT NULL DEFAULT '',
    archived      INTEGER NOT NULL DEFAULT 0,
    charter       TEXT NOT NULL DEFAULT '',
    composer      TEXT NOT NULL DEFAULT '',
    level         TEXT NOT NULL DEFAULT '',
    note_count    INTEGER NOT NULL DEFAULT 0,
    chart         TEXT NOT NULL DEFAULT '{}',
    chart_index   TEXT NOT NULL DEFAULT '',
    size          INTEGER NOT NULL DEFAULT 0,
    revision      INTEGER NOT NULL DEFAULT 1,
    chart_hash    TEXT NOT NULL DEFAULT '',
    view_state    TEXT NOT NULL DEFAULT '{}',
    asset_folders TEXT NOT NULL DEFAULT '[]',
    background    TEXT NOT NULL DEFAULT '',
    song          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_archived   ON projects(archived);

CREATE TABLE IF NOT EXISTS revisions (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    chart      TEXT NOT NULL DEFAULT '{}',
    chart_index TEXT NOT NULL DEFAULT '',
    size       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS preferences (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    hash       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    bytes      BLOB NOT NULL,
    created_at TEXT NOT NULL,
    staged_at  TEXT NOT NULL DEFAULT '',
    staged_by  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_assets (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    hash       TEXT NOT NULL REFERENCES assets(hash),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_project_assets_hash ON project_assets(hash);

CREATE TABLE IF NOT EXISTS revision_assets (
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    hash        TEXT NOT NULL REFERENCES assets(hash),
    PRIMARY KEY(revision_id, name)
);
CREATE INDEX IF NOT EXISTS idx_revision_assets_hash ON revision_assets(hash);`
	if _, err := s.db.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("create v%d schema: %w", schemaVersion, err)
	}
	if err := s.ensureAssetStagingColumn(ctx); err != nil {
		return err
	}
	if err := s.ensureChartIndexColumns(ctx); err != nil {
		return err
	}
	return nil
}

// ensureAssetStagingColumn adds the staging lease fields to libraries created
// before they existed. Unreferenced rows inherit their creation time so the
// first GC pass gives them the same grace period as a fresh stage; referenced
// blobs need no lease and stay protected by their mappings. Updating only
// orphans also avoids rewriting every large BLOB during the upgrade.
func (s *Store) ensureAssetStagingColumn(ctx context.Context) error {
	addedStagingAt, err := s.ensureAssetColumn(ctx, "staged_at",
		`ALTER TABLE assets ADD COLUMN staged_at TEXT NOT NULL DEFAULT ''`)
	if err != nil {
		return err
	}
	if _, err := s.ensureAssetColumn(ctx, "staged_by",
		`ALTER TABLE assets ADD COLUMN staged_by TEXT NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	if !addedStagingAt {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `
        UPDATE assets SET staged_at = created_at
        WHERE staged_at = ''
          AND hash NOT IN (SELECT hash FROM project_assets)
          AND hash NOT IN (SELECT hash FROM revision_assets)`); err != nil {
		return fmt.Errorf("backfill asset staging timestamps: %w", err)
	}
	return nil
}

// ensureAssetColumn reports whether it added a missing column. A concurrent
// upgrade that wins the ALTER is treated as success once the column is visible.
func (s *Store) ensureAssetColumn(ctx context.Context, name, ddl string) (bool, error) {
	return s.ensureTableColumn(ctx, "assets", name, ddl)
}

// ensureChartIndexColumns adds the rebuildable line-index cache columns to
// libraries created before they existed. The columns hold a cache only; an
// empty or stale value is rebuilt on demand, and existing chart payloads are
// never rewritten.
func (s *Store) ensureChartIndexColumns(ctx context.Context) error {
	if _, err := s.ensureTableColumn(ctx, "projects", "chart_index",
		`ALTER TABLE projects ADD COLUMN chart_index TEXT NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("add projects.chart_index: %w", err)
	}
	if _, err := s.ensureTableColumn(ctx, "revisions", "chart_index",
		`ALTER TABLE revisions ADD COLUMN chart_index TEXT NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("add revisions.chart_index: %w", err)
	}
	return nil
}

// ensureTableColumn reports whether it added a missing column. A concurrent
// upgrade that wins the ALTER is treated as success once the column is visible.
func (s *Store) ensureTableColumn(ctx context.Context, table, name, ddl string) (bool, error) {
	// Table names are internal constants; rejecting anything else keeps the
	// interpolated pragma argument from becoming a query injection point.
	switch table {
	case "assets", "projects", "revisions":
	default:
		return false, fmt.Errorf("unsupported table %q", table)
	}
	columnQuery := fmt.Sprintf(
		`SELECT COUNT(*) FROM pragma_table_info('%s') WHERE name = ?`, table)
	var count int
	if err := s.db.QueryRowContext(ctx, columnQuery, name).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect %s schema: %w", table, err)
	}
	if count > 0 {
		return false, nil
	}
	if _, err := s.db.ExecContext(ctx, ddl); err != nil {
		// Another process may have added the column between the check and the
		// ALTER; only report the failure when the column is still absent.
		var exists int
		if probeErr := s.db.QueryRowContext(ctx, columnQuery, name).Scan(&exists); probeErr != nil {
			return false, fmt.Errorf("inspect %s schema: %w", table, probeErr)
		}
		if exists == 0 {
			return false, fmt.Errorf("add %s column %s: %w", table, name, err)
		}
		return false, nil
	}
	return true, nil
}

// Checkpoint flushes the WAL so the native backup command can copy a coherent
// main database file without stopping the service.
func (s *Store) Checkpoint(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return fmt.Errorf("checkpoint sqlite: %w", err)
	}
	return nil
}

// nowString returns the current time as an RFC3339 UTC timestamp.
func nowString() string {
	return time.Now().UTC().Format(timeLayout)
}

// newID returns a random UUID v4 string.
func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	buf := make([]byte, 36)
	hex.Encode(buf[0:8], b[0:4])
	buf[8] = '-'
	hex.Encode(buf[9:13], b[4:6])
	buf[13] = '-'
	hex.Encode(buf[14:18], b[6:8])
	buf[18] = '-'
	hex.Encode(buf[19:23], b[8:10])
	buf[23] = '-'
	hex.Encode(buf[24:36], b[10:16])
	return string(buf), nil
}

// sha256Hex is the stable content id for charts and assets.
func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// cleanAssetName keeps names relative and portable. The bytes live in SQLite,
// so this is not a filesystem sandbox; it prevents a chart from inventing an
// absolute or parent-relative name that would later escape an export folder.
func cleanAssetName(name string) (string, error) {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if name == "" || len(name) > 512 {
		return "", errors.New("asset name must be 1..512 characters")
	}
	if strings.HasPrefix(name, "/") {
		return "", errors.New("asset name must be relative")
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("asset name must not contain empty, . or .. segments")
		}
		for _, r := range part {
			if r < 0x20 || r == 0x7f {
				return "", errors.New("asset name must not contain control characters")
			}
		}
	}
	return name, nil
}

// compactJSON validates and canonicalizes a JSON object for comparison.
func compactJSON(raw []byte, fallback string) ([]byte, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		trimmed = fallback
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("value must be valid JSON")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &object); err != nil {
		return nil, errors.New("value must be a JSON object")
	}
	var out bytes.Buffer
	if err := json.Compact(&out, []byte(trimmed)); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// normalizeChart guarantees a valid JSON object payload, defaulting to {}.
func normalizeChart(raw json.RawMessage) ([]byte, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return []byte("{}"), nil
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("chart must be valid JSON")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &object); err != nil {
		return nil, errors.New("chart must be a JSON object")
	}
	return []byte(trimmed), nil
}

// chartMeta is the searchable metadata extracted from a chart document.
type chartMeta struct {
	Charter    string
	Composer   string
	Level      string
	Background string
	Song       string
	NoteCount  int
}

// metaString tolerates numbers and other scalars in string-valued fields.
func metaString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	case float64:
		return strconvFormat(t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

// strconvFormat renders a float without a trailing zero fraction.
func strconvFormat(f float64) string {
	if f == float64(int64(f)) {
		return fmt.Sprintf("%d", int64(f))
	}
	return fmt.Sprintf("%g", f)
}

// metaInt tolerates numeric strings and float encodings.
func metaInt(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case string:
		var f float64
		if _, err := fmt.Sscanf(strings.TrimSpace(t), "%g", &f); err == nil {
			return int(f)
		}
	}
	return 0
}

// extractMeta reads searchable fields from a chart object, tolerating any shape.
func extractMeta(chart json.RawMessage) chartMeta {
	var m chartMeta
	if len(chart) == 0 {
		return m
	}
	var root map[string]any
	if err := json.Unmarshal(chart, &root); err != nil {
		return m
	}
	meta, _ := root["META"].(map[string]any)
	lineList, _ := root["judgeLineList"].([]any)

	sum := 0
	found := false
	for _, line := range lineList {
		lm, ok := line.(map[string]any)
		if !ok {
			continue
		}
		notes, ok := lm["notes"].([]any)
		if !ok {
			continue
		}
		found = true
		sum += len(notes)
	}
	if found {
		m.NoteCount = sum
	} else if meta != nil {
		m.NoteCount = metaInt(meta["numOfNotes"])
	}
	if meta != nil {
		m.Charter = metaString(meta["charter"])
		m.Composer = metaString(meta["composer"])
		m.Level = metaString(meta["level"])
		m.Background = metaString(meta["background"])
		m.Song = metaString(meta["song"])
	}
	return m
}

// imageAssetPattern matches the formats the library can draw as a cover.
var imageAssetPattern = regexp.MustCompile(`(?i)\.(png|jpe?g|webp|gif|bmp|avif)$`)

// audioAssetPattern matches the formats the welcome page can preview.
var audioAssetPattern = regexp.MustCompile(`(?i)\.(mp3|ogg|wav|m4a|flac|aac|opus|weba|webm)$`)

// chartBackground returns the cover reference for a chart. A chart without an
// explicit META.background falls back to its first image asset so the library
// grid still has a cover.
func chartBackground(meta chartMeta, assets []AssetMapping) string {
	if meta.Background != "" {
		return meta.Background
	}
	for _, asset := range assets {
		if imageAssetPattern.MatchString(asset.Name) {
			return asset.Name
		}
	}
	return ""
}

// chartSong returns the audio reference for a chart. A chart without an
// explicit META.song falls back to its first audio asset so imported projects
// stay previewable without explicit metadata.
func chartSong(meta chartMeta, assets []AssetMapping) string {
	if meta.Song != "" {
		return meta.Song
	}
	for _, asset := range assets {
		if audioAssetPattern.MatchString(asset.Name) {
			return asset.Name
		}
	}
	return ""
}

// CreateProjectInput describes a new project.
type CreateProjectInput struct {
	Name         string
	Group        string
	Chart        json.RawMessage
	Assets       []AssetMapping
	ViewState    json.RawMessage
	AssetFolders []string
}

// CreateProject inserts a project and returns its full representation.
func (s *Store) CreateProject(ctx context.Context, in CreateProjectInput) (*ProjectFull, error) {
	id, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate id: %w", err)
	}
	chart, err := normalizeChart(in.Chart)
	if err != nil {
		return nil, err
	}
	viewState, err := compactJSON(in.ViewState, "{}")
	if err != nil {
		return nil, fmt.Errorf("view state: %w", err)
	}
	assetFolders, err := json.Marshal(nonNilStrings(in.AssetFolders))
	if err != nil {
		return nil, fmt.Errorf("asset folders: %w", err)
	}
	meta := extractMeta(chart)
	background := chartBackground(meta, in.Assets)
	song := chartSong(meta, in.Assets)
	now := nowString()
	hash := sha256Hex(chart)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create project: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
        INSERT INTO projects
            (id, name, grp, archived, charter, composer, level, background, song, note_count, chart,
             size, revision, chart_hash, view_state, asset_folders, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
		id, strings.TrimSpace(in.Name), in.Group, meta.Charter, meta.Composer,
		meta.Level, background, song, meta.NoteCount, string(chart), len(chart), hash,
		string(viewState), string(assetFolders), now, now); err != nil {
		return nil, fmt.Errorf("insert project: %w", err)
	}
	if err := replaceProjectAssets(ctx, tx, id, in.Assets, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit project: %w", err)
	}
	return s.GetProject(ctx, id)
}

// nonNilStrings keeps JSON output as [] rather than null for empty lists.
func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// projectColumns is the metadata column list shared by every project query.
const projectColumns = `id, name, grp, archived, charter, composer, level, background, song,
    note_count, revision, size, view_state, asset_folders, created_at, updated_at`

// scanProject scans a project row. When withChart is true the query must also
// select the chart column, which is returned verbatim.
func scanProject(sc interface{ Scan(...any) error }, withChart bool) (*Project, []byte, error) {
	var (
		p            Project
		archived     int
		viewState    string
		assetFolders string
		chart        []byte
	)
	dest := []any{&p.ID, &p.Name, &p.Group, &archived, &p.Charter, &p.Composer,
		&p.Level, &p.Background, &p.Song, &p.NoteCount, &p.Revision, &p.Size, &viewState,
		&assetFolders, &p.CreatedAt, &p.UpdatedAt}
	if withChart {
		dest = append(dest, &chart)
	}
	if err := sc.Scan(dest...); err != nil {
		return nil, nil, err
	}
	p.Archived = archived != 0
	p.ViewState = json.RawMessage(compactOr(viewState, "{}"))
	if err := json.Unmarshal([]byte(assetFolders), &p.AssetFolders); err != nil {
		p.AssetFolders = []string{}
	}
	return &p, chart, nil
}

// compactOr returns a compact JSON value or the fallback when it is unusable.
func compactOr(value, fallback string) string {
	var out bytes.Buffer
	if json.Valid([]byte(value)) && json.Compact(&out, []byte(value)) == nil {
		return out.String()
	}
	return fallback
}

// projectExists reports whether an id names a stored project.
func projectExists(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (bool, error) {
	var found int
	if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects WHERE id = ?`, id).Scan(&found); err != nil {
		return false, err
	}
	return found > 0, nil
}

// projectRevision reads the current optimistic-concurrency token.
func projectRevision(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (int, error) {
	var revision int
	err := q.QueryRowContext(ctx, `SELECT revision FROM projects WHERE id = ?`, id).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return revision, err
}

// replaceProjectAssets validates a complete manifest and rewrites only the
// mappings that differ. The bytes themselves were staged earlier and are shared
// by content hash across projects and revisions. Attaching clears the lease
// held by this project; a lease another project took for the same bytes remains
// so its own later commit can still promote them.
func replaceProjectAssets(
	ctx context.Context,
	tx *sql.Tx,
	projectID string,
	assets []AssetMapping,
	now string,
) error {
	seen := make(map[string]string, len(assets))
	for _, asset := range assets {
		name, err := cleanAssetName(asset.Name)
		if err != nil {
			return fmt.Errorf("asset %q: %w", asset.Name, err)
		}
		if asset.Hash == "" {
			return fmt.Errorf("asset %q has no hash", name)
		}
		if previous, ok := seen[name]; ok {
			return fmt.Errorf("asset %q is listed twice (and the previous hash is %q)", name, previous)
		}
		seen[name] = asset.Hash
	}

	current := map[string]string{}
	rows, err := tx.QueryContext(ctx, `SELECT name, hash FROM project_assets WHERE project_id = ?`, projectID)
	if err != nil {
		return fmt.Errorf("load project assets: %w", err)
	}
	for rows.Next() {
		var name, hash string
		if err := rows.Scan(&name, &hash); err != nil {
			rows.Close()
			return fmt.Errorf("scan project asset: %w", err)
		}
		current[name] = hash
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate project assets: %w", err)
	}
	rows.Close()

	for name := range current {
		if _, keep := seen[name]; !keep {
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM project_assets WHERE project_id = ? AND name = ?`, projectID, name); err != nil {
				return fmt.Errorf("remove project asset %q: %w", name, err)
			}
		}
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		hash := seen[name]
		if current[name] == hash {
			continue
		}
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM assets WHERE hash = ?`, hash).Scan(&exists); err != nil {
			return fmt.Errorf("verify asset %q: %w", name, err)
		}
		if exists == 0 {
			return fmt.Errorf("asset %q references unknown blob %s", name, hash)
		}
		if _, err := tx.ExecContext(ctx, `
            UPDATE assets SET staged_at = '', staged_by = ''
            WHERE hash = ? AND (staged_by = ? OR staged_by = '')`, hash, projectID); err != nil {
			return fmt.Errorf("mark asset %q referenced: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO project_assets (project_id, name, hash, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id, name) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`,
			projectID, name, hash, now); err != nil {
			return fmt.Errorf("attach asset %q: %w", name, err)
		}
	}
	return nil
}

// copyProjectAssets clones the manifest without copying blob bytes.
func copyProjectAssets(ctx context.Context, tx *sql.Tx, from, to, now string) error {
	_, err := tx.ExecContext(ctx, `
        INSERT INTO project_assets (project_id, name, hash, updated_at)
        SELECT ?, name, hash, ? FROM project_assets WHERE project_id = ?`,
		to, now, from)
	if err != nil {
		return fmt.Errorf("copy project assets: %w", err)
	}
	return nil
}

// GetProject loads one project with its chart payload.
func (s *Store) GetProject(ctx context.Context, id string) (*ProjectFull, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+projectColumns+`, chart FROM projects WHERE id = ?`, id)
	p, chart, err := scanProject(row, true)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}
	return &ProjectFull{Project: *p, Chart: json.RawMessage(chart)}, nil
}

// ListProjectsInput filters and orders a project listing.
type ListProjectsInput struct {
	Search    string
	Group     string
	Archived  string // "all" | "true" | "false"
	Sort      string // "created" | "updated" | "name" | "composer" | "charter"
	Direction string // "asc" | "desc"
	Limit     int
	Offset    int
}

// ListProjects returns matching summaries plus the pre-pagination total.
func (s *Store) ListProjects(ctx context.Context, in ListProjectsInput) ([]Project, int, error) {
	where := []string{"1=1"}
	args := []any{}

	if q := strings.TrimSpace(in.Search); q != "" {
		like := "%" + strings.ToLower(q) + "%"
		where = append(where, `(LOWER(name) LIKE ? OR LOWER(charter) LIKE ? OR LOWER(composer) LIKE ? OR LOWER(level) LIKE ?)`)
		args = append(args, like, like, like, like)
	}
	if g := strings.TrimSpace(in.Group); g != "" {
		where = append(where, "grp = ?")
		args = append(args, g)
	}
	switch strings.ToLower(strings.TrimSpace(in.Archived)) {
	case "", "all":
		// no filter
	case "true":
		where = append(where, "archived = 1")
	case "false":
		where = append(where, "archived = 0")
	default:
		return nil, 0, errors.New("archived must be one of all|true|false")
	}

	clause := strings.Join(where, " AND ")

	sortColumn := "updated_at"
	switch strings.ToLower(strings.TrimSpace(in.Sort)) {
	case "", "updated":
		sortColumn = "updated_at"
	case "created":
		sortColumn = "created_at"
	case "name":
		sortColumn = "name"
	case "composer":
		sortColumn = "composer"
	case "charter":
		sortColumn = "charter"
	default:
		return nil, 0, errors.New("sort must be one of created|updated|name|composer|charter")
	}
	direction := strings.ToLower(strings.TrimSpace(in.Direction))
	if direction == "" {
		direction = "desc"
	}
	if direction != "asc" && direction != "desc" {
		return nil, 0, errors.New("direction must be asc or desc")
	}
	order := sortColumn
	if sortColumn == "name" || sortColumn == "composer" || sortColumn == "charter" {
		order += " COLLATE NOCASE"
	}
	order += " " + strings.ToUpper(direction) + ", id DESC"

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE `+clause, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count projects: %w", err)
	}

	limit := in.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}

	rows, err := s.db.QueryContext(ctx,
		`SELECT `+projectColumns+` FROM projects WHERE `+clause+
			` ORDER BY `+order+` LIMIT ? OFFSET ?`,
		append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	out := make([]Project, 0)
	for rows.Next() {
		p, _, err := scanProject(rows, false)
		if err != nil {
			return nil, 0, fmt.Errorf("scan project: %w", err)
		}
		out = append(out, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate projects: %w", err)
	}
	return out, total, nil
}

// UpdateProjectInput carries optional field updates; nil means "unchanged".
type UpdateProjectInput struct {
	Name     *string
	Group    *string
	Archived *bool
	Chart    *json.RawMessage
}

// UpdateProject applies partial updates and returns the new full project.
func (s *Store) UpdateProject(ctx context.Context, id string, in UpdateProjectInput) (*ProjectFull, error) {
	sets := []string{}
	args := []any{}

	if in.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, strings.TrimSpace(*in.Name))
	}
	if in.Group != nil {
		sets = append(sets, "grp = ?")
		args = append(args, *in.Group)
	}
	if in.Archived != nil {
		v := 0
		if *in.Archived {
			v = 1
		}
		sets = append(sets, "archived = ?")
		args = append(args, v)
	}
	if in.Chart != nil {
		chart, err := normalizeChart(*in.Chart)
		if err != nil {
			return nil, err
		}
		meta := extractMeta(chart)
		sets = append(sets,
			"chart = ?", "size = ?", "charter = ?", "composer = ?", "level = ?",
			"background = ?", "song = ?", "note_count = ?", "chart_hash = ?",
			"revision = revision + 1")
		args = append(args, string(chart), len(chart), meta.Charter, meta.Composer, meta.Level,
			meta.Background, meta.Song, meta.NoteCount, sha256Hex(chart))
	}
	if len(sets) == 0 {
		return nil, errors.New("no fields to update")
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, nowString(), id)

	res, err := s.db.ExecContext(ctx,
		`UPDATE projects SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		// Distinguish "missing row" from "no change".
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects WHERE id = ?`, id).Scan(&exists); err != nil {
			return nil, fmt.Errorf("verify project: %w", err)
		}
		if exists == 0 {
			return nil, ErrNotFound
		}
	}
	return s.GetProject(ctx, id)
}

// DeleteProject removes a project, its revisions, and any blob only it used.
func (s *Store) DeleteProject(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete project: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := gcAssets(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete project: %w", err)
	}
	return nil
}

// StageAsset stores a blob by content hash without attaching it to a project.
// The row carries a staging lease so a concurrent commit or delete cannot
// collect the bytes before the caller maps them; an interrupted save leaves
// only an expired blob rather than a half-updated chart.
func (s *Store) StageAsset(ctx context.Context, projectID, name string, data []byte) (*Asset, error) {
	clean, err := cleanAssetName(name)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errors.New("asset must not be empty")
	}
	if ok, err := projectExists(ctx, s.db, projectID); err != nil {
		return nil, fmt.Errorf("verify project: %w", err)
	} else if !ok {
		return nil, ErrNotFound
	}
	hash := sha256Hex(data)
	now := nowString()
	if _, err := s.db.ExecContext(ctx, `
        INSERT INTO assets (hash, size, bytes, created_at, staged_at, staged_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(hash) DO UPDATE SET
            staged_at = excluded.staged_at, staged_by = excluded.staged_by`,
		hash, len(data), data, now, now, projectID); err != nil {
		return nil, fmt.Errorf("stage asset: %w", err)
	}
	return &Asset{Name: clean, Hash: hash, Size: len(data)}, nil
}

// ListProjectAssets returns the current manifest, sorted by name.
func (s *Store) ListProjectAssets(ctx context.Context, projectID string) ([]Asset, error) {
	rows, err := s.db.QueryContext(ctx, `
        SELECT pa.name, pa.hash, a.size
        FROM project_assets pa JOIN assets a ON a.hash = pa.hash
        WHERE pa.project_id = ? ORDER BY pa.name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list project assets: %w", err)
	}
	defer rows.Close()
	out := make([]Asset, 0)
	for rows.Next() {
		var asset Asset
		if err := rows.Scan(&asset.Name, &asset.Hash, &asset.Size); err != nil {
			return nil, fmt.Errorf("scan project asset: %w", err)
		}
		out = append(out, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project assets: %w", err)
	}
	return out, nil
}

// OpenProjectAsset returns one asset's metadata and a range-capable reader.
// Reads go through SQLite `substr` in bounded chunks, so serving a large music
// track does not materialize the whole blob just to answer a Range request.
func (s *Store) OpenProjectAsset(ctx context.Context, projectID, name string) (*Asset, *AssetReader, error) {
	clean, err := cleanAssetName(name)
	if err != nil {
		return nil, nil, err
	}
	var asset Asset
	err = s.db.QueryRowContext(ctx, `
        SELECT pa.name, pa.hash, a.size
        FROM project_assets pa JOIN assets a ON a.hash = pa.hash
        WHERE pa.project_id = ? AND pa.name = ?`, projectID, clean).
		Scan(&asset.Name, &asset.Hash, &asset.Size)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read project asset: %w", err)
	}
	return &asset, &AssetReader{db: s.db, hash: asset.Hash, size: int64(asset.Size)}, nil
}

// OpenAssetByHash returns a range-capable reader for any locally stored blob
// whose content hash matches. Collaboration uses it to reuse an asset already
// present in the library before downloading it from a room.
func (s *Store) OpenAssetByHash(ctx context.Context, hash string) (*AssetReader, int64, error) {
	var size int64
	err := s.db.QueryRowContext(ctx, `SELECT size FROM assets WHERE hash = ?`, hash).Scan(&size)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, ErrNotFound
	}
	if err != nil {
		return nil, 0, fmt.Errorf("read asset by hash: %w", err)
	}
	return &AssetReader{db: s.db, hash: hash, size: size}, size, nil
}

// assetChunkBytes is the SQL read size behind AssetReader. It is larger than
// http.ServeContent's copy buffer so most Read calls are served from memory.
const assetChunkBytes = 256 << 10

// AssetReader implements io.ReadSeeker over a SQLite BLOB without loading it.
type AssetReader struct {
	db       *sql.DB
	hash     string
	size     int64
	pos      int64
	buffer   []byte
	bufferAt int64
}

// Read fills p from the current offset.
func (r *AssetReader) Read(p []byte) (int, error) {
	if r.pos >= r.size {
		return 0, io.EOF
	}
	if len(r.buffer) == 0 || r.pos < r.bufferAt || r.pos >= r.bufferAt+int64(len(r.buffer)) {
		length := int64(assetChunkBytes)
		if remaining := r.size - r.pos; remaining < length {
			length = remaining
		}
		var chunk []byte
		if err := r.db.QueryRow(
			`SELECT substr(bytes, ?, ?) FROM assets WHERE hash = ?`,
			r.pos+1, length, r.hash,
		).Scan(&chunk); err != nil {
			return 0, fmt.Errorf("read asset chunk: %w", err)
		}
		if len(chunk) == 0 {
			return 0, io.EOF
		}
		r.buffer = chunk
		r.bufferAt = r.pos
	}
	offset := r.pos - r.bufferAt
	n := copy(p, r.buffer[offset:])
	r.pos += int64(n)
	return n, nil
}

// Seek moves the read offset. ServeContent uses Seek(0, SeekEnd) to discover
// the size and Seek(0, SeekStart) before a full response.
func (r *AssetReader) Seek(offset int64, whence int) (int64, error) {
	var next int64
	switch whence {
	case io.SeekStart:
		next = offset
	case io.SeekCurrent:
		next = r.pos + offset
	case io.SeekEnd:
		next = r.size + offset
	default:
		return 0, errors.New("invalid seek origin")
	}
	if next < 0 {
		return 0, errors.New("negative seek offset")
	}
	r.pos = next
	if next < r.bufferAt || next > r.bufferAt+int64(len(r.buffer)) {
		r.buffer = nil
		r.bufferAt = 0
	}
	return next, nil
}

// CommitProjectInput is the atomic save boundary for a library document.
//
// Chart text arrives already serialized by the renderer so the service does not
// need to marshal the object again. Assets is the complete manifest; blobs are
// staged first and only the mappings change here.
type CommitProjectInput struct {
	ProjectID    string
	BaseRevision *int
	Name         *string
	Chart        json.RawMessage
	Assets       *[]AssetMapping
	ViewState    *json.RawMessage
	AssetFolders *[]string
	Label        string
	Snapshot     bool
}

// CommitProject updates a chart and its manifest in one transaction. A failed
// commit releases the leases it was about to promote and reclaims orphaned
// blobs, so an aborted save does not leave staged bytes behind.
func (s *Store) CommitProject(ctx context.Context, in CommitProjectInput) (project *Project, err error) {
	defer func() {
		if err != nil {
			s.releaseStagedAssets(ctx, in.ProjectID, in.Assets)
		}
	}()
	chart, err := normalizeChart(in.Chart)
	if err != nil {
		return nil, err
	}
	hash := sha256Hex(chart)
	meta := extractMeta(chart)
	now := nowString()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin project commit: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var (
		currentRevision   int
		currentHash       string
		currentChart      []byte
		currentName       string
		currentView       string
		currentFolders    string
		currentBackground string
		currentSong       string
	)
	err = tx.QueryRowContext(ctx, `
        SELECT revision, chart_hash, chart, name, view_state, asset_folders, background, song
        FROM projects WHERE id = ?`, in.ProjectID).
		Scan(&currentRevision, &currentHash, &currentChart, &currentName, &currentView,
			&currentFolders, &currentBackground, &currentSong)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}
	if in.BaseRevision != nil && *in.BaseRevision != currentRevision {
		return nil, &RevisionConflictError{CurrentRevision: currentRevision}
	}

	nextView := currentView
	if in.ViewState != nil {
		view, err := compactJSON(*in.ViewState, "{}")
		if err != nil {
			return nil, fmt.Errorf("view state: %w", err)
		}
		nextView = string(view)
	}
	nextFolders := currentFolders
	if in.AssetFolders != nil {
		encoded, err := json.Marshal(nonNilStrings(*in.AssetFolders))
		if err != nil {
			return nil, fmt.Errorf("asset folders: %w", err)
		}
		nextFolders = string(encoded)
	}
	nextName := currentName
	if in.Name != nil {
		nextName = strings.TrimSpace(*in.Name)
		if nextName == "" {
			return nil, errors.New("name must not be blank")
		}
	}
	// An explicit META.background wins. Otherwise a new manifest can supply the
	// only image asset; a metadata-only commit keeps the cover already stored.
	nextBackground := meta.Background
	if nextBackground == "" {
		nextBackground = currentBackground
		if in.Assets != nil {
			nextBackground = chartBackground(meta, *in.Assets)
		}
	}
	// The audio reference follows the same rule: an explicit META.song wins,
	// then a new manifest can name the track, and a metadata-only commit keeps
	// the song already stored.
	nextSong := meta.Song
	if nextSong == "" {
		nextSong = currentSong
		if in.Assets != nil {
			nextSong = chartSong(meta, *in.Assets)
		}
	}

	manifestChanged := false
	if in.Assets != nil {
		var current []AssetMapping
		current, err = projectAssetManifest(ctx, tx, in.ProjectID)
		if err != nil {
			return nil, err
		}
		manifestChanged = !sameAssetManifest(current, *in.Assets)
	}
	changed := manifestChanged || hash != currentHash || string(chart) != string(currentChart) ||
		nextView != compactOr(currentView, "{}") || nextFolders != currentFolders ||
		nextName != currentName
	if !changed && !in.Snapshot {
		// Release the single connection before reading the summary; the pool is
		// intentionally capped at one writer.
		_ = tx.Rollback()
		return s.GetProjectSummary(ctx, in.ProjectID)
	}

	if in.Assets != nil {
		if err := replaceProjectAssets(ctx, tx, in.ProjectID, *in.Assets, now); err != nil {
			return nil, err
		}
	}
	revision := currentRevision + 1
	if _, err := tx.ExecContext(ctx, `
        UPDATE projects SET
            name = ?, chart = ?, size = ?, charter = ?, composer = ?, level = ?,
            background = ?, song = ?, note_count = ?, chart_hash = ?, revision = ?, view_state = ?,
            asset_folders = ?, updated_at = ?
        WHERE id = ?`,
		nextName, string(chart), len(chart), meta.Charter, meta.Composer, meta.Level,
		nextBackground, nextSong, meta.NoteCount, hash, revision, nextView, nextFolders, now,
		in.ProjectID); err != nil {
		return nil, fmt.Errorf("update project: %w", err)
	}
	if in.Snapshot {
		id, err := newID()
		if err != nil {
			return nil, fmt.Errorf("generate revision id: %w", err)
		}
		label := strings.TrimSpace(in.Label)
		if label == "" {
			label = "revision"
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO revisions (id, project_id, label, chart, size, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`, id, in.ProjectID, label, string(chart), len(chart), now); err != nil {
			return nil, fmt.Errorf("insert revision: %w", err)
		}
		if in.Assets != nil {
			if err := snapshotAssets(ctx, tx, id, *in.Assets); err != nil {
				return nil, err
			}
		}
	}
	if err := gcAssets(ctx, tx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit project: %w", err)
	}
	return s.GetProjectSummary(ctx, in.ProjectID)
}

// projectAssetManifest reads the current name/hash pairs inside a transaction.
func projectAssetManifest(ctx context.Context, tx *sql.Tx, projectID string) ([]AssetMapping, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT name, hash FROM project_assets WHERE project_id = ? ORDER BY name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("load project assets: %w", err)
	}
	defer rows.Close()
	out := make([]AssetMapping, 0)
	for rows.Next() {
		var asset AssetMapping
		if err := rows.Scan(&asset.Name, &asset.Hash); err != nil {
			return nil, fmt.Errorf("scan project asset: %w", err)
		}
		out = append(out, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate project assets: %w", err)
	}
	return out, nil
}

// sameAssetManifest compares two manifests without depending on input order.
func sameAssetManifest(left, right []AssetMapping) bool {
	if len(left) != len(right) {
		return false
	}
	normalized := func(values []AssetMapping) map[string]string {
		out := make(map[string]string, len(values))
		for _, value := range values {
			out[value.Name] = value.Hash
		}
		return out
	}
	a, b := normalized(left), normalized(right)
	for name, hash := range a {
		if b[name] != hash {
			return false
		}
	}
	return true
}

// snapshotAssets records which blobs a revision used.
func snapshotAssets(ctx context.Context, tx *sql.Tx, revisionID string, assets []AssetMapping) error {
	for _, asset := range assets {
		name, err := cleanAssetName(asset.Name)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
            INSERT INTO revision_assets (revision_id, name, hash) VALUES (?, ?, ?)`,
			revisionID, name, asset.Hash); err != nil {
			return fmt.Errorf("snapshot asset %q: %w", name, err)
		}
	}
	return nil
}

// releaseStagedAssets rolls back the leases a failed commit took for its
// manifest. Clearing only this project's leases keeps bytes another project is
// still preparing intact; the following sweep then removes the blobs that no
// manifest, revision, or live lease protects. Cleanup is best effort because
// the original commit error is the one the caller needs.
func (s *Store) releaseStagedAssets(ctx context.Context, projectID string, assets *[]AssetMapping) {
	if assets == nil || len(*assets) == 0 {
		return
	}
	hashes := make(map[string]struct{}, len(*assets))
	for _, asset := range *assets {
		if asset.Hash != "" {
			hashes[asset.Hash] = struct{}{}
		}
	}
	if len(hashes) == 0 {
		return
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(cleanupCtx, nil)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback() }()
	for hash := range hashes {
		if _, err := tx.ExecContext(cleanupCtx, `
            UPDATE assets SET staged_at = '', staged_by = ''
            WHERE hash = ? AND staged_by = ?`, hash, projectID); err != nil {
			return
		}
	}
	if err := gcAssets(cleanupCtx, tx); err != nil {
		return
	}
	_ = tx.Commit()
}

// assetStagingTTL is the grace period between staging a blob and the commit
// that references it. Unreferenced blobs younger than this survive GC so a
// competing save, delete, or another service instance cannot collect an
// in-flight upload.
const assetStagingTTL = 10 * time.Minute

// gcAssets removes blobs that no current manifest or revision references and
// whose staging lease has expired. Referenced bytes survive regardless of age,
// while an abandoned staged upload is reclaimed after the TTL.
func gcAssets(ctx context.Context, tx *sql.Tx) error {
	cutoff := time.Now().UTC().Add(-assetStagingTTL).Format(timeLayout)
	if _, err := tx.ExecContext(ctx, `
        DELETE FROM assets
        WHERE hash NOT IN (SELECT hash FROM project_assets)
          AND hash NOT IN (SELECT hash FROM revision_assets)
          AND (staged_at = '' OR staged_at < ?)`, cutoff); err != nil {
		return fmt.Errorf("collect unused assets: %w", err)
	}
	return nil
}

// DuplicateProject copies a chart and its asset manifest under a new name.
func (s *Store) DuplicateProject(ctx context.Context, id, name string) (*Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("name must not be blank")
	}
	newProjectID, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate id: %w", err)
	}
	now := nowString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin duplicate: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
        INSERT INTO projects
            (id, name, grp, archived, charter, composer, level, background, song, note_count, chart,
             size, revision, chart_hash, view_state, asset_folders, created_at, updated_at)
        SELECT ?, ?, grp, archived, charter, composer, level, background, song, note_count, chart,
               size, 1, chart_hash, view_state, asset_folders, ?, ?
        FROM projects WHERE id = ?`, newProjectID, name, now, now, id)
	if err != nil {
		return nil, fmt.Errorf("duplicate project: %w", err)
	}
	if rows, err := res.RowsAffected(); err != nil {
		return nil, fmt.Errorf("duplicate project: %w", err)
	} else if rows == 0 {
		return nil, ErrNotFound
	}
	if err := copyProjectAssets(ctx, tx, id, newProjectID, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit duplicate: %w", err)
	}
	return s.GetProjectSummary(ctx, newProjectID)
}

// GetProjectSummary loads one project without its chart payload.
func (s *Store) GetProjectSummary(ctx context.Context, id string) (*Project, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+projectColumns+` FROM projects WHERE id = ?`, id)
	p, _, err := scanProject(row, false)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load project: %w", err)
	}
	return p, nil
}

// CreateRevisionInput describes a new snapshot.
type CreateRevisionInput struct {
	ProjectID string
	Chart     json.RawMessage
	Label     string
}

// CreateRevision snapshots a chart under a project.
func (s *Store) CreateRevision(ctx context.Context, in CreateRevisionInput) (*Revision, error) {
	// Verify the parent project first so the caller gets a clean 404.
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM projects WHERE id = ?`, in.ProjectID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("verify project: %w", err)
	}
	if exists == 0 {
		return nil, ErrNotFound
	}

	chart, err := normalizeChart(in.Chart)
	if err != nil {
		return nil, err
	}
	label := strings.TrimSpace(in.Label)
	if label == "" {
		var count int
		if err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM revisions WHERE project_id = ?`, in.ProjectID).Scan(&count); err != nil {
			return nil, fmt.Errorf("count revisions: %w", err)
		}
		label = fmt.Sprintf("revision %d", count+1)
	}

	id, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate id: %w", err)
	}
	now := nowString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin revision: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO revisions (id, project_id, label, chart, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
		id, in.ProjectID, label, string(chart), len(chart), now); err != nil {
		return nil, fmt.Errorf("insert revision: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
        INSERT INTO revision_assets (revision_id, name, hash)
        SELECT ?, name, hash FROM project_assets WHERE project_id = ?`,
		id, in.ProjectID); err != nil {
		return nil, fmt.Errorf("snapshot revision assets: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit revision: %w", err)
	}
	return s.GetRevision(ctx, id)
}

// ListRevisions returns a project's snapshots, newest first.
func (s *Store) ListRevisions(ctx context.Context, projectID string, limit int) ([]RevisionSummary, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
        SELECT id, project_id, label, created_at, size
        FROM revisions WHERE project_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("list revisions: %w", err)
	}
	defer rows.Close()

	out := make([]RevisionSummary, 0)
	for rows.Next() {
		var r RevisionSummary
		if err := rows.Scan(&r.ID, &r.ProjectID, &r.Label, &r.CreatedAt, &r.Size); err != nil {
			return nil, fmt.Errorf("scan revision: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate revisions: %w", err)
	}
	return out, nil
}

// GetRevision loads one snapshot with its chart payload.
func (s *Store) GetRevision(ctx context.Context, id string) (*Revision, error) {
	var (
		r     Revision
		chart []byte
	)
	err := s.db.QueryRowContext(ctx, `
        SELECT id, project_id, label, created_at, size, chart
        FROM revisions WHERE id = ?`, id).
		Scan(&r.ID, &r.ProjectID, &r.Label, &r.CreatedAt, &r.Size, &chart)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load revision: %w", err)
	}
	r.Chart = json.RawMessage(chart)
	return &r, nil
}

// DeleteRevision removes one snapshot and any blob that only it referenced.
func (s *Store) DeleteRevision(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete revision: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM revisions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete revision: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete revision: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := gcAssets(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete revision: %w", err)
	}
	return nil
}

// CountRevisions returns how many snapshots a project has.
func (s *Store) CountRevisions(ctx context.Context, projectID string) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM revisions WHERE project_id = ?`, projectID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count revisions: %w", err)
	}
	return n, nil
}

// GetPreferences returns the stored preferences object, or {} when empty.
func (s *Store) GetPreferences(ctx context.Context) (json.RawMessage, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT data FROM preferences WHERE id = 1`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return json.RawMessage("{}"), nil
	}
	if err != nil {
		return nil, fmt.Errorf("load preferences: %w", err)
	}
	if !json.Valid([]byte(raw)) {
		return json.RawMessage("{}"), nil
	}
	return json.RawMessage(raw), nil
}

// PutPreferences replaces the whole preferences object.
func (s *Store) PutPreferences(ctx context.Context, values json.RawMessage) (json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(values))
	if trimmed == "" || trimmed == "null" {
		trimmed = "{}"
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("values must be valid JSON")
	}
	// Normalize to an object so the contract holds.
	var probe map[string]any
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return nil, errors.New("values must be a JSON object")
	}
	if _, err := s.db.ExecContext(ctx, `
        INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		trimmed, nowString()); err != nil {
		return nil, fmt.Errorf("save preferences: %w", err)
	}
	return json.RawMessage(trimmed), nil
}
