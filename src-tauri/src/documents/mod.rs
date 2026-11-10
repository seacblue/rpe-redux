//! Document host: the shared document state and command surface, re-exported
//! from one lifecycle stage per submodule.
//!
//! `open`, `save`, `recovery`, `recovery_store`, `library`, `media`, and `watch`
//! each own one stage; this module owns the types and helpers they all operate
//! on.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{ipc::Request, AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use zip::ZipArchive;

mod chart_stream;
mod library;
mod media;
mod open;
mod recovery;
mod recovery_store;
mod save;
mod watch;

pub use chart_stream::{open_document_stream, read_chart_line_chunk, read_chart_lines};
pub use library::{import_library_project, inspect_library};
pub use media::media_response;
pub use open::{close_document, open_document, read_asset};
pub(crate) use recovery::migrate_legacy as migrate_recovery;
pub use recovery::{
    begin_recovery, cancel_recovery, delete_recovery, finish_recovery, list_recovery,
    read_recovery, write_recovery, write_recovery_asset, write_recovery_chart,
};
pub use save::{
    begin_save_document, cancel_save_document, finish_save_document, write_save_asset,
    write_save_chart,
};
pub use watch::document_disk_snapshot;

/// Open one loose-document resource with the operating system's associated editor.
#[tauri::command]
pub fn open_asset_external(
    app: AppHandle,
    state: State<'_, DocumentHost>,
    id: String,
    name: String,
) -> Result<()> {
    let document = document(&state, &id)?;
    if document.packed {
        return Err("Packed chart assets must be extracted before external editing.".into());
    }
    let path = readable_resource_path(&document, &name)?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(error)
}

/// Command result type: a diagnostic message on failure.
pub(crate) type Result<T> = std::result::Result<T, String>;

/// Largest chart JSON or PEZ chart entry accepted by the document host.
pub(crate) const MAX_CHART_BYTES: u64 = 512 * 1024 * 1024;
/// Largest single chart resource accepted from disk or a PEZ entry.
pub(crate) const MAX_RESOURCE_BYTES: u64 = 256 * 1024 * 1024;
/// Largest cumulative PEZ or loose-document resource set accepted.
pub(crate) const MAX_RESOURCE_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
/// Largest optional sidecar (`extra.json`) read beside a chart.
pub(crate) const MAX_SIDECAR_BYTES: u64 = 64 * 1024 * 1024;
/// Largest file accepted by the generic picked-file command.
pub(crate) const MAX_IMPORT_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// Largest cumulative payload accepted from one OS asset drop.
///
/// Dropped bytes are returned in one IPC response, so this stays below the
/// historical 1 GiB archive ceiling to leave room for the response copy.
pub(crate) const MAX_DROPPED_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
/// Largest number of files accepted from one OS asset drop.
pub(crate) const MAX_DROPPED_FILES: usize = 4096;
/// Largest media response materialised in memory.
pub(crate) const MAX_MEDIA_RESPONSE_BYTES: u64 = 256 * 1024 * 1024;
/// Largest single file hashed for a document disk snapshot.
///
/// Snapshots stream the file, so this ceiling only rejects pathological inputs;
/// it does not allocate the file size in memory.
pub(crate) const MAX_SNAPSHOT_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Read a whole file after checking a hard byte ceiling.
///
/// The metadata check avoids opening a huge file; the `take` guard covers a
/// file that grows between the check and the read.
pub(crate) fn read_file_limited(path: &Path, limit: u64, too_large: &str) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(error)?;
    if !metadata.is_file() {
        return Err("not_a_file".into());
    }
    if metadata.len() > limit {
        return Err(too_large.into());
    }
    let file = File::open(path).map_err(error)?;
    let mut bytes = Vec::with_capacity(metadata.len().min(limit) as usize);
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > limit {
        return Err(too_large.into());
    }
    Ok(bytes)
}

/// Read one archive entry after checking a hard byte ceiling.
pub(crate) fn read_entry_limited<R: Read>(
    reader: &mut R,
    declared: u64,
    limit: u64,
    too_large: &str,
) -> Result<Vec<u8>> {
    if declared > limit {
        return Err(too_large.into());
    }
    let mut bytes = Vec::with_capacity(declared.min(limit) as usize);
    // Reading one byte beyond the declared size is enough to detect a lying
    // central directory without materialising the whole limit again.
    reader
        .take(declared.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > limit {
        return Err(too_large.into());
    }
    Ok(bytes)
}

/// Progress of a packaged-document read.
#[derive(Clone, Serialize)]
pub struct LoadProgress {
    pub(crate) completed: usize,
    pub(crate) total: usize,
}

/// Shared native contract for open documents and their in-flight write sessions.
#[derive(Default)]
pub struct DocumentHost {
    pub(crate) documents: Mutex<HashMap<String, Document>>,
    pub(crate) saves: Mutex<HashMap<String, SaveSession>>,
    pub(crate) recoveries: Mutex<HashMap<String, RecoverySession>>,
    pub(crate) watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    /// Random-access chart bytes and line ranges for streaming opens.
    pub(crate) streams: Mutex<HashMap<String, chart_stream::ChartStreamDocument>>,
}

/// Open document and the resolved paths of its chart and referenced resources.
#[derive(Clone)]
pub(crate) struct Document {
    pub(crate) path: PathBuf,
    pub(crate) chart_name: String,
    pub(crate) packed: bool,
    pub(crate) resources: HashMap<String, PathBuf>,
}

/// One resource entry reported to the frontend after a document opens.
#[derive(Serialize)]
pub struct Entry {
    pub(crate) name: String,
    pub(crate) size: u64,
}

/// Result of opening a document.
#[derive(Serialize)]
pub struct Opened {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) chart_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) chart: Option<Value>,
    pub(crate) entries: Vec<Entry>,
    pub(crate) packed: bool,
    pub(crate) disk_snapshot: String,
    /// Referenced names that stay outside the document folder without a grant,
    /// or whose relative path escapes it. Omitted when every reference resolved.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) rejected_external_resources: Vec<String>,
}

