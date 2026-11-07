//! External chart-folder scan for the official/PEC importer.
//!
//! The webview cannot enumerate a chart folder. This command reads one selected
//! file or folder, returns the chart text, metadata sidecars and media paths, and
//! leaves conversion and library writing to TypeScript. It accepts only chart
//! text and media; archives are read as bytes by the frontend so the existing
//! ZIP reader owns their limits.

use serde::Serialize;
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

/// One metadata sidecar found beside a chart.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSidecar {
    pub name: String,
    pub text: String,
}

/// One audio or image file found beside a chart.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalMedia {
    /// Path relative to the chart folder, using `/` separators.
    pub name: String,
    /// Absolute path the frontend can read through `read_picked_file`.
    pub path: String,
    pub size: u64,
}

/// A chart file, its metadata sidecars and its media candidates.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChartScan {
    pub root: String,
    pub chart_path: String,
    pub chart_name: String,
    pub chart_text: String,
    pub sidecars: Vec<ExternalSidecar>,
    pub media: Vec<ExternalMedia>,
    pub warnings: Vec<String>,
}

const MAX_CHART_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SIDECAR_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MEDIA_FILES: usize = 2048;
const MAX_MEDIA_DEPTH: usize = 4;

/// Read a bounded UTF-8 text file; unreadable or oversized files return None.
fn read_text(path: &Path, limit: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > limit {
        return None;
    }
    let text = String::from_utf8_lossy(&bytes);
    Some(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

/// Audio extensions the importer may attach as chart assets.
fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "mp3" | "ogg" | "wav" | "flac" | "m4a" | "aac" | "opus" | "webm"
            )
        })
}

/// Image extensions the importer may attach as chart assets.
fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif"
            )
        })
}

/// Chart text extensions. A Re:PhiEdit PEC export can use `.json`.
fn is_chart_text(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "json" | "pec" | "txt"))
}

/// Sidecar extensions, in the order metadata should be merged by the frontend.
fn is_sidecar(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "info.yml" | "info.yaml" | "info.txt" | "info.csv"
    )
}

/// Service files that are never a chart candidate.
fn is_service_chart_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let lower = name.to_ascii_lowercase();
    lower.starts_with("autosave_")
        || lower.starts_with("chartlist")
        || lower.starts_with("info.")
        || lower.starts_with("readme")
        || lower.starts_with("license")
        || lower.starts_with("changelog")
        || lower.starts_with("credits")
        || lower == "extra.json"
        || lower == "settings.json"
        || lower == "config.json"
        || lower == "expression.json"
        || lower == "custom_background.json"
        || matches!(
            lower.as_str(),
            "en.txt"
                | "zh.txt"
                | "division_color.txt"
                | "group_display.txt"
                | "lastsong.txt"
                | "replace.txt"
                | "bezier.txt"
                | "gather_points.txt"
        )
}

/// Read every metadata sidecar directly under the chart root.
fn read_sidecars(root: &Path) -> Vec<ExternalSidecar> {
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return result;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_sidecar(&path) {
            continue;
        }
        let Some(text) = read_text(&path, MAX_SIDECAR_BYTES) else {
            continue;
        };
        result.push(ExternalSidecar {
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default(),
            text,
        });
    }
    result.sort_by(|left, right| left.name.cmp(&right.name));
    result
}

