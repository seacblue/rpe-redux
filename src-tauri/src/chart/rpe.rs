//! Native RPE folder scan for the welcome-screen migration.
//!
//! The webview cannot enumerate arbitrary local folders. This module reads a
//! user-selected RPE installation once: its Settings.json, Hotkey.txt, and the
//! numeric chart folders under Resources (or Charts). It never opens or imports
//! chart bytes; the existing document store and library importer own that work.

use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

/// One chart folder under an RPE Resources directory.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpeChartFolder {
    /// Full path to the chart JSON.
    pub path: String,
    /// Folder name under Resources.
    pub folder: String,
    /// Display name from Info.txt, or the chart file stem.
    pub name: String,
    /// Group from Info.txt, or `RPE` when the source did not name one.
    pub group: String,
    pub song: Option<String>,
    pub picture: Option<String>,
    /// Chart file name for display; `path` is the path the importer opens.
    pub chart: Option<String>,
    /// Composer written by RPE Info.txt.
    pub composer: Option<String>,
    /// Charter written by RPE Info.txt.
    pub charter: Option<String>,
    pub last_edit: Option<String>,
    pub autosaves: usize,
}

/// The two sidecars and every chart folder found under one RPE root.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpeFolderScan {
    pub root: String,
    /// True when the root carries PhiEdit.exe and a Resources folder.
    pub installation: bool,
    pub settings_text: Option<String>,
    pub hotkeys_text: Option<String>,
    pub ui_text: Option<String>,
    /// RPE's dedicated beat-line palette (`division_color.txt`).
    pub division_color_text: Option<String>,
    pub charts: Vec<RpeChartFolder>,
    pub warnings: Vec<String>,
}

/// Read a small UTF-8 sidecar, rejecting oversized or unreadable files.
fn read_text(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    let text = String::from_utf8_lossy(&bytes);
    Some(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

/// Find a child whose name matches case-insensitively.
fn find_child(directory: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(directory)
        .ok()?
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        })
        .map(|entry| entry.path())
}

/// Parse colon-separated Info.txt fields into lower-case keys.
fn info_fields(text: &str) -> std::collections::HashMap<String, String> {
    text.replace('\u{feff}', "")
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect()
}

/// A relative chart path that cannot escape the selected chart folder.
fn safe_relative(value: &str) -> Option<PathBuf> {
    crate::storage::path_safety::relative_path(value).map(PathBuf::from)
}

/// Resolve the chart JSON a folder's Info.txt names, or the folder's own stem.
fn chart_in_folder(
    folder: &Path,
    info: &std::collections::HashMap<String, String>,
) -> Option<PathBuf> {
    if let Some(name) = info.get("chart").and_then(|value| safe_relative(value)) {
        let candidate = folder.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let stem = folder.file_name()?.to_string_lossy();
    if let Some(candidate) = find_child(folder, &format!("{stem}.json")) {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let mut candidates = fs::read_dir(folder)
        .ok()?
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
        })
        .filter(|path| {
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            !name.starts_with("AutoSave_") && !name.eq_ignore_ascii_case("extra.json")
        })
        .collect::<Vec<_>>();
    candidates.sort();
    if candidates.len() == 1 {
        candidates.pop()
    } else {
        None
    }
}

/// Count RPE autosave snapshots without importing them.
fn autosave_count(folder: &Path) -> usize {
    fs::read_dir(folder)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false)
                })
                .filter(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name.starts_with("AutoSave_") && name.to_ascii_lowercase().ends_with(".json")
                })
                .count()
        })
        .unwrap_or(0)
}

