//! Discovers, reads, installs, and removes note-skin folders from the
//! deployment and resource roots.
//!
//! A skin is data, not code: the host returns the manifest and relative file
//! bytes, and the frontend's note-skin parser validates and decodes the package.
//! The scanner never follows symlinks and stays inside the selected package
//! root. Deletion targets only the writable root, so a shipped package can
//! never be removed.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{hash_map::DefaultHasher, BTreeMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{ipc::Request, AppHandle, Manager, State};

type Result<T> = std::result::Result<T, String>;

/// Largest accepted Phira info.yml file, in bytes.
const MAX_INFO_BYTES: u64 = 64 * 1024;
/// File count cap for one skin package.
const MAX_FILES: usize = 256;
/// Total uncompressed size cap for one skin package, in bytes.
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// Package folder id of the built-in note skin shipped with the build.
///
/// The folder follows the shared display-name slug rule from the package's own
/// `name`; the frontend never spells this id out, it asks for it through
/// [`builtin_note_skin_id`].
pub const BUILTIN_SKIN_ID: &str = "built_in_original";

/// Package folder ids used by builds that shipped the built-in package before
/// it was renamed.
///
/// An upgrader can leave one of these behind in the portable install folder.
/// They hold the pre-rename shipped skin, so the scanner skips them instead of
/// listing a second built-in entry; only [`BUILTIN_SKIN_ID`] is the built-in.
const LEGACY_BUILTIN_SKIN_IDS: &[&str] = &["default"];

/// One note-skin package as the picker sees it.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSkinSummary {
    /// Package folder name, unique across the scanned roots.
    pub id: String,
    /// Manifest `name`, either an i18n object or a plain string.
    pub name: Value,
    /// Root the package was found in: `portable` or `resource`.
    pub source: String,
    /// Whether this package is the built-in one, so the picker lists it once.
    pub builtin: bool,
    /// Content signature so the picker and preview react to files changing on disk.
    pub fingerprint: String,
}

/// A discovered package with its manifest and canonical folder.
struct SkinPackage {
    id: String,
    folder: PathBuf,
    source: &'static str,
    manifest: Value,
}

/// Writable `skins/` folder below the deployment root.
fn skin_root() -> Result<PathBuf> {
    Ok(crate::storage::user_root()?.join("skins"))
}

/// Scanned package roots in precedence order: user first, then resource.
fn roots(app: &AppHandle) -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Ok(user) = crate::storage::user_root() {
        roots.push((user.join("skins"), "portable"));
    }
    if let Ok(resource) = app.path().resource_dir() {
        roots.push((resource.join("skins"), "resource"));
    }
    roots
}

/// Package ids are folder names of ASCII letters, digits, and `._-`.
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

/// Locate the one authored metadata file in a Phira skin package.
fn manifest_path(folder: &Path) -> Option<PathBuf> {
    let path = folder.join("info.yml");
    path.is_file().then_some(path)
}

/// Validate one package folder and read its manifest.
///
/// Returns `None` for invalid ids, symlinks, oversized manifests, or a folder
/// that resolves outside `root`.
fn read_skin(root: &Path, folder: &Path, source: &'static str) -> Option<SkinPackage> {
    let id = folder.file_name()?.to_str()?.to_owned();
    if !valid_id(&id) || LEGACY_BUILTIN_SKIN_IDS.contains(&id.as_str()) {
        return None;
    }
    let metadata = fs::symlink_metadata(folder).ok()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    let path = manifest_path(folder)?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_INFO_BYTES {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let name = String::from_utf8_lossy(&bytes)
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim() == "name").then(|| value.trim().trim_matches(['\"', '\'']).to_owned())
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| id.clone());
    let manifest = serde_json::json!({ "name": name });
    let canonical_root = root.canonicalize().ok()?;
    let canonical_folder = folder.canonicalize().ok()?;
    if !canonical_folder.starts_with(&canonical_root) {
        return None;
    }
    Some(SkinPackage {
        id,
        folder: canonical_folder,
        source,
        manifest,
    })
}

/// Every valid package, deduplicated by id in root precedence order.
fn packages(app: &AppHandle) -> Vec<SkinPackage> {
    let mut found = BTreeMap::<String, SkinPackage>::new();
    for (root, source) in roots(app) {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if let Some(package) = read_skin(&root, &entry.path(), source) {
                found.entry(package.id.clone()).or_insert(package);
            }
        }
    }
    found.into_values().collect()
}

/// Display name from the manifest, falling back to the package id.
fn skin_name(manifest: &Value, id: &str) -> Value {
    let name = manifest.get("name").cloned();
    match name {
        Some(Value::String(text)) if !text.trim().is_empty() => Value::String(text),
        Some(value @ Value::Object(_)) => value,
        _ => Value::String(id.to_owned()),
    }
}