/// One resource write supplied with a save or recovery request.
#[derive(Deserialize)]
pub struct AssetUpdate {
    pub(crate) name: String,
    pub(crate) bytes: Vec<u8>,
}

/// Chart payload accepted by a save.
///
/// The editor normally pre-serializes the immutable snapshot in a worker and
/// sends JSON text, so the UI thread never has to walk the whole object graph.
/// A raw value remains accepted for other desktop callers.
#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum ChartPayload {
    // Keep the string variant first: untagged deserialization takes the first
    // matching variant, and `Value` accepts every JSON shape including a string.
    Json(String),
    Value(Value),
}

impl ChartPayload {
    /// Decode JSON text or return the already-parsed value.
    pub(crate) fn into_value(self) -> std::result::Result<Value, String> {
        match self {
            Self::Json(text) => {
                if text.len() as u64 > MAX_CHART_BYTES {
                    return Err("chart_too_large".into());
                }
                serde_json::from_str(&text).map_err(|_| "invalid_save_chart".to_string())
            }
            Self::Value(value) => Ok(value),
        }
    }
}

/// Save request as sent by the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveRequest {
    pub(crate) id: Option<String>,
    pub(crate) path: String,
    pub(crate) chart: Option<ChartPayload>,
    pub(crate) disk_snapshot: Option<String>,
    pub(crate) removed: Vec<String>,
    pub(crate) extract_to: Option<String>,
    pub(crate) export: bool,
}

/// In-flight save: the staged chart, resources, and the target document.
pub(crate) struct SaveSession {
    pub(crate) id: Option<String>,
    pub(crate) document: Option<Document>,
    pub(crate) target: PathBuf,
    pub(crate) chart: Option<Value>,
    pub(crate) chart_bytes: Vec<u8>,
    pub(crate) expected_disk_snapshot: Option<String>,
    pub(crate) removed: Vec<String>,
    pub(crate) extract_to: Option<String>,
    pub(crate) export: bool,
    pub(crate) staging: tempfile::TempDir,
    pub(crate) asset_names: Vec<String>,
    pub(crate) asset_bytes: u64,
}

/// In-flight recovery draft with its staged chart and resources.
pub(crate) struct RecoverySession {
    pub(crate) id: String,
    pub(crate) path: Option<String>,
    pub(crate) chart: Option<Value>,
    pub(crate) chart_bytes: Vec<u8>,
    pub(crate) view_state: Value,
    pub(crate) limit: usize,
    pub(crate) staging: tempfile::TempDir,
    pub(crate) asset_names: Vec<String>,
    pub(crate) asset_bytes: u64,
}

/// Magic bytes at the start of a raw asset packet: session id, name, bytes.
pub(crate) const SAVE_ASSET_MAGIC: &[u8; 4] = b"RPEA";
/// Version of [`SAVE_ASSET_MAGIC`] packets.
pub(crate) const SAVE_ASSET_VERSION: u8 = 1;
/// Magic bytes at the start of a raw chart-chunk packet.
pub(crate) const SESSION_CHUNK_MAGIC: &[u8; 4] = b"RPEC";
/// Version of [`SESSION_CHUNK_MAGIC`] packets.
pub(crate) const SESSION_CHUNK_VERSION: u8 = 1;

/// Decode one raw chart chunk: session id length, session id, chart bytes.
pub(crate) fn decode_session_chunk(body: &[u8]) -> Result<(String, &[u8])> {
    if body.len() < 9 || &body[..4] != SESSION_CHUNK_MAGIC || body[4] != SESSION_CHUNK_VERSION {
        return Err("invalid_chunk_data".into());
    }
    let session_length = u32::from_le_bytes(body[5..9].try_into().unwrap()) as usize;
    let session_end = 9usize
        .checked_add(session_length)
        .ok_or_else(|| "invalid_chunk_data".to_string())?;
    if body.len() < session_end {
        return Err("incomplete_chunk_data".into());
    }
    let session = std::str::from_utf8(&body[9..session_end])
        .map_err(|_| "invalid_chunk_data".to_string())?
        .to_owned();
    Ok((session, &body[session_end..]))
}

/// Whether a path has one of the chart extensions the host opens.
pub fn is_document(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("json" | "pez" | "zip")
    )
}

/// Chart files passed on the command line at launch.
#[tauri::command]
pub fn startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|path| is_document(path))
        .collect()
}

