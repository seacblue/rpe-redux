//! Diagnostic bundle export.
//!
//! The frontend supplies the redacted snapshot, environment facts, extension
//! inventory, chart summary, renderer counters, and an optional frame. This
//! host command adds a bounded tail of the recent log files and writes one
//! atomic zip at the destination the save dialog returned.

use regex::Regex;
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
const BUNDLE_VERSION: u32 = 2;
/// Largest report the frontend may send in one command.
const MAX_REPORT_BYTES: usize = 8 << 20;
/// Largest tail retained from one log file.
const MAX_LOG_FILE_BYTES: u64 = 512 << 10;
/// Largest total log payload retained across files.
const MAX_LOG_TOTAL_BYTES: u64 = 4 << 20;
/// Newest log files considered for the bundle.
const MAX_LOG_FILES: usize = 8;

/// Stable JSON files included in every diagnostic bundle.
const REPORT_ENTRIES: [(&str, &str); 8] = [
    ("environment", "environment.json"),
    ("diagnostics", "diagnostics.json"),
    ("extensions", "extensions.json"),
    ("chart", "chart.json"),
    ("renderer", "renderer.json"),
    ("frame", "frame.json"),
    ("actions", "actions.json"),
    ("issues", "issues.json"),
];

/// Maximum number of structured warning/error lines copied from native logs.
const MAX_LOG_ISSUES: usize = 256;

/// Log files and the structured issues extracted from them.
struct LogCollection {
    entries: Vec<Value>,
    issues: Vec<Value>,
}

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

/// Keep structured frame counters while dropping any legacy image payload.
fn frame_report(value: &Value) -> Value {
    let mut report = value.clone();
    if let Some(object) = report.as_object_mut() {
        object.remove("image");
    }
    report
}

