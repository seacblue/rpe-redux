//! SQLite persistence for crash-recovery drafts.
//!
//! Drafts live in the same `redux.db` as the library and preferences. They are
//! implementation data rather than user files: no recovery directory is created,
//! and the files page does not list them. Assets are content-addressed, so a
//! blob is stored once and shared by every draft that references the same bytes.

use super::{save::save_zip_name, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::AppHandle;

/// Drafts kept per owner when the caller cannot supply the configured limit.
pub(crate) const DEFAULT_LIMIT: usize = 10;
/// Upper bound matching the `autosave-limit` settings control.
const MAX_LIMIT: usize = 100;
/// Version recorded in `recovery_meta` after the content-addressed migration.
const SCHEMA_VERSION: i64 = 2;

/// One draft handed to the store after its chart and assets have been read.
pub(crate) struct RecoveryDraftInput {
    /// Stable caller identity for a document without a path. A library project
    /// id becomes a project-owned draft; any other value becomes an explicit
    /// untitled family shared across restarts.
    pub document_id: String,
    pub path: Option<String>,
    pub title: String,
    pub chart: Vec<u8>,
    pub view_state: Vec<u8>,
    pub assets: Vec<(String, Vec<u8>)>,
    pub created_at: i64,
    pub limit: usize,
}

/// The recovery tables; created on demand so any library database opens without
/// a separate migration step. `recovery_drafts.project_id` stores the namespaced
/// owner key described by [`owner_key`], not a library project id directly.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS recovery_drafts (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    path        TEXT,
    title       TEXT NOT NULL DEFAULT '',
    chart       TEXT NOT NULL,
    view_state  TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_drafts_project
    ON recovery_drafts(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS recovery_asset_blobs (
    hash       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    bytes      BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_asset_refs (
    draft_id TEXT NOT NULL REFERENCES recovery_drafts(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    hash     TEXT NOT NULL REFERENCES recovery_asset_blobs(hash),
    PRIMARY KEY(draft_id, name)
);
CREATE INDEX IF NOT EXISTS idx_recovery_asset_refs_hash
    ON recovery_asset_refs(hash);
CREATE TABLE IF NOT EXISTS recovery_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

/// Path of the shared database the Go service also owns.
pub(crate) fn database_path(app: &AppHandle) -> Result<PathBuf> {
    crate::services::server::expected_db_path(app)
}

/// Open the shared database with a bounded busy wait and the recovery schema.
fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    // The library service uses the same WAL database from another connection.
    connection
        .busy_timeout(Duration::from_secs(15))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    let reclaimed = migrate(&mut connection)?;
    if reclaimed {
        // Dropping the legacy table returns its pages to the free list. Rebuild
        // once so the database file itself shrinks after duplicate blobs merge.
        // A failure leaves the usable, already-migrated database in place.
        let _ = connection.execute_batch("VACUUM");
    }
    Ok(connection)
}

/// Upgrade the legacy per-draft asset table and normalise draft owner keys.
///
/// SQLite DDL participates in the surrounding transaction, so an interrupted
/// migration leaves the old table intact and the next open retries it. Returns
/// whether the legacy asset table was migrated.
fn migrate(connection: &mut Connection) -> Result<bool> {
    let version = meta_value(connection, "schema_version")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let legacy_assets = has_legacy_asset_table(connection)?;
    if version >= SCHEMA_VERSION && !legacy_assets {
        return Ok(false);
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if legacy_assets {
        migrate_legacy_assets(&transaction)?;
    }
    normalize_owner_keys(&transaction)?;
    transaction
        .execute(
            "INSERT INTO recovery_meta (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(legacy_assets)
}

/// Move every legacy `(draft_id, name, bytes)` row into a shared blob and a
/// reference, then drop the old table. Identical bytes collapse to one blob.
fn migrate_legacy_assets(transaction: &rusqlite::Transaction<'_>) -> Result<()> {
    let rows = {
        let mut statement = transaction
            .prepare("SELECT draft_id, name, bytes FROM recovery_assets")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    let created_at = crate::storage::now_ms() as i64;
    for (draft_id, name, bytes) in rows {
        let hash = content_hash(&bytes);
        transaction
            .execute(
                "INSERT INTO recovery_asset_blobs (hash, size, bytes, created_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(hash) DO NOTHING",
                params![hash, bytes.len() as i64, bytes, created_at],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO recovery_asset_refs (draft_id, name, hash) VALUES (?, ?, ?)
                 ON CONFLICT(draft_id, name) DO UPDATE SET hash = excluded.hash",
                params![draft_id, name, hash],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute("DROP TABLE recovery_assets", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Replace legacy opaque owner keys with the stable namespaced form.
fn normalize_owner_keys(transaction: &rusqlite::Transaction<'_>) -> Result<()> {
    let rows = {
        let mut statement = transaction
            .prepare("SELECT id, path, project_id FROM recovery_drafts")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    for (id, path, current) in rows {
        let owner = match path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(path) => path_owner_key(path),
            None if is_namespaced_owner(&current) => current.clone(),
            None => format!("untitled:{current}"),
        };
        if owner != current {
            transaction
                .execute(
                    "UPDATE recovery_drafts SET project_id = ? WHERE id = ?",
                    params![owner, id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Whether an owner key already uses the stable namespaced form.
fn is_namespaced_owner(value: &str) -> bool {
    value.starts_with("path:") || value.starts_with("project:") || value.starts_with("untitled:")
}

/// Whether the legacy asset table still has its inline `bytes` column.
fn has_legacy_asset_table(connection: &Connection) -> Result<bool> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('recovery_assets') WHERE name = 'bytes'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

/// Read one value from the recovery migration metadata table.
fn meta_value(connection: &Connection, key: &str) -> Option<String> {
    connection
        .query_row(
            "SELECT value FROM recovery_meta WHERE key = ?",
            [key],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
}

/// Insert one draft and prune older drafts of the same owner.
pub(crate) fn write(app: &AppHandle, draft: RecoveryDraftInput) -> Result<String> {
    write_at(&database_path(app)?, draft)
}

/// Insert one draft at an explicit database path and prune older drafts of the
/// same owner. The whole write is one transaction, so a failed asset read or
/// cancellation leaves no partial draft behind.
pub(crate) fn write_at(path: &Path, draft: RecoveryDraftInput) -> Result<String> {
    for (name, _) in &draft.assets {
        save_zip_name(name)?;
    }
    let chart = String::from_utf8(draft.chart).map_err(|_| "invalid_recovery_chart".to_owned())?;
    let view_state =
        String::from_utf8(draft.view_state).map_err(|_| "invalid_recovery_view".to_owned())?;
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = if draft.created_at > 0 {
        draft.created_at
    } else {
        crate::storage::now_ms() as i64
    };
    let limit = normalize_limit(draft.limit);
    let mut connection = open(path)?;
    let owner = owner_key(&connection, &draft.document_id, &draft.path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO recovery_drafts
                (id, project_id, path, title, chart, view_state, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                owner,
                draft.path,
                draft.title,
                chart,
                view_state,
                created_at
            ],
        )
        .map_err(|error| error.to_string())?;
    for (name, bytes) in &draft.assets {
        let hash = content_hash(bytes);
        transaction
            .execute(
                "INSERT INTO recovery_asset_blobs (hash, size, bytes, created_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(hash) DO NOTHING",
                params![hash, bytes.len() as i64, bytes, created_at],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO recovery_asset_refs (draft_id, name, hash) VALUES (?, ?, ?)
                 ON CONFLICT(draft_id, name) DO UPDATE SET hash = excluded.hash",
                params![id, name, hash],
            )
            .map_err(|error| error.to_string())?;
    }
    prune_owner(&transaction, &owner, limit)?;
    collect_unreferenced(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(id)
}

/// Limit accepted from the frontend or settings, clamped to the supported range.
fn normalize_limit(limit: usize) -> i64 {
    limit.clamp(1, MAX_LIMIT) as i64
}

/// Resolve the stable owner family for one draft.
///
/// A document with a path is owned by that path, so reopening the same file
/// keeps writing to one family. A pathless writer that names a real library
/// project is project-owned; anything else is an explicit untitled family whose
/// id the frontend persists across restarts.
fn owner_key(connection: &Connection, document_id: &str, path: &Option<String>) -> Result<String> {
    if let Some(path) = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(path_owner_key(path));
    }
    let id = document_id.trim();
    if id.is_empty() {
        return Ok("untitled:unknown".to_owned());
    }
    if table_exists(connection, "projects")? && project_exists(connection, id)? {
        return Ok(format!("project:{id}"));
    }
    Ok(format!("untitled:{id}"))
}

/// Stable owner key for one document path. Windows paths compare without case.
fn path_owner_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    };
    format!("path:{}", content_hash(normalized.as_bytes()))
}

/// SHA-256 content id for one asset blob.
fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Whether a table exists in the current database.
fn table_exists(connection: &Connection, name: &str) -> Result<bool> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            [name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

/// Whether a library project row exists.
fn project_exists(connection: &Connection, id: &str) -> Result<bool> {
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM projects WHERE id = ?", [id], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

/// Keep only the newest `limit` drafts of one owner family.
fn prune_owner(transaction: &rusqlite::Transaction<'_>, owner: &str, limit: i64) -> Result<()> {
    transaction
        .execute(
            "DELETE FROM recovery_drafts
             WHERE project_id = ?1
               AND id NOT IN (
                 SELECT id FROM recovery_drafts
                 WHERE project_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?2
               )",
            params![owner, limit],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Keep only the newest `limit` drafts for every owner family.
fn prune_all_owners(transaction: &rusqlite::Transaction<'_>, limit: i64) -> Result<()> {
    transaction
        .execute(
            "DELETE FROM recovery_drafts
             WHERE id NOT IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (
                          PARTITION BY project_id ORDER BY created_at DESC, rowid DESC
                        ) AS rank
                 FROM recovery_drafts
               )
               WHERE rank <= ?1
             )",
            [limit],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Drop blobs no draft references.
fn collect_unreferenced(transaction: &rusqlite::Transaction<'_>) -> Result<()> {
    transaction
        .execute(
            "DELETE FROM recovery_asset_blobs
             WHERE hash NOT IN (SELECT hash FROM recovery_asset_refs)",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Draft summaries in camelCase for the frontend, newest first.
pub(crate) fn list(app: &AppHandle) -> Result<Vec<Value>> {
    let connection = open(&database_path(app)?)?;
    let mut statement = connection
        .prepare(
            "SELECT id, path, title, created_at
             FROM recovery_drafts
             ORDER BY created_at DESC, rowid DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "path": row.get::<_, Option<String>>(1)?,
                "title": row.get::<_, String>(2)?,
                "createdAt": row.get::<_, i64>(3)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

/// One draft with its chart, view state, and asset blobs.
pub(crate) fn read(app: &AppHandle, id: &str) -> Result<Value> {
    read_at(&database_path(app)?, id)
}

/// One draft read from an explicit database path.
fn read_at(path: &Path, id: &str) -> Result<Value> {
    let connection = open(path)?;
    let (path, title, chart, view_state) = connection
        .query_row(
            "SELECT path, title, chart, view_state FROM recovery_drafts WHERE id = ?",
            [id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT r.name, b.bytes
             FROM recovery_asset_refs r
             JOIN recovery_asset_blobs b ON b.hash = r.hash
             WHERE r.draft_id = ?
             ORDER BY r.name",
        )
        .map_err(|error| error.to_string())?;
    let assets = statement
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "id": id,
        "path": path,
        "title": title,
        "chart": serde_json::from_str::<Value>(&chart).map_err(|error| error.to_string())?,
        "viewState": serde_json::from_str::<Value>(&view_state).unwrap_or_else(|_| json!({})),
        "assets": assets,
    }))
}

/// Remove one draft and its references, then reclaim unreferenced blobs.
pub(crate) fn delete(app: &AppHandle, id: &str) -> Result<bool> {
    delete_at(&database_path(app)?, id)
}

/// Remove one draft from an explicit database path.
fn delete_at(path: &Path, id: &str) -> Result<bool> {
    let mut connection = open(path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let removed = transaction
        .execute("DELETE FROM recovery_drafts WHERE id = ?", [id])
        .map_err(|error| error.to_string())?;
    collect_unreferenced(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(removed > 0)
}

/// Remove ownerless drafts, surplus drafts, and every blob no draft references.
///
/// The startup pass uses the configured `autosave-limit` when it is readable and
/// falls back to [`DEFAULT_LIMIT`]. A failed cleanup is diagnostic only; it must
/// not block opening the editor.
pub(crate) fn cleanup_at(path: &Path, limit: usize) -> Result<()> {
    let limit = normalize_limit(limit);
    let mut connection = open(path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if table_exists(&transaction, "projects")? {
        transaction
            .execute(
                "DELETE FROM recovery_drafts
                 WHERE project_id LIKE 'project:%'
                   AND substr(project_id, 9) NOT IN (SELECT id FROM projects)",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    prune_all_owners(&transaction, limit)?;
    collect_unreferenced(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())
}

/// Retention limit stored by the settings page, or [`DEFAULT_LIMIT`].
pub(crate) fn stored_limit(path: &Path) -> usize {
    let Ok(connection) = open(path) else {
        return DEFAULT_LIMIT;
    };
    let stored: Option<String> = connection
        .query_row("SELECT data FROM preferences WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()
        .ok()
        .flatten();
    stored
        .and_then(|data| serde_json::from_str::<Value>(&data).ok())
        .and_then(|value| {
            let setting = value.get("settings")?.get("autosave-limit")?;
            match setting {
                Value::Number(number) => number.as_f64(),
                Value::String(text) => text.parse::<f64>().ok(),
                _ => None,
            }
        })
        .map(|value| value.round() as i64)
        .map(|value| value.clamp(1, MAX_LIMIT as i64) as usize)
        .unwrap_or(DEFAULT_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn database() -> (tempfile::TempDir, PathBuf) {
        // The process temp directory is not writable in some packaged test
        // environments; the build target is always writable and disposable.
        let directory =
            tempfile::tempdir_in(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")).unwrap();
        let path = directory.path().join("redux.db");
        (directory, path)
    }

    fn draft(owner: &str, created_at: i64, assets: Vec<(&str, Vec<u8>)>) -> RecoveryDraftInput {
        RecoveryDraftInput {
            document_id: owner.to_owned(),
            path: Some("chart.pez".to_owned()),
            title: "Chart".to_owned(),
            chart: br#"{"META":{"name":"Chart"}}"#.to_vec(),
            view_state: br#"{"lineIndex":0}"#.to_vec(),
            assets: assets
                .into_iter()
                .map(|(name, bytes)| (name.to_owned(), bytes))
                .collect(),
            created_at,
            limit: 2,
        }
    }

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn writes_prunes_and_reads_drafts() {
        let (_directory, path) = database();
        let first = write_at(
            &path,
            draft("project", 1, vec![("song.ogg", vec![1, 2, 3])]),
        )
        .unwrap();
        let second = write_at(
            &path,
            draft("project", 2, vec![("song.ogg", vec![1, 2, 3])]),
        )
        .unwrap();
        write_at(
            &path,
            draft("project", 3, vec![("song.ogg", vec![1, 2, 3])]),
        )
        .unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM recovery_drafts WHERE project_id LIKE 'path:%'"
            ),
            2
        );
        assert!(!first.is_empty() && !second.is_empty());
        let read = read_at(&path, &second).unwrap();
        assert_eq!(read["assets"][0][0], "song.ogg");
        assert_eq!(read["assets"][0][1], json!([1, 2, 3]));
    }

    #[test]
    fn identical_content_is_stored_once_across_drafts() {
        let (_directory, path) = database();
        let bytes = vec![7u8; 64];
        let mut first = draft("alpha", 1, vec![("shared.png", bytes.clone())]);
        first.path = None;
        let mut second = draft("beta", 2, vec![("shared.png", bytes.clone())]);
        second.path = None;
        write_at(&path, first).unwrap();
        write_at(&path, second).unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_blobs"),
            1
        );
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_refs"),
            2
        );
        assert_eq!(
            count(&connection, "SELECT SUM(size) FROM recovery_asset_blobs"),
            bytes.len() as i64
        );
    }

    #[test]
    fn rewriting_a_draft_reuses_its_assets() {
        let (_directory, path) = database();
        let bytes = vec![9u8; 32];
        let mut first = draft("alpha", 1, vec![("song.ogg", bytes.clone())]);
        first.path = None;
        first.limit = 10;
        let mut second = draft("alpha", 2, vec![("song.ogg", bytes)]);
        second.path = None;
        second.limit = 10;
        write_at(&path, first).unwrap();
        write_at(&path, second).unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_blobs"),
            1
        );
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_refs"),
            2
        );
    }

    #[test]
    fn path_owners_are_stable_across_native_document_ids() {
        let (_directory, path) = database();
        write_at(&path, draft("first-session", 1, Vec::new())).unwrap();
        write_at(&path, draft("second-session", 2, Vec::new())).unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(DISTINCT project_id) FROM recovery_drafts"
            ),
            1
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM recovery_drafts WHERE project_id LIKE 'path:%'"
            ),
            2
        );
    }

    #[test]
    fn project_owners_require_an_existing_project() {
        let (_directory, path) = database();
        let connection = open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE projects (id TEXT PRIMARY KEY);
                 INSERT INTO projects (id) VALUES ('project-1');",
            )
            .unwrap();
        drop(connection);

        let mut owned = draft("project-1", 1, Vec::new());
        owned.path = None;
        write_at(&path, owned).unwrap();
        let mut missing = draft("missing-project", 2, Vec::new());
        missing.path = None;
        write_at(&path, missing).unwrap();

        let connection = open(&path).unwrap();
        let mut statement = connection
            .prepare("SELECT project_id FROM recovery_drafts ORDER BY created_at")
            .unwrap();
        let owners: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(
            owners,
            vec!["project:project-1", "untitled:missing-project"]
        );
    }

    #[test]
    fn deleting_a_draft_keeps_shared_blobs_until_the_last_owner_leaves() {
        let (_directory, path) = database();
        let bytes = vec![5u8; 16];
        let mut first = draft("alpha", 1, vec![("shared.png", bytes.clone())]);
        first.path = None;
        let mut second = draft("beta", 2, vec![("shared.png", bytes)]);
        second.path = None;
        let first_id = write_at(&path, first).unwrap();
        let second_id = write_at(&path, second).unwrap();

        assert!(delete_at(&path, &first_id).unwrap());
        let connection = open(&path).unwrap();
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_blobs"),
            1
        );
        drop(connection);

        assert!(delete_at(&path, &second_id).unwrap());
        let connection = open(&path).unwrap();
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_blobs"),
            0
        );
    }

    #[test]
    fn cleanup_removes_drafts_whose_project_was_deleted() {
        let (_directory, path) = database();
        let connection = open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE projects (id TEXT PRIMARY KEY);
                 INSERT INTO projects (id) VALUES ('alive'), ('gone');",
            )
            .unwrap();
        drop(connection);

        let now = crate::storage::now_ms() as i64;
        let mut alive = draft("alive", now, Vec::new());
        alive.path = None;
        write_at(&path, alive).unwrap();
        let mut orphan = draft("gone", now, Vec::new());
        orphan.path = None;
        write_at(&path, orphan).unwrap();
        let connection = open(&path).unwrap();
        connection
            .execute("DELETE FROM projects WHERE id = 'gone'", [])
            .unwrap();
        drop(connection);

        cleanup_at(&path, 10).unwrap();
        let connection = open(&path).unwrap();
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM recovery_drafts WHERE project_id = 'project:alive'"
            ),
            1
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM recovery_drafts WHERE project_id = 'project:gone'"
            ),
            0
        );
    }

    #[test]
    fn migrates_legacy_asset_rows_into_shared_blobs() {
        let (_directory, path) = database();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE recovery_drafts (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT,
                    title TEXT NOT NULL DEFAULT '', chart TEXT NOT NULL,
                    view_state TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
                 );
                 CREATE TABLE recovery_assets (
                    draft_id TEXT NOT NULL REFERENCES recovery_drafts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(draft_id, name)
                 );",
            )
            .unwrap();
        let bytes = vec![3u8; 24];
        for (id, name, created_at) in [("one", "song.ogg", 1i64), ("two", "song.ogg", 2)] {
            connection
                .execute(
                    "INSERT INTO recovery_drafts (id, project_id, path, title, chart, created_at)
                     VALUES (?, 'legacy', NULL, 'Chart', '{\"META\":{}}', ?)",
                    params![id, created_at],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO recovery_assets (draft_id, name, bytes) VALUES (?, ?, ?)",
                    params![id, name, bytes],
                )
                .unwrap();
        }
        drop(connection);

        let connection = open(&path).unwrap();
        assert!(!has_legacy_asset_table(&connection).unwrap());
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_blobs"),
            1
        );
        assert_eq!(
            count(&connection, "SELECT COUNT(*) FROM recovery_asset_refs"),
            2
        );
        assert_eq!(
            count(&connection, "SELECT SUM(size) FROM recovery_asset_blobs"),
            bytes.len() as i64
        );
        assert_eq!(
            count(
                &connection,
                "SELECT COUNT(*) FROM recovery_drafts WHERE project_id LIKE 'untitled:%'"
            ),
            2
        );
        let read = read_at(&path, "two").unwrap();
        assert_eq!(read["assets"][0][1], json!(bytes));

        let connection = open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE preferences (
                    id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL
                 );
                 INSERT INTO preferences (id, data, updated_at)
                 VALUES (1, '{\"settings\":{\"autosave-limit\":\"4\"}}', 'now');",
            )
            .unwrap();
        drop(connection);
        assert_eq!(stored_limit(&path), 4);
    }
}
