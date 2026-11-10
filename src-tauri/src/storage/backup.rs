//! Export and import of durable application data.
//!
//! The bundle is a zip with a manifest naming the parts it carries. Parts are the
//! unit of choice: a portable build that was replaced wholesale can bring its
//! settings and library across without dragging in external packages, or the
//! other way round.
//!
//! The database cannot be replaced while the local service holds it, so an import
//! stages and validates a copy beside the live files and promotes it on the next
//! start after keeping the previous database as `redux.db.bak-<time>`.
use rusqlite::{Connection, OpenFlags};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{ipc::Request, AppHandle, State};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

type Result<T> = std::result::Result<T, String>;

/// Manifest `format` value that identifies an application backup.
const BACKUP_FORMAT: &str = "rpe-redux-app-backup";
/// Current bundle layout version.
const BACKUP_VERSION: u32 = 2;
/// SQLite `application_id` that marks a library database.
const LIBRARY_APPLICATION_ID: i64 = 1_380_992_338;
/// Newest library schema this build can promote and then migrate.
const LIBRARY_SCHEMA_VERSION: i64 = 2;

// Import limits. The database is streamed to a staging file; the remaining
// parts are small documents and theme files.
const MAX_BACKUP_ENTRIES: usize = 100_000;
const MAX_BACKUP_MANIFEST_BYTES: u64 = 1 << 20;
const MAX_BACKUP_FILE_BYTES: u64 = 256 << 20;
const MAX_BACKUP_DATABASE_BYTES: u64 = 8 << 30;
const MAX_BACKUP_TOTAL_BYTES: u64 = 8 << 30;

/// The parts a bundle may carry. Anything else in a bundle is ignored.
const PARTS: [&str; 4] = ["database", "themes", "skins", "extensions"];

/// Live database files in promotion order: main file first, then its WAL and
/// shared-memory sidecars.
const DATABASE_FILES: [(&str, &str); 3] = [
    ("redux.db", "redux.db.import"),
    ("redux.db-wal", "redux.db.import-wal"),
    ("redux.db-shm", "redux.db.import-shm"),
];
/// Main staged database; its presence identifies a pending import.
const STAGED_DATABASE: &str = "redux.db.import";
/// Sidecar names written by builds that staged each file under `.import`.
const LEGACY_STAGED_WAL: &str = "redux.db-wal.import";
const LEGACY_STAGED_SHM: &str = "redux.db-shm.import";
/// Written only after a validated staged database and every selected part are ready.
const IMPORT_READY: &str = "redux.db.import-ready.json";
/// Format version of the import-ready marker.
const IMPORT_READY_FORMAT: u32 = 1;
/// Journal that makes a database promotion restartable.
const PROMOTION_JOURNAL: &str = "redux.db.promote.json";
/// Prefix of a previous database set kept beside the live files.
const DATABASE_BACKUP_PREFIX: &str = "redux.db.bak-";
/// Number of earlier database sets kept after a promotion.
const DATABASE_BACKUPS_KEPT: usize = 1;

/// Every SQLite database starts with this 16-byte magic header.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";
/// Bytes a SQLite file must contain before its header can be inspected.
const SQLITE_HEADER_BYTES: u64 = 100;

// Stable prefixes for import database rejections. The text before the first
// colon is a machine-matchable code; the remainder is diagnostic detail.
const ERROR_DATABASE_MISSING: &str = "backup_database_missing";
const ERROR_DATABASE_DUPLICATE: &str = "backup_database_duplicate";
const ERROR_DATABASE_TOO_LARGE: &str = "backup_database_too_large";
const ERROR_DATABASE_TOO_SMALL: &str = "backup_database_too_small";
const ERROR_DATABASE_INVALID_HEADER: &str = "backup_database_invalid_header";
const ERROR_DATABASE_UNREADABLE: &str = "backup_database_unreadable";
const ERROR_DATABASE_INTEGRITY: &str = "backup_database_integrity_failed";
const ERROR_DATABASE_NOT_LIBRARY: &str = "backup_database_not_library";
const ERROR_DATABASE_SCHEMA_TOO_NEW: &str = "backup_database_schema_too_new";

/// Library tables the local service creates and this build expects.
const LIBRARY_TABLES: [&str; 6] = [
    "assets",
    "preferences",
    "project_assets",
    "projects",
    "revision_assets",
    "revisions",
];

fn error<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

/// Prefix a database import diagnostic with its stable error code.
fn database_error(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

/// Select the requested parts in canonical order; `None` selects all.
fn selected_parts(parts: Option<Vec<String>>) -> Vec<&'static str> {
    match parts {
        Some(list) => PARTS
            .into_iter()
            .filter(|part| list.iter().any(|entry| entry == part))
            .collect(),
        None => PARTS.to_vec(),
    }
}

/// Read one archive entry into memory, refusing a decompression bomb.
fn read_limited<R: Read>(reader: R, limit: u64, label: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > limit {
        return Err(format!("Backup entry is too large: {label}"));
    }
    Ok(bytes)
}

/// Stream a database entry into a temporary file. The caller persists it only
/// after every selected entry has been read, so a failed import never leaves a
/// partial `.import` file for the next start to promote.
fn stage_database_temp<R: Read>(root: &Path, reader: R) -> Result<(tempfile::NamedTempFile, u64)> {
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(error)?;
    let copied = std::io::copy(
        &mut reader.take(MAX_BACKUP_DATABASE_BYTES + 1),
        temporary.as_file_mut(),
    )
    .map_err(error)?;
    if copied > MAX_BACKUP_DATABASE_BYTES {
        return Err(database_error(
            ERROR_DATABASE_TOO_LARGE,
            "the database entry exceeds the size limit",
        ));
    }
    temporary.as_file().sync_all().map_err(error)?;
    Ok((temporary, copied))
}

/// Staged file name for one live database file.
fn staged_database_name(live: &str) -> Option<&'static str> {
    DATABASE_FILES
        .iter()
        .find(|(name, _)| *name == live)
        .map(|(_, staged)| *staged)
}

/// Validate a staged database without modifying it: it must carry the SQLite
/// header, fit the import limits, open read-only, pass `quick_check`, and contain
/// the library tables the service expects.
fn validate_staged_database(path: &Path) -> Result<()> {
    let metadata =
        fs::metadata(path).map_err(|error| database_error(ERROR_DATABASE_MISSING, error))?;
    if !metadata.is_file() {
        return Err(database_error(
            ERROR_DATABASE_MISSING,
            "the staged path is not a file",
        ));
    }
    if metadata.len() > MAX_BACKUP_DATABASE_BYTES {
        return Err(database_error(
            ERROR_DATABASE_TOO_LARGE,
            format!(
                "{} bytes exceeds the {MAX_BACKUP_DATABASE_BYTES}-byte limit",
                metadata.len()
            ),
        ));
    }
    if metadata.len() < SQLITE_HEADER_BYTES {
        return Err(database_error(
            ERROR_DATABASE_TOO_SMALL,
            format!(
                "{} bytes is smaller than the {SQLITE_HEADER_BYTES}-byte SQLite header",
                metadata.len()
            ),
        ));
    }
    let mut header = [0u8; 16];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|error| database_error(ERROR_DATABASE_UNREADABLE, error))?;
    if &header != SQLITE_HEADER {
        return Err(database_error(
            ERROR_DATABASE_INVALID_HEADER,
            "the file does not start with the SQLite format header",
        ));
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| database_error(ERROR_DATABASE_UNREADABLE, error))?;
    {
        let mut check = connection
            .prepare("PRAGMA quick_check")
            .map_err(|error| database_error(ERROR_DATABASE_INTEGRITY, error))?;
        let mut rows = check
            .query([])
            .map_err(|error| database_error(ERROR_DATABASE_INTEGRITY, error))?;
        let mut problems = Vec::new();
        let mut checked = false;
        while let Some(row) = rows
            .next()
            .map_err(|error| database_error(ERROR_DATABASE_INTEGRITY, error))?
        {
            checked = true;
            let value: String = row
                .get(0)
                .map_err(|error| database_error(ERROR_DATABASE_INTEGRITY, error))?;
            if value != "ok" {
                problems.push(value);
            }
        }
        if !checked {
            return Err(database_error(
                ERROR_DATABASE_INTEGRITY,
                "quick_check returned no result",
            ));
        }
        if !problems.is_empty() {
            return Err(database_error(
                ERROR_DATABASE_INTEGRITY,
                problems.join("; "),
            ));
        }
    }
    let application_id: i64 = connection
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(|error| database_error(ERROR_DATABASE_UNREADABLE, error))?;
    if application_id != 0 && application_id != LIBRARY_APPLICATION_ID {
        return Err(database_error(
            ERROR_DATABASE_NOT_LIBRARY,
            format!("application id {application_id} is not an RPE Redux library"),
        ));
    }
    let schema_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| database_error(ERROR_DATABASE_UNREADABLE, error))?;
    if schema_version > LIBRARY_SCHEMA_VERSION {
        return Err(database_error(
            ERROR_DATABASE_SCHEMA_TOO_NEW,
            format!(
                "schema version {schema_version} is newer than the supported {LIBRARY_SCHEMA_VERSION}"
            ),
        ));
    }
    let names = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<BTreeSet<_>, _>>()
        })
        .map_err(|error| database_error(ERROR_DATABASE_UNREADABLE, error))?;
    let missing = LIBRARY_TABLES
        .iter()
        .filter(|name| !names.contains(**name))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(database_error(
            ERROR_DATABASE_NOT_LIBRARY,
            format!("missing tables: {}", missing.join(", ")),
        ));
    }
    Ok(())
}

