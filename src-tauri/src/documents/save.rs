//! Saves a document: packs the chart, resources, and assets into a `.pez`
//! archive, tracks the pending save session, and reports the resulting disk
//! snapshot.

use super::{
    atomic_write, decode_session_chunk, document, error, external_resources_of,
    normalize_resource_name, remap_chart, resolve_path, resolve_references, resource_names, watch,
    zip_name, AssetSource, Document, DocumentHost, ExternalResources, Result, SaveRequest,
    SaveSession, MAX_CHART_BYTES, MAX_RESOURCE_BYTES, MAX_RESOURCE_TOTAL_BYTES,
};
use crate::storage::path_safety::package_id;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{hash_map::Entry, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{
    ipc::{InvokeBody, Request},
    State,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

/// Successful save result: the written path and any rewritten references.
#[derive(Serialize)]
pub struct Saved {
    path: String,
    chart: Option<Value>,
    chart_name: String,
    packed: bool,
    remap: HashMap<String, String>,
    disk_snapshot: Option<String>,
}

/// A save rejected because the document changed on disk after it was opened.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SaveConflict {
    path: String,
    expected_disk_snapshot: Option<String>,
    actual_disk_snapshot: Option<String>,
}

/// Save result discriminated by `status`.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveOutcome {
    Saved(Saved),
    SaveConflict(SaveConflict),
}

/// Internal save failure: a disk conflict or a diagnostic error message.
#[derive(Debug)]
pub(crate) enum SaveFailure {
    Conflict(SaveConflict),
    Error(String),
}

impl From<String> for SaveFailure {
    fn from(error: String) -> Self {
        Self::Error(error)
    }
}

impl From<&'static str> for SaveFailure {
    fn from(error: &'static str) -> Self {
        Self::Error(error.into())
    }
}

impl From<SaveFailure> for String {
    fn from(error: SaveFailure) -> Self {
        match error {
            SaveFailure::Conflict(conflict) => {
                serde_json::to_string(&SaveOutcome::SaveConflict(conflict))
                    .unwrap_or_else(|_| "save_outcome_serialize_failed".into())
            }
            SaveFailure::Error(error) => error,
        }
    }
}

/// Result of writing a document before it is turned into a [`SaveOutcome`].
#[derive(Debug)]
pub(crate) struct Written {
    path: String,
    chart: Value,
    chart_changed: bool,
    pub(crate) chart_name: String,
    packed: bool,
    remap: HashMap<String, String>,
}

/// Validate an asset path for a save session.
pub(crate) fn save_zip_name(name: &str) -> Result<()> {
    zip_name(name).map_err(|_| "unsafe_save_asset_path".into())
}

/// Read the `Path` field from an existing Info.txt body.
fn info_path(info: &[u8]) -> Option<String> {
    String::from_utf8_lossy(info).lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case("Path")
            .then(|| value.trim().to_owned())
    })
}

/// File stem of a chart entry name.
fn chart_stem(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Whether an entry is an Info.txt sidecar at any directory depth.
fn is_info_name(name: &str) -> bool {
    name.rsplit('/')
        .next()
        .is_some_and(|leaf| leaf.eq_ignore_ascii_case("info.txt"))
}

/// Keep the RPE sidecar complete without rewriting fields the caller keeps for
/// another player. The first `#` marker and `Chart:` are mandatory for package
/// discovery; metadata values are refreshed only when the chart authors them.
fn update_info(info: &mut Vec<u8>, chart: &Value, chart_name: &str, chart_id: &str) {
    const KEYS: [&str; 9] = [
        "Name",
        "Path",
        "Song",
        "Picture",
        "Chart",
        "Level",
        "Composer",
        "Charter",
        "Illustration",
    ];
    let text = String::from_utf8_lossy(info).replace("\r\n", "\n");
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    if !lines.iter().any(|line| line.trim() == "#") {
        lines.insert(0, "#".into());
    }
    let mut values: HashMap<String, String> = HashMap::new();
    for line in &lines {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_ascii_lowercase();
            if KEYS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&key))
            {
                values.insert(key, value.trim().to_owned());
            }
        }
    }
    let meta = chart.get("META");
    let field = |key: &str| -> String {
        meta.and_then(|value| value.get(key))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    let authored = [
        ("Name", field("name")),
        ("Composer", field("composer")),
        ("Charter", field("charter")),
        ("Illustration", field("illustration")),
        ("Level", field("level")),
        ("Chart", chart_name.replace('\\', "/")),
        ("Song", field("song")),
        ("Picture", field("background")),
        ("Path", chart_id.trim().to_owned()),
    ];
    for (key, value) in authored {
        if !value.is_empty() {
            values.insert(key.to_ascii_lowercase(), value);
        }
    }
    lines.retain(|line| {
        if line.trim() == "#" {
            return true;
        }
        line.split_once(':')
            .map(|(key, _)| {
                !KEYS
                    .iter()
                    .any(|candidate| candidate.eq_ignore_ascii_case(key.trim()))
            })
            .unwrap_or(true)
    });
    for key in KEYS {
        if let Some(value) = values.get(&key.to_ascii_lowercase()) {
            if !value.is_empty() {
                lines.push(format!("{key}: {value}"));
            }
        }
    }
    *info = (lines.join("\r\n") + "\r\n").into_bytes();
}

/// Start a save session and return its id.
///
/// The chart may arrive here or through [`write_save_chart`] chunks; resources
/// arrive through [`write_save_asset`]. The target is written only by
/// [`finish_save_document`].
#[tauri::command]
pub async fn begin_save_document(
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    ipc: Request<'_>,
    request: SaveRequest,
) -> Result<String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), ipc.headers())?;
    let SaveRequest {
        id,
        path,
        chart,
        disk_snapshot,
        removed,
        extract_to,
        export,
    } = request;
    // The frontend serializes large charts in a worker and may stream the text
    // in bounded chunks, so the chart is parsed on a blocking worker before the
    // save session exists.
    let chart = match chart {
        Some(chart) => Some(
            tauri::async_runtime::spawn_blocking(move || chart.into_value())
                .await
                .map_err(error)??,
        ),
        None => None,
    };
    let target = PathBuf::from(&path);
    let document = id.as_deref().map(|id| document(&state, id)).transpose()?;
    let expected_disk_snapshot = if !export
        && document
            .as_ref()
            .is_some_and(|document| document.path == target)
    {
        Some(
            disk_snapshot
                .or_else(|| {
                    document
                        .as_ref()
                        .and_then(|document| watch::disk_snapshot(document).ok())
                })
                .ok_or("save_baseline_unavailable")?,
        )
    } else {
        None
    };
    let parent = target.parent().unwrap_or(Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".rpe-redux-save-")
        .tempdir_in(parent)
        .map_err(error)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = SaveSession {
        id,
        document,
        target,
        chart,
        chart_bytes: Vec::new(),
        expected_disk_snapshot,
        removed,
        extract_to,
        export,
        staging,
        asset_names: Vec::new(),
        asset_bytes: 0,
    };
    state
        .saves
        .lock()
        .map_err(error)?
        .insert(session_id.clone(), session);
    Ok(session_id)
}