/// One file from an OS drop, with the bare name the asset map stores.
#[derive(Serialize)]
pub struct DroppedAssetFile {
    /// Bare file name as reported by the OS.
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Read dropped asset paths for the asset-library importer.
///
/// The webview cannot read arbitrary local paths, so the native drop handler
/// hands the paths here and receives the bytes in one command. Directories and
/// unreadable entries are skipped; the frontend decides which extensions to
/// accept.
#[tauri::command]
pub fn read_dropped_asset_files(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    paths: Vec<String>,
) -> Result<Vec<DroppedAssetFile>> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    if paths.len() > MAX_DROPPED_FILES {
        return Err("dropped_file_count_limit".into());
    }
    let mut files = Vec::new();
    let mut total = 0u64;
    for raw in paths {
        let path = Path::new(&raw);
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let length = fs::metadata(path).map_err(error)?.len();
        if length > MAX_RESOURCE_BYTES {
            return Err("dropped_file_too_large".into());
        }
        total = total
            .checked_add(length)
            .filter(|value| *value <= MAX_DROPPED_TOTAL_BYTES)
            .ok_or("dropped_total_too_large")?;
        let bytes = read_file_limited(path, MAX_RESOURCE_BYTES, "dropped_file_too_large")?;
        files.push(DroppedAssetFile {
            name: name.to_owned(),
            bytes,
        });
    }
    Ok(files)
}

/// Read a file chosen by the native dialog as binary IPC data.
///
/// The webview receives a path from `plugin-dialog`; this command turns the
/// selected files into bytes without routing them through a number-array JSON
/// payload.
#[tauri::command]
pub fn read_picked_file(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
) -> Result<tauri::ipc::Response> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let bytes = read_file_limited(
        Path::new(&path),
        MAX_IMPORT_FILE_BYTES,
        "picked_file_too_large",
    )?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Write one exported chart text file chosen by the native save dialog.
///
/// Official JSON and PEC are single-file text formats, so they bypass the PEZ
/// writer and use the same atomic replacement rule as a document save.
#[tauri::command]
pub fn write_export_text(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    text: String,
) -> std::result::Result<String, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    if text.len() as u64 > MAX_CHART_BYTES {
        return Err("export_text_too_large".into());
    }
    let target = PathBuf::from(&path);
    if target.is_dir() {
        return Err("The export target is a directory.".into());
    }
    atomic_write(&target, text.as_bytes())?;
    Ok(path)
}

/// Write one binary package export selected by the native save dialog.
#[tauri::command]
pub fn write_export_bytes(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    bytes: Vec<u8>,
) -> std::result::Result<String, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    if bytes.len() as u64 > 64 * 1024 * 1024 {
        return Err("export_bytes_too_large".into());
    }
    let target = PathBuf::from(&path);
    if target.is_dir() {
        return Err("The export target is a directory.".into());
    }
    atomic_write(&target, &bytes)?;
    Ok(path)
}

/// Render any displayable error as its message.
pub(crate) fn error<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

/// Resource names the chart references through its metadata, lines, notes, and
/// effect shaders, sorted and deduplicated.
pub(crate) fn resource_names(chart: &Value) -> Vec<String> {
    let mut names = Vec::new();
    for key in ["song", "background"] {
        if let Some(s) = chart["META"][key].as_str() {
            if !s.is_empty() {
                names.push(s.to_owned());
            }
        }
    }
    if let Some(lines) = chart["judgeLineList"].as_array() {
        for line in lines {
            if let Some(s) = line["Texture"].as_str() {
                if s != "line.png" && !s.is_empty() {
                    names.push(s.to_owned());
                }
            }
            if let Some(notes) = line["notes"].as_array() {
                for note in notes {
                    for key in ["hitsound", "hitSound"] {
                        if let Some(s) = note[key].as_str() {
                            if !s.is_empty() && !["tap", "drag", "flick"].contains(&s) {
                                names.push(s.to_owned());
                            }
                        }
                    }
                }
            }
        }
    }
    let mut collect_shader_effects = |effects: Option<&Vec<Value>>| {
        if let Some(effects) = effects {
            for effect in effects {
                for key in ["shader", "source", "shaderPath"] {
                    if let Some(name) = effect[key].as_str() {
                        let lower = name.to_ascii_lowercase();
                        if [".glsl", ".frag", ".vert", ".vsh", ".fsh", ".shader"]
                            .iter()
                            .any(|suffix| lower.ends_with(suffix))
                        {
                            names.push(name.into());
                        }
                    }
                }
            }
        }
    };
    collect_shader_effects(chart["effects"].as_array());
    collect_shader_effects(chart["shaderEvents"].as_array());
    collect_shader_effects(chart["META"]["effects"].as_array());
    if let Some(lines) = chart["judgeLineList"].as_array() {
        for line in lines {
            collect_shader_effects(line["extended"]["paintEvents"].as_array());
        }
    }
    names.sort();
    names.dedup();
    names
}

/// Normalize one chart resource name under the project-relative policy.
///
/// This keeps the document host's public error code while the shared policy
/// lives in [`crate::storage::path_safety::relative_path`].
pub(crate) fn normalize_resource_name(name: &str) -> Result<String> {
    crate::storage::path_safety::relative_path(name).ok_or_else(|| "unsafe_resource_path".into())
}

/// Reject archive entry names that are absolute, traversing, or platform paths.
///
/// Archive names are stored verbatim, so they must already be normalized; this
/// keeps a backslash or `.` segment from becoming a different entry on unpack.
pub(crate) fn zip_name(name: &str) -> Result<()> {
    // Explicit directory entries are stored with a trailing separator.
    let entry = name.strip_suffix('/').unwrap_or(name);
    let normalized = normalize_resource_name(entry)?;
    if normalized != entry {
        return Err("Unsafe PEZ resource path.".into());
    }
    Ok(())
}