/// Remove staged database files and the import-ready marker. Missing files are
/// the normal case.
fn cleanup_staged_database(root: &Path) {
    for name in [
        STAGED_DATABASE,
        "redux.db.import-wal",
        "redux.db.import-shm",
        LEGACY_STAGED_WAL,
        LEGACY_STAGED_SHM,
        IMPORT_READY,
    ] {
        let _ = fs::remove_file(root.join(name));
    }
}

/// Record that the staged database and every selected part are complete. The
/// marker gates promotion so an interrupted import is never installed.
fn write_import_ready(root: &Path) -> Result<()> {
    let path = root.join(IMPORT_READY);
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(error)?;
    serde_json::to_writer(
        temporary.as_file_mut(),
        &ImportReceipt {
            format: IMPORT_READY_FORMAT,
        },
    )
    .map_err(error)?;
    temporary.as_file().sync_all().map_err(error)?;
    if path.exists() {
        fs::remove_file(&path).map_err(error)?;
    }
    temporary
        .persist(&path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

/// Whether a complete, validated import is waiting for the next start.
fn import_ready(root: &Path) -> bool {
    crate::storage::read_json::<ImportReceipt>(&root.join(IMPORT_READY))
        .is_some_and(|receipt| receipt.format <= IMPORT_READY_FORMAT)
}

/// Stage and validate the bundle's database entries.
///
/// Returns the staged byte count, or `None` when the database part was not
/// selected. On any failure the staged files are removed and the live files are
/// left untouched.
fn stage_database_import(
    archive: &mut ZipArchive<File>,
    selected: &[&str],
    root: &Path,
) -> Result<Option<u64>> {
    if !selected.contains(&"database") {
        return Ok(None);
    }
    match stage_database_import_inner(archive, root) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) => {
            cleanup_staged_database(root);
            Err(error)
        }
    }
}

/// Read every database entry into a temporary file, publish the staging set,
/// then validate the main file before the caller restores anything else.
fn stage_database_import_inner(archive: &mut ZipArchive<File>, root: &Path) -> Result<u64> {
    cleanup_staged_database(root);
    let mut temporary_files: Vec<(tempfile::NamedTempFile, PathBuf)> = Vec::new();
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(error)?;
        let Some(relative) = entry_relative(&name) else {
            continue;
        };
        if part_of(&relative) != Some("database") {
            continue;
        }
        let Some(staged_name) = relative.to_str().and_then(staged_database_name) else {
            continue;
        };
        if !names.insert(staged_name) {
            return Err(database_error(
                ERROR_DATABASE_DUPLICATE,
                format!("duplicate database file: {staged_name}"),
            ));
        }
        let (temporary, copied) = stage_database_temp(root, &mut entry)?;
        temporary_files.push((temporary, root.join(staged_name)));
        total = total.checked_add(copied).ok_or("Backup size overflow")?;
    }
    if !names.contains(STAGED_DATABASE) {
        return Err(database_error(
            ERROR_DATABASE_MISSING,
            "the backup does not contain a library database",
        ));
    }
    if total > MAX_BACKUP_TOTAL_BYTES {
        return Err("Extracted backup exceeds the size limit.".into());
    }
    for (temporary, target) in temporary_files {
        if target.exists() {
            fs::remove_file(&target).map_err(error)?;
        }
        temporary
            .persist(&target)
            .map_err(|error| error.error.to_string())?;
    }
    validate_staged_database(&root.join(STAGED_DATABASE))?;
    Ok(total)
}

/// Archive entry name for a path relative to the data root.
fn archive_path(relative: &Path) -> String {
    format!(
        "user-data/{}",
        relative.to_string_lossy().replace('\\', "/")
    )
}

