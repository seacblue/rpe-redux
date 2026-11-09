//! Diagnostic bundle export.
//!
//! The frontend supplies the redacted snapshot, environment facts, extension
//! inventory, and chart summary. This host command adds a bounded tail of the
//! recent log files and writes one atomic zip at the destination the save
//! dialog returned.

use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    time::SystemTime,
};
use tauri::{ipc::Request, AppHandle, State};
use zip::{write::SimpleFileOptions, ZipWriter};

type Result<T> = std::result::Result<T, String>;

/// Manifest `format` value that identifies a diagnostic bundle.
const BUNDLE_FORMAT: &str = "rpe-redux-diagnostics";
/// Current bundle layout version.
const BUNDLE_VERSION: u32 = 1;
/// Largest report the frontend may send in one command.
const MAX_REPORT_BYTES: usize = 8 << 20;
/// Largest tail retained from one log file.
const MAX_LOG_FILE_BYTES: u64 = 512 << 10;
/// Largest total log payload retained across files.
const MAX_LOG_TOTAL_BYTES: u64 = 4 << 20;
/// Newest log files considered for the bundle.
const MAX_LOG_FILES: usize = 8;

/// Validate and canonicalize the zip destination selected by the save dialog.
fn bundle_target(path: &str) -> Result<PathBuf> {
    let raw = PathBuf::from(path);
    if !raw.is_absolute()
        || raw
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("diagnostic_bundle_invalid_destination".to_owned());
    }
    let name = raw
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "diagnostic_bundle_invalid_destination".to_owned())?;
    let normalized = crate::storage::path_safety::single_segment(name)
        .ok_or_else(|| "diagnostic_bundle_invalid_destination".to_owned())?;
    if normalized != name
        || raw
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("zip"))
            != Some(true)
    {
        return Err("diagnostic_bundle_invalid_destination".to_owned());
    }
    let parent = raw
        .parent()
        .filter(|value| value.is_dir())
        .ok_or_else(|| "diagnostic_bundle_invalid_destination".to_owned())?;
    let parent =
        fs::canonicalize(parent).map_err(|_| "diagnostic_bundle_invalid_destination".to_owned())?;
    Ok(parent.join(name))
}

/// Options shared by every archive entry.
fn file_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

/// Write one pretty JSON value into the archive.
fn write_json<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    value: &Value,
    options: SimpleFileOptions,
) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(&bytes).map_err(|error| error.to_string())
}

/// Append the newest log tails to the archive; missing logs are not an error.
fn add_logs<W: Write + Seek>(
    app: &AppHandle,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<Vec<String>> {
    let mut added = Vec::new();
    let Ok(data_root) = crate::storage::data_dir(app) else {
        return Ok(added);
    };
    let logs = data_root.join("logs");
    let Ok(entries) = fs::read_dir(&logs) else {
        return Ok(added);
    };
    let mut files: Vec<(PathBuf, String, SystemTime, u64)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        if !name.to_ascii_lowercase().ends_with(".log") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        files.push((
            path,
            name,
            metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            metadata.len(),
        ));
    }
    files.sort_by(|left, right| right.2.cmp(&left.2));
    let mut total = 0_u64;
    for (path, name, _, size) in files.into_iter().take(MAX_LOG_FILES) {
        if total >= MAX_LOG_TOTAL_BYTES {
            break;
        }
        let take = size
            .min(MAX_LOG_FILE_BYTES)
            .min(MAX_LOG_TOTAL_BYTES - total);
        if take == 0 {
            continue;
        }
        let Ok(mut file) = File::open(&path) else {
            continue;
        };
        let truncated = size > take;
        if truncated && file.seek(SeekFrom::Start(size - take)).is_err() {
            continue;
        }
        let mut bytes = Vec::with_capacity(take as usize + 24);
        if truncated {
            bytes.extend_from_slice(b"[...truncated...]\n");
        }
        let mut reader = file.take(take);
        if reader.read_to_end(&mut bytes).is_err() {
            continue;
        }
        zip.start_file(format!("logs/{name}"), options)
            .map_err(|error| error.to_string())?;
        zip.write_all(&bytes).map_err(|error| error.to_string())?;
        total += take;
        added.push(name);
    }
    Ok(added)
}

/// Write one diagnostic zip and return the written path.
///
/// The destination must be an absolute path to a `.zip` directly inside an
/// existing directory. The report object carries `environment`, `diagnostics`,
/// `extensions`, and `chart`; missing keys are written as `null`.
#[tauri::command]
pub fn export_diagnostic_bundle(
    app: AppHandle,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    report: Value,
) -> Result<String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let target = bundle_target(&path)?;
    let object = report
        .as_object()
        .ok_or_else(|| "Diagnostic report must be an object".to_owned())?;
    let report_bytes = serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?;
    if report_bytes.len() > MAX_REPORT_BYTES {
        return Err("Diagnostic report is too large".to_owned());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "diagnostic_bundle_invalid_destination".to_owned())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    let options = file_options();
    let entries = [
        ("environment", "environment.json"),
        ("diagnostics", "diagnostics.json"),
        ("extensions", "extensions.json"),
        ("chart", "chart.json"),
    ];
    let logs;
    {
        let mut zip = ZipWriter::new(temporary.as_file_mut());
        for (key, name) in &entries {
            let value = object.get(*key).cloned().unwrap_or(Value::Null);
            write_json(&mut zip, name, &value, options)?;
        }
        logs = add_logs(&app, &mut zip, options)?;
        let manifest = serde_json::json!({
            "format": BUNDLE_FORMAT,
            "version": BUNDLE_VERSION,
            "generatedAt": crate::storage::now_ms(),
            "entries": entries.map(|(_, name)| name),
            "logs": logs,
            "redaction": "diagnostics.json is the frontend's redacted snapshot; environment, extensions, and chart describe the current runtime only."
        });
        write_json(&mut zip, "manifest.json", &manifest, options)?;
        zip.finish().map_err(|error| error.to_string())?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(&target)
        .map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}