/// A cheap signature of every regular file's path, size, and mtime.
///
/// The folder poll compares this string, so editing a manifest or replacing a
/// texture reports a change without loading the package again.
fn folder_fingerprint(root: &Path) -> String {
    let mut rows = Vec::<(String, u64, u128)>::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            rows.push((relative, metadata.len(), modified));
        }
    }
    rows.sort();
    let mut hasher = DefaultHasher::new();
    rows.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Packages dropped into `skins/` beside the executable, ready for the picker.
#[tauri::command]
pub fn list_note_skins(app: AppHandle) -> Result<Vec<NoteSkinSummary>> {
    Ok(packages(&app)
        .into_iter()
        .map(|package| NoteSkinSummary {
            name: skin_name(&package.manifest, &package.id),
            fingerprint: folder_fingerprint(&package.folder),
            builtin: package.id == BUILTIN_SKIN_ID,
            id: package.id,
            source: package.source.to_owned(),
        })
        .collect())
}

/// The package id the build ships as its built-in note skin.
#[tauri::command]
pub fn builtin_note_skin_id() -> String {
    BUILTIN_SKIN_ID.to_owned()
}

/// Read one package recursively as relative paths and base64-encoded bytes.
///
/// Symlinks are skipped and the per-file and total size caps abort the read.
fn collect_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
    total: &mut u64,
) -> Result<()> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_files(root, &path, files, total)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        if *total + metadata.len() > MAX_TOTAL_BYTES {
            return Err("Note skin is too large".into());
        }
        *total += metadata.len();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        {
            continue;
        }
        files.push((
            relative,
            fs::read(&path).map_err(|error| error.to_string())?,
        ));
        if files.len() > MAX_FILES {
            return Err("Note skin has too many files".into());
        }
    }
    Ok(())
}

/// Reads one package as relative paths plus base64 bytes and its root name.
#[tauri::command]
pub fn read_note_skin(app: AppHandle, id: String) -> Result<Value> {
    let package = packages(&app)
        .into_iter()
        .find(|package| package.id == id)
        .ok_or_else(|| format!("Note skin was not found: {id}"))?;
    let mut files = Vec::new();
    let mut total = 0;
    collect_files(&package.folder, &package.folder, &mut files, &mut total)?;
    let encoded = files
        .into_iter()
        .map(|(name, bytes)| {
            serde_json::json!({
                "name": name,
                "data": base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "manifest": package.manifest,
        "source": package.source,
        "files": encoded,
    }))
}

/// One relative file written by a Phira skin import.
#[derive(Deserialize)]
pub struct ImportedSkinFile {
    pub name: String,
    pub data: String,
}

/// Install a validated Phira package into the writable skin root.
///
/// The frontend validates the Phira schema before calling this command; the
/// host still re-checks paths, ids, base64, file counts, and total bytes before
/// replacing the package atomically through a temporary sibling directory.
#[tauri::command]
pub fn install_note_skin(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    id: String,
    files: Vec<ImportedSkinFile>,
) -> Result<String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    if !valid_id(&id) {
        return Err("Invalid note skin id".into());
    }
    if files.is_empty() || files.len() > MAX_FILES {
        return Err("Note skin has an invalid file count".into());
    }
    let root = skin_root()?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let target = root.join(&id);
    let temporary = root.join(format!(".{id}.importing-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temporary).map_err(|error| error.to_string())?;
    let result = (|| -> Result<()> {
        let mut total = 0u64;
        for file in files {
            if file.name.is_empty()
                || file.name.starts_with('/')
                || file.name.contains('\\')
                || file
                    .name
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            {
                return Err("Invalid note skin file path".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(file.data)
                .map_err(|error| error.to_string())?;
            total = total
                .checked_add(bytes.len() as u64)
                .filter(|value| *value <= MAX_TOTAL_BYTES)
                .ok_or_else(|| "Note skin is too large".to_owned())?;
            let path = temporary.join(&file.name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(path, bytes).map_err(|error| error.to_string())?;
        }
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&temporary);
    }
    result.map(|()| id)
}

/// Remove one package from the writable skin root.
///
/// Only a folder directly under `<user_root>/skins` is a deletion target: the
/// id must be one safe segment, the target must be a real (non-symlinked)
/// directory, and its canonical path must stay inside the canonical skin root.
/// A shipped package lives in the resource root, so it is never removed here.
/// Returns the removed id.
#[tauri::command]
pub fn remove_note_skin(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    id: String,
) -> Result<String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    // The scanner's charset is wider than a path segment needs; reject the
    // reserved and traversal names too before touching the filesystem.
    if !valid_id(&id) || crate::storage::path_safety::single_segment(&id).is_none() {
        return Err("Invalid note skin id".into());
    }
    let root = skin_root()?;
    let target = root.join(&id);
    let metadata =
        fs::symlink_metadata(&target).map_err(|_| format!("Note skin was not found: {id}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("Note skin was not found: {id}"));
    }
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_target = target.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_target.starts_with(&canonical_root) || canonical_target == canonical_root {
        return Err("Invalid note skin folder".into());
    }
    fs::remove_dir_all(&canonical_target).map_err(|error| error.to_string())?;
    Ok(id)
}