/// Build one chart entry; folders without a chart file are ignored.
fn chart_entry(folder: &Path) -> Option<RpeChartFolder> {
    let info_path = find_child(folder, "info.txt");
    let info = info_path
        .as_deref()
        .and_then(read_text)
        .map(|text| info_fields(&text))
        .unwrap_or_default();
    let chart = chart_in_folder(folder, &info)?;
    let folder_name = folder.file_name()?.to_string_lossy().into_owned();
    let chart_name = chart.file_name()?.to_string_lossy().into_owned();
    let name = info
        .get("name")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .or_else(|| {
            chart
                .file_stem()
                .map(|value| value.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| folder_name.clone());
    let group = info
        .get("group")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && *value != "-")
        .unwrap_or("RPE")
        .to_owned();
    Some(RpeChartFolder {
        path: chart.to_string_lossy().into_owned(),
        folder: folder_name,
        name,
        group,
        song: info.get("song").cloned().filter(|value| !value.is_empty()),
        picture: info
            .get("picture")
            .cloned()
            .filter(|value| !value.is_empty()),
        chart: Some(chart_name),
        composer: info
            .get("composer")
            .or_else(|| info.get("artist"))
            .cloned()
            .filter(|value| !value.trim().is_empty()),
        charter: info
            .get("charter")
            .or_else(|| info.get("mapper"))
            .cloned()
            .filter(|value| !value.trim().is_empty()),
        last_edit: info
            .get("lastedittime")
            .cloned()
            .filter(|value| !value.is_empty()),
        autosaves: autosave_count(folder),
    })
}

/// Whether a folder looks like the app root RPE writes.
fn has_rpe_marker(directory: &Path) -> bool {
    ["Resources", "Settings.json", "Hotkey.txt"]
        .iter()
        .any(|name| find_child(directory, name).is_some())
}

/// A native installation carries both PhiEdit.exe and a Resources folder.
fn has_installation_marker(directory: &Path) -> bool {
    let executable = find_child(directory, "PhiEdit.exe");
    let resources = find_child(directory, "Resources");
    executable.map(|path| path.is_file()).unwrap_or(false)
        && resources.map(|path| path.is_dir()).unwrap_or(false)
}

/// Accept a parent such as a game folder and descend one level to its `rpe` root.
///
/// A child literally named `rpe` wins, so a sibling backup or a second install
/// cannot be chosen just because the directory enumeration reached it first.
fn effective_root(root: PathBuf) -> PathBuf {
    if has_rpe_marker(&root) {
        return root;
    }
    if let Some(preferred) = find_child(&root, "rpe") {
        if preferred.is_dir() && has_rpe_marker(&preferred) {
            return preferred;
        }
    }
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten().take(64) {
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                let candidate = entry.path();
                if has_rpe_marker(&candidate) {
                    return candidate;
                }
            }
        }
    }
    root
}

/// Read one RPE root. The scan is bounded to direct child folders of Resources
/// or Charts, which is the layout native RPE writes.
#[tauri::command]
pub fn scan_rpe_root(
    token: tauri::State<'_, crate::app::ipc_guard::HostToken>,
    request: tauri::ipc::Request<'_>,
    path: String,
) -> Result<RpeFolderScan, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    scan_rpe_root_unchecked(&path)
}