/// Whether a zip archive contains an entry whose decoded name equals `target`.
///
/// Entry names are decoded from their raw bytes as UTF-8. A name that cannot be
/// decoded fails the lookup instead of being silently skipped, so a malformed
/// archive cannot hide an entry from the caller.
pub(crate) fn archive_has_entry<R: Read + Seek>(
    archive: &ZipArchive<R>,
    target: &str,
) -> Result<bool> {
    for name in archive.file_names() {
        if name.map_err(error)? == target {
            return Ok(true);
        }
    }
    Ok(false)
}

/// External resource targets explicitly granted for one document.
///
/// A grant names a canonical file outside the document folder. The set is kept
/// on the open [`Document`] and in the per-document grant store; it is never a
/// process-wide allow list, so one document cannot authorize another's paths.
#[derive(Clone, Debug, Default)]
pub(crate) struct ExternalResources {
    paths: Vec<PathBuf>,
}

impl ExternalResources {
    /// Build a grant set from already resolved paths.
    pub(crate) fn from_paths(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        let mut resources = Self::default();
        for path in paths {
            resources.insert(path);
        }
        resources
    }

    /// Add one canonical path; returns whether the set changed.
    pub(crate) fn insert(&mut self, path: PathBuf) -> bool {
        if self.contains(&path) {
            return false;
        }
        self.paths.push(path);
        true
    }

    /// Whether `path` is exactly one of the granted targets.
    pub(crate) fn contains(&self, path: &Path) -> bool {
        self.paths.iter().any(|granted| same_path(granted, path))
    }

    /// Granted targets in insertion order.
    pub(crate) fn paths(&self) -> impl Iterator<Item = &PathBuf> {
        self.paths.iter()
    }
}

/// One resource reference resolved against a document folder.
#[derive(Clone, Debug)]
pub(crate) struct ResolvedReference {
    pub(crate) path: PathBuf,
    /// Whether the target stays inside the document folder after canonicalisation.
    pub(crate) internal: bool,
}

/// Resource references split by the policy the document host can enforce.
pub(crate) struct ResolvedReferences {
    /// Names that may be read: in-folder paths and explicitly granted external paths.
    pub(crate) allowed: HashMap<String, PathBuf>,
    /// Absolute names whose canonical targets lie outside the document folder.
    pub(crate) external: HashMap<String, PathBuf>,
    /// Relative names that escape the folder, or names that cannot be parsed.
    pub(crate) rejected: Vec<String>,
}

/// Whether `name` syntactically names an absolute, drive, UNC, or colon path.
pub(crate) fn reference_is_absolute(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    Path::new(&normalized).is_absolute() || normalized.starts_with('/') || normalized.contains(':')
}

/// Whether `name` contains a parent-directory segment.
pub(crate) fn reference_has_parent(name: &str) -> bool {
    name.replace('\\', "/").split('/').any(|part| part == "..")
}

/// Whether a reference cannot be turned into a path at all.
pub(crate) fn reference_is_invalid(name: &str) -> bool {
    name.is_empty() || name.contains('\0')
}

/// Compare two path components using the host file-system convention.
#[cfg(windows)]
fn component_eq(left: &std::ffi::OsStr, right: &std::ffi::OsStr) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

/// Compare two path components exactly on case-sensitive hosts.
#[cfg(not(windows))]
fn component_eq(left: &std::ffi::OsStr, right: &std::ffi::OsStr) -> bool {
    left == right
}

/// Whether `target` is `root` or one of its descendants.
pub(crate) fn path_within(root: &Path, target: &Path) -> bool {
    let mut target_components = target.components();
    for expected in root.components() {
        match target_components.next() {
            Some(component) if component_eq(expected.as_os_str(), component.as_os_str()) => {}
            _ => return false,
        }
    }
    true
}

/// Whether two resolved paths name the same location.
fn same_path(left: &Path, right: &Path) -> bool {
    path_within(left, right) && path_within(right, left)
}

/// Canonicalise a path whose leaf may not exist yet.
///
/// The nearest existing ancestor is canonicalised and the missing suffix is
/// appended, so a missing resource is still classified against the folder that
/// actually contains it.
fn canonicalize_allow_missing(path: &Path) -> Result<PathBuf> {
    let mut cursor = path.to_path_buf();
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match fs::canonicalize(&cursor) {
            Ok(mut resolved) => {
                for part in suffix.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(cursor_error) if cursor_error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = cursor.file_name().map(|name| name.to_os_string()) else {
                    return Err("resource_path_unresolvable".into());
                };
                suffix.push(name);
                match cursor.parent() {
                    Some(parent) if !parent.as_os_str().is_empty() => {
                        cursor = parent.to_path_buf();
                    }
                    _ => return Err("resource_path_unresolvable".into()),
                }
            }
            Err(cursor_error) => return Err(error(cursor_error)),
        }
    }
}

/// Candidate on disk for one project-relative chart reference.
fn reference_candidate(root: &Path, name: &str) -> Result<PathBuf> {
    Ok(root.join(normalize_resource_name(name)?))
}