/// Archive one file under the data root; returns false when it does not exist.
fn add_file<W: Write + Seek>(
    root: &Path,
    relative: &Path,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<bool> {
    add_file_at(&root.join(relative), relative, zip, options)
}

/// Archive one file under an explicit archive path; returns false when the
/// source does not exist.
fn add_file_at<W: Write + Seek>(
    source: &Path,
    relative: &Path,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<bool> {
    if !source.is_file() {
        return Ok(false);
    }
    zip.start_file(archive_path(relative), options)
        .map_err(error)?;
    let mut input = File::open(source).map_err(error)?;
    std::io::copy(&mut input, zip).map_err(error)?;
    Ok(true)
}

/// Archive a directory under the data root.
fn add_tree<W: Write + Seek>(
    root: &Path,
    relative: &Path,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<()> {
    add_tree_at(&root.join(relative), relative, zip, options)
}

/// Archive `directory` under `relative`, which need not match the source path.
fn add_tree_at<W: Write + Seek>(
    directory: &Path,
    relative: &Path,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<()> {
    if !directory.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(error)? {
        let entry = entry.map_err(error)?;
        let file_type = entry.file_type().map_err(error)?;
        if file_type.is_symlink() {
            continue;
        }
        let child = relative.join(entry.file_name());
        if file_type.is_dir() {
            add_tree_at(&entry.path(), &child, zip, options)?;
        } else if file_type.is_file() {
            add_file_at(&entry.path(), &child, zip, options)?;
        }
    }
    Ok(())
}

/// Archive a tree while skipping top-level package folders already archived
/// from a higher-precedence root.
fn add_tree_at_skipping<W: Write + Seek>(
    directory: &Path,
    relative: &Path,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
    skip: &BTreeSet<String>,
) -> Result<()> {
    if !directory.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(directory).map_err(error)? {
        let entry = entry.map_err(error)?;
        if skip.contains(&entry.file_name().to_string_lossy().into_owned()) {
            continue;
        }
        let file_type = entry.file_type().map_err(error)?;
        if file_type.is_symlink() {
            continue;
        }
        let child = relative.join(entry.file_name());
        if file_type.is_dir() {
            add_tree_at(&entry.path(), &child, zip, options)?;
        } else if file_type.is_file() {
            add_file_at(&entry.path(), &child, zip, options)?;
        }
    }
    Ok(())
}

/// Archive one named part under its canonical `user-data/` prefix.
///
/// `database` overrides the live database files with a standalone snapshot; the
/// live WAL and shared-memory sidecars must never enter the bundle beside it.
fn add_part<W: Write + Seek>(
    root: &Path,
    theme_root: &Path,
    external_root: &Path,
    database: Option<&Path>,
    part: &str,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<()> {
    match part {
        "database" => {
            if let Some(snapshot) = database {
                add_file_at(snapshot, Path::new("redux.db"), zip, options)?;
            } else {
                for name in ["redux.db", "redux.db-wal", "redux.db-shm"] {
                    add_file(root, Path::new(name), zip, options)?;
                }
            }
        }
        "themes" => add_tree_at(theme_root, Path::new("themes"), zip, options)?,
        "backgrounds" => add_tree(root, Path::new("backgrounds"), zip, options)?,
        "skins" => {
            let source = external_root.join(part);
            add_tree_at(&source, Path::new(part), zip, options)?;
        }
        "extensions" => {
            let portable = external_root.join(part);
            add_tree_at(&portable, Path::new(part), zip, options)?;
            // Managed installs live in the data root and use the same archive
            // prefix; a portable copy with the same id wins the collision.
            let managed_names = fs::read_dir(&portable)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect::<BTreeSet<_>>();
            add_tree_at_skipping(
                &root.join(part),
                Path::new(part),
                zip,
                options,
                &managed_names,
            )?;
        }
        _ => {}
    }
    Ok(())
}

/// Write a complete bundle to a temporary file and publish it at `target`.
fn write_bundle(
    target: &Path,
    root: &Path,
    theme_root: &Path,
    external_root: &Path,
    database: Option<&Path>,
    parts: &[&str],
    manifest: &serde_json::Value,
) -> Result<()> {
    let parent = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(error)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut zip = ZipWriter::new(temporary.as_file_mut());
    zip.start_file("manifest.json", options).map_err(error)?;
    zip.write_all(
        serde_json::to_string_pretty(manifest)
            .map_err(error)?
            .as_bytes(),
    )
    .map_err(error)?;
    for part in parts {
        add_part(
            root,
            theme_root,
            external_root,
            database,
            part,
            &mut zip,
            options,
        )?;
    }
    zip.finish().map_err(error)?;
    temporary.as_file().sync_all().map_err(error)?;
    temporary.persist(target).map_err(error)?;
    Ok(())
}

/// Export the selected durable parts to `path` and return the written path.
#[tauri::command]
pub fn export_app_backup(
    app: AppHandle,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    parts: Option<Vec<String>>,
) -> Result<String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let target = PathBuf::from(path);
    if target.as_os_str().is_empty() {
        return Err("Backup target must not be empty.".into());
    }
    let chosen = selected_parts(parts);
    if chosen.is_empty() {
        return Err("Select at least one item.".into());
    }
    let root = crate::storage::data_dir(&app)?;
    let themes = crate::assets::themes::theme_root()?;
    let manifest = serde_json::json!({
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "parts": chosen,
        "excluded": ["backgrounds/", "WebView2 cache", "runtime binaries", "logs"]
    });
    write_bundle(
        &target,
        &root,
        &themes,
        &crate::storage::user_root()?,
        None,
        &chosen,
        &manifest,
    )?;
    Ok(target.to_string_lossy().into_owned())
}

/// Parts restored from an import.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub parts: Vec<String>,
    /// True when the database or themes take effect on the next start.
    pub restart_required: bool,
}

/// Marker recorded when a staged database is complete and validated.
#[derive(serde::Serialize, serde::Deserialize)]
struct ImportReceipt {
    format: u32,
}

/// Replace every character that is unsafe in a generated file name.
fn safe_file_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

/// Keep the newest `keep` pre-update backup archives in `directory`.
fn prune_update_backups(directory: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut backups: Vec<PathBuf> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let name = path.file_name()?.to_str()?;
            (path.is_file() && name.starts_with("pre-update-") && name.ends_with(".zip"))
                .then_some(path)
        })
        .collect();
    backups.sort();
    if backups.len() > keep {
        for path in &backups[..backups.len() - keep] {
            let _ = fs::remove_file(path);
        }
    }
}

/// Copy the live library into a standalone file with SQLite's `VACUUM INTO`.
///
/// The source connection only reads. SQLite includes committed WAL pages in the
/// snapshot, so a sidecar write that lands after the frontend checkpoint cannot
/// leave a mismatched main/WAL pair in the backup.
fn snapshot_database(source: &Path, target: &Path) -> Result<()> {
    if target.exists() {
        return Err("The pre-update database snapshot target already exists.".into());
    }
    let connection = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Could not open the library for the pre-update backup: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(30))
        .map_err(|error| format!("Could not configure the pre-update database read: {error}"))?;
    let path = target
        .to_str()
        .ok_or("The pre-update database snapshot path is not valid Unicode.")?;
    connection
        .execute("VACUUM INTO ?1", [path])
        .map_err(|error| {
            format!("Could not snapshot the library for the pre-update backup: {error}")
        })?;
    Ok(())
}

/// Run SQLite's full integrity check on one database file.
fn check_database_integrity(path: &Path, label: &str) -> Result<()> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("{label} could not be opened: {error}"))?;
    let mut check = connection
        .prepare("PRAGMA integrity_check")
        .map_err(|error| format!("{label} could not be checked: {error}"))?;
    let mut rows = check
        .query([])
        .map_err(|error| format!("{label} could not be checked: {error}"))?;
    let mut problems = Vec::new();
    let mut checked = false;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("{label} could not be checked: {error}"))?
    {
        checked = true;
        let value: String = row
            .get(0)
            .map_err(|error| format!("{label} could not be checked: {error}"))?;
        if value != "ok" {
            problems.push(value);
        }
    }
    if !checked {
        return Err(format!("{label} did not return an integrity-check result."));
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{label} failed SQLite's integrity check: {}",
            problems.join("; ")
        ))
    }
}

/// Read the database entry back out of a written bundle and validate it.
fn verify_backup_database(bundle: &Path, root: &Path) -> Result<()> {
    let mut archive = ZipArchive::new(File::open(bundle).map_err(error)?).map_err(error)?;
    let entry = archive
        .by_name("user-data/redux.db")
        .map_err(|_| "The pre-update backup does not contain a library database.".to_owned())?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(error)?;
    let copied = std::io::copy(
        &mut entry.take(MAX_BACKUP_DATABASE_BYTES + 1),
        temporary.as_file_mut(),
    )
    .map_err(error)?;
    if copied > MAX_BACKUP_DATABASE_BYTES {
        return Err("The pre-update database backup exceeds the size limit.".into());
    }
    temporary.as_file().sync_all().map_err(error)?;
    check_database_integrity(temporary.path(), "The pre-update database backup")
}

/// Build one pre-update bundle from explicit roots.
fn create_update_backup_at(
    root: &Path,
    themes: &Path,
    external_root: &Path,
    from: &str,
    to: &str,
) -> Result<String> {
    let directory = root.join("backups");
    fs::create_dir_all(&directory).map_err(error)?;
    let stamp = crate::storage::now_ms();
    let target = directory.join(format!(
        "pre-update-{}-to-{}-{stamp}.zip",
        safe_file_component(from),
        safe_file_component(to)
    ));
    // VACUUM INTO refuses an existing target, so the snapshot lives in a fresh
    // directory beside the live files and is removed with it.
    let snapshot_directory = tempfile::tempdir_in(root).map_err(error)?;
    let live = root.join("redux.db");
    let snapshot = live
        .is_file()
        .then(|| snapshot_directory.path().join("redux.db"));
    if let Some(snapshot) = &snapshot {
        snapshot_database(&live, snapshot)?;
    }
    let parts = ["database", "themes", "backgrounds", "skins", "extensions"];
    let manifest = serde_json::json!({
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "kind": "pre-update",
        "from": from,
        "to": to,
        "parts": parts,
        "createdAt": stamp,
    });
    let publish = (|| -> Result<()> {
        write_bundle(
            &target,
            root,
            themes,
            external_root,
            snapshot.as_deref(),
            &parts,
            &manifest,
        )?;
        if snapshot.is_some() {
            verify_backup_database(&target, root)?;
        }
        Ok(())
    })();
    if let Err(error) = publish {
        // The bundle may have been published before its database failed the
        // check; never keep it as a restorable pre-update backup.
        return match fs::remove_file(&target) {
            Ok(()) => Err(error),
            Err(remove) if remove.kind() == std::io::ErrorKind::NotFound => Err(error),
            Err(remove) => Err(format!(
                "{error}; could not remove the rejected backup {}: {remove}",
                target.display()
            )),
        };
    }
    prune_update_backups(&directory, 5);
    Ok(target.to_string_lossy().into_owned())
}

