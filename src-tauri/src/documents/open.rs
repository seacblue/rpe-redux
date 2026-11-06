//! Opens a `.pez` document: unpacks the archive, restores its chart and assets,
//! and streams large charts to the frontend in line batches.

use super::{
    archive_has_entry, document, error, load_external_grants, read_entry_limited,
    read_file_limited, rejected_reference_names, resolve_reference, resolve_references,
    store_external_grants, watch, zip_name, Document, DocumentHost, Entry, ExternalResources,
    LoadProgress, Opened, Result, MAX_CHART_BYTES, MAX_RESOURCE_BYTES, MAX_RESOURCE_TOTAL_BYTES,
    MAX_SIDECAR_BYTES,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Seek},
    path::Path,
};
use tauri::{
    ipc::{Channel, JavaScriptChannelId, Request, Response},
    State, Webview,
};
use zip::ZipArchive;

/// Batched desktop chart delivery. The header is small; line batches keep a
/// large chart from arriving as one IPC value on the UI thread.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ChartStreamMessage {
    Header { chart: Value },
    Lines { lines: Vec<Value> },
    Done,
}

const CHART_STREAM_LINES: usize = 12;
/// Largest number of entries accepted from one PEZ archive.
const MAX_PEZ_ENTRIES: usize = 16_384;
/// Largest number of JSON chart candidates parsed from one PEZ archive.
const MAX_PEZ_CHART_CANDIDATES: usize = 64;
/// Cumulative bytes allowed for chart JSON candidates inside one PEZ archive.
const MAX_PEZ_CHART_BYTES: u64 = MAX_CHART_BYTES;
/// Cumulative bytes allowed for Info.txt sidecars inside one PEZ archive.
const MAX_PEZ_INFO_BYTES: u64 = 8 * 1024 * 1024;

/// Deliver the chart header first, then line batches, then a done marker.
async fn stream_chart(mut chart: Value, channel: Channel<ChartStreamMessage>) -> Result<()> {
    let lines = chart
        .get_mut("judgeLineList")
        .and_then(Value::as_array_mut)
        .map(std::mem::take)
        .unwrap_or_default();
    channel
        .send(ChartStreamMessage::Header { chart })
        .map_err(error)?;
    for chunk in lines.chunks(CHART_STREAM_LINES) {
        channel
            .send(ChartStreamMessage::Lines {
                lines: chunk.to_vec(),
            })
            .map_err(error)?;
        std::thread::yield_now();
    }
    channel.send(ChartStreamMessage::Done).map_err(error)?;
    Ok(())
}

/// First `key: value` line in an Info.txt body, matched case-insensitively.
fn info_field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim().eq_ignore_ascii_case(key).then(|| value.trim())
    })
}

/// Fill metadata gaps from the selected package's Info.txt without replacing
/// values authored in the chart itself.
fn apply_info_metadata(chart: &mut Value, info: &str) {
    let Some(meta) = chart.get_mut("META").and_then(Value::as_object_mut) else {
        return;
    };
    for (source, target) in [
        ("Name", "name"),
        ("Composer", "composer"),
        ("Charter", "charter"),
        ("Illustration", "illustration"),
        ("Level", "level"),
        ("Song", "song"),
        ("Picture", "background"),
        ("Path", "id"),
    ] {
        let present = meta
            .get(target)
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        if present {
            continue;
        }
        if let Some(value) = info_field(info, source) {
            if !value.is_empty() {
                meta.insert(target.to_owned(), Value::String(value.to_owned()));
            }
        }
    }
}

