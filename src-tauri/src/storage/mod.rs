//! Writable application data and user-file access: resolves the deployment
//! root (beside the executable for Windows and portable builds, under the XDG
//! data directory for packaged Linux builds) and validates custom-background
//! paths before any read or write.
//!
//! `backup` owns application backup import/export and the pre-update snapshot;
//! `path_safety` owns the shared policy for every user-supplied path.

pub(crate) mod backup;
pub(crate) mod path_safety;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_opener::OpenerExt;

/// Subdirectory of the data root that holds saved background images.
const CUSTOM_BACKGROUND_DIR: &str = "backgrounds";
/// Marker that makes a folder beside the executable the deployment root.
const PORTABLE_MARKER: &str = "portable.marker";
/// Identifier Tauri uses for per-user state on packaged Linux builds.
#[cfg(not(windows))]
const APP_IDENTIFIER: &str = "io.rperedux.editor";
/// Largest accepted custom background, in bytes.
const MAX_CUSTOM_BACKGROUND_BYTES: usize = 32 << 20;
/// Largest accepted frontend diagnostic report, in bytes.
const MAX_DIAGNOSTIC_LOG_BYTES: usize = 2 << 20;

/// Resolve `backgrounds/<file>` inside the data root, rejecting every other
/// shape or traversal attempt.
fn custom_background_path(app: &AppHandle, reference: &str) -> Result<PathBuf, String> {
    let relative = crate::storage::path_safety::relative_path(reference)
        .ok_or_else(|| "Invalid custom background reference".to_owned())?;
    let mut parts = relative.split('/');
    let folder = parts.next();
    let file = parts
        .next()
        .and_then(crate::storage::path_safety::single_segment);
    if folder != Some(CUSTOM_BACKGROUND_DIR) || file.is_none() || parts.next().is_some() {
        return Err("Invalid custom background reference".to_owned());
    }
    Ok(data_dir(app)?.join(relative))
}

/// Writable deployment root.
///
/// A portable folder keeps everything beside its executable. Windows installers
/// publish into a writable install directory, so they use the same layout. A
/// packaged Linux build installs the executable under `/usr`, where the user
/// cannot write, so it uses the XDG data directory instead.
pub fn user_root() -> Result<PathBuf, String> {
    let executable = executable_directory()?;
    if executable.join(PORTABLE_MARKER).is_file() {
        return Ok(executable);
    }
    packaged_root()
}

/// Whether this executable runs from a portable folder.
pub fn portable() -> bool {
    executable_directory()
        .map(|directory| directory.join(PORTABLE_MARKER).is_file())
        .unwrap_or(false)
}

/// Installer root for hosts whose install directory is writable.
#[cfg(windows)]
fn packaged_root() -> Result<PathBuf, String> {
    executable_directory()
}

/// Per-user root for packaged Linux builds.
#[cfg(not(windows))]
fn packaged_root() -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(root).join(APP_IDENTIFIER));
    }
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Could not resolve the user data directory: HOME is not set.".to_owned())?;
    Ok(PathBuf::from(home)
        .join(".local")
        .join("share")
        .join(APP_IDENTIFIER))
}

/// Durable application data below the deployment root. REDUX_PROFILE_DIR is
/// reserved for isolated automated desktop runs.
pub fn data_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    let dir = if let Some(profile) = std::env::var_os("REDUX_PROFILE_DIR") {
        PathBuf::from(profile)
    } else {
        user_root()?.join("user-data")
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Read one JSON file, returning `None` for missing or malformed content.
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Write pretty JSON, creating the parent directory when needed.
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

/// Milliseconds since the Unix epoch; zero on a clock before 1970.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// Open the durable application-data directory in the host file explorer.
#[tauri::command]
pub fn open_app_data_folder(app: AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?;
    open_directory(&app, path)
}

/// Return the durable application-data directory for the developer summary.
#[tauri::command]
pub fn app_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().into_owned())
}

/// Open a directory in the host file manager.
fn open_directory(app: &AppHandle, path: PathBuf) -> Result<(), String> {
    // Explorer opens a known directory directly; other hosts use the platform
    // opener.
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|error| error.to_string())
    }
}

/// Append a frontend diagnostic report to the durable log directory and return
/// the path so the UI can tell the user exactly what to upload.
#[tauri::command]
pub fn write_diagnostic_log(app: AppHandle, report: String) -> Result<String, String> {
    if report.len() > MAX_DIAGNOSTIC_LOG_BYTES {
        return Err("Diagnostic report is too large".to_owned());
    }
    let logs = data_dir(&app)?.join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let path = logs.join("frontend.log");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "\n{report}\n").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Open the folder containing frontend and native diagnostic logs.
#[tauri::command]
pub fn open_diagnostic_logs(app: AppHandle) -> Result<(), String> {
    let logs = data_dir(&app)?.join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    open_directory(&app, logs)
}

/// Copy a settings background into app data and return its portable reference.
#[tauri::command]
pub fn save_custom_background(
    app: AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > MAX_CUSTOM_BACKGROUND_BYTES {
        return Err("Custom background is empty or too large".to_owned());
    }
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| {
            matches!(
                value.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif"
            )
        })
        .ok_or_else(|| "Unsupported custom background format".to_owned())?;
    let directory = data_dir(&app)?.join(CUSTOM_BACKGROUND_DIR);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let reference = format!(
        "{CUSTOM_BACKGROUND_DIR}/{}.{}",
        uuid::Uuid::new_v4(),
        extension
    );
    let path = custom_background_path(&app, &reference)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(reference)
}

/// Read a settings background by its validated app-data reference.
#[tauri::command]
pub fn read_custom_background(app: AppHandle, reference: String) -> Result<Vec<u8>, String> {
    let path = custom_background_path(&app, &reference)?;
    std::fs::read(path).map_err(|e| e.to_string())
}

/// Remove one settings background after its preference stops referring to it.
#[tauri::command]
pub fn delete_custom_background(app: AppHandle, reference: String) -> Result<(), String> {
    let path = custom_background_path(&app, &reference)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Remove saved backgrounds that are no longer referenced by the settings value.
#[tauri::command]
pub fn cleanup_custom_backgrounds(app: AppHandle, active_reference: String) -> Result<(), String> {
    let active_path = if active_reference.trim().is_empty() {
        None
    } else {
        Some(custom_background_path(&app, &active_reference)?)
    };
    let directory = data_dir(&app)?.join(CUSTOM_BACKGROUND_DIR);
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        if active_path.as_ref().is_some_and(|active| active == &path) {
            continue;
        }
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Keep the browser profile separate from durable application data.
/// Isolated smoke runs intentionally use one shared root for both.
pub fn webview_data_dir() -> Result<PathBuf, String> {
    if let Some(profile) = std::env::var_os("REDUX_PROFILE_DIR") {
        return Ok(PathBuf::from(profile));
    }
    Ok(user_root()?.join("webview-data"))
}

/// Restore the executable bit when a bundle copy lost its permissions.
#[cfg(unix)]
pub fn ensure_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path)?;
    let mode = metadata.permissions().mode();
    if mode & 0o111 == 0 {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode | 0o555))?;
    }
    Ok(())
}

/// Windows has no executable bit.
#[cfg(not(unix))]
pub fn ensure_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Directory that contains the running executable; portable data and resources
/// are resolved relative to it.
pub fn executable_directory() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Executable has no parent directory".to_owned())
}