/// Candidate for an explicitly granted external reference.
///
/// External grants are the only path that may leave the document folder. UNC,
/// device-namespace, parent-traversing, and drive-relative names stay rejected
/// before canonicalisation.
fn external_candidate(name: &str) -> Result<PathBuf> {
    if reference_is_invalid(name) || !reference_is_absolute(name) || reference_has_parent(name) {
        return Err("unsafe_resource_path".into());
    }
    let normalized = name.replace('\\', "/");
    // A leading separator rejects UNIX-root, UNC, and `\\?\`/`\\.\` paths.
    let path = Path::new(&normalized);
    if normalized.starts_with('/') || !path.is_absolute() {
        return Err("unsafe_resource_path".into());
    }
    Ok(path.to_path_buf())
}

/// Resolve one candidate path against an already canonical folder.
fn classify_candidate(root: &Path, candidate: PathBuf) -> Result<ResolvedReference> {
    let path = canonicalize_allow_missing(&candidate)?;
    let internal = path_within(root, &path);
    Ok(ResolvedReference { path, internal })
}

/// Resolve one reference against a canonical document folder.
fn resolve_reference_in(root: &Path, name: &str) -> Result<ResolvedReference> {
    classify_candidate(root, reference_candidate(root, name)?)
}

/// Resolve one reference against a document folder.
pub(crate) fn resolve_reference(root: &Path, name: &str) -> Result<ResolvedReference> {
    let root = fs::canonicalize(root).map_err(error)?;
    resolve_reference_in(&root, name)
}

/// Resolve an already computed candidate path against a document folder.
pub(crate) fn resolve_path(root: &Path, candidate: &Path) -> Result<ResolvedReference> {
    let root = fs::canonicalize(root).map_err(error)?;
    let candidate = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    classify_candidate(&root, candidate)
}

/// Resolve each referenced resource against the chart's folder.
///
/// In-folder relative paths are always allowed. Absolute paths are allowed only
/// when their canonical target is in `authorized`; relative paths that escape the
/// folder, including symlink escapes, stay rejected.
pub(crate) fn resolve_references(
    path: &Path,
    chart: &Value,
    authorized: &ExternalResources,
) -> Result<ResolvedReferences> {
    resolve_named_references(path, resource_names(chart), authorized)
}

/// Resolve an explicit list of resource names against the chart's folder.
///
/// This is the streaming-open entry point: the header and line index already
/// name every resource, so the chart object graph does not have to be rebuilt.
pub(crate) fn resolve_named_references(
    path: &Path,
    names: impl IntoIterator<Item = String>,
    authorized: &ExternalResources,
) -> Result<ResolvedReferences> {
    let root = fs::canonicalize(path.parent().unwrap_or(Path::new("."))).map_err(error)?;
    let mut resolved = ResolvedReferences {
        allowed: HashMap::new(),
        external: HashMap::new(),
        rejected: Vec::new(),
    };
    for name in names {
        if reference_is_absolute(&name) {
            let candidate = match external_candidate(&name) {
                Ok(candidate) => candidate,
                Err(_) => {
                    resolved.rejected.push(name);
                    continue;
                }
            };
            match classify_candidate(&root, candidate) {
                Ok(reference) if !reference.internal => {
                    resolved
                        .external
                        .insert(name.clone(), reference.path.clone());
                    if authorized.contains(&reference.path) {
                        resolved.allowed.insert(name, reference.path);
                    }
                }
                // An absolute name that happens to resolve inside the folder is
                // still not a project-relative resource.
                Ok(_) | Err(_) => resolved.rejected.push(name),
            }
            continue;
        }
        match resolve_reference_in(&root, &name) {
            Ok(reference) if reference.internal => {
                resolved.allowed.insert(name, reference.path);
            }
            Ok(_) | Err(_) => resolved.rejected.push(name),
        }
    }
    Ok(resolved)
}

/// Names from resolved references that could not be read without a grant.
///
/// An external reference counts as denied unless its name also appears in
/// `allowed`; every syntactically rejected name is included. The result is
/// sorted and deduplicated so a chart and its `extra.json` can be merged.
pub(crate) fn rejected_reference_names<'a>(
    references: impl IntoIterator<Item = &'a ResolvedReferences>,
) -> Vec<String> {
    let mut names = Vec::new();
    for resolved in references {
        names.extend(resolved.rejected.iter().cloned());
        names.extend(
            resolved
                .external
                .keys()
                .filter(|name| !resolved.allowed.contains_key(name.as_str()))
                .cloned(),
        );
    }
    names.sort();
    names.dedup();
    names
}

/// Resolve one readable resource, rechecking containment after the document opened.
///
/// A local resource must still canonicalise inside the document folder. A path
/// outside the folder is readable only when it is exactly the canonical target
/// recorded for the document, so replacing an authorized file with a symlink
/// does not widen the read.
pub(crate) fn readable_resource_path(document: &Document, name: &str) -> Result<PathBuf> {
    if reference_is_absolute(name) {
        external_candidate(name)?;
    } else {
        normalize_resource_name(name)?;
    }
    let stored = document
        .resources
        .get(name)
        .ok_or("Resource is not part of the current document")?;
    let root = fs::canonicalize(document.path.parent().unwrap_or(Path::new("."))).map_err(error)?;
    let current = fs::canonicalize(stored).map_err(error)?;
    if path_within(&root, &current) {
        return Ok(current);
    }
    if !path_within(&root, stored) && same_path(stored, &current) {
        return Ok(current);
    }
    Err("Resource is not authorized.".into())
}