/// Scan without an IPC token; visible to module tests and the command wrapper.
fn scan_rpe_root_unchecked(path: &str) -> Result<RpeFolderScan, String> {
    let selected = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !selected.is_dir() {
        return Err("The selected RPE path is not a folder.".into());
    }
    let root = effective_root(selected);
    let mut warnings = Vec::new();
    let settings_text = find_child(&root, "Settings.json")
        .or_else(|| find_child(&root, "Settings.txt"))
        .as_deref()
        .and_then(read_text);
    let hotkeys_text = find_child(&root, "Hotkey.txt")
        .as_deref()
        .and_then(read_text);
    let ui_text = find_child(&root, "UI.txt")
        .or_else(|| find_child(&root, "UI.json"))
        .as_deref()
        .and_then(read_text);
    let division_color_text = find_child(&root, "division_color.txt")
        .as_deref()
        .and_then(read_text);

    let mut folders = Vec::new();
    for name in ["Resources", "resources", "Charts", "charts"] {
        if let Some(directory) = find_child(&root, name) {
            if directory.is_dir() {
                folders.push(directory);
            }
        }
    }
    // A folder dropped directly from Resources/<id> is a single-chart root.
    folders.push(root.clone());

    let mut seen = HashSet::new();
    let mut charts = Vec::new();
    for directory in folders {
        let mut entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(format!("Could not read {}: {error}", directory.display()));
                continue;
            }
        };
        let mut visited = 0usize;
        for entry in entries.by_ref().flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            visited += 1;
            if visited > 5000 {
                warnings.push("The RPE folder contains more than 5000 chart folders.".into());
                break;
            }
            let folder = entry.path();
            if !seen.insert(folder.clone()) {
                continue;
            }
            if let Some(chart) = chart_entry(&folder) {
                charts.push(chart);
            }
        }
    }
    charts.sort_by(|left, right| {
        left.group
            .to_lowercase()
            .cmp(&right.group.to_lowercase())
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(RpeFolderScan {
        root: root.to_string_lossy().into_owned(),
        installation: has_installation_marker(&root),
        settings_text,
        hotkeys_text,
        ui_text,
        division_color_text,
        charts,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scans_settings_hotkeys_and_numeric_chart_folders() {
        let root = tempfile::tempdir().expect("temp dir");
        let resources = root.path().join("Resources");
        let folder = resources.join("12345");
        fs::create_dir_all(&folder).expect("chart folder");
        fs::write(root.path().join("PhiEdit.exe"), "exe").expect("executable");
        fs::write(root.path().join("Settings.json"), "{\"FpsLimit\":120}").expect("settings");
        fs::write(root.path().join("Hotkey.txt"), "AddTap A\n").expect("hotkeys");
        fs::write(root.path().join("UI.txt"), "GridColor1=#FF0000\n").expect("ui");
        fs::write(
            root.path().join("division_color.txt"),
            "# comment\n8: 128, 128, 255, 0.5 // bright blue\n",
        )
        .expect("division colours");
        fs::write(
            folder.join("info.txt"),
            "#\r\nName: Test Song\r\nChart: 12345.json\r\nGroup: WIP\r\nSong: song.mp3\r\nComposer: Composer Name\r\nCharter: Charter Name\r\n",
        )
        .expect("info");
        fs::write(folder.join("12345.json"), "{}").expect("chart");
        fs::write(folder.join("AutoSave_1.json"), "{}").expect("autosave");

        let scan = scan_rpe_root_unchecked(&root.path().to_string_lossy()).expect("scan");
        assert!(scan.installation);
        assert_eq!(scan.settings_text.as_deref(), Some("{\"FpsLimit\":120}"));
        assert_eq!(scan.hotkeys_text.as_deref(), Some("AddTap A\n"));
        assert_eq!(scan.ui_text.as_deref(), Some("GridColor1=#FF0000\n"));
        assert_eq!(
            scan.division_color_text.as_deref(),
            Some("# comment\n8: 128, 128, 255, 0.5 // bright blue\n")
        );
        assert_eq!(scan.charts.len(), 1);
        assert_eq!(scan.charts[0].name, "Test Song");
        assert_eq!(scan.charts[0].group, "WIP");
        assert_eq!(scan.charts[0].autosaves, 1);
        assert_eq!(scan.charts[0].song.as_deref(), Some("song.mp3"));
        assert_eq!(scan.charts[0].composer.as_deref(), Some("Composer Name"));
        assert_eq!(scan.charts[0].charter.as_deref(), Some("Charter Name"));
    }

    #[test]
    fn falls_back_to_the_folder_stem_and_skips_service_folders() {
        let root = tempfile::tempdir().expect("temp dir");
        let resources = root.path().join("Resources");
        let folder = resources.join("777");
        fs::create_dir_all(&folder).expect("chart folder");
        fs::create_dir_all(resources.join("Texture")).expect("service folder");
        fs::write(folder.join("777.json"), "{}").expect("chart");
        fs::write(resources.join("Texture").join("line.png"), b"png").expect("texture");

        let scan = scan_rpe_root_unchecked(&root.path().to_string_lossy()).expect("scan");
        assert!(!scan.installation);
        assert_eq!(scan.charts.len(), 1);
        assert_eq!(scan.charts[0].folder, "777");
        assert_eq!(scan.charts[0].name, "777");
        assert_eq!(scan.charts[0].group, "RPE");
    }
}