/// Largest raw chart chunk accepted by one IPC write.
pub(crate) const CHART_CHUNK_BYTES: usize = 8 * 1024 * 1024;

/// Append one validated chart chunk to an in-flight save or recovery session.
///
/// The per-chunk and cumulative ceilings match the document host's chart limit,
/// so a streamed save and a recovery draft accept the same chart text.
pub(crate) fn stage_chart_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<()> {
    if chunk.len() > CHART_CHUNK_BYTES {
        return Err("chart_chunk_too_large".into());
    }
    let next = bytes
        .len()
        .checked_add(chunk.len())
        .filter(|length| (*length as u64) <= MAX_CHART_BYTES)
        .ok_or("chart_too_large")?;
    bytes.reserve(next - bytes.len());
    bytes.extend_from_slice(chunk);
    Ok(())
}

/// Return the new cumulative asset size after applying the shared limits.
fn checked_asset_total(length: u64, total: u64) -> Result<u64> {
    if length > MAX_RESOURCE_BYTES {
        return Err("save_asset_too_large".into());
    }
    total
        .checked_add(length)
        .filter(|value| *value <= MAX_RESOURCE_TOTAL_BYTES)
        .ok_or_else(|| "save_assets_too_large".into())
}

/// Account for one resource under the shared per-file and total limits.
pub(crate) fn account_asset_bytes(length: u64, total: &mut u64) -> Result<()> {
    *total = checked_asset_total(length, *total)?;
    Ok(())
}

/// Stage one resource after applying the shared resource-size limits.
pub(crate) fn stage_asset(root: &Path, name: &str, bytes: &[u8], total: &mut u64) -> Result<()> {
    let next = checked_asset_total(bytes.len() as u64, *total)?;
    stage_save_asset(root, name, bytes)?;
    *total = next;
    Ok(())
}

/// Append one raw chart-text chunk to a pending save session.
#[tauri::command]
pub fn write_save_chart(
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
) -> Result<()> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err("chart_chunks_binary_required".into()),
    };
    let (session_id, chunk) = decode_session_chunk(body)?;
    let mut saves = state.saves.lock().map_err(error)?;
    let session = saves.get_mut(&session_id).ok_or("save_session_missing")?;
    if session.chart.is_some() {
        return Err("chart_chunks_not_allowed".into());
    }
    stage_chart_chunk(&mut session.chart_bytes, chunk)
}

/// Decode a raw asset packet: magic, version, session id, name, then bytes.
pub(crate) fn decode_save_asset(body: &[u8]) -> Result<(String, String, &[u8])> {
    if body.len() < 13
        || &body[..4] != super::SAVE_ASSET_MAGIC
        || body[4] != super::SAVE_ASSET_VERSION
    {
        return Err("invalid_save_asset_data".into());
    }
    let session_length = u32::from_le_bytes(body[5..9].try_into().unwrap()) as usize;
    let name_length = u32::from_le_bytes(body[9..13].try_into().unwrap()) as usize;
    let header_end = 13usize
        .checked_add(session_length)
        .and_then(|value| value.checked_add(name_length))
        .ok_or("save_asset_data_too_large")?;
    if header_end > body.len() {
        return Err("incomplete_save_asset_data".into());
    }
    let session_end = 13 + session_length;
    let session_id = std::str::from_utf8(&body[13..session_end])
        .map_err(error)?
        .to_owned();
    let name = std::str::from_utf8(&body[session_end..header_end])
        .map_err(error)?
        .to_owned();
    Ok((session_id, name, &body[header_end..]))
}

/// Write one staged resource, rejecting duplicates and unsafe paths.
pub(crate) fn stage_save_asset(root: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    save_zip_name(name)?;
    let target = root.join(name);
    if target.exists() {
        return Err(format!("duplicate_save_asset:{name}"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(error)?;
    }
    let parent = target.parent().unwrap_or(root);
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    temp.write_all(bytes).map_err(error)?;
    temp.as_file().sync_all().map_err(error)?;
    temp.persist(&target).map_err(error)?;
    Ok(())
}

/// Stage one resource for a save session as binary IPC data.
#[tauri::command]
pub fn write_save_asset(
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
) -> Result<()> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err("save_assets_binary_required".into()),
    };
    let (session_id, name, bytes) = decode_save_asset(body)?;
    let mut saves = state.saves.lock().map_err(error)?;
    let session = saves.get_mut(&session_id).ok_or("save_session_missing")?;
    stage_asset(
        session.staging.path(),
        &name,
        bytes,
        &mut session.asset_bytes,
    )?;
    session.asset_names.push(name);
    Ok(())
}

/// Commit a staged save session and report whether the target was written or had
/// changed on disk.
#[tauri::command]
pub async fn finish_save_document(
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    session_id: String,
) -> Result<SaveOutcome> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let session = state
        .saves
        .lock()
        .map_err(error)?
        .remove(&session_id)
        .ok_or("save_session_missing")?;
    let SaveSession {
        id,
        document,
        target,
        chart,
        chart_bytes,
        expected_disk_snapshot,
        removed,
        extract_to,
        export,
        staging,
        asset_names,
        asset_bytes: _,
    } = session;
    let worker_target = target.clone();
    let worker_document = document.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let chart = match chart {
            Some(chart) => chart,
            None => serde_json::from_slice(&chart_bytes)
                .map_err(|_| SaveFailure::Error("invalid_save_chart".into()))?,
        };
        let assets = AssetSource::Staged {
            root: staging.path(),
            names: &asset_names,
        };
        write_document(
            worker_document.as_ref(),
            &worker_target,
            chart,
            assets,
            removed,
            extract_to,
            expected_disk_snapshot,
        )
    })
    .await
    .map_err(error)?;
    let result = match result {
        Ok(result) => result,
        Err(SaveFailure::Conflict(conflict)) => return Ok(SaveOutcome::SaveConflict(conflict)),
        Err(SaveFailure::Error(error)) => return Err(error),
    };
    finish_saved_document(&state, id, &target, result, document, export)
}

