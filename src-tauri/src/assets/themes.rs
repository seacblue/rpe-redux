//! Discovers theme and icon packages from the deployment root and the bundled
//! resources.
//!
//! User packages live in `themes/` below the deployment root: beside the
//! executable for Windows and portable builds, under the XDG data directory for
//! packaged Linux builds. Bundled packages sit in the resource directory. A user
//! package wins an id collision so a local copy can override a shipped one.
//!
//! A theme package is one JSON document (see `src/core/theme/packages.ts`). The
//! host only reads and writes documents: it never interprets a palette or a
//! chrome recipe, so a theme cannot change anything the frontend does not
//! already expose as a validated token or preset.
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, Metadata},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

type Result<T> = std::result::Result<T, String>;

/// A palette is small; an icon set inlines its glyphs as data URLs.
const MAX_THEME_BYTES: u64 = 4 * 1024 * 1024;
/// Only JSON documents are considered theme packages.
const THEME_EXTENSION: &str = "json";
/// Number of parsed documents retained between folder polls.
const MAX_CACHED_THEMES: usize = 128;

/// One parsed theme document and the metadata it was read from.
struct CachedTheme {
    length: u64,
    modified: Option<(u64, u32)>,
    document: Value,
}

/// Parsed theme documents keyed by path.
///
/// The folder poll runs while the editor is open. Re-reading and re-parsing an
/// unchanged icon theme every tick costs more than the comparison that follows,
/// so a file is parsed again only after its size or modification time changes.
#[derive(Default)]
struct ThemeCache {
    entries: HashMap<PathBuf, CachedTheme>,
}

/// Modification stamp with the platform's available precision.
fn modified_stamp(metadata: &Metadata) -> Option<(u64, u32)> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| (duration.as_secs(), duration.subsec_nanos()))
}

/// Writable `themes/` folder below the deployment root.
pub(crate) fn theme_root() -> Result<PathBuf> {
    Ok(crate::storage::user_root()?.join("themes"))
}

/// Scanned roots in precedence order: user packages, then bundled resources.
fn roots(app: &AppHandle) -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Ok(user) = crate::storage::user_root() {
        roots.push((user.join("themes"), "portable"));
    }
    if let Ok(resource) = app.path().resource_dir() {
        roots.push((resource.join("themes"), "resource"));
    }
    roots
}

/// Read one regular, non-symlinked JSON document within the size cap.
fn read_document(path: &Path, cache: &mut ThemeCache) -> Option<Value> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_THEME_BYTES
    {
        return None;
    }
    let length = metadata.len();
    let modified = modified_stamp(&metadata);
    if let Some(cached) = cache.entries.get(path) {
        if cached.length == length && cached.modified == modified {
            return Some(cached.document.clone());
        }
    }
    let bytes = fs::read(path).ok()?;
    let document: Value = serde_json::from_slice(&bytes).ok()?;
    if cache.entries.len() >= MAX_CACHED_THEMES {
        cache.entries.clear();
    }
    cache.entries.insert(
        path.to_path_buf(),
        CachedTheme {
            length,
            modified,
            document: document.clone(),
        },
    );
    Some(document)
}

/// Every package document in the scanned roots, deduplicated by id.
fn list_packages(app: &AppHandle) -> Result<Vec<Value>> {
    static CACHE: OnceLock<Mutex<ThemeCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(ThemeCache::default()));
    let mut cache = cache
        .lock()
        .map_err(|_| "theme_cache_poisoned".to_owned())?;
    let mut found = BTreeMap::<String, Value>::new();
    for (root, source) in roots(app) {
        if !root.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for item in entries.flatten() {
            let path = item.path();
            if path.extension().and_then(|value| value.to_str()) != Some(THEME_EXTENSION) {
                continue;
            }
            let Some(document) = read_document(&path, &mut cache) else {
                continue;
            };
            let Some(id) = document.get("id").and_then(Value::as_str) else {
                continue;
            };
            // Roots are ordered by precedence, so the first document wins.
            found
                .entry(id.to_owned())
                .or_insert_with(|| serde_json::json!({ "source": source, "document": document }));
        }
    }
    Ok(found.into_values().collect())
}

/// Every package document in the scanned roots, deduplicated by id.
#[tauri::command]
pub async fn list_theme_packages(app: AppHandle) -> Result<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(move || list_packages(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{read_document, ThemeCache};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn theme_cache_reuses_unchanged_documents() {
        let root = tempdir().unwrap();
        let path = root.path().join("theme.json");
        fs::write(&path, br##"{"id":"first","colors":{"surface":"#000"}}"##).unwrap();
        let mut cache = ThemeCache::default();
        let first = read_document(&path, &mut cache).unwrap();
        let second = read_document(&path, &mut cache).unwrap();
        assert_eq!(first, second);
        assert_eq!(cache.entries.len(), 1);

        fs::write(&path, br#"{"id":"second"}"#).unwrap();
        let third = read_document(&path, &mut cache).unwrap();
        assert_eq!(third["id"], serde_json::json!("second"));

        // The scan never keeps a file open; a deleted package can leave the
        // picker without waiting for the editor to restart.
        fs::remove_file(&path).unwrap();
        assert!(read_document(&path, &mut cache).is_none());
    }
}

/// Writes an imported package into the user theme folder, named after its id.
#[tauri::command]
pub fn install_theme_package(document: String) -> Result<String> {
    if document.len() as u64 > MAX_THEME_BYTES {
        return Err("Theme package is too large.".into());
    }
    let value: Value = serde_json::from_str(&document).map_err(|error| error.to_string())?;
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Theme package is missing an id".to_owned())?;
    let valid_name = crate::storage::path_safety::single_segment(id).is_some();
    let valid_characters = id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || ".-_".contains(character)
    });
    if !valid_name || !valid_characters || id.is_empty() {
        return Err(
            "Theme package id may contain only lowercase letters, digits, dots, underscores, and hyphens."
                .into(),
        );
    }
    let folder = theme_root()?;
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let target = folder.join(format!("{id}.{THEME_EXTENSION}"));
    fs::write(&target, document).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Remove an imported package by id. Bundled packages never live in the
/// portable folder, so a shipped theme cannot be deleted here.
#[tauri::command]
pub fn remove_theme_package(id: String) -> Result<()> {
    // Removal accepts any single safe segment so packages installed by older
    // builds, including ids that do not follow the current charset rule, can
    // still be deleted.
    if crate::storage::path_safety::single_segment(&id).is_none() {
        return Err("Theme package id is invalid.".into());
    }
    let folder = theme_root()?;
    let target = folder.join(format!("{id}.{THEME_EXTENSION}"));
    if target.is_file() {
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}