/// Bounded PEZ discovery; media stay compressed until read_asset requests them.
pub(crate) fn read_pez_progress<R: Read + Seek>(
    reader: R,
    mut progress: impl FnMut(usize, usize),
) -> Result<(String, Value, Vec<Entry>)> {
    let mut archive = ZipArchive::new(reader).map_err(error)?;
    if archive.len() > MAX_PEZ_ENTRIES {
        return Err("pez_entry_limit".into());
    }
    let mut entries = Vec::new();
    let mut candidates = Vec::new();
    let mut infos = Vec::new();
    let mut total = 0u64;
    let mut chart_bytes = 0u64;
    let mut info_bytes = 0u64;
    let mut names = std::collections::HashSet::new();
    let count = archive.len();
    progress(0, count);
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(error)?;
        let name = file.name().map_err(error)?.into_owned();
        zip_name(&name)?;
        if !names.insert(name.clone()) {
            return Err("PEZ contains duplicate paths.".into());
        }
        total = total.checked_add(file.size()).ok_or("pez_size_overflow")?;
        if file.size() > MAX_RESOURCE_BYTES || total > MAX_RESOURCE_TOTAL_BYTES {
            return Err("pez_extracted_size_limit".into());
        }
        if file.is_dir() {
            progress(i + 1, count);
            continue;
        }
        entries.push(Entry {
            name: name.clone(),
            size: file.size(),
        });
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".json") || lower == "info.txt" || lower.ends_with("/info.txt") {
            let declared = file.size();
            let (limit, budget, too_large) = if lower.ends_with(".json") {
                (
                    MAX_PEZ_CHART_BYTES,
                    &mut chart_bytes,
                    "pez_chart_size_limit",
                )
            } else {
                (MAX_PEZ_INFO_BYTES, &mut info_bytes, "pez_info_size_limit")
            };
            if declared > limit.saturating_sub(*budget) {
                return Err(too_large.into());
            }
            *budget = budget
                .checked_add(declared)
                .ok_or("pez_sidecar_size_overflow")?;
            let bytes = read_entry_limited(&mut file, declared, limit, too_large)?;
            if bytes.len() as u64 != declared {
                return Err("pez_entry_size_mismatch".into());
            }
            let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
            if lower.ends_with(".json") {
                if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
                    if value.is_object() && name.rsplit('/').next() != Some("extra.json") {
                        if candidates.len() >= MAX_PEZ_CHART_CANDIDATES {
                            return Err("pez_chart_candidates_limit".into());
                        }
                        candidates.push((name, value));
                    }
                }
            } else {
                infos.push((name, String::from_utf8_lossy(bytes).into_owned()));
            }
        }
        progress(i + 1, count);
    }
    if candidates.is_empty() {
        return Err("No RPE chart found in the PEZ archive.".into());
    }
    let normalize = |path: &str| {
        let path = path.replace('\\', "/");
        let mut parts = Vec::new();
        for part in path.split('/') {
            if part == ".." {
                parts.pop();
            } else if !part.is_empty() && part != "." {
                parts.push(part);
            }
        }
        parts.join("/").to_lowercase()
    };
    let mut preferred = Vec::new();
    for (name, info) in &infos {
        for row in info.lines() {
            if let Some((key, value)) = row.split_once(':') {
                if key.trim().eq_ignore_ascii_case("Chart") {
                    let parent = name
                        .rsplit_once('/')
                        .map(|(parent, _)| format!("{parent}/"))
                        .unwrap_or_default();
                    let reference = normalize(&format!("{parent}{}", value.trim()));
                    if let Some(index) = candidates
                        .iter()
                        .position(|(name, _)| normalize(name) == reference)
                    {
                        preferred.push(index);
                    }
                }
            }
        }
    }
    preferred.sort_unstable();
    preferred.dedup();
    // Do not silently choose an autosave or another difficulty in an ambiguous package.
    let index = if preferred.len() == 1 {
        preferred[0]
    } else if candidates.len() == 1 {
        0
    } else {
        return Err(format!(
            "PEZ contains multiple charts. Select one with info.txt Chart: {}",
            candidates
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };
    let selected_info = infos.iter().find(|(info_name, text)| {
        let Some(reference) = info_field(text, "Chart") else {
            return false;
        };
        let parent = info_name
            .rsplit_once('/')
            .map(|(parent, _)| format!("{parent}/"))
            .unwrap_or_default();
        normalize(&format!("{parent}{reference}")) == normalize(&candidates[index].0)
    });
    let (name, mut chart) = candidates.swap_remove(index);
    if let Some((_, info)) = selected_info {
        apply_info_metadata(&mut chart, info);
    }
    Ok((name, chart, entries))
}

/// Open a chart or package, register its resources, and optionally stream the
/// chart through `on_chart`.
///
/// Progress is reported through `on_progress`. `include_chart` defaults to true
/// when no chart channel is supplied.
#[tauri::command]
pub async fn open_document(
    app: tauri::AppHandle,
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    on_progress: Option<JavaScriptChannelId>,
    on_chart: Option<JavaScriptChannelId>,
    include_chart: Option<bool>,
    allow_external_resources: Option<bool>,
    webview: Webview,
) -> Result<Opened> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let progress_webview = webview.clone();
    let chart_channel = on_chart.map(|id| id.channel_on(webview));
    let on_progress: Option<Channel<LoadProgress>> =
        on_progress.map(|id| id.channel_on(progress_webview));
    let path = fs::canonicalize(path).map_err(error)?;
    let parent = path.parent().ok_or("Invalid document path")?;
    let packed = matches!(
        path.extension()
            .and_then(|p| p.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("pez" | "zip")
    );
    let mut entries = Vec::new();
    let chart_name;
    let chart;
    if packed {
        (chart_name, chart, entries) =
            read_pez_progress(File::open(&path).map_err(error)?, |completed, total| {
                if let Some(channel) = &on_progress {
                    let _ = channel.send(LoadProgress { completed, total });
                }
            })?;
    } else {
        let bytes = read_file_limited(&path, MAX_CHART_BYTES, "chart_too_large")?;
        chart = serde_json::from_slice::<Value>(&bytes).map_err(error)?;
        chart_name = path
            .file_name()
            .ok_or("Document path has no file name")?
            .to_string_lossy()
            .into_owned();
    }
    // Preserve associated shader metadata without scanning resource directories.
    // A sidecar that resolves outside the document folder is treated as absent.
    let extra_path = if packed {
        None
    } else {
        resolve_reference(parent, "extra.json")
            .ok()
            .filter(|reference| reference.internal && reference.path.is_file())
            .map(|reference| reference.path)
    };
    let extra = extra_path
        .as_deref()
        .map(|path| read_file_limited(path, MAX_SIDECAR_BYTES, "sidecar_too_large"))
        .transpose()?
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let mut authorized = if packed {
        ExternalResources::default()
    } else {
        load_external_grants(&app, &path)
    };
    if !packed && allow_external_resources.unwrap_or(false) {
        let mut discovered = ExternalResources::default();
        for value in std::iter::once(&chart).chain(extra.iter()) {
            let references = resolve_references(&path, value, &ExternalResources::default())?;
            for target in references.external.values() {
                discovered.insert(target.clone());
            }
        }
        let mut changed = false;
        for target in discovered.paths() {
            changed |= authorized.insert(target.clone());
        }
        if changed {
            store_external_grants(&app, &path, &authorized)?;
        }
    }
    let chart_references = if packed {
        None
    } else {
        Some(resolve_references(&path, &chart, &authorized)?)
    };
    let extra_references = if packed {
        None
    } else {
        extra
            .as_ref()
            .map(|value| resolve_references(&path, value, &authorized))
            .transpose()?
    };
    let rejected_external_resources =
        rejected_reference_names(chart_references.iter().chain(extra_references.iter()));
    if !rejected_external_resources.is_empty() {
        // One bounded warning per open keeps a hostile chart from filling the
        // log with one line per reference while still making the skip visible.
        let sample = rejected_external_resources
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        eprintln!(
            "[redux.documents] skipped {} unsafe or unapproved resource reference(s) in {}: {}{}",
            rejected_external_resources.len(),
            path.display(),
            sample,
            if rejected_external_resources.len() > 8 {
                ", ..."
            } else {
                ""
            }
        );
    }
    if let Some(references) = &chart_references {
        let mut resource_total = 0u64;
        for (name, target) in &references.allowed {
            let size = fs::metadata(target).map(|m| m.len()).unwrap_or(0);
            resource_total = resource_total
                .checked_add(size)
                .filter(|total| *total <= MAX_RESOURCE_TOTAL_BYTES)
                .ok_or("resource_total_too_large")?;
            entries.push(Entry {
                name: name.clone(),
                size,
            });
        }
        if let Some(extra_path) = &extra_path {
            let size = fs::metadata(extra_path).map(|m| m.len()).unwrap_or(0);
            resource_total = resource_total
                .checked_add(size)
                .filter(|total| *total <= MAX_RESOURCE_TOTAL_BYTES)
                .ok_or("resource_total_too_large")?;
            entries.push(Entry {
                name: "extra.json".into(),
                size,
            });
        }
        if let Some(references) = &extra_references {
            for (name, target) in &references.allowed {
                if !entries.iter().any(|entry| &entry.name == name) {
                    let size = fs::metadata(target).map(|m| m.len()).unwrap_or(0);
                    resource_total = resource_total
                        .checked_add(size)
                        .filter(|total| *total <= MAX_RESOURCE_TOTAL_BYTES)
                        .ok_or("resource_total_too_large")?;
                    entries.push(Entry {
                        name: name.clone(),
                        size,
                    });
                }
            }
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut resources = chart_references
        .map(|references| references.allowed)
        .unwrap_or_default();
    if let Some(references) = extra_references {
        for (name, path) in references.allowed {
            resources.entry(name).or_insert(path);
        }
    }
    if packed {
        resources.insert("extra.json".into(), parent.join("extra.json"));
    } else if let Some(extra_path) = extra_path {
        resources.insert("extra.json".into(), extra_path);
    }
    let loaded = Document {
        path: path.clone(),
        chart_name: chart_name.clone(),
        packed,
        resources,
    };
    let disk_snapshot = watch::disk_snapshot(&loaded)?;
    state
        .documents
        .lock()
        .map_err(error)?
        .insert(id.clone(), loaded.clone());
    if let Err(error) = watch::watch_document(&app, &state, &id, &loaded) {
        state.documents.lock().map_err(super::error)?.remove(&id);
        return Err(error);
    }
    let chart = match chart_channel {
        Some(channel) => {
            stream_chart(chart, channel).await?;
            None
        }
        None if include_chart.unwrap_or(true) => Some(chart),
        None => None,
    };
    Ok(Opened {
        id,
        path: path.to_string_lossy().into_owned(),
        chart_name,
        chart,
        entries,
        packed,
        disk_snapshot,
        rejected_external_resources,
    })
}

/// Read one authorized resource, from the archive or the document folder.
pub(crate) fn resource_bytes(doc: &Document, name: &str) -> Result<Vec<u8>> {
    if doc.packed {
        if !doc.resources.contains_key(name) {
            zip_name(name)?;
        }
        let mut archive = ZipArchive::new(File::open(&doc.path).map_err(error)?).map_err(error)?;
        let relative = Path::new(&doc.chart_name)
            .parent()
            .unwrap_or(Path::new(""))
            .join(name)
            .to_string_lossy()
            .replace('\\', "/");
        let alias = doc
            .resources
            .get(name)
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let selected = match alias {
            Some(alias) if archive_has_entry(&archive, &alias)? => alias,
            _ if archive_has_entry(&archive, &relative)? => relative,
            _ => name.to_owned(),
        };
        let mut file = archive.by_name(&selected).map_err(error)?;
        let declared = file.size();
        let bytes = read_entry_limited(
            &mut file,
            declared,
            MAX_RESOURCE_BYTES,
            "resource_too_large",
        )?;
        if bytes.len() as u64 != declared {
            return Err("resource_size_mismatch".into());
        }
        Ok(bytes)
    } else {
        let path = super::readable_resource_path(doc, name)?;
        read_file_limited(&path, MAX_RESOURCE_BYTES, "resource_too_large")
    }
}

/// Read one authorized resource as binary IPC data.
#[tauri::command]
pub fn read_asset(state: State<'_, DocumentHost>, id: String, name: String) -> Result<Response> {
    Ok(Response::new(resource_bytes(
        &document(&state, &id)?,
        &name,
    )?))
}

/// Unregister a document and stop watching its folders.
#[tauri::command]
pub fn close_document(state: State<'_, DocumentHost>, id: String) -> Result<()> {
    state.watchers.lock().map_err(error)?.remove(&id);
    state.documents.lock().map_err(error)?.remove(&id);
    Ok(())
}