/// Drop a staged save session without touching the target.
#[tauri::command]
pub fn cancel_save_document(state: State<'_, DocumentHost>, session_id: String) -> Result<()> {
    state.saves.lock().map_err(error)?.remove(&session_id);
    Ok(())
}

/// Rewrite chart resource references from the old folder to the new one.
fn rebase(chart: &mut Value, from: &Path, to: &Path) -> bool {
    rebase_with_resources(chart, from, to, None)
}

/// Rebase resource references, resolving aliases through `resources` first.
fn rebase_with_resources(
    chart: &mut Value,
    from: &Path,
    to: &Path,
    resources: Option<&HashMap<String, PathBuf>>,
) -> bool {
    let origin = from.parent().unwrap_or(Path::new("."));
    let destination = to.parent().unwrap_or(Path::new("."));
    let mut changed = false;
    let mut rewrite = |value: &mut Value| {
        if let Some(name) = value.as_str() {
            if name.is_empty() || name == "line.png" {
                return;
            }
            let path = Path::new(name);
            let absolute = resources
                .and_then(|r| r.get(name))
                .cloned()
                .unwrap_or_else(|| {
                    if path.is_absolute() {
                        path.to_path_buf()
                    } else {
                        origin.join(path)
                    }
                });
            let next = Value::String(
                pathdiff::diff_paths(&absolute, destination)
                    .unwrap_or(absolute)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
            if *value != next {
                *value = next;
                changed = true;
            }
        }
    };
    if let Some(meta) = chart.get_mut("META") {
        for key in ["song", "background"] {
            if let Some(v) = meta.get_mut(key) {
                rewrite(v);
            }
        }
    }
    if let Some(lines) = chart.get_mut("judgeLineList").and_then(Value::as_array_mut) {
        for line in lines {
            if let Some(v) = line.get_mut("Texture") {
                rewrite(v);
            }
            if let Some(notes) = line.get_mut("notes").and_then(Value::as_array_mut) {
                for note in notes {
                    for key in ["hitsound", "hitSound"] {
                        if let Some(v) = note.get_mut(key) {
                            rewrite(v);
                        }
                    }
                }
            }
        }
    }
    changed
}

/// Refresh the registered document and disk snapshot after a successful write.
fn finish_saved_document(
    state: &DocumentHost,
    id: Option<String>,
    target: &Path,
    result: Written,
    document: Option<Document>,
    export: bool,
) -> Result<SaveOutcome> {
    let mut disk_snapshot = None;
    if !export {
        if let Some(id) = id {
            let authorized = if result.packed {
                ExternalResources::default()
            } else {
                document
                    .as_ref()
                    .map(external_resources_of)
                    .unwrap_or_default()
            };
            let resolved = resolve_references(target, &result.chart, &authorized)?;
            let mut resources = resolved.allowed;
            for (name, alias) in &result.remap {
                resources.insert(
                    name.clone(),
                    if result.packed {
                        PathBuf::from(alias)
                    } else {
                        target.parent().unwrap_or(Path::new(".")).join(alias)
                    },
                );
            }
            if let Some(old) = document.filter(|d| d.packed == result.packed) {
                for (name, path) in old.resources {
                    if !result.packed || !path.is_absolute() {
                        resources.entry(name).or_insert(path);
                    }
                }
            }
            resources.insert(
                "extra.json".into(),
                target.parent().unwrap_or(Path::new(".")).join("extra.json"),
            );
            let saved_document = Document {
                path: target.to_path_buf(),
                chart_name: result.chart_name.clone(),
                packed: result.packed,
                resources,
            };
            disk_snapshot = Some(watch::disk_snapshot(&saved_document)?);
            let mut registry = state.documents.lock().map_err(error)?;
            if let Entry::Occupied(mut entry) = registry.entry(id) {
                entry.insert(saved_document);
            }
        }
    }
    let chart = if result.chart_changed {
        Some(result.chart)
    } else {
        None
    };
    Ok(SaveOutcome::Saved(Saved {
        path: result.path,
        chart,
        chart_name: result.chart_name,
        packed: result.packed,
        remap: result.remap,
        disk_snapshot,
    }))
}

/// Expected on-disk state of a document that is being overwritten in place.
struct SavePrecondition<'a> {
    document: Option<&'a Document>,
    target: &'a Path,
    expected: Option<String>,
}

impl<'a> SavePrecondition<'a> {
    /// Build the precondition for one write.
    fn new(document: Option<&'a Document>, target: &'a Path, expected: Option<String>) -> Self {
        Self {
            document,
            target,
            expected,
        }
    }

    /// Fail when the live snapshot no longer matches the expected one.
    fn check(&self) -> std::result::Result<(), SaveFailure> {
        let Some(expected) = &self.expected else {
            return Ok(());
        };
        let actual = self
            .document
            .map(watch::disk_snapshot)
            .transpose()
            .map_err(SaveFailure::Error)?;
        if actual.as_deref() != Some(expected) {
            return Err(SaveFailure::Conflict(SaveConflict {
                path: self.target.to_string_lossy().into_owned(),
                expected_disk_snapshot: Some(expected.clone()),
                actual_disk_snapshot: actual,
            }));
        }
        Ok(())
    }

    /// Build a conflict for `changed_path`, or for the target when a baseline exists.
    fn conflict(&self, changed_path: PathBuf) -> SaveFailure {
        SaveFailure::Conflict(SaveConflict {
            path: if self.expected.is_some() {
                self.target.to_string_lossy().into_owned()
            } else {
                changed_path.to_string_lossy().into_owned()
            },
            expected_disk_snapshot: self.expected.clone(),
            actual_disk_snapshot: self.expected.as_ref().and_then(|_| {
                self.document
                    .and_then(|document| watch::disk_snapshot(document).ok())
            }),
        })
    }
}

/// A file staged in memory until the whole directory write can be committed.
struct StagedDirectoryFile {
    path: PathBuf,
    bytes: Vec<u8>,
}