/// External grants carried by an already open document.
pub(crate) fn external_resources_of(document: &Document) -> ExternalResources {
    let Ok(root) = fs::canonicalize(document.path.parent().unwrap_or(Path::new("."))) else {
        return ExternalResources::default();
    };
    let mut resources = ExternalResources::default();
    for path in document.resources.values() {
        let candidate = if path.is_absolute() {
            path.clone()
        } else {
            root.join(path)
        };
        if let Ok(reference) = classify_candidate(&root, candidate) {
            if !reference.internal {
                resources.insert(reference.path);
            }
        }
    }
    resources
}

/// Per-document external-resource grants, stored under the user data folder.
const EXTERNAL_GRANT_FILE: &str = "document-external-resources.json";
/// Largest grant store read from disk.
const MAX_GRANT_STORE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Default, Deserialize, Serialize)]
struct ExternalGrantStore {
    #[serde(default)]
    documents: BTreeMap<String, Vec<String>>,
}

/// Read the grant store; a missing or malformed store grants nothing.
fn read_grant_store(path: &Path) -> ExternalGrantStore {
    read_file_limited(path, MAX_GRANT_STORE_BYTES, "grant_store_too_large")
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Persist one grant store atomically.
fn write_grant_store(path: &Path, store: &ExternalGrantStore) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(store).map_err(error)?;
    atomic_write(path, &bytes)
}

/// Load explicitly granted external resources for one canonical document path.
pub(crate) fn load_external_grants(app: &AppHandle, document: &Path) -> ExternalResources {
    let Ok(path) = crate::storage::data_dir(app).map(|root| root.join(EXTERNAL_GRANT_FILE)) else {
        return ExternalResources::default();
    };
    let store = read_grant_store(&path);
    let key = document.to_string_lossy();
    let Some(values) = store.documents.get(key.as_ref()) else {
        return ExternalResources::default();
    };
    ExternalResources::from_paths(values.iter().map(PathBuf::from))
}

/// Store the complete grant set for one canonical document path.
pub(crate) fn store_external_grants(
    app: &AppHandle,
    document: &Path,
    resources: &ExternalResources,
) -> Result<()> {
    let directory = crate::storage::data_dir(app)?;
    fs::create_dir_all(&directory).map_err(error)?;
    let path = directory.join(EXTERNAL_GRANT_FILE);
    let mut store = read_grant_store(&path);
    let key = document.to_string_lossy().into_owned();
    let mut values: Vec<String> = resources
        .paths()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    values.sort();
    values.dedup();
    if values.is_empty() {
        store.documents.remove(&key);
    } else {
        store.documents.insert(key, values);
    }
    write_grant_store(&path, &store)
}

/// Clone the registered document for `id`; a closed id is an error.
pub(crate) fn document(state: &DocumentHost, id: &str) -> Result<Document> {
    state
        .documents
        .lock()
        .map_err(error)?
        .get(id)
        .cloned()
        .ok_or("Document is closed.".into())
}

/// Replace a file by persisting a synced temporary file in the same directory.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_write_with(path, |file| file.write_all(bytes).map_err(error))
}

/// Atomically replace `path` with whatever `write` produces.
pub(crate) fn atomic_write_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> Result<()>,
) -> Result<()> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new("."))).map_err(error)?;
    write(file.as_file_mut())?;
    file.as_file().sync_all().map_err(error)?;
    file.persist(path).map_err(error)?;
    Ok(())
}

