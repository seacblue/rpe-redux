//! Discovers, reads, installs, and removes trusted Extension packages from the source,
//! resource, portable, and managed roots.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{ipc::Response, AppHandle, Manager, State};

type Result<T> = std::result::Result<T, String>;
/// Largest accepted `manifest.json`, in bytes.
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
/// Largest accepted code entry, in bytes.
const MAX_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
/// Largest accepted i18n catalog, in bytes.
const MAX_I18N_BYTES: u64 = 256 * 1024;
/// Package count cap across all roots.
const MAX_PACKAGES: usize = 256;
/// Largest accepted file in a managed install, in bytes.
const MAX_INSTALL_FILE_BYTES: usize = 4 * 1024 * 1024;
/// Largest accepted managed install, in bytes.
const MAX_INSTALL_TOTAL_BYTES: usize = 8 * 1024 * 1024;
/// File count cap for a managed install.
const MAX_INSTALL_FILES: usize = 8;
/// Heartbeat age after which the main WebView is considered stuck.
const WATCHDOG_STALE_AFTER: Duration = Duration::from_secs(12);

/// Watchdog deadline and marker state.
struct WatchdogState {
    last: Instant,
    active: bool,
    marked: bool,
}

/// Native heartbeat for the main WebView.
///
/// JavaScript cannot run when the renderer is stuck inside an Extension, so the
/// host process owns the deadline. A missed heartbeat leaves a marker in the app
/// data directory; the next launch reads it through `extension_safe_mode`.
pub struct ExtensionWatchdog {
    state: Mutex<WatchdogState>,
}

impl Default for ExtensionWatchdog {
    fn default() -> Self {
        Self {
            state: Mutex::new(WatchdogState {
                last: Instant::now(),
                active: false,
                marked: false,
            }),
        }
    }
}

/// Marker file written after a watchdog timeout and consumed on the next launch.
fn watchdog_marker(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("extensions-interrupted"))
}

/// Package metadata returned to the frontend.
#[derive(Clone, Serialize)]
pub struct PackagedExtension {
    /// Manifest id, also the folder name.
    pub id: String,
    pub manifest: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    /// Root the package came from.
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
}

/// A discovered package with its canonical folder.
struct Package {
    public: PackagedExtension,
    root: PathBuf,
}

/// Ids start with a lowercase letter and contain only `a-z`, `0-9`, `.`, `-`,
/// and `_`, up to 64 characters.
fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some('a'..='z'))
        && id.len() <= 64
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ".-_".contains(ch))
}

/// Whether a path is relative and contains only safe normal components.
fn safe_relative(path: &str) -> bool {
    crate::storage::path_safety::relative_path(path).is_some()
}

/// Whether a manifest-relative path is a portable `.json` file name.
fn safe_package_file(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 256
        && path.ends_with(".json")
        && !path.contains('\\')
        && safe_relative(path)
}

/// Scanned roots in descending trust order.
fn roots(app: &AppHandle) -> Vec<(PathBuf, &'static str)> {
    // Highest-trust roots win an id collision. Source is the development tree,
    // resource is the installed application bundle, and the deployment root is
    // where a user drops a package; a dropped package must never shadow either
    // shipped root.
    let mut roots = Vec::new();
    roots.push((
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/assets/extensions"),
        "source",
    ));
    if let Ok(resource) = app.path().resource_dir() {
        roots.push((resource.join("extensions"), "resource"));
    }
    if let Ok(user) = crate::storage::user_root() {
        roots.push((user.join("extensions"), "portable"));
    }
    if let Ok(data) = crate::storage::data_dir(app) {
        // Marketplace installs are managed by the application and survive an
        // application update; a manually dropped portable package still wins an
        // id collision so a user can pin a local build.
        roots.push((data.join("extensions"), "installed"));
    }
    roots
}

/// Whether an id belongs to the reserved builtin namespace.
fn reserved_builtin_id(id: &str) -> bool {
    id.starts_with("builtin.")
}