/// Add or replace the staged bytes for one path.
fn stage_directory_file(files: &mut Vec<StagedDirectoryFile>, path: PathBuf, bytes: Vec<u8>) {
    if let Some(existing) = files.iter_mut().find(|file| file.path == path) {
        existing.bytes = bytes;
    } else {
        files.push(StagedDirectoryFile { path, bytes });
    }
}

/// Original content of one target file; `None` means the file did not exist.
#[derive(Debug)]
struct DirectoryFileBaseline {
    path: PathBuf,
    bytes: Option<Vec<u8>>,
}

/// Why a directory commit stopped: an external change or an I/O error.
#[derive(Debug)]
enum DirectoryCommitFailure {
    Conflict(PathBuf),
    Error(String),
}

/// Read a target file, treating a missing file as an empty baseline.
fn read_directory_file(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.len() > MAX_RESOURCE_BYTES => {
            Err("directory_baseline_too_large".into())
        }
        Ok(_) => match fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(io_error) => Err(error(io_error)),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(io_error) => Err(error(io_error)),
    }
}

/// Capture the current content of every distinct staged path before writing.
fn capture_directory_baselines(
    files: &[StagedDirectoryFile],
) -> Result<Vec<DirectoryFileBaseline>> {
    let mut baselines = Vec::new();
    for file in files {
        if baselines
            .iter()
            .any(|baseline: &DirectoryFileBaseline| baseline.path == file.path)
        {
            continue;
        }
        baselines.push(DirectoryFileBaseline {
            path: file.path.clone(),
            bytes: read_directory_file(&file.path)?,
        });
    }
    Ok(baselines)
}

/// Verify that no target changed since its baseline was captured.
fn verify_directory_baselines(
    baselines: &[DirectoryFileBaseline],
    files: &[StagedDirectoryFile],
) -> std::result::Result<(), DirectoryCommitFailure> {
    for file in files {
        let Some(baseline) = baselines.iter().find(|baseline| baseline.path == file.path) else {
            return Err(DirectoryCommitFailure::Error(format!(
                "directory baseline missing: {}",
                file.path.display()
            )));
        };
        let actual = read_directory_file(&baseline.path).map_err(DirectoryCommitFailure::Error)?;
        if actual != baseline.bytes {
            return Err(DirectoryCommitFailure::Conflict(baseline.path.clone()));
        }
    }
    Ok(())
}

/// Verify that every target now contains exactly its staged bytes.
fn verify_directory_outputs(
    files: &[StagedDirectoryFile],
) -> std::result::Result<(), DirectoryCommitFailure> {
    for file in files {
        let actual = read_directory_file(&file.path).map_err(DirectoryCommitFailure::Error)?;
        if actual.as_deref() != Some(file.bytes.as_slice()) {
            return Err(DirectoryCommitFailure::Conflict(file.path.clone()));
        }
    }
    Ok(())
}

/// Restore committed files to their baselines, newest first.
fn rollback_directory_files(
    files: &[StagedDirectoryFile],
    baselines: &[DirectoryFileBaseline],
    committed_paths: &[PathBuf],
) -> Result<()> {
    for baseline in baselines.iter().rev() {
        if !committed_paths.iter().any(|path| path == &baseline.path) {
            continue;
        }
        let Some(file) = files.iter().find(|file| file.path == baseline.path) else {
            continue;
        };
        let current = read_directory_file(&baseline.path)?;
        if current.as_deref() != Some(file.bytes.as_slice()) {
            continue;
        }
        match &baseline.bytes {
            Some(bytes) => atomic_write(&baseline.path, bytes)?,
            None => match fs::remove_file(&baseline.path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(io_error) => return Err(error(io_error)),
            },
        }
    }
    Ok(())
}

/// Roll back a failed commit and return the original failure, or a combined
/// error when rollback itself fails.
fn with_directory_rollback(
    failure: DirectoryCommitFailure,
    files: &[StagedDirectoryFile],
    baselines: &[DirectoryFileBaseline],
    committed_paths: &[PathBuf],
) -> DirectoryCommitFailure {
    match rollback_directory_files(files, baselines, committed_paths) {
        Ok(()) => failure,
        Err(rollback_error) => {
            DirectoryCommitFailure::Error(format!("{failure:?}; rollback failed: {rollback_error}"))
        }
    }
}

/// Write every staged file atomically, rechecking baselines as it goes.
///
/// The first external change or write error rolls back the files already
/// replaced, so the caller never observes a half-applied save.
fn commit_directory_files_with_baselines(
    files: Vec<StagedDirectoryFile>,
    baselines: Vec<DirectoryFileBaseline>,
    mut after_replace: impl FnMut(&Path),
) -> std::result::Result<(), DirectoryCommitFailure> {
    if let Err(failure) = verify_directory_baselines(&baselines, &files) {
        return Err(failure);
    }

    let mut committed_paths = Vec::new();
    for (index, file) in files.iter().enumerate() {
        if let Some(parent) = file.path.parent() {
            if let Err(io_error) = fs::create_dir_all(parent) {
                return Err(with_directory_rollback(
                    DirectoryCommitFailure::Error(error(io_error)),
                    &files,
                    &baselines,
                    &committed_paths,
                ));
            }
        }
        if let Err(failure) = verify_directory_baselines(&baselines, &files[index..]) {
            return Err(with_directory_rollback(
                failure,
                &files,
                &baselines,
                &committed_paths,
            ));
        }
        if let Err(write_error) = atomic_write(&file.path, &file.bytes) {
            return Err(with_directory_rollback(
                DirectoryCommitFailure::Error(write_error),
                &files,
                &baselines,
                &committed_paths,
            ));
        }
        committed_paths.push(file.path.clone());
        after_replace(&file.path);
    }

    if let Err(failure) = verify_directory_outputs(&files) {
        return Err(with_directory_rollback(
            failure,
            &files,
            &baselines,
            &committed_paths,
        ));
    }
    Ok(())
}