/// Snapshot durable data before an in-app update replaces the executable.
///
/// The database part is a standalone `VACUUM INTO` copy checked with
/// `PRAGMA integrity_check`, so the archive never combines a live main file with
/// a later WAL. The file lives under `user-data/backups`, which the NSIS updater
/// preserves.
pub fn create_update_backup(app: &AppHandle, from: &str, to: &str) -> Result<String> {
    let root = crate::storage::data_dir(app)?;
    let themes = crate::assets::themes::theme_root()?;
    create_update_backup_at(&root, &themes, &crate::storage::user_root()?, from, to)
}

/// Convert an archive entry name into a relative, traversal-free path.
///
/// Backup writers only emit names produced from real user-data files, so the
/// shared relative-path policy still accepts every entry a current backup can
/// contain. Archive names must already be normalized, so a backslash is
/// rejected rather than folded into a different path.
fn entry_relative(name: &str) -> Option<PathBuf> {
    let rest = name.strip_prefix("user-data/")?;
    let relative = crate::storage::path_safety::relative_path(rest)?;
    (relative == rest).then(|| PathBuf::from(relative))
}

/// Classify a relative entry path as one of the bundle parts.
fn part_of(relative: &Path) -> Option<&'static str> {
    let first = relative
        .components()
        .next()?
        .as_os_str()
        .to_str()?
        .to_owned();
    if first == "redux.db" || first.starts_with("redux.db-") {
        return Some("database");
    }
    match first.as_str() {
        "themes" => Some("themes"),
        "skins" => Some("skins"),
        "extensions" => Some("extensions"),
        _ => None,
    }
}

/// Reject existing files and reparse points before restoring external packages.
fn external_restore_target(root: &Path, relative: &Path) -> Result<PathBuf> {
    let mut target = root.to_path_buf();
    for component in relative.components() {
        target.push(component.as_os_str());
        match fs::symlink_metadata(&target) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!("backup_resource_conflict:{}", target.display()));
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(format!("backup_resource_conflict:{}", target.display()));
                    }
                }
                if target == root.join(relative) {
                    return Err(format!("backup_resource_conflict:{}", target.display()));
                }
                if !metadata.is_dir() {
                    return Err(format!("backup_resource_conflict:{}", target.display()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(target)
}

/// Restores the chosen parts of a bundle. The database is staged beside the live
/// files and promoted by `promote_pending_import` before the next start.
#[tauri::command]
pub fn import_app_backup(
    app: AppHandle,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    parts: Option<Vec<String>>,
) -> Result<ImportOutcome> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Backup file does not exist.".into());
    }
    let chosen = selected_parts(parts);
    if chosen.is_empty() {
        return Err("Select at least one item.".into());
    }
    let root = crate::storage::data_dir(&app)?;
    let themes = crate::assets::themes::theme_root()?;
    let deployment = crate::storage::user_root()?;
    import_bundle(&root, &themes, &deployment, &source, &chosen)
}

/// Import selected parts from `source` into explicit data roots.
///
/// The database is staged and validated before any non-database part is
/// restored. The import-ready marker is written last, so an interrupted import
/// is discarded instead of being promoted on the next start.
fn import_bundle(
    root: &Path,
    themes: &Path,
    deployment: &Path,
    source: &Path,
    chosen: &[&str],
) -> Result<ImportOutcome> {
    if root.join(PROMOTION_JOURNAL).is_file() {
        return Err(
            "A previous database update could not be completed. Restart the application before importing again."
                .into(),
        );
    }
    let file = File::open(source).map_err(error)?;
    let mut archive = ZipArchive::new(file).map_err(error)?;
    if archive.len() > MAX_BACKUP_ENTRIES {
        return Err("Backup file contains too many entries.".into());
    }

    let manifest: serde_json::Value = {
        let entry = archive.by_name("manifest.json").map_err(error)?;
        if entry.size() > MAX_BACKUP_MANIFEST_BYTES {
            return Err("Backup manifest is too large.".into());
        }
        let mut text = String::new();
        entry
            .take(MAX_BACKUP_MANIFEST_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(error)?;
        if text.len() as u64 > MAX_BACKUP_MANIFEST_BYTES {
            return Err("Backup manifest is too large.".into());
        }
        serde_json::from_str(&text).map_err(error)?
    };
    if manifest.get("format").and_then(|value| value.as_str()) != Some(BACKUP_FORMAT) {
        return Err("This is not an RPE Redux backup file.".into());
    }
    if manifest
        .get("version")
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
        > BACKUP_VERSION as u64
    {
        return Err(
            "Backup was created by a newer application version and cannot be imported.".into(),
        );
    }

    // Check the whole selected external-package set before changing any files.
    let mut external_paths = std::collections::BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(error)?;
        let Some(relative) = entry_relative(&name) else {
            continue;
        };
        let Some(part) = part_of(&relative) else {
            continue;
        };
        if !chosen.contains(&part) || !matches!(part, "skins" | "extensions") {
            continue;
        }
        if !external_paths.insert(relative.clone()) {
            return Err(format!("backup_resource_conflict:{}", name));
        }
        external_restore_target(deployment, &relative)?;
    }

    // A database that is not a valid library is rejected here, before any live
    // file or non-database part is touched.
    let staged_database = stage_database_import(&mut archive, chosen, root)?;
    let mut total = staged_database.unwrap_or(0);
    let (mut restored, restored_bytes, destination_restart) =
        match restore_archive_parts(&mut archive, chosen, root, themes, deployment) {
            Ok(result) => result,
            Err(error) => {
                cleanup_staged_database(root);
                return Err(error);
            }
        };
    total = total
        .checked_add(restored_bytes)
        .ok_or("Backup size overflow")?;
    if total > MAX_BACKUP_TOTAL_BYTES {
        cleanup_staged_database(root);
        return Err("Extracted backup exceeds the size limit.".into());
    }
    if staged_database.is_some() {
        if let Err(error) = write_import_ready(root) {
            cleanup_staged_database(root);
            return Err(error);
        }
        restored.insert(0, "database".to_owned());
    }
    Ok(ImportOutcome {
        parts: restored,
        restart_required: staged_database.is_some() || destination_restart,
    })
}