/// Validate one package folder and read its manifest, entry, and i18n catalog.
fn read_package(root: &Path, folder: &Path, source: &str) -> Result<Option<Package>> {
    let Some(folder_name) = folder.file_name().and_then(|name| name.to_str()) else {
        return Ok(None);
    };
    let folder_metadata = fs::symlink_metadata(folder).map_err(|error| error.to_string())?;
    if !valid_id(folder_name)
        || !folder_metadata.is_dir()
        || folder_metadata.file_type().is_symlink()
    {
        return Ok(None);
    }
    let manifest_path = folder.join("manifest.json");
    let metadata = match fs::symlink_metadata(&manifest_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "Extension manifest is not a regular file: {folder_name}"
        ));
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(format!("Extension manifest is too large: {folder_name}"));
    }
    let bytes = fs::read(&manifest_path).map_err(|error| error.to_string())?;
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Extension manifest has no id: {folder_name}"))?;
    if id != folder_name || !valid_id(id) {
        return Err(format!(
            "Extension id does not match its directory: {folder_name}"
        ));
    }
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_folder = folder.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_folder.starts_with(&canonical_root) {
        return Err(format!("Extension package escaped its root: {id}"));
    }
    let entry = match manifest.get("entry") {
        None => None,
        Some(Value::String(entry)) => {
            if !safe_relative(entry) {
                return Err(format!("Extension entry must be a relative file: {id}"));
            }
            let entry_path = folder.join(entry);
            let entry_metadata =
                fs::symlink_metadata(&entry_path).map_err(|error| error.to_string())?;
            if entry_metadata.file_type().is_symlink()
                || !entry_metadata.is_file()
                || entry_metadata.len() > MAX_ENTRY_BYTES
            {
                return Err(format!("Extension entry is missing or too large: {id}"));
            }
            let canonical_entry = entry_path
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if !canonical_entry.starts_with(&canonical_folder) {
                return Err(format!("Extension entry escaped its package: {id}"));
            }
            Some(entry.clone())
        }
        Some(value) => {
            return Err(format!(
                "Extension entry must be a relative file for {id}: {value}"
            ));
        }
    };
    let declared_i18n = manifest.get("i18n").is_some();
    let i18n = match manifest.get("i18n") {
        None => Some("i18n.json".to_owned()),
        Some(Value::String(path)) => {
            if !safe_package_file(path) {
                return Err(format!("Extension i18n path is invalid for {id}: {path}"));
            }
            Some(path.clone())
        }
        Some(value) => {
            return Err(format!(
                "Extension i18n path must be a relative JSON file for {id}: {value}"
            ));
        }
    };
    let i18n = if let Some(i18n) = i18n {
        let i18n_path = folder.join(&i18n);
        match fs::symlink_metadata(&i18n_path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(format!(
                        "Extension i18n is not a regular file: {id} ({i18n})"
                    ));
                }
                if metadata.len() > MAX_I18N_BYTES {
                    return Err(format!("Extension i18n is too large: {id} ({i18n})"));
                }
                let canonical_i18n = i18n_path
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !canonical_i18n.starts_with(&canonical_folder) {
                    return Err(format!("Extension i18n escaped its package: {id} ({i18n})"));
                }
                let bytes = fs::read(&i18n_path).map_err(|error| error.to_string())?;
                let value: Value = serde_json::from_slice(&bytes).map_err(|error| {
                    format!("Extension i18n is invalid UTF-8 or JSON: {id} ({i18n}): {error}")
                })?;
                Some(value)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !declared_i18n => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("Extension i18n file is missing: {id} ({i18n})"));
            }
            Err(error) => return Err(error.to_string()),
        }
    } else {
        None
    };
    Ok(Some(Package {
        public: PackagedExtension {
            id: id.to_owned(),
            manifest,
            entry,
            source: source.to_owned(),
            i18n,
        },
        root: canonical_folder,
    }))
}