/// Read the `Chart`/`chart` reference from a sidecar.
fn sidecar_chart_reference(sidecar: &ExternalSidecar) -> Option<String> {
    let lower = sidecar.name.to_ascii_lowercase();
    if lower.ends_with(".csv") {
        let mut lines = sidecar.text.lines().filter(|line| !line.trim().is_empty());
        let header = lines.next()?;
        let row = lines.next()?;
        let headers: Vec<&str> = header.split(',').map(str::trim).collect();
        let values: Vec<&str> = row.split(',').map(str::trim).collect();
        let index = headers
            .iter()
            .position(|value| value.eq_ignore_ascii_case("chart"))?;
        return values
            .get(index)
            .filter(|value| !value.is_empty())
            .map(|value| value.trim_matches('"').trim_matches('\'').to_string());
    }
    for line in sidecar.text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("chart") {
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

/// Convert a path into a display name relative to the chart root.
fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Collect media files recursively with a depth and count bound.
fn collect_media(
    root: &Path,
    directory: &Path,
    depth: usize,
    result: &mut Vec<ExternalMedia>,
    warnings: &mut Vec<String>,
) {
    if depth > MAX_MEDIA_DEPTH || result.len() >= MAX_MEDIA_FILES {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name.starts_with('.') {
                continue;
            }
            collect_media(root, &path, depth + 1, result, warnings);
            if result.len() >= MAX_MEDIA_FILES {
                warnings.push(
                    "The chart folder contains more than 2048 media files; the rest were ignored."
                        .into(),
                );
                return;
            }
            continue;
        }
        if !(is_audio(&path) || is_image(&path)) {
            continue;
        }
        let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        result.push(ExternalMedia {
            name: relative_name(root, &path),
            path: path.to_string_lossy().into_owned(),
            size,
        });
        if result.len() >= MAX_MEDIA_FILES {
            return;
        }
    }
}

/// A relative chart path that cannot escape the selected chart folder.
fn safe_relative(value: &str) -> Option<PathBuf> {
    crate::storage::path_safety::relative_path(value).map(PathBuf::from)
}

/// Find the chart candidate when the selected path is a folder.
fn find_chart(root: &Path, sidecars: &[ExternalSidecar]) -> Result<PathBuf, String> {
    for sidecar in sidecars {
        if let Some(reference) = sidecar_chart_reference(sidecar) {
            if let Some(relative) = safe_relative(&reference.replace('\\', "/")) {
                let candidate = root.join(relative);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    let mut candidates = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return Err("The chart folder could not be read.".into());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_chart_text(&path) || is_service_chart_name(&path) {
            continue;
        }
        candidates.push(path);
    }
    candidates.sort();
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err("No JSON or PEC chart file was found in this folder.".into()),
        _ => Err(format!(
            "The folder contains several chart files. Drop the one you want: {}",
            candidates
                .iter()
                .map(|path| relative_name(root, path))
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

/// Scan a selected chart file or folder.
///
/// A file path selects that exact chart. A folder path uses a sidecar reference
/// first, then a single unambiguous chart file. Archives are rejected here and
/// read as bytes by the frontend.
#[tauri::command]
pub fn scan_external_chart(
    token: tauri::State<'_, crate::app::ipc_guard::HostToken>,
    request: tauri::ipc::Request<'_>,
    path: String,
) -> Result<ExternalChartScan, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    scan_external_chart_unchecked(&path)
}

/// Scan without an IPC token; visible to module tests and the command wrapper.
fn scan_external_chart_unchecked(path: &str) -> Result<ExternalChartScan, String> {
    let selected = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let (root, chart_path) = if selected.is_file() {
        let extension = selected
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if matches!(extension.as_deref(), Some("zip" | "pez")) {
            return Err("Archives are read by the frontend, not this folder scanner.".into());
        }
        if !is_chart_text(&selected) {
            return Err("The selected file is not a JSON or PEC chart.".into());
        }
        let root = selected
            .parent()
            .ok_or("The selected chart has no parent folder.")?
            .to_path_buf();
        (root, selected)
    } else {
        let sidecars = read_sidecars(&selected);
        let chart = find_chart(&selected, &sidecars)?;
        (selected, chart)
    };

    let mut warnings = Vec::new();
    let chart_text = read_text(&chart_path, MAX_CHART_BYTES)
        .ok_or("The chart file could not be read or is larger than 64 MB.")?;
    let sidecars = read_sidecars(&root);
    let mut media = Vec::new();
    collect_media(&root, &root, 0, &mut media, &mut warnings);
    media.sort_by(|left, right| left.name.cmp(&right.name));
    if media.iter().any(|entry| entry.size > 256 * 1024 * 1024) {
        warnings.push("A media file is larger than 256 MB and may fail to import.".into());
    }
    Ok(ExternalChartScan {
        root: root.to_string_lossy().into_owned(),
        chart_path: chart_path.to_string_lossy().into_owned(),
        chart_name: relative_name(&root, &chart_path),
        chart_text,
        sidecars,
        media,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_a_chart_folder_and_its_sidecars() {
        let root = tempfile::tempdir().expect("temp dir");
        fs::write(root.path().join("Chart_IN.json"), "{\"formatVersion\":3}").expect("chart");
        fs::write(
            root.path().join("info.csv"),
            ",Chart,Music,Image,Name,Artist,Level,Illustrator,Charter\n,Chart_IN.json,music.ogg,cover.png,Song,Artist,IN 15,Illustrator,Charter\n",
        )
        .expect("info");
        fs::write(root.path().join("music.ogg"), b"ogg").expect("music");
        fs::write(root.path().join("cover.png"), b"png").expect("cover");

        let scan = scan_external_chart_unchecked(&root.path().to_string_lossy()).expect("scan");
        assert_eq!(scan.chart_name, "Chart_IN.json");
        assert_eq!(scan.sidecars.len(), 1);
        assert_eq!(scan.media.len(), 2);
        assert_eq!(scan.chart_text, "{\"formatVersion\":3}");
    }

    #[test]
    fn rejects_an_ambiguous_folder() {
        let root = tempfile::tempdir().expect("temp dir");
        fs::write(root.path().join("Chart_IN.json"), "{}").expect("chart");
        fs::write(root.path().join("Chart_HD.json"), "{}").expect("chart");
        let error = scan_external_chart_unchecked(&root.path().to_string_lossy()).unwrap_err();
        assert!(error.contains("several chart files"));
    }
}