/// Restore the non-database parts of a bundle and report the restored part names
/// and byte count.
fn restore_archive_parts(
    archive: &mut ZipArchive<File>,
    chosen: &[&str],
    root: &Path,
    themes: &Path,
    deployment: &Path,
) -> Result<(Vec<String>, u64, bool)> {
    let mut restored: Vec<String> = Vec::new();
    let mut restart_required = false;
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(error)?.into_owned();
        let Some(relative) = entry_relative(&name) else {
            continue;
        };
        let Some(part) = part_of(&relative) else {
            continue;
        };
        if !chosen.contains(&part) || part == "database" {
            continue;
        }
        let label = name;
        let bytes = read_limited(&mut entry, MAX_BACKUP_FILE_BYTES, &label)?;
        // Themes live in the deployment root, not in the data root; the bundle
        // still stores them under the shared `user-data/themes` prefix.
        let target = if part == "themes" {
            themes.join(relative.strip_prefix("themes").map_err(error)?)
        } else if matches!(part, "skins" | "extensions") {
            external_restore_target(deployment, &relative)?
        } else {
            root.join(&relative)
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(error)?;
        }
        if matches!(part, "skins" | "extensions") {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(error)?;
            file.write_all(&bytes).map_err(error)?;
        } else {
            fs::write(&target, &bytes).map_err(error)?;
        }
        total = total
            .checked_add(bytes.len() as u64)
            .ok_or("Backup size overflow")?;
        if matches!(part, "themes" | "skins" | "extensions") {
            restart_required = true;
        }
        if !restored.iter().any(|entry| entry == part) {
            restored.push(part.to_owned());
        }
        if total > MAX_BACKUP_TOTAL_BYTES {
            return Err("Extracted backup exceeds the size limit.".into());
        }
    }
    Ok((restored, total, restart_required))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn update_backup_contains_external_skins_and_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().join("resources");
        fs::create_dir_all(resources.join("skins/example")).unwrap();
        fs::create_dir_all(resources.join("extensions/sample")).unwrap();
        fs::create_dir_all(dir.path().join("extensions/managed")).unwrap();
        fs::write(resources.join("skins/example/skin.json"), b"skin").unwrap();
        fs::write(
            resources.join("extensions/sample/manifest.json"),
            b"extension",
        )
        .unwrap();
        fs::write(
            dir.path().join("extensions/managed/manifest.json"),
            b"managed",
        )
        .unwrap();
        let target = dir.path().join("backup.zip");
        write_bundle(
            &target,
            dir.path(),
            &dir.path().join("themes"),
            &resources,
            None,
            &["skins", "extensions"],
            &serde_json::json!({}),
        )
        .unwrap();
        let mut archive = ZipArchive::new(File::open(target).unwrap()).unwrap();
        for (path, expected) in [
            ("user-data/skins/example/skin.json", "skin"),
            ("user-data/extensions/sample/manifest.json", "extension"),
            ("user-data/extensions/managed/manifest.json", "managed"),
        ] {
            let mut content = String::new();
            archive
                .by_name(path)
                .unwrap()
                .read_to_string(&mut content)
                .unwrap();
            assert_eq!(content, expected);
        }
    }

    #[test]
    fn external_packages_reject_existing_targets() {
        let root = tempfile::tempdir().unwrap();
        let relative = Path::new("skins/example/skin.json");
        assert!(external_restore_target(root.path(), relative).is_ok());
        fs::create_dir_all(root.path().join("skins/example")).unwrap();
        fs::write(root.path().join(relative), b"user content").unwrap();
        let error = external_restore_target(root.path(), relative).unwrap_err();
        assert!(error.contains("backup_resource_conflict:"));
        assert_eq!(
            fs::read(root.path().join(relative)).unwrap(),
            b"user content"
        );
    }

    #[test]
    fn entry_relative_rejects_traversal_and_platform_paths() {
        // Names produced by `archive_path` from real Windows user-data files.
        for safe_path in [
            "user-data/redux.db",
            "user-data/redux.db-wal",
            "user-data/themes/theme.zip",
            "user-data/extensions/sample/manifest.json",
            "user-data/skins/example/skin.json",
            "user-data/themes/theme with space.rpetheme",
        ] {
            assert!(entry_relative(safe_path).is_some(), "{safe_path}");
        }
        for unsafe_path in [
            "user-data/../redux.db",
            "user-data/redux.db/../../escape",
            "/user-data/redux.db",
            "user-data/C:/redux.db",
            "user-data/..\\escape",
            "user-data/",
            "user-data/CON",
            "user-data/themes/theme.",
            "user-data/themes/theme ",
            "user-data/themes/bad\nname",
            "user-data/themes/bad<name",
        ] {
            assert!(entry_relative(unsafe_path).is_none(), "{unsafe_path}");
        }
    }

    #[test]
    fn read_limited_stops_at_the_declared_limit() {
        let bytes = read_limited(Cursor::new(vec![0u8; 8]), 4, "test").expect_err("limit");
        assert!(bytes.contains("too large"));
        assert!(read_limited(Cursor::new(vec![0u8; 4]), 4, "test").is_ok());
    }

    /// Minimal library schema accepted by `validate_staged_database`.
    const LIBRARY_SCHEMA: &str = "
        CREATE TABLE projects (id TEXT PRIMARY KEY);
        CREATE TABLE revisions (id TEXT PRIMARY KEY);
        CREATE TABLE preferences (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE assets (hash TEXT PRIMARY KEY);
        CREATE TABLE project_assets (
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (project_id, name)
        );
        CREATE TABLE revision_assets (
            revision_id TEXT NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (revision_id, name)
        );
    ";

    /// Build a valid library database and return its closed file bytes.
    fn library_bytes(marker: &str) -> Vec<u8> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("redux.db");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(LIBRARY_SCHEMA).unwrap();
        connection
            .execute(
                "INSERT INTO preferences (id, data) VALUES (1, ?1)",
                [marker],
            )
            .unwrap();
        drop(connection);
        fs::read(&path).unwrap()
    }

    /// Build a valid SQLite database without the library tables.
    fn foreign_sqlite_bytes() -> Vec<u8> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("foreign.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('x');")
            .unwrap();
        drop(connection);
        fs::read(&path).unwrap()
    }

    /// Write a bundle with the standard manifest and the given `user-data/`
    /// entries.
    fn write_bundle_entries(path: &Path, entries: &[(&str, &[u8])]) {
        let mut archive = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default();
        archive.start_file("manifest.json", options).unwrap();
        archive
            .write_all(br#"{"format":"rpe-redux-app-backup","version":2,"parts":["database"]}"#)
            .unwrap();
        for (name, bytes) in entries {
            archive.start_file(*name, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.finish().unwrap();
    }

    /// Write a bundle that carries only one database entry.
    fn write_database_bundle(path: &Path, database: &[u8]) {
        write_bundle_entries(path, &[("user-data/redux.db", database)]);
    }

    /// Create a data root and import a database bundle into it.
    fn import_database(root: &Path, bundle: &Path) -> Result<ImportOutcome> {
        let themes = root.join("themes");
        let deployment = root.join("deployment");
        fs::create_dir_all(&themes).unwrap();
        fs::create_dir_all(&deployment).unwrap();
        import_bundle(root, &themes, &deployment, bundle, &["database"])
    }

    /// Backup stamps found beside the live database, oldest first.
    fn backup_stamps(root: &Path) -> Vec<u64> {
        let mut stamps = fs::read_dir(root)
            .unwrap()
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().into_string().ok()?;
                name.strip_prefix(DATABASE_BACKUP_PREFIX)?.parse().ok()
            })
            .collect::<Vec<u64>>();
        stamps.sort_unstable();
        stamps
    }

    #[test]
    fn import_rejects_invalid_databases_and_keeps_live_data_untouched() {
        let mut wrong_header = vec![0u8; 100];
        wrong_header[..16].copy_from_slice(b"Not a SQLite db\0");
        let mut corrupt_pages = library_bytes("corrupt");
        // Keep the header so the rejection comes from SQLite, not the magic check.
        for byte in &mut corrupt_pages[100..200] {
            *byte = 0;
        }
        for (case, database, code) in [
            ("wrong header", wrong_header, ERROR_DATABASE_INVALID_HEADER),
            (
                "short header",
                b"SQLite format 3\0".to_vec(),
                ERROR_DATABASE_TOO_SMALL,
            ),
            ("empty", Vec::new(), ERROR_DATABASE_TOO_SMALL),
            (
                "text",
                b"not a sqlite database".to_vec(),
                ERROR_DATABASE_TOO_SMALL,
            ),
            ("corrupt pages", corrupt_pages, ERROR_DATABASE_INTEGRITY),
            (
                "foreign sqlite",
                foreign_sqlite_bytes(),
                ERROR_DATABASE_NOT_LIBRARY,
            ),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("user-data");
            fs::create_dir_all(&root).unwrap();
            let live = library_bytes("live");
            fs::write(root.join("redux.db"), &live).unwrap();
            let bundle = dir.path().join("backup.zip");
            write_database_bundle(&bundle, &database);

            let error = import_database(&root, &bundle).expect_err(case);
            assert!(error.starts_with(code), "{case}: {error}");
            assert_eq!(
                fs::read(root.join("redux.db")).unwrap(),
                live,
                "{case}: live database changed"
            );
            assert!(!root.join(STAGED_DATABASE).exists(), "{case}");
            assert!(!root.join(IMPORT_READY).exists(), "{case}");
        }
    }

    #[test]
    fn import_rejects_a_newer_library_schema() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let live = library_bytes("live");
        fs::write(root.join("redux.db"), &live).unwrap();

        let source_dir = dir.path().join("source");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("newer.db");
        let connection = Connection::open(&source).unwrap();
        connection.execute_batch(LIBRARY_SCHEMA).unwrap();
        connection
            .execute_batch("PRAGMA application_id = 1380992338; PRAGMA user_version = 99;")
            .unwrap();
        drop(connection);

        let bundle = dir.path().join("newer.zip");
        write_database_bundle(&bundle, &fs::read(&source).unwrap());
        let error = import_database(&root, &bundle).expect_err("newer schema");
        assert!(error.starts_with(ERROR_DATABASE_SCHEMA_TOO_NEW), "{error}");
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), live);
    }

    #[test]
    fn import_failure_after_staging_removes_staged_files_and_keeps_live_data() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        let themes = dir.path().join("themes");
        let deployment = dir.path().join("deployment");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(themes.join("blocked")).unwrap();
        fs::create_dir_all(&deployment).unwrap();
        let live = library_bytes("live");
        fs::write(root.join("redux.db"), &live).unwrap();
        let replacement = library_bytes("replacement");
        let bundle = dir.path().join("partial.zip");
        write_bundle_entries(
            &bundle,
            &[
                ("user-data/redux.db", &replacement),
                ("user-data/themes/blocked", b"not a directory"),
            ],
        );

        let error = import_bundle(
            &root,
            &themes,
            &deployment,
            &bundle,
            &["database", "themes"],
        )
        .expect_err("theme target is a directory");

        assert!(!error.is_empty());
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), live);
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join("redux.db.import-wal").exists());
        assert!(!root.join(IMPORT_READY).exists());
    }

    #[test]
    fn import_accepts_a_wal_database_with_uncheckpointed_pages() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let live = library_bytes("live");
        fs::write(root.join("redux.db"), &live).unwrap();

        let source_dir = dir.path().join("source");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("redux.db");
        let connection = Connection::open(&source).unwrap();
        connection
            .execute_batch("PRAGMA journal_mode = WAL;")
            .unwrap();
        connection.execute_batch(LIBRARY_SCHEMA).unwrap();
        connection
            .execute("INSERT INTO preferences (id, data) VALUES (1, 'wal')", [])
            .unwrap();
        let main = fs::read(&source).unwrap();
        let wal = fs::read(source_dir.join("redux.db-wal")).unwrap();
        let shm = fs::read(source_dir.join("redux.db-shm")).unwrap();
        drop(connection);

        let bundle = dir.path().join("wal.zip");
        write_bundle_entries(
            &bundle,
            &[
                ("user-data/redux.db", &main),
                ("user-data/redux.db-wal", &wal),
                ("user-data/redux.db-shm", &shm),
            ],
        );
        import_database(&root, &bundle).unwrap();
        assert!(root.join("redux.db.import-wal").is_file());
        promote_staged_database(&root).unwrap();

        let connection = Connection::open(root.join("redux.db")).unwrap();
        let data: String = connection
            .query_row("SELECT data FROM preferences WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(data, "wal");
        assert_eq!(backup_stamps(&root).len(), 1);
    }

    #[test]
    fn promotion_replaces_the_live_database_and_keeps_one_backup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let first = library_bytes("first");
        fs::write(root.join("redux.db"), &first).unwrap();
        let second = library_bytes("second");
        let bundle = dir.path().join("first.zip");
        write_database_bundle(&bundle, &second);

        let outcome = import_database(&root, &bundle).unwrap();
        assert!(outcome.restart_required);
        assert_eq!(outcome.parts, vec!["database".to_owned()]);
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), first);
        assert!(root.join(IMPORT_READY).is_file());

        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), second);
        let stamps = backup_stamps(&root);
        assert_eq!(stamps.len(), 1);
        assert_eq!(
            fs::read(root.join(format!("{DATABASE_BACKUP_PREFIX}{}", stamps[0]))).unwrap(),
            first
        );
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());

        // A later import replaces the retained set with the newest previous one.
        let third = library_bytes("third");
        let bundle = dir.path().join("second.zip");
        write_database_bundle(&bundle, &third);
        import_database(&root, &bundle).unwrap();
        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), third);
        let stamps = backup_stamps(&root);
        assert_eq!(stamps.len(), 1);
        assert_eq!(
            fs::read(root.join(format!("{DATABASE_BACKUP_PREFIX}{}", stamps[0]))).unwrap(),
            second
        );
    }

    #[test]
    fn promotion_rejects_a_corrupt_staged_database_without_touching_live_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let live = library_bytes("live");
        fs::write(root.join("redux.db"), &live).unwrap();
        fs::write(root.join(STAGED_DATABASE), b"corrupt").unwrap();
        write_import_ready(&root).unwrap();

        let error = promote_staged_database(&root).expect_err("staged database");
        assert!(error.contains("current library was kept"), "{error}");
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), live);
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn promotion_failure_restores_the_previous_database() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let previous = library_bytes("previous");
        fs::write(root.join("redux.db"), &previous).unwrap();
        fs::write(root.join("redux.db-wal"), b"old wal").unwrap();
        fs::write(root.join(STAGED_DATABASE), library_bytes("replacement")).unwrap();
        fs::write(root.join("redux.db.import-wal"), b"new wal").unwrap();
        write_import_ready(&root).unwrap();

        // Let the main file install, then fail while installing the WAL.
        FAIL_INSTALL_AFTER.with(|remaining| remaining.set(1));
        let error = promote_staged_database(&root).expect_err("install should fail");
        FAIL_INSTALL_AFTER.with(|remaining| remaining.set(usize::MAX));

        assert!(error.contains("previous library was restored"), "{error}");
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), previous);
        assert_eq!(fs::read(root.join("redux.db-wal")).unwrap(), b"old wal");
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join("redux.db.import-wal").exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn startup_discards_a_staged_database_without_a_ready_marker() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let live = library_bytes("live");
        fs::write(root.join("redux.db"), &live).unwrap();
        fs::write(root.join(STAGED_DATABASE), library_bytes("replacement")).unwrap();

        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), live);
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn promotion_failure_before_install_keeps_unmoved_live_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let previous = library_bytes("previous");
        fs::write(root.join("redux.db"), &previous).unwrap();
        fs::write(root.join("redux.db-shm"), b"old shm").unwrap();
        // A directory at the WAL path fails the backup step after the main file
        // has already moved but before installation begins.
        fs::create_dir(root.join("redux.db-wal")).unwrap();
        fs::write(root.join(STAGED_DATABASE), library_bytes("replacement")).unwrap();
        write_import_ready(&root).unwrap();

        let error = promote_staged_database(&root).expect_err("backup should fail");

        assert!(error.contains("previous library was restored"), "{error}");
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), previous);
        assert_eq!(fs::read(root.join("redux.db-shm")).unwrap(), b"old shm");
        assert!(root.join("redux.db-wal").is_dir());
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn startup_rolls_back_a_promotion_interrupted_after_backup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let previous = library_bytes("previous");
        fs::write(root.join("redux.db"), &previous).unwrap();
        fs::write(root.join(STAGED_DATABASE), library_bytes("replacement")).unwrap();
        write_import_ready(&root).unwrap();
        let stamp = next_backup_stamp(&root);
        write_promotion_journal(
            &root,
            &PromotionJournal {
                phase: PromotionPhase::Prepared,
                stamp,
            },
        )
        .unwrap();
        fs::rename(
            root.join("redux.db"),
            root.join(database_backup_name("redux.db", stamp)),
        )
        .unwrap();

        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), previous);
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn startup_rolls_back_an_interrupted_install_of_a_corrupt_database() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let previous = library_bytes("previous");
        fs::write(root.join("redux.db"), &previous).unwrap();
        fs::write(root.join(STAGED_DATABASE), b"corrupt").unwrap();
        write_import_ready(&root).unwrap();
        let stamp = next_backup_stamp(&root);
        write_promotion_journal(
            &root,
            &PromotionJournal {
                phase: PromotionPhase::Installing,
                stamp,
            },
        )
        .unwrap();
        fs::rename(
            root.join("redux.db"),
            root.join(database_backup_name("redux.db", stamp)),
        )
        .unwrap();

        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), previous);
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());
        assert!(backup_stamps(&root).is_empty());
    }

    #[test]
    fn startup_finishes_a_promotion_interrupted_during_install() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        fs::create_dir_all(&root).unwrap();
        let previous = library_bytes("previous");
        fs::write(root.join("redux.db"), &previous).unwrap();
        let replacement = library_bytes("replacement");
        fs::write(root.join(STAGED_DATABASE), &replacement).unwrap();
        write_import_ready(&root).unwrap();
        let stamp = next_backup_stamp(&root);
        write_promotion_journal(
            &root,
            &PromotionJournal {
                phase: PromotionPhase::Installing,
                stamp,
            },
        )
        .unwrap();
        fs::rename(
            root.join("redux.db"),
            root.join(database_backup_name("redux.db", stamp)),
        )
        .unwrap();

        promote_staged_database(&root).unwrap();
        assert_eq!(fs::read(root.join("redux.db")).unwrap(), replacement);
        assert_eq!(
            fs::read(root.join(database_backup_name("redux.db", stamp))).unwrap(),
            previous
        );
        assert!(!root.join(STAGED_DATABASE).exists());
        assert!(!root.join(IMPORT_READY).exists());
        assert!(!root.join(PROMOTION_JOURNAL).exists());
        assert_eq!(backup_stamps(&root), vec![stamp]);
    }

    #[test]
    fn update_backup_snapshots_an_open_wal_library() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        let themes = dir.path().join("themes");
        let external = dir.path().join("deployment");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&themes).unwrap();
        fs::create_dir_all(&external).unwrap();
        let live = Connection::open(root.join("redux.db")).unwrap();
        live.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        live.execute_batch(LIBRARY_SCHEMA).unwrap();
        live.execute(
            "INSERT INTO preferences (id, data) VALUES (1, 'snapshot')",
            [],
        )
        .unwrap();
        // Keep the connection open: the row may still live only in the WAL.
        assert!(fs::metadata(root.join("redux.db-wal")).unwrap().len() > 0);

        let backup = create_update_backup_at(&root, &themes, &external, "1.0.0", "2.0.0").unwrap();
        let mut archive = ZipArchive::new(File::open(&backup).unwrap()).unwrap();
        assert!(archive.by_name("user-data/redux.db").is_ok());
        assert!(archive.by_name("user-data/redux.db-wal").is_err());
        assert!(archive.by_name("user-data/redux.db-shm").is_err());

        let mut entry = archive.by_name("user-data/redux.db").unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        drop(entry);
        let restored_path = dir.path().join("restored.db");
        fs::write(&restored_path, bytes).unwrap();
        let restored = Connection::open(&restored_path).unwrap();
        let data: String = restored
            .query_row("SELECT data FROM preferences WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(data, "snapshot");
        let integrity: String = restored
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn update_backup_can_be_imported_and_promoted() {
        let dir = tempfile::tempdir().unwrap();
        let source_root = dir.path().join("source-user-data");
        let themes = dir.path().join("themes");
        let external = dir.path().join("deployment");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(&themes).unwrap();
        fs::create_dir_all(&external).unwrap();
        let live = Connection::open(source_root.join("redux.db")).unwrap();
        live.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
        live.execute_batch(LIBRARY_SCHEMA).unwrap();
        live.execute(
            "INSERT INTO preferences (id, data) VALUES (1, 'restore')",
            [],
        )
        .unwrap();
        let backup =
            create_update_backup_at(&source_root, &themes, &external, "1.0.0", "2.0.0").unwrap();
        drop(live);

        let restore_root = dir.path().join("restore-user-data");
        let restore_themes = dir.path().join("restore-themes");
        let restore_external = dir.path().join("restore-deployment");
        fs::create_dir_all(&restore_root).unwrap();
        fs::create_dir_all(&restore_themes).unwrap();
        fs::create_dir_all(&restore_external).unwrap();
        let outcome = import_bundle(
            &restore_root,
            &restore_themes,
            &restore_external,
            Path::new(&backup),
            &["database"],
        )
        .unwrap();
        assert!(outcome.restart_required);
        promote_staged_database(&restore_root).unwrap();

        let restored = Connection::open(restore_root.join("redux.db")).unwrap();
        let data: String = restored
            .query_row("SELECT data FROM preferences WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(data, "restore");
    }

    #[test]
    fn integrity_check_rejects_a_corrupt_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.db");
        fs::write(&path, b"not a sqlite database").unwrap();
        let error = check_database_integrity(&path, "test backup").expect_err("corrupt database");
        assert!(error.contains("test backup"), "{error}");
    }

    #[test]
    fn update_backup_aborts_when_the_live_database_cannot_be_snapshotted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("user-data");
        let themes = dir.path().join("themes");
        let external = dir.path().join("deployment");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&themes).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(root.join("redux.db"), b"not a sqlite database").unwrap();

        let error = create_update_backup_at(&root, &themes, &external, "1.0.0", "2.0.0")
            .expect_err("corrupt live database");
        assert!(error.contains("pre-update"), "{error}");
        let backups = fs::read_dir(root.join("backups")).unwrap().count();
        assert_eq!(backups, 0);
    }
}