/// Every valid package, deduplicated by id in trust order.
fn packages(app: &AppHandle) -> Result<Vec<Package>> {
    let mut found = BTreeMap::<String, Package>::new();
    for (root, source) in roots(app) {
        if found.len() >= MAX_PACKAGES {
            break;
        }
        if !root.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!("[redux.extensions] cannot read {}: {error}", root.display());
                continue;
            }
        };
        for item in entries.flatten() {
            let folder = item.path();
            let package = match read_package(&root, &folder, source) {
                Ok(Some(package)) => package,
                Ok(None) => continue,
                Err(error) => {
                    // A malformed package is its own failure; it must not hide
                    // the other packages in the same root.
                    eprintln!("[redux.extensions] skipped {}: {error}", folder.display());
                    continue;
                }
            };
            insert_package(&mut found, package);
            if found.len() >= MAX_PACKAGES {
                break;
            }
        }
    }
    Ok(found.into_values().collect())
}

/// Keep the highest-trust package for an id. User-writable roots may neither
/// claim `builtin.*` nor shadow a package already found in a shipped root.
fn insert_package(found: &mut BTreeMap<String, Package>, package: Package) {
    let id = package.public.id.clone();
    let user_writable = matches!(package.public.source.as_str(), "portable" | "installed");
    if user_writable && (reserved_builtin_id(&id) || found.contains_key(&id)) {
        eprintln!(
            "[redux.extensions] ignored {} package {id}",
            package.public.source
        );
        return;
    }
    found.entry(id).or_insert(package);
}

/// List every discovered package and its manifest.
///
/// The folder poll runs while the editor is open; scanning manifests and i18n
/// catalogs moves to the blocking pool so the IPC thread keeps answering.
#[tauri::command]
pub async fn list_extensions(app: AppHandle) -> Result<Vec<PackagedExtension>> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(packages(&app)?
            .into_iter()
            .map(|package| package.public)
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Refresh the native deadline while the main thread can still answer.
#[tauri::command]
pub fn extension_watchdog_heartbeat(state: State<ExtensionWatchdog>, active: bool) {
    if let Ok(mut watchdog) = state.state.lock() {
        watchdog.last = Instant::now();
        watchdog.active = active;
        if !active {
            watchdog.marked = false;
        }
    }
}

/// Whether this launch must skip Extension code, from the CLI flag or the watchdog.
#[tauri::command]
pub fn extension_safe_mode(app: AppHandle) -> bool {
    if std::env::args().any(|argument| argument == "--extensions-off") {
        return true;
    }
    let Some(marker) = watchdog_marker(&app) else {
        return false;
    };
    if marker.is_file() {
        let _ = fs::remove_file(marker);
        return true;
    }
    false
}

/// Start the host-side watchdog once, before the frontend evaluates packages.
pub fn start_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let mark = {
            let watchdog = app.state::<ExtensionWatchdog>();
            let Ok(mut state) = watchdog.state.lock() else {
                continue;
            };
            let stale = state.active && state.last.elapsed() > WATCHDOG_STALE_AFTER;
            if stale && !state.marked {
                state.marked = true;
                true
            } else {
                false
            }
        };
        if mark {
            if let Some(marker) = watchdog_marker(&app) {
                if let Some(parent) = marker.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(marker, b"extension watchdog timeout");
            }
        }
    });
}