/// Two paths name the same directory when they resolve to the same place.
///
/// The comparison is deliberately tolerant: an export folder the caller picked
/// may be spelled differently from the chart target's parent (relative, a
/// different drive casing, a trailing separator). A failed canonicalisation
/// falls back to the lexical comparison.
fn same_directory(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// Reject references a package cannot carry without reading outside the document.
///
/// A PEZ entry name must stay package-relative. Absolute, drive, UNC, and
/// parent-traversing references are rejected before any file is read; for a
/// loose document every resolved target must also stay inside its folder.
fn validate_pez_references(doc: Option<&Document>, chart: &Value) -> Result<()> {
    let root = match doc {
        Some(document) if !document.packed => {
            let parent = document.path.parent().unwrap_or(Path::new("."));
            Some(fs::canonicalize(parent).map_err(error)?)
        }
        _ => None,
    };
    for name in resource_names(chart) {
        let normalized =
            normalize_resource_name(&name).map_err(|_| "unsafe_save_asset_path".to_string())?;
        if let (Some(root), Some(document)) = (&root, doc) {
            let candidate = document
                .resources
                .get(&name)
                .or_else(|| document.resources.get(&normalized))
                .cloned()
                .unwrap_or_else(|| root.join(&normalized));
            if !resolve_path(root, &candidate)?.internal {
                return Err("unsafe_save_asset_path".into());
            }
        }
    }
    Ok(())
}

/// Write a chart and its resources to `target`.
///
/// A `.pez` target is built as a complete archive; any other target writes the
/// chart and staged resources as separate files. `expected_disk_snapshot`
/// guards an in-place overwrite, and a conflict leaves the target untouched.
pub(crate) fn write_document(
    doc: Option<&Document>,
    target: &Path,
    mut chart: Value,
    assets: AssetSource<'_>,
    removed: Vec<String>,
    extract_to: Option<String>,
    expected_disk_snapshot: Option<String>,
) -> std::result::Result<Written, SaveFailure> {
    let precondition = SavePrecondition::new(doc, target, expected_disk_snapshot);
    let mut directory_files = Vec::new();
    let mut saved_remap = HashMap::new();
    let mut chart_changed = false;
    // Saving a JSON chart into the folder that already holds it re-exports the
    // chart's own resources: replacing those files is the update the author
    // asked for, not a collision. A different folder keeps the guard.
    let overwrite_root = extract_to
        .as_deref()
        .map(|extract| {
            same_directory(
                Path::new(extract),
                target.parent().unwrap_or(Path::new(".")),
            )
        })
        .unwrap_or(false);
    let packed = target
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("pez"))
        .unwrap_or(false);
    if packed {
        validate_pez_references(doc, &chart)?;
    }
    let old_packed = doc.map(|d| d.packed).unwrap_or(false);
    // The sidecar already carried by the document or supplied with the export
    // keeps its custom fields and its Path when the chart does not declare an id.
    let existing_info = if old_packed {
        doc.and_then(|document| super::open::resource_bytes(document, "info.txt").ok())
            .unwrap_or_default()
    } else {
        assets
            .names()
            .into_iter()
            .find(|name| is_info_name(name))
            .and_then(|name| assets.read(&name).ok().flatten())
            .unwrap_or_default()
    };
    let declared_id = chart
        .get("META")
        .and_then(|meta| meta.get("id"))
        .and_then(Value::as_str)
        .and_then(package_id);
    let fallback_id = if old_packed {
        doc.and_then(|document| package_id(&chart_stem(&document.chart_name)))
    } else {
        target
            .file_stem()
            .and_then(|stem| package_id(&stem.to_string_lossy()))
    };
    let chart_id = declared_id
        .or_else(|| info_path(&existing_info).and_then(|path| package_id(&path)))
        .or(fallback_id)
        .ok_or("chart_package_id_missing")?;
    // RPE records the project id in the chart, the sidecar Path and the chart
    // entry name; keep all three aligned for packages Redux writes.
    let id_changed = chart
        .get("META")
        .and_then(|meta| meta.get("id"))
        .and_then(Value::as_str)
        != Some(chart_id.as_str());
    if let Some(meta) = chart.get_mut("META").and_then(Value::as_object_mut) {
        meta.insert("id".into(), Value::String(chart_id.clone()));
    }
    chart_changed |= id_changed;
    let chart_name = if packed {
        // Keep an opened package's chart entry where it already lives so its
        // relative resource paths stay valid; new packages use the id as the
        // native chart stem.
        if old_packed {
            doc.map(|document| document.chart_name.clone())
                .unwrap_or_else(|| format!("{chart_id}.json"))
        } else {
            format!("{chart_id}.json")
        }
    } else {
        target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    };
    if !packed && old_packed && extract_to.is_none() {
        return Err("pez_to_json_export_directory_required".into());
    }
    if !packed && !assets.is_empty() && extract_to.is_none() {
        return Err("embedded_assets_export_directory_required".into());
    }
    if !packed {
        if let Some(d) = doc {
            if d.packed {
                let root = PathBuf::from(
                    extract_to
                        .as_ref()
                        .ok_or("asset_export_directory_missing")?,
                );
                fs::create_dir_all(&root).map_err(error)?;
                let mut archive =
                    ZipArchive::new(File::open(&d.path).map_err(error)?).map_err(error)?;
                for i in 0..archive.len() {
                    let file = archive.by_index(i).map_err(error)?;
                    let name = file.name().map_err(error)?.into_owned();
                    save_zip_name(&name)?;
                    if !file.is_dir()
                        && name != d.chart_name
                        && !overwrite_root
                        && root.join(&name).exists()
                    {
                        return Err(format!("asset_export_destination_exists:{}", name).into());
                    }
                }
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i).map_err(error)?;
                    let name = file.name().map_err(error)?.into_owned();
                    if file.is_dir()
                        || name == d.chart_name
                        || removed.iter().any(|removed_name| removed_name == &name)
                    {
                        continue;
                    }
                    save_zip_name(&name)?;
                    let output = root.join(&name);
                    if let Some(parent) = output.parent() {
                        fs::create_dir_all(parent).map_err(error)?;
                    }
                    if output.exists() && !overwrite_root {
                        return Err(format!(
                            "asset_export_destination_exists:{}",
                            output.display()
                        )
                        .into());
                    }
                    let mut bytes = Vec::new();
                    file.read_to_end(&mut bytes).map_err(error)?;
                    if let Some(update) = assets.read(&name)? {
                        bytes = update;
                    }
                    stage_directory_file(&mut directory_files, output, bytes);
                }
                for name in assets.names() {
                    save_zip_name(&name)?;
                    let output = root.join(&name);
                    if !output.exists() {
                        let bytes = assets
                            .read(&name)?
                            .ok_or_else(|| format!("save_asset_missing:{name}"))?;
                        stage_directory_file(&mut directory_files, output, bytes);
                    }
                }
                chart_changed |= rebase(&mut chart, &root.join(&d.chart_name), target);
            } else {
                chart_changed |=
                    rebase_with_resources(&mut chart, &d.path, target, Some(&d.resources));
            }
        }
        if !old_packed && !assets.is_empty() {
            let root = PathBuf::from(
                extract_to
                    .as_ref()
                    .ok_or("asset_export_directory_missing")?,
            );
            fs::create_dir_all(&root).map_err(error)?;
            let names = assets.names();
            for name in &names {
                save_zip_name(name)?;
                if root.join(name).exists() && !overwrite_root {
                    return Err(format!("asset_export_destination_exists:{name}").into());
                }
            }
            let mut remap = HashMap::new();
            for source_name in names {
                let output = root.join(&source_name);
                let bytes = assets
                    .read(&source_name)?
                    .ok_or_else(|| format!("save_asset_missing:{source_name}"))?;
                stage_directory_file(&mut directory_files, output.clone(), bytes);
                let remapped_name =
                    pathdiff::diff_paths(&output, target.parent().unwrap_or(Path::new(".")))
                        .unwrap_or(output)
                        .to_string_lossy()
                        .replace('\\', "/");
                if let Some(d) = doc {
                    let source = d.resources.get(&source_name).cloned().unwrap_or_else(|| {
                        d.path.parent().unwrap_or(Path::new(".")).join(&source_name)
                    });
                    let rebased =
                        pathdiff::diff_paths(&source, target.parent().unwrap_or(Path::new(".")))
                            .unwrap_or(source)
                            .to_string_lossy()
                            .replace('\\', "/");
                    remap.insert(rebased, remapped_name.clone());
                }
                remap.insert(source_name, remapped_name);
            }
            remap_chart(&mut chart, &remap);
            chart_changed |= !remap.is_empty();
            saved_remap = remap;
        }
        let mut chart_bytes = serde_json::to_vec_pretty(&chart).map_err(error)?;
        chart_bytes.push(b'\n');
        stage_directory_file(&mut directory_files, target.to_path_buf(), chart_bytes);
        let baselines =
            capture_directory_baselines(&directory_files).map_err(SaveFailure::Error)?;
        precondition.check()?;
        commit_directory_files_with_baselines(directory_files, baselines, |_| {}).map_err(
            |failure| match failure {
                DirectoryCommitFailure::Conflict(path) => precondition.conflict(path),
                DirectoryCommitFailure::Error(error) => SaveFailure::Error(error),
            },
        )?;
    } else {
        let mut temp = tempfile::NamedTempFile::new_in(target.parent().unwrap_or(Path::new(".")))
            .map_err(error)?;
        let mut writer = ZipWriter::new(temp.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let override_names = assets.names();
        if let Some(d) = doc {
            if d.packed {
                let mut archive =
                    ZipArchive::new(File::open(&d.path).map_err(error)?).map_err(error)?;
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i).map_err(error)?;
                    let name = file.name().map_err(error)?.into_owned();
                    if file.is_dir()
                        || name == chart_name
                        || name == d.chart_name
                        || is_info_name(&name)
                        || override_names.iter().any(|entry| entry == &name)
                        || removed.contains(&name)
                    {
                        continue;
                    }
                    save_zip_name(&name)?;
                    writer.start_file(name, options).map_err(error)?;
                    std::io::copy(&mut file, &mut writer).map_err(error)?;
                }
            } else {
                let root =
                    fs::canonicalize(d.path.parent().unwrap_or(Path::new("."))).map_err(error)?;
                let mut remap = HashMap::new();
                let mut used: std::collections::HashSet<String> =
                    override_names.iter().map(|s| s.to_string()).collect();
                used.insert(chart_name.clone());
                used.insert("extra.json".into());
                used.insert("info.txt".into());
                for name in resource_names(&chart) {
                    if override_names.iter().any(|entry| entry == &name) || removed.contains(&name)
                    {
                        continue;
                    }
                    let normalized = normalize_resource_name(&name)
                        .map_err(|_| "unsafe_save_asset_path".to_string())?;
                    let candidate = d
                        .resources
                        .get(&name)
                        .or_else(|| d.resources.get(&normalized))
                        .cloned()
                        .unwrap_or_else(|| root.join(&normalized));
                    let resolved = resolve_path(&root, &candidate)?;
                    if !resolved.internal {
                        return Err("unsafe_save_asset_path".into());
                    }
                    let path = resolved.path;
                    if !path.is_file() {
                        return Err(format!("save_asset_missing:{name}").into());
                    }
                    let stem = path
                        .file_name()
                        .ok_or_else(|| format!("save_asset_filename_missing:{name}"))?
                        .to_string_lossy()
                        .into_owned();
                    let mut output = stem.clone();
                    let mut suffix = 1;
                    while !used.insert(output.clone()) {
                        output = format!("{suffix}-{stem}");
                        suffix += 1;
                    }
                    writer.start_file(&output, options).map_err(error)?;
                    std::io::copy(&mut File::open(path).map_err(error)?, &mut writer)
                        .map_err(error)?;
                    remap.insert(name, output);
                }
                remap_chart(&mut chart, &remap);
                chart_changed |= !remap.is_empty();
                saved_remap = remap;
                if let Ok(bytes) = super::open::resource_bytes(d, "extra.json") {
                    writer.start_file("extra.json", options).map_err(error)?;
                    writer.write_all(&bytes).map_err(error)?;
                }
            }
        }
        let mut info = existing_info;
        update_info(&mut info, &chart, &chart_name, &chart_id);
        writer.start_file("info.txt", options).map_err(error)?;
        writer.write_all(&info).map_err(error)?;
        for name in assets.names() {
            if is_info_name(&name) || name == chart_name {
                continue;
            }
            save_zip_name(&name)?;
            writer.start_file(&name, options).map_err(error)?;
            assets.copy_to(&name, &mut writer)?;
        }
        // Recheck the final entry name after all fallbacks. An opened package
        // keeps its original chart path, which may predate current validation.
        save_zip_name(&chart_name)?;
        writer.start_file(&chart_name, options).map_err(error)?;
        serde_json::to_writer_pretty(&mut writer, &chart).map_err(error)?;
        writer.write_all(b"\n").map_err(error)?;
        writer.finish().map_err(error)?;
        temp.as_file().sync_all().map_err(error)?;
        precondition.check()?;
        temp.persist(target).map_err(error)?;
    }
    Ok(Written {
        path: target.to_string_lossy().into_owned(),
        chart,
        chart_changed,
        chart_name,
        packed,
        remap: saved_remap,
    })
}