/// Promotion step recorded in the transaction journal.
#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum PromotionPhase {
    /// Live files have not all been moved to their backups yet.
    Prepared,
    /// Every live file is in its backup; staged files may be moving into place.
    Installing,
}

/// Describes an in-flight promotion so the next start can finish or undo it.
#[derive(serde::Serialize, serde::Deserialize)]
struct PromotionJournal {
    phase: PromotionPhase,
    stamp: u64,
}

/// Unique backup name for one live database file.
fn database_backup_name(live: &str, stamp: u64) -> String {
    if live == "redux.db" {
        return format!("{DATABASE_BACKUP_PREFIX}{stamp}");
    }
    format!("{live}.bak-{stamp}")
}

/// Choose a backup stamp that no earlier transaction is using.
fn next_backup_stamp(root: &Path) -> u64 {
    let mut stamp = crate::storage::now_ms();
    while DATABASE_FILES
        .iter()
        .any(|(live, _)| root.join(database_backup_name(live, stamp)).exists())
    {
        stamp = stamp.saturating_add(1);
    }
    stamp
}

/// Atomically replace the promotion journal with the next transaction step.
fn write_promotion_journal(root: &Path, journal: &PromotionJournal) -> Result<()> {
    let path = root.join(PROMOTION_JOURNAL);
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(error)?;
    serde_json::to_writer(temporary.as_file_mut(), journal).map_err(error)?;
    temporary.as_file().sync_all().map_err(error)?;
    temporary
        .persist(&path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

/// Read the journal, treating a missing file as no transaction.
fn read_promotion_journal(root: &Path) -> Result<Option<PromotionJournal>> {
    let path = root.join(PROMOTION_JOURNAL);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Database promotion journal is unreadable: {error}"))
}

/// Move one staged file into place.
fn install_staged_file(staged: &Path, live: &Path) -> Result<()> {
    #[cfg(test)]
    if FAIL_INSTALL_AFTER.with(|remaining| match remaining.get() {
        0 => true,
        value => {
            remaining.set(value - 1);
            false
        }
    }) {
        return Err("Injected staged database installation failure.".to_owned());
    }
    fs::rename(staged, live).map_err(error)
}

#[cfg(test)]
thread_local! {
    /// Number of staged-file installs to allow before one fails in a test.
    static FAIL_INSTALL_AFTER: std::cell::Cell<usize> = const { std::cell::Cell::new(usize::MAX) };
}

/// Move live database files into this transaction's backups.
fn back_up_live_database(root: &Path, stamp: u64) -> Result<()> {
    for (live_name, _) in DATABASE_FILES {
        let live = root.join(live_name);
        if live.is_file() {
            fs::rename(&live, root.join(database_backup_name(live_name, stamp))).map_err(error)?;
        } else if live.exists() {
            return Err(format!(
                "The live database path is not a file: {}",
                live.display()
            ));
        }
    }
    Ok(())
}

/// Run one promotion transaction. The caller has already written the `Prepared`
/// journal entry and validates the staged database before calling this.
fn promote_transaction(root: &Path, stamp: u64) -> Result<()> {
    back_up_live_database(root, stamp)?;
    write_promotion_journal(
        root,
        &PromotionJournal {
            phase: PromotionPhase::Installing,
            stamp,
        },
    )?;
    for (live_name, staged_name) in DATABASE_FILES {
        let staged = root.join(staged_name);
        if staged.is_file() {
            install_staged_file(&staged, &root.join(live_name))?;
        }
    }
    if !root.join("redux.db").is_file() {
        return Err("The staged database disappeared before it could be installed.".into());
    }
    // Keep the previous set until the installed copy passes the same validation
    // as the staged one; only then may the caller prune the older backups.
    validate_staged_database(&root.join("redux.db"))
        .map_err(|error| format!("The installed database failed validation: {error}"))?;
    Ok(())
}

/// Restore this transaction's backups. `remove_installed` also removes live
/// files that have no backup, which can only be staged files already installed
/// by an interrupted transaction.
fn rollback_promotion(root: &Path, stamp: u64, remove_installed: bool) -> Result<()> {
    for (live_name, _) in DATABASE_FILES {
        let live = root.join(live_name);
        let backup = root.join(database_backup_name(live_name, stamp));
        if backup.is_file() {
            if live.exists() {
                fs::remove_file(&live).map_err(error)?;
            }
            fs::rename(&backup, &live).map_err(error)?;
        } else if remove_installed && live.is_file() {
            fs::remove_file(&live).map_err(error)?;
        }
    }
    Ok(())
}

/// Finish installing a transaction that reached the `Installing` step and check
/// the installed database before declaring the transaction complete.
fn finish_promotion(root: &Path) -> Result<()> {
    for (live_name, staged_name) in DATABASE_FILES {
        let staged = root.join(staged_name);
        if !staged.is_file() {
            continue;
        }
        let live = root.join(live_name);
        if live.exists() {
            fs::remove_file(&live).map_err(error)?;
        }
        install_staged_file(&staged, &live)?;
    }
    if !root.join("redux.db").is_file() {
        return Err("The interrupted database update lost its main file.".into());
    }
    validate_staged_database(&root.join("redux.db"))?;
    Ok(())
}

/// Resolve a transaction left behind by an interrupted start. A prepared
/// transaction is undone, while a transaction that already moved the old files
/// aside is completed; both outcomes are idempotent.
fn recover_interrupted_promotion(root: &Path) -> Result<()> {
    let Some(journal) = read_promotion_journal(root)? else {
        return Ok(());
    };
    let result = match journal.phase {
        PromotionPhase::Prepared => rollback_promotion(root, journal.stamp, false),
        PromotionPhase::Installing => finish_promotion(root).or_else(|error| {
            rollback_promotion(root, journal.stamp, true)
                .map_err(|rollback| format!("{error} (rollback failed: {rollback})"))
        }),
    };
    match result {
        Ok(()) => {
            cleanup_staged_database(root);
            remove_promotion_journal(root)?;
            prune_database_backups(root);
            Ok(())
        }
        Err(error) => Err(format!(
            "Could not recover the interrupted database update; the transaction journal was kept: {error}"
        )),
    }
}

/// Remove the transaction journal; a missing file is the normal case.
fn remove_promotion_journal(root: &Path) -> Result<()> {
    match fs::remove_file(root.join(PROMOTION_JOURNAL)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Remove older pre-import database sets, keeping the newest one.
fn prune_database_backups(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut stamps = BTreeSet::new();
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if let Some(stamp) = name
            .strip_prefix(DATABASE_BACKUP_PREFIX)
            .and_then(|value| value.parse::<u64>().ok())
        {
            stamps.insert(stamp);
        }
    }
    let mut newest_first: Vec<u64> = stamps.into_iter().collect();
    newest_first.sort_unstable_by(|left, right| right.cmp(left));
    for stamp in newest_first.into_iter().skip(DATABASE_BACKUPS_KEPT) {
        for (live_name, _) in DATABASE_FILES {
            let _ = fs::remove_file(root.join(database_backup_name(live_name, stamp)));
        }
    }
}

/// Promote a complete staged database import. Called once at startup, before the
/// local service opens the database; safe to run after an interrupted attempt.
fn promote_staged_database(root: &Path) -> Result<()> {
    recover_interrupted_promotion(root)?;
    if !import_ready(root) {
        cleanup_staged_database(root);
        return Ok(());
    }
    let staged = root.join(STAGED_DATABASE);
    if !staged.is_file() {
        cleanup_staged_database(root);
        return Err("Staged database import is missing; the current library was kept.".into());
    }
    if let Err(error) = validate_staged_database(&staged) {
        cleanup_staged_database(root);
        return Err(format!(
            "Staged database import was rejected; the current library was kept: {error}"
        ));
    }
    let stamp = next_backup_stamp(root);
    if let Err(error) = write_promotion_journal(
        root,
        &PromotionJournal {
            phase: PromotionPhase::Prepared,
            stamp,
        },
    ) {
        return Err(format!(
            "Could not record the database promotion; the current library was kept: {error}"
        ));
    }
    match promote_transaction(root, stamp) {
        Ok(()) => {
            cleanup_staged_database(root);
            remove_promotion_journal(root)?;
            prune_database_backups(root);
            Ok(())
        }
        Err(error) => {
            // Only the `Installing` phase guarantees every original live file
            // has a backup, so only then may rollback delete live files that
            // have no backup.
            let installing = matches!(
                read_promotion_journal(root),
                Ok(Some(PromotionJournal {
                    phase: PromotionPhase::Installing,
                    stamp: journal_stamp,
                })) if journal_stamp == stamp
            );
            match rollback_promotion(root, stamp, installing) {
                Ok(()) => {
                    cleanup_staged_database(root);
                    let _ = remove_promotion_journal(root);
                    prune_database_backups(root);
                    Err(format!(
                        "Could not install the imported database; the previous library was restored: {error}"
                    ))
                }
                Err(rollback) => Err(format!(
                    "Could not install the imported database ({error}) and could not restore the previous library ({rollback}). The transaction journal was kept for the next start."
                )),
            }
        }
    }
}

/// Promote a staged database import, if one is waiting for the next start.
pub fn promote_pending_import(app: &AppHandle) -> Result<()> {
    let root = crate::storage::data_dir(app)?;
    promote_staged_database(&root)
}