/// Read one package's code entry after revalidating its path and size.
fn read_entry_bytes(app: &AppHandle, id: &str) -> Result<Vec<u8>> {
    let package = packages(app)?
        .into_iter()
        .find(|package| package.public.id == id)
        .ok_or_else(|| format!("Unknown Extension: {id}"))?;
    let entry = package
        .public
        .entry
        .as_deref()
        .ok_or_else(|| format!("Extension package has no code entry: {id}"))?;
    let path = package.root.join(entry);
    // Revalidate at read time so a changed package or symlink cannot redirect
    // this read outside the package.
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_ENTRY_BYTES
    {
        return Err(format!("Extension entry changed or is unsafe: {id}"));
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(&package.root) {
        return Err(format!("Extension entry escaped its package: {id}"));
    }
    fs::read(canonical).map_err(|error| error.to_string())
}

/// Read one package's code entry as raw IPC bytes.
///
/// An entry can be several megabytes; the read runs on the blocking pool and
/// crosses IPC as an ArrayBuffer instead of a JSON number array.
#[tauri::command]
pub async fn read_extension_entry(app: AppHandle, id: String) -> Result<Response> {
    tauri::async_runtime::spawn_blocking(move || read_entry_bytes(&app, &id).map(Response::new))
        .await
        .map_err(|error| error.to_string())?
}

/// One text file in a managed install request.
#[derive(Clone, Deserialize)]
pub struct ExtensionInstallFile {
    /// Package-relative path.
    pub path: String,
    pub contents: String,
}

/// Managed install root under the application data directory.
fn installed_extension_root(app: &AppHandle) -> Result<PathBuf> {
    Ok(crate::storage::data_dir(app)?.join("extensions"))
}

/// Whether an install file path stays inside its package folder.
fn valid_install_file(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 256
        && !path.contains('\\')
        && !path.contains('\0')
        && !path.starts_with('/')
        && !path.as_bytes().get(1).is_some_and(|byte| *byte == b':')
        && safe_relative(path)
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// The package-relative files a manifest may install.
///
/// Only the manifest, its declared entry, and its declared or conventional i18n
/// catalog are accepted. This keeps the managed root from becoming a generic
/// file-write primitive for a compromised host page.
fn install_allowlist(manifest: &Value, id: &str) -> Result<HashSet<String>> {
    if manifest.get("id").and_then(Value::as_str) != Some(id) {
        return Err(format!("Extension manifest id does not match {id}"));
    }
    let mut allowed = HashSet::from(["manifest.json".to_owned()]);
    if let Some(entry) = manifest.get("entry") {
        let entry = entry
            .as_str()
            .ok_or_else(|| "Extension entry must be a relative file".to_owned())?;
        if !valid_install_file(entry) {
            return Err(format!("Extension entry path is unsafe: {entry}"));
        }
        allowed.insert(entry.to_owned());
    }
    if let Some(i18n) = manifest.get("i18n") {
        let i18n = i18n
            .as_str()
            .ok_or_else(|| "Extension i18n must be a relative JSON file".to_owned())?;
        if !valid_install_file(i18n) {
            return Err(format!("Extension i18n path is unsafe: {i18n}"));
        }
        allowed.insert(i18n.to_owned());
    } else {
        allowed.insert("i18n.json".to_owned());
    }
    Ok(allowed)
}

/// Write a validated install request into a unique staging folder.
fn stage_package(root: &Path, id: &str, files: &[ExtensionInstallFile]) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(format!("Extension id is invalid: {id}"));
    }
    if id.starts_with("builtin.") {
        return Err("A managed install cannot claim a builtin.* id".to_owned());
    }
    if files.is_empty() || files.len() > MAX_INSTALL_FILES {
        return Err(format!(
            "Extension install must contain 1-{MAX_INSTALL_FILES} files"
        ));
    }
    let manifest_file = files
        .iter()
        .find(|file| file.path == "manifest.json")
        .ok_or_else(|| "Extension install is missing manifest.json".to_owned())?;
    let manifest: Value = serde_json::from_str(&manifest_file.contents)
        .map_err(|error| format!("Extension manifest is not valid JSON: {error}"))?;
    let allowed = install_allowlist(&manifest, id)?;
    for required in [
        manifest.get("entry").and_then(Value::as_str),
        manifest.get("i18n").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    {
        if !files.iter().any(|file| file.path == required) {
            return Err(format!(
                "Extension install is missing declared file: {required}"
            ));
        }
    }
    let mut seen = HashSet::new();
    let mut total = 0usize;
    for file in files {
        if !valid_install_file(&file.path) {
            return Err(format!("Extension install path is unsafe: {}", file.path));
        }
        if !allowed.contains(&file.path) {
            return Err(format!(
                "Extension install contains an undeclared file: {}",
                file.path
            ));
        }
        if !seen.insert(file.path.to_ascii_lowercase()) {
            return Err(format!("Extension install repeats a file: {}", file.path));
        }
        if file.contents.len() > MAX_INSTALL_FILE_BYTES {
            return Err(format!(
                "Extension install file is too large: {}",
                file.path
            ));
        }
        total = total
            .checked_add(file.contents.len())
            .ok_or_else(|| "Extension install size overflow".to_owned())?;
    }
    if total > MAX_INSTALL_TOTAL_BYTES {
        return Err("Extension install is too large".to_owned());
    }
    let staging = root.join(format!(".install-{id}-{}", uuid::Uuid::new_v4()));
    let write: std::io::Result<()> = (|| {
        fs::create_dir_all(&staging)?;
        for file in files {
            let target = staging.join(&file.path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&target, &file.contents)?;
        }
        Ok(())
    })();
    if let Err(error) = write {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Unable to write Extension staging folder: {error}"));
    }
    Ok(staging)
}

/// Install a validated package into the managed application-data root.
#[tauri::command]
pub fn install_extension(
    app: AppHandle,
    id: String,
    files: Vec<ExtensionInstallFile>,
    source: Option<String>,
) -> Result<String> {
    let _ = source;
    let root = installed_extension_root(&app)?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let staging = stage_package(&root, &id, &files)?;
    let target = root.join(&id);
    let metadata = fs::symlink_metadata(&target);
    if let Ok(metadata) = &metadata {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Extension target is not a regular folder: {id}"));
        }
    }
    let backup = metadata
        .is_ok()
        .then(|| root.join(format!(".backup-{id}-{}", uuid::Uuid::new_v4())));
    if let Some(backup) = &backup {
        if let Err(error) = fs::rename(&target, backup) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Unable to replace the existing Extension: {error}"));
        }
    }
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        if let Some(backup) = &backup {
            let _ = fs::rename(backup, &target);
        }
        return Err(format!("Unable to move the Extension into place: {error}"));
    }
    if let Some(backup) = backup {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Delete one managed package. Portable and shipped roots are never removed.
#[tauri::command]
pub fn remove_extension(app: AppHandle, id: String) -> Result<()> {
    if !valid_id(&id) {
        return Err(format!("Extension id is invalid: {id}"));
    }
    let target = installed_extension_root(&app)?.join(&id);
    let metadata = match fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("Extension target is not a regular folder: {id}"));
    }
    fs::remove_dir_all(target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn write_package(folder: &Path, manifest: &str, i18n: Option<(&str, &str)>) {
        fs::create_dir_all(folder).unwrap();
        fs::write(folder.join("manifest.json"), manifest).unwrap();
        if manifest.contains("\"entry\"") {
            fs::write(folder.join("index.js"), "export default {};").unwrap();
        }
        if let Some((path, value)) = i18n {
            let target = folder.join(path);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, value).unwrap();
        }
    }

    #[test]
    fn i18n_loader_probe_covers_declared_and_metadata_only_packages() {
        let temporary = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!(".extension-i18n-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temporary);
        fs::create_dir_all(&temporary).unwrap();
        let root = temporary.join("extensions");
        fs::create_dir(&root).unwrap();

        let custom = root.join("demo.custom");
        write_package(
            &custom,
            r#"{"id":"demo.custom","entry":"index.js","i18n":"locales/strings.json"}"#,
            Some((
                "locales/strings.json",
                r#"{"en":{"name":"Demo","description":"ok"}}"#,
            )),
        );
        let package = read_package(&root, &custom, "test").unwrap().unwrap();
        assert_eq!(package.public.i18n.unwrap()["en"]["name"], "Demo");

        let metadata_only = root.join("demo.metadata");
        write_package(&metadata_only, r#"{"id":"demo.metadata"}"#, None);
        let package = read_package(&root, &metadata_only, "test")
            .unwrap()
            .unwrap();
        assert!(package.public.entry.is_none());
        assert!(package.public.i18n.is_none());

        let data_only = root.join("demo.data");
        write_package(
            &data_only,
            r#"{"id":"demo.data"}"#,
            Some(("i18n.json", r#"{"en":{"name":"Data","description":"ok"}}"#)),
        );
        let package = read_package(&root, &data_only, "test").unwrap().unwrap();
        assert!(package.public.entry.is_none());
        assert_eq!(package.public.i18n.unwrap()["en"]["name"], "Data");

        assert!(!safe_package_file("C:/outside.json"));
        assert!(!safe_package_file("../outside.json"));
        assert!(!safe_package_file("local\\strings.json"));
        assert!(!safe_package_file("local/./strings.json"));
        assert!(!safe_package_file("CON.json"));
        assert!(!safe_package_file("local/line\nbreak.json"));
        assert!(safe_package_file("local/strings.json"));

        fs::remove_dir_all(temporary).unwrap();
    }

    fn test_package(id: &str, source: &str) -> Package {
        Package {
            public: PackagedExtension {
                id: id.to_owned(),
                manifest: serde_json::json!({ "id": id }),
                entry: None,
                source: source.to_owned(),
                i18n: None,
            },
            root: PathBuf::new(),
        }
    }

    #[test]
    fn portable_packages_cannot_shadow_shipped_ids_or_claim_builtins() {
        let mut found = BTreeMap::new();
        insert_package(&mut found, test_package("demo.package", "resource"));
        insert_package(&mut found, test_package("demo.package", "portable"));
        assert_eq!(found["demo.package"].public.source, "resource");

        insert_package(&mut found, test_package("builtin.spoof", "portable"));
        insert_package(&mut found, test_package("builtin.market", "installed"));
        assert!(!found.contains_key("builtin.spoof"));
        assert!(!found.contains_key("builtin.market"));
        assert!(reserved_builtin_id("builtin.anything"));
    }

    #[test]
    fn managed_install_writes_only_declared_package_files() {
        let temporary = tempfile::tempdir().unwrap();
        let manifest = serde_json::json!({
            "id": "demo.install",
            "entry": "index.js",
            "i18n": "locales/strings.json"
        })
        .to_string();
        let files = vec![
            ExtensionInstallFile {
                path: "manifest.json".to_owned(),
                contents: manifest,
            },
            ExtensionInstallFile {
                path: "index.js".to_owned(),
                contents: "export default {};".to_owned(),
            },
            ExtensionInstallFile {
                path: "locales/strings.json".to_owned(),
                contents: r#"{"en":{"name":"Demo","description":"ok"}}"#.to_owned(),
            },
        ];
        let staging = stage_package(temporary.path(), "demo.install", &files).unwrap();
        assert!(staging.join("manifest.json").is_file());
        assert!(staging.join("index.js").is_file());
        assert!(staging.join("locales/strings.json").is_file());
        fs::remove_dir_all(staging).unwrap();

        let mut traversal = files.clone();
        traversal.push(ExtensionInstallFile {
            path: "../outside.js".to_owned(),
            contents: "x".to_owned(),
        });
        assert!(stage_package(temporary.path(), "demo.install", &traversal).is_err());

        let mut undeclared = files.clone();
        undeclared.push(ExtensionInstallFile {
            path: "extra.js".to_owned(),
            contents: "x".to_owned(),
        });
        assert!(stage_package(temporary.path(), "demo.install", &undeclared).is_err());

        let mut spoof = files.clone();
        spoof[0].contents = serde_json::json!({
            "id": "builtin.spoof",
            "entry": "index.js"
        })
        .to_string();
        assert!(stage_package(temporary.path(), "builtin.spoof", &spoof).is_err());
        assert!(!valid_install_file("C:/outside.js"));
        assert!(!valid_install_file("a\\b.js"));
        assert!(!valid_install_file("CON.json"));
        assert!(!valid_install_file("locales/line\nbreak.json"));
        assert!(!safe_relative("CON.js"));
        assert!(safe_relative("locales/strings.json"));
        assert!(valid_install_file("locales/strings.json"));
    }
}