/// Rewrite chart resource references through `remap`.
pub(crate) fn remap_chart(chart: &mut Value, remap: &HashMap<String, String>) {
    let rewrite = |v: &mut Value| {
        if let Some(next) = v.as_str().and_then(|name| remap.get(name)) {
            *v = Value::String(next.clone());
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
}

/// Resource bytes supplied either directly or staged in a session directory.
pub(crate) enum AssetSource<'a> {
    Memory(&'a [AssetUpdate]),
    Staged { root: &'a Path, names: &'a [String] },
}

impl AssetSource<'_> {
    /// Names in the order the caller supplied them.
    pub(crate) fn names(&self) -> Vec<String> {
        match self {
            Self::Memory(updates) => updates.iter().map(|update| update.name.clone()).collect(),
            Self::Staged { names, .. } => names.to_vec(),
        }
    }

    /// Whether the source carries no resources.
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Self::Memory(updates) => updates.is_empty(),
            Self::Staged { names, .. } => names.is_empty(),
        }
    }

    /// Whether `name` is part of the source, without reading its bytes.
    pub(crate) fn contains(&self, name: &str) -> bool {
        match self {
            Self::Memory(updates) => updates.iter().any(|update| update.name == name),
            Self::Staged { names, .. } => names.iter().any(|entry| entry == name),
        }
    }

    /// Read one resource as owned bytes; `None` when the source lacks it.
    pub(crate) fn read(&self, name: &str) -> Result<Option<Vec<u8>>> {
        match self {
            Self::Memory(updates) => Ok(updates
                .iter()
                .find(|update| update.name == name)
                .map(|update| update.bytes.clone())),
            Self::Staged { root, .. } => {
                if !self.contains(name) {
                    return Ok(None);
                }
                Ok(Some(fs::read(root.join(name)).map_err(error)?))
            }
        }
    }

    /// Stream one resource into `writer` without materialising it twice.
    pub(crate) fn copy_to<W: Write>(&self, name: &str, writer: &mut W) -> Result<()> {
        match self {
            Self::Memory(updates) => {
                let update = updates
                    .iter()
                    .find(|update| update.name == name)
                    .ok_or_else(|| format!("Missing resource: {name}"))?;
                writer.write_all(&update.bytes).map_err(error)?;
            }
            Self::Staged { root, .. } => {
                let mut file = File::open(root.join(name)).map_err(error)?;
                std::io::copy(&mut file, writer).map_err(error)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        read_entry_limited, read_file_limited, read_grant_store, rejected_reference_names,
        resolve_references, write_grant_store, ExternalGrantStore, ExternalResources, Opened,
    };
    use serde_json::json;
    use std::{fs, io::Cursor, path::Path};
    use tempfile::tempdir;

    #[cfg(unix)]
    fn symlink_file(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(source, link)
    }

    #[cfg(windows)]
    fn symlink_file(source: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(source, link)
    }

    #[test]
    fn resource_name_normalization_rejects_absolute_paths() {
        assert_eq!(
            super::normalize_resource_name(r"C:\charts\song.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
        assert_eq!(
            super::normalize_resource_name("/charts/song.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
    }

    #[test]
    fn resource_name_normalization_rejects_parent_segments() {
        assert_eq!(
            super::normalize_resource_name("../secret.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
        assert_eq!(
            super::normalize_resource_name(r"media\..\secret.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
    }

    #[test]
    fn resource_name_normalization_accepts_a_project_relative_path() {
        assert_eq!(
            super::normalize_resource_name(r"media\songs\song.ogg").unwrap(),
            "media/songs/song.ogg"
        );
    }

    #[test]
    fn resource_name_normalization_rejects_unc_and_device_paths() {
        assert_eq!(
            super::normalize_resource_name(r"\\server\share\song.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
        assert_eq!(
            super::normalize_resource_name(r"\\?\C:\charts\song.ogg").unwrap_err(),
            "unsafe_resource_path"
        );
        assert_eq!(
            super::normalize_resource_name("CON.mp4").unwrap_err(),
            "unsafe_resource_path"
        );
    }

    #[test]
    fn zip_name_allows_explicit_directories_but_rejects_traversal() {
        assert!(super::zip_name("resources/").is_ok());
        assert!(super::zip_name("../resources").is_err());
    }

    #[test]
    fn relative_resource_inside_the_document_folder_is_allowed() {
        let root = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let song = root.path().join("song.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&song, b"audio").unwrap();
        let chart_json = json!({"META": {"song": "song.ogg"}});

        let references =
            resolve_references(&chart, &chart_json, &ExternalResources::default()).unwrap();

        assert_eq!(
            references.allowed.get("song.ogg"),
            Some(&fs::canonicalize(&song).unwrap())
        );
        assert!(references.external.is_empty());
        assert!(references.rejected.is_empty());
    }

    #[test]
    fn parent_traversal_and_absolute_paths_are_rejected_without_authorization() {
        let root = tempdir().unwrap();
        let folder = root.path().join("project");
        fs::create_dir_all(&folder).unwrap();
        let chart = folder.join("chart.json");
        let secret = root.path().join("secret.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&secret, b"private").unwrap();
        let absolute = secret.to_string_lossy().replace('\\', "/");
        let chart_json = json!({"META": {"song": "../secret.ogg", "background": absolute}});

        let references =
            resolve_references(&chart, &chart_json, &ExternalResources::default()).unwrap();

        assert!(references.allowed.is_empty());
        assert!(references.rejected.contains(&"../secret.ogg".to_string()));
        assert!(references
            .external
            .contains_key(&secret.to_string_lossy().replace('\\', "/")));
    }

    #[test]
    fn an_absolute_resource_is_allowed_only_after_explicit_authorization() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let external = outside.path().join("shared.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&external, b"audio").unwrap();
        let name = external.to_string_lossy().replace('\\', "/");
        let chart_json = json!({"META": {"song": name}});
        let canonical = fs::canonicalize(&external).unwrap();

        let authorized = resolve_references(
            &chart,
            &chart_json,
            &ExternalResources::from_paths([canonical.clone()]),
        )
        .unwrap();

        assert_eq!(authorized.allowed.get(&name), Some(&canonical));
        assert_eq!(authorized.external.get(&name), Some(&canonical));
    }

    #[test]
    fn a_symlink_escape_is_rejected_even_when_its_target_is_authorized() {
        let root = tempdir().unwrap();
        let folder = root.path().join("project");
        let outside = root.path().join("outside.ogg");
        fs::create_dir_all(&folder).unwrap();
        fs::write(&folder.join("chart.json"), b"{}").unwrap();
        fs::write(&outside, b"private").unwrap();
        let link = folder.join("link.ogg");
        if symlink_file(&outside, &link).is_err() {
            return;
        }
        let chart_json = json!({"META": {"song": "link.ogg"}});
        let authorization = ExternalResources::from_paths([fs::canonicalize(&outside).unwrap()]);

        let references =
            resolve_references(&folder.join("chart.json"), &chart_json, &authorization).unwrap();

        assert!(!references.allowed.contains_key("link.ogg"));
        assert!(references.rejected.contains(&"link.ogg".to_string()));
    }

    #[test]
    fn external_grants_round_trip_per_document() {
        let root = tempdir().unwrap();
        let path = root.path().join("grants.json");
        let mut store = ExternalGrantStore::default();
        store.documents.insert(
            "D:/charts/chart.json".into(),
            vec!["D:/shared/song.ogg".into()],
        );

        write_grant_store(&path, &store).unwrap();
        let loaded = read_grant_store(&path);

        assert_eq!(
            loaded.documents.get("D:/charts/chart.json"),
            Some(&vec!["D:/shared/song.ogg".into()])
        );
    }

    #[test]
    fn chart_and_extra_rejections_merge_without_duplicates() {
        let root = tempdir().unwrap();
        let folder = root.path().join("project");
        let outside = root.path().join("outside");
        fs::create_dir_all(&folder).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let chart = folder.join("chart.json");
        fs::write(&chart, b"{}").unwrap();
        fs::write(root.path().join("secret.ogg"), b"private").unwrap();
        let external = outside.join("shared.glsl");
        fs::write(&external, b"shader").unwrap();
        let external_name = external.to_string_lossy().replace('\\', "/");
        let chart_json = json!({
            "META": {"song": external_name.clone(), "background": "../secret.ogg"},
            "effects": [{"shader": external_name.clone()}],
        });
        let extra_json = json!({"META": {"song": external_name.clone()}});

        let chart_references =
            resolve_references(&chart, &chart_json, &ExternalResources::default()).unwrap();
        let extra_references =
            resolve_references(&chart, &extra_json, &ExternalResources::default()).unwrap();
        let names = rejected_reference_names([&chart_references, &extra_references]);

        let mut expected = vec!["../secret.ogg".to_string(), external_name];
        expected.sort();
        assert_eq!(names, expected);
    }

    #[test]
    fn references_inside_the_document_folder_are_not_reported() {
        let root = tempdir().unwrap();
        let folder = root.path().join("project");
        fs::create_dir_all(&folder).unwrap();
        let chart = folder.join("chart.json");
        fs::write(&chart, b"{}").unwrap();
        fs::write(folder.join("song.ogg"), b"audio").unwrap();
        fs::write(folder.join("background.png"), b"image").unwrap();
        let chart_json = json!({"META": {"song": "song.ogg", "background": "background.png"}});
        let extra_json = json!({"META": {"song": "song.ogg"}});

        let chart_references =
            resolve_references(&chart, &chart_json, &ExternalResources::default()).unwrap();
        let extra_references =
            resolve_references(&chart, &extra_json, &ExternalResources::default()).unwrap();

        assert!(rejected_reference_names([&chart_references, &extra_references]).is_empty());
    }

    #[test]
    fn authorized_external_references_are_not_reported() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let granted = outside.path().join("granted.ogg");
        let denied = outside.path().join("denied.ogg");
        fs::write(&chart, b"{}").unwrap();
        fs::write(&granted, b"audio").unwrap();
        fs::write(&denied, b"audio").unwrap();
        let granted_name = granted.to_string_lossy().replace('\\', "/");
        let denied_name = denied.to_string_lossy().replace('\\', "/");
        let authorization = ExternalResources::from_paths([fs::canonicalize(&granted).unwrap()]);

        let all_granted = resolve_references(
            &chart,
            &json!({"META": {"song": granted_name.clone()}}),
            &authorization,
        )
        .unwrap();
        assert!(rejected_reference_names([&all_granted]).is_empty());

        let mixed = resolve_references(
            &chart,
            &json!({"META": {"song": granted_name, "background": denied_name.clone()}}),
            &authorization,
        )
        .unwrap();
        assert_eq!(rejected_reference_names([&mixed]), vec![denied_name]);
    }

    #[test]
    fn opened_omits_the_rejected_list_when_empty() {
        let opened = |rejected_external_resources| Opened {
            id: "id".into(),
            path: "D:/charts/chart.json".into(),
            chart_name: "chart.json".into(),
            chart: None,
            entries: Vec::new(),
            packed: false,
            disk_snapshot: "snapshot".into(),
            rejected_external_resources,
        };

        let empty = serde_json::to_value(opened(Vec::new())).unwrap();
        assert!(empty.get("rejected_external_resources").is_none());

        let rejected = serde_json::to_value(opened(vec!["../secret.ogg".into()])).unwrap();
        assert_eq!(
            rejected.get("rejected_external_resources"),
            Some(&json!(["../secret.ogg"]))
        );
    }

    #[test]
    fn file_read_limit_accepts_the_ceiling_and_rejects_larger_input() {
        let root = tempdir().unwrap();
        let path = root.path().join("asset.bin");
        fs::write(&path, b"1234").unwrap();
        assert_eq!(read_file_limited(&path, 4, "too_large").unwrap(), b"1234");
        assert_eq!(
            read_file_limited(&path, 3, "too_large").unwrap_err(),
            "too_large"
        );
    }

    #[test]
    fn entry_read_limit_rejects_an_oversized_declaration_before_reading() {
        let mut reader = Cursor::new(vec![0u8; 8]);
        assert_eq!(
            read_entry_limited(&mut reader, 9, 8, "too_large").unwrap_err(),
            "too_large"
        );
    }

    #[test]
    fn entry_read_limit_stops_one_byte_past_a_lying_declaration() {
        let mut reader = Cursor::new(vec![0u8; 8]);
        let bytes = read_entry_limited(&mut reader, 4, 1024, "too_large").unwrap();
        assert_eq!(bytes.len(), 5);
    }

    #[test]
    fn chart_payload_keeps_the_existing_parse_error_code() {
        let payload = super::ChartPayload::Json("{".into());
        assert_eq!(payload.into_value().unwrap_err(), "invalid_save_chart");
    }
}