#[cfg(test)]
mod tests {
    use super::{update_info, write_document, AssetSource, SaveFailure, SaveOutcome};
    use crate::documents::{watch, Document};
    use serde_json::json;
    use std::{collections::HashMap, fs, path::PathBuf};
    use tempfile::tempdir;

    fn document(path: PathBuf) -> Document {
        Document {
            path,
            chart_name: "chart.json".into(),
            packed: false,
            resources: HashMap::new(),
        }
    }

    #[test]
    fn pez_writer_packs_a_resource_inside_the_document_folder() {
        let root = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let song = root.path().join("song.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&song, b"audio").unwrap();
        let mut document = document(chart);
        document
            .resources
            .insert("song.ogg".into(), fs::canonicalize(&song).unwrap());
        let target = root.path().join("package.pez");

        let written = write_document(
            Some(&document),
            &target,
            json!({"META": {"name": "Song", "song": "song.ogg"}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            None,
        )
        .unwrap();

        assert_eq!(written.chart["META"]["song"], "song.ogg");
        let mut archive = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        assert!(archive.by_name("song.ogg").is_ok());
        assert!(archive.by_name("info.txt").is_ok());
    }

    #[test]
    fn pez_writer_rejects_an_authorized_external_resource() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let song = outside.path().join("song.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&song, b"private").unwrap();
        let name = song.to_string_lossy().replace('\\', "/");
        let mut document = document(chart);
        document
            .resources
            .insert(name.clone(), fs::canonicalize(&song).unwrap());
        let target = root.path().join("package.pez");

        let result = write_document(
            Some(&document),
            &target,
            json!({"META": {"song": name}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            None,
        );

        assert!(matches!(
            result,
            Err(SaveFailure::Error(code)) if code == "unsafe_save_asset_path"
        ));
        assert!(!target.exists());
    }

    #[test]
    fn pez_writer_rejects_a_parent_traversal_reference() {
        let root = tempdir().unwrap();
        let project = root.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let chart = project.join("chart.json");
        let secret = root.path().join("secret.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&secret, b"private").unwrap();
        let document = document(chart);
        let target = project.join("package.pez");

        let result = write_document(
            Some(&document),
            &target,
            json!({"META": {"song": "../secret.ogg"}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            None,
        );

        assert!(matches!(
            result,
            Err(SaveFailure::Error(code)) if code == "unsafe_save_asset_path"
        ));
        assert!(!target.exists());
    }

    #[test]
    fn changed_disk_rejects_save_before_replacing_the_target() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.json");
        fs::write(&path, b"disk-before").unwrap();
        let document = document(path.clone());
        let baseline = watch::disk_snapshot(&document).unwrap();
        fs::write(&path, b"external-change").unwrap();

        let result = write_document(
            Some(&document),
            &path,
            json!({"META": {"name": "new"}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            Some(baseline.clone()),
        );

        match result {
            Err(SaveFailure::Conflict(conflict)) => {
                assert_eq!(conflict.expected_disk_snapshot, Some(baseline));
                assert_ne!(conflict.actual_disk_snapshot, None);
            }
            other => panic!("expected save conflict, got {other:?}"),
        }
        assert_eq!(fs::read(&path).unwrap(), b"external-change");
    }

    #[test]
    fn unchanged_disk_returns_a_structured_saved_outcome() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.json");
        fs::write(&path, b"disk-before").unwrap();
        let document = document(path.clone());
        let baseline = watch::disk_snapshot(&document).unwrap();

        let written = write_document(
            Some(&document),
            &path,
            json!({"META": {"name": "new"}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            Some(baseline),
        )
        .unwrap();
        let encoded = serde_json::to_value(SaveOutcome::Saved(super::Saved {
            path: written.path,
            chart: Some(written.chart),
            chart_name: written.chart_name,
            packed: written.packed,
            remap: written.remap,
            disk_snapshot: None,
        }))
        .unwrap();

        assert_eq!(encoded["status"], "saved");
        assert_eq!(fs::read_to_string(&path).unwrap().contains("\"new\""), true);
    }

    #[test]
    fn directory_conflict_preserves_existing_resources() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.json");
        let resource = root.path().join("song.ogg");
        fs::write(&path, br#"{"META":{"song":"song.ogg"}}"#).unwrap();
        fs::write(&resource, b"original-resource").unwrap();
        let mut document = document(path.clone());
        document
            .resources
            .insert("song.ogg".into(), resource.clone());
        let baseline = watch::disk_snapshot(&document).unwrap();
        fs::write(&path, b"external-chart-change").unwrap();

        let updates = [crate::documents::AssetUpdate {
            name: "song.ogg".into(),
            bytes: b"replacement-resource".to_vec(),
        }];
        let export_root = root.path().join("export");
        let result = write_document(
            Some(&document),
            &path,
            json!({"META": {"song": "song.ogg"}}),
            AssetSource::Memory(&updates),
            Vec::new(),
            Some(export_root.to_string_lossy().into_owned()),
            Some(baseline),
        );

        assert!(matches!(result, Err(SaveFailure::Conflict(_))));
        assert_eq!(fs::read(&resource).unwrap(), b"original-resource");
    }

    #[test]
    fn directory_commit_rolls_back_files_when_a_later_file_fails() {
        let root = tempdir().unwrap();
        let first = root.path().join("chart.json");
        let blocked_parent = root.path().join("blocked");
        let second = blocked_parent.join("resource.ogg");
        fs::write(&first, b"chart-before").unwrap();
        fs::write(&blocked_parent, b"not-a-directory").unwrap();

        let files = vec![
            super::StagedDirectoryFile {
                path: first.clone(),
                bytes: b"chart-after".to_vec(),
            },
            super::StagedDirectoryFile {
                path: second,
                bytes: b"resource-after".to_vec(),
            },
        ];
        let baselines = super::capture_directory_baselines(&files).unwrap();
        let result = super::commit_directory_files_with_baselines(files, baselines, |_| {});

        assert!(result.is_err());
        assert_eq!(fs::read(&first).unwrap(), b"chart-before");
    }

    #[test]
    fn directory_commit_rejects_a_drifted_baseline_before_replacement() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.json");
        fs::write(&path, b"before").unwrap();
        let files = vec![super::StagedDirectoryFile {
            path: path.clone(),
            bytes: b"after".to_vec(),
        }];
        let baselines = super::capture_directory_baselines(&files).unwrap();
        fs::write(&path, b"external-update").unwrap();

        let result = super::commit_directory_files_with_baselines(files, baselines, |_| {});

        assert!(matches!(
            result,
            Err(super::DirectoryCommitFailure::Conflict(conflict_path))
                if conflict_path == path
        ));
        assert_eq!(fs::read(&path).unwrap(), b"external-update");
    }

    #[test]
    fn directory_commit_replaces_all_staged_files_after_their_baselines_hold() {
        let root = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let resource = root.path().join("song.ogg");
        fs::write(&chart, b"chart-before").unwrap();
        fs::write(&resource, b"resource-before").unwrap();
        let files = vec![
            super::StagedDirectoryFile {
                path: chart.clone(),
                bytes: b"chart-after".to_vec(),
            },
            super::StagedDirectoryFile {
                path: resource.clone(),
                bytes: b"resource-after".to_vec(),
            },
        ];
        let baselines = super::capture_directory_baselines(&files).unwrap();

        super::commit_directory_files_with_baselines(files, baselines, |_| {}).unwrap();

        assert_eq!(fs::read(&chart).unwrap(), b"chart-after");
        assert_eq!(fs::read(&resource).unwrap(), b"resource-after");
    }

    #[test]
    fn directory_commit_reports_an_external_update_seen_in_final_verification() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.json");
        fs::write(&path, b"before").unwrap();
        let files = vec![super::StagedDirectoryFile {
            path: path.clone(),
            bytes: b"after".to_vec(),
        }];
        let baselines = super::capture_directory_baselines(&files).unwrap();

        let result = super::commit_directory_files_with_baselines(files, baselines, |path| {
            fs::write(path, b"external-update").unwrap();
        });

        assert!(matches!(
            result,
            Err(super::DirectoryCommitFailure::Conflict(conflict_path))
                if conflict_path == path
        ));
        assert_eq!(fs::read(&path).unwrap(), b"external-update");
    }

    #[test]
    fn info_sidecar_keeps_package_fields_and_chart_reference() {
        let mut info = b"Path: 123\r\nCustom: keep\r\n".to_vec();
        update_info(
            &mut info,
            &json!({"META": {"name": "Sidecar", "song": "song.ogg", "background": "cover.png"}}),
            "chart.json",
            "123",
        );
        let text = String::from_utf8(info).unwrap();
        assert!(text.starts_with("#\r\n"));
        assert!(text.contains("Chart: chart.json"));
        assert!(text.contains("Name: Sidecar"));
        assert!(text.contains("Song: song.ogg"));
        assert!(text.contains("Picture: cover.png"));
        assert!(text.contains("Path: 123"));
        assert!(text.contains("Custom: keep"));
    }

    #[test]
    fn directory_commit_rollback_does_not_overwrite_an_external_update() {
        let root = tempdir().unwrap();
        let first = root.path().join("chart.json");
        let blocked_parent = root.path().join("blocked");
        let second = blocked_parent.join("resource.ogg");
        fs::write(&first, b"chart-before").unwrap();
        fs::write(&blocked_parent, b"not-a-directory").unwrap();
        let files = vec![
            super::StagedDirectoryFile {
                path: first.clone(),
                bytes: b"chart-after".to_vec(),
            },
            super::StagedDirectoryFile {
                path: second,
                bytes: b"resource-after".to_vec(),
            },
        ];
        let baselines = super::capture_directory_baselines(&files).unwrap();

        let result = super::commit_directory_files_with_baselines(files, baselines, |path| {
            if path == first {
                fs::write(path, b"external-update").unwrap();
            }
        });

        assert!(result.is_err());
        assert_eq!(fs::read(&first).unwrap(), b"external-update");
    }

    #[test]
    fn rewritten_package_ids_produce_packages_that_reopen() {
        let root = tempdir().unwrap();
        let ids = [
            "CON".to_string(),
            "line\nbreak".to_string(),
            "a".repeat(crate::storage::path_safety::MAX_PACKAGE_ID_BYTES + 1),
        ];
        for (index, id) in ids.into_iter().enumerate() {
            let target = root.path().join(format!("package-{index}.pez"));
            let result = write_document(
                None,
                &target,
                json!({"META": {"id": id, "name": "Song"}}),
                AssetSource::Memory(&[]),
                Vec::new(),
                None,
                None,
            );
            match result {
                Ok(_) => {
                    let (_, chart, entries) = crate::documents::open::read_pez_progress(
                        fs::File::open(&target).unwrap(),
                        |_, _| {},
                    )
                    .unwrap();
                    let written_id = chart["META"]["id"].as_str().unwrap();
                    assert!(crate::storage::path_safety::package_id(written_id).is_some());
                    assert!(entries
                        .iter()
                        .any(|entry| { entry.name == format!("{written_id}.json") }));
                }
                Err(SaveFailure::Error(code)) => {
                    assert!(
                        matches!(
                            code.as_str(),
                            "chart_package_id_missing" | "unsafe_save_asset_path"
                        ),
                        "{code}"
                    );
                    assert!(!target.exists());
                }
                Err(other) => panic!("unexpected save failure: {other:?}"),
            }
        }
    }

    #[test]
    fn packed_writer_rejects_an_unsafe_inherited_chart_entry() {
        let root = tempdir().unwrap();
        let source = root.path().join("source.pez");
        {
            use std::io::Write;
            let mut writer = zip::ZipWriter::new(fs::File::create(&source).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("chart.json", options).unwrap();
            writer.write_all(b"{\"META\":{\"id\":\"kept\"}}").unwrap();
            writer.finish().unwrap();
        }
        let document = Document {
            path: source,
            chart_name: "CON.json".into(),
            packed: true,
            resources: HashMap::new(),
        };
        let target = root.path().join("target.pez");

        let result = write_document(
            Some(&document),
            &target,
            json!({"META": {"id": "kept"}}),
            AssetSource::Memory(&[]),
            Vec::new(),
            None,
            None,
        );

        assert!(matches!(
            result,
            Err(SaveFailure::Error(code)) if code == "unsafe_save_asset_path"
        ));
        assert!(!target.exists());
    }
}