/// Remove paths, emails, and common secret assignments from one log payload.
fn sanitize_log(bytes: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(bytes);
    let secret = Regex::new(
        r"(?i)\b(?:token|secret|password|authorization|cookie|api[_-]?key)\b\s*[:=]\s*[^\s,;]+",
    )
    .expect("diagnostic secret regex");
    let path = Regex::new(r#"(?i)(?:[a-z]:[\\/]|\\\\|file:|https?://)[^\s"'<>]+"#)
        .expect("diagnostic path regex");
    let email = Regex::new(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b")
        .expect("diagnostic email regex");
    let text = secret.replace_all(&text, "[REDACTED_SECRET]");
    let text = path.replace_all(&text, "[REDACTED_PATH]");
    let text = email.replace_all(&text, "[REDACTED_EMAIL]");
    text.into_owned().into_bytes()
}

/// Extract warning/error lines after redaction, without retaining normal logs.
fn extract_log_issues(name: &str, bytes: &[u8], issues: &mut Vec<Value>) {
    if issues.len() >= MAX_LOG_ISSUES {
        return;
    }
    let source = if name.eq_ignore_ascii_case("backend.log") {
        "backend"
    } else if name.to_ascii_lowercase().contains("frontend") {
        "frontend"
    } else {
        "host"
    };
    for line in String::from_utf8_lossy(bytes).lines() {
        let upper = line.to_ascii_uppercase();
        let severity =
            if upper.contains("ERROR") || upper.contains("FATAL") || upper.contains("PANIC") {
                "error"
            } else if upper.contains("WARN") {
                "warning"
            } else {
                continue;
            };
        issues.push(serde_json::json!({
            "source": source,
            "severity": severity,
            "message": line.chars().take(256).collect::<String>(),
            "log": name,
        }));
        if issues.len() >= MAX_LOG_ISSUES {
            return;
        }
    }
}

/// Append the newest log tails to the archive; missing logs are not an error.
fn add_logs<W: Write + Seek>(
    app: &AppHandle,
    zip: &mut ZipWriter<W>,
    options: SimpleFileOptions,
) -> Result<LogCollection> {
    let mut collection = LogCollection {
        entries: Vec::new(),
        issues: Vec::new(),
    };
    let Ok(data_root) = crate::storage::data_dir(app) else {
        return Ok(collection);
    };
    let logs = data_root.join("logs");
    let Ok(entries) = fs::read_dir(&logs) else {
        return Ok(collection);
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
        let sanitized = sanitize_log(&bytes);
        extract_log_issues(&name, &sanitized, &mut collection.issues);
        zip.start_file(format!("logs/{name}"), options)
            .map_err(|error| error.to_string())?;
        zip.write_all(&sanitized)
            .map_err(|error| error.to_string())?;
        total += take;
        collection.entries.push(serde_json::json!({
            "name": name,
            "originalBytes": size,
            "includedBytes": sanitized.len(),
            "truncated": truncated,
            "redacted": true,
        }));
    }
    Ok(collection)
}

/// Write one diagnostic zip and return the written path.
///
/// The destination must be an absolute path to a `.zip` directly inside an
/// existing directory. The report object carries environment, runtime,
/// extension, chart, renderer, frame, action, and frontend-issue objects;
/// missing keys are written as `null`. Frame pixels and typed field contents
/// are never written.
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
    let log_collection;
    let entries: Vec<String> = REPORT_ENTRIES
        .iter()
        .map(|(_, name)| (*name).to_owned())
        .collect();
    {
        let mut zip = ZipWriter::new(temporary.as_file_mut());
        log_collection = add_logs(&app, &mut zip, options)?;
        for (key, name) in &REPORT_ENTRIES {
            let value = object.get(*key).cloned().unwrap_or(Value::Null);
            let value = match *key {
                "frame" => frame_report(&value),
                "issues" => {
                    let mut issues = value.as_object().cloned().unwrap_or_default();
                    let frontend = log_collection
                        .issues
                        .iter()
                        .filter(|issue| issue["source"] == "frontend")
                        .cloned()
                        .collect::<Vec<_>>();
                    let backend = log_collection
                        .issues
                        .iter()
                        .filter(|issue| issue["source"] == "backend")
                        .cloned()
                        .collect::<Vec<_>>();
                    let host = log_collection
                        .issues
                        .iter()
                        .filter(|issue| issue["source"] == "host")
                        .cloned()
                        .collect::<Vec<_>>();
                    if let Some(existing) = issues.get_mut("frontend") {
                        if let Some(existing) = existing.as_array_mut() {
                            existing.extend(frontend);
                        }
                    } else {
                        issues.insert("frontend".to_owned(), Value::Array(frontend));
                    }
                    issues.insert("backend".to_owned(), Value::Array(backend));
                    issues.insert("host".to_owned(), Value::Array(host));
                    Value::Object(issues)
                }
                _ => value,
            };
            write_json(&mut zip, name, &value, options)?;
        }
        let manifest = serde_json::json!({
            "format": BUNDLE_FORMAT,
            "version": BUNDLE_VERSION,
            "generatedAt": crate::storage::now_ms(),
            "entries": entries,
            "logs": log_collection.entries,
            "structuredIssues": true,
            "frame": {
                "structured": object.get("frame").is_some(),
                "pixels": false,
            },
            "actions": {
                "structured": object.get("actions").is_some(),
                "inputs": false,
                "capacity": 512,
            },
            "issues": {
                "structured": true,
                "capacity": 256,
            },
            "redaction": {
                "policy": "structured diagnostics, input-free actions, chart metadata presence only, redacted logs",
                "rawPaths": false,
                "rawChartMetadata": false,
                "rawLogPayloads": false,
                "inputContents": false,
            }
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

#[cfg(test)]
mod tests {
    use super::{extract_log_issues, frame_report, sanitize_log, write_json, REPORT_ENTRIES};
    use serde_json::json;
    use std::io::{Cursor, Read};
    use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

    #[test]
    fn logs_redact_paths_secrets_and_emails() {
        let source = b"path=C:\\Users\\Alice\\chart.json token=SECRET alice@example.com";
        let result = String::from_utf8(sanitize_log(source)).unwrap();
        assert!(!result.contains("Alice"));
        assert!(!result.contains("SECRET"));
        assert!(!result.contains("alice@example.com"));
        assert!(result.contains("[REDACTED_PATH]"));
        assert!(result.contains("[REDACTED_SECRET]"));
        assert!(result.contains("[REDACTED_EMAIL]"));
    }

    #[test]
    fn bundle_layout_contains_renderer_report_and_no_frame_pixels() {
        let mut output = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut output);
            for (key, name) in REPORT_ENTRIES {
                let value = if key == "frame" {
                    frame_report(&json!({
                        "preview": {},
                        "image": { "dataUrl": "data:image/png;base64,SECRET" }
                    }))
                } else {
                    json!({ "ok": true })
                };
                write_json(&mut zip, name, &value, SimpleFileOptions::default()).unwrap();
            }
            zip.finish().unwrap();
        }
        let mut archive = ZipArchive::new(Cursor::new(output.into_inner())).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_owned())
            .collect();
        assert!(names.contains(&"renderer.json".to_owned()));
        assert!(names.contains(&"frame.json".to_owned()));
        assert!(!names.iter().any(|name| name.starts_with("frame/")));
        let mut renderer = archive.by_name("renderer.json").unwrap();
        let mut contents = String::new();
        renderer.read_to_string(&mut contents).unwrap();
        assert!(contents.contains("ok"));
        let mut frame = archive.by_name("frame.json").unwrap();
        let mut frame_contents = String::new();
        frame.read_to_string(&mut frame_contents).unwrap();
        assert!(!frame_contents.contains("dataUrl"));
        assert!(!frame_contents.contains("image"));
    }

    #[test]
    fn log_issue_extraction_keeps_only_redacted_warning_and_error_lines() {
        let mut issues = Vec::new();
        extract_log_issues(
            "backend.log",
            b"info ok\nWARNING: path=C:\\Users\\Alice\\chart.json\nERROR: token=SECRET\n",
            &mut issues,
        );
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0]["source"], "backend");
        assert_eq!(issues[0]["severity"], "warning");
        assert!(!issues[0]["message"].as_str().unwrap().contains("Alice"));
        assert!(!issues[1]["message"].as_str().unwrap().contains("SECRET"));
    }
}
