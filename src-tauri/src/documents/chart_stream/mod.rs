//! Streaming chart opens for the Tauri host.
//!
//! `open_document_stream` scans a `.json`, `.pez`, or `.zip` source without
//! building the chart object graph, keeps the chart bytes and line ranges for
//! random access, and sends header/index/line frames through a binary channel.
//! `read_chart_lines` serves a bounded line batch from the same stored source.
//!
//! PEZ media entries stay compressed: selection reads JSON candidates and
//! `Info.txt` sidecars, then the selected chart entry is read again for random
//! access. Media bytes are only read when `read_asset` asks for them.

mod frames;
mod index;
mod json_scan;

use self::frames::{
    encode_error_frame, encode_json_frame, encode_lines_frame, FRAME_END, FRAME_HEADER, FRAME_INDEX,
};
use self::index::{build_chart_index, combine_content_fingerprint};
use self::json_scan::{scan_chart_json, LineRange};
use super::open::{
    apply_info_metadata_to_meta, info_field, select_pez_chart, MAX_PEZ_CHART_BYTES,
    MAX_PEZ_CHART_CANDIDATES, MAX_PEZ_ENTRIES, MAX_PEZ_INFO_BYTES,
};
use super::{
    error, load_external_grants, read_entry_limited, read_file_limited, rejected_reference_names,
    resolve_named_references, resolve_reference, resolve_references, resource_names,
    store_external_grants, watch, zip_name, Document, DocumentHost, Entry, ExternalResources,
    LoadProgress, Result, MAX_CHART_BYTES, MAX_RESOURCE_BYTES, MAX_RESOURCE_TOTAL_BYTES,
    MAX_SIDECAR_BYTES,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::Path,
    sync::Arc,
};
use tauri::{
    ipc::{Channel, InvokeResponseBody, JavaScriptChannelId, Request, Response},
    State, Webview,
};
use zip::ZipArchive;

/// Largest line batch sent while opening a chart.
const MAX_STREAM_BATCH_BYTES: usize = 1024 * 1024;
/// Largest number of lines in one open batch.
const MAX_STREAM_BATCH_LINES: usize = 256;
/// Largest line range returned by one `read_chart_lines` call.
const MAX_LINE_READ_BYTES: u64 = 64 * 1024 * 1024;
/// Largest slice returned by one `read_chart_line_chunk` call.
const MAX_LINE_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

/// Random-access state for one streaming document.
///
/// The chart bytes are shared with the open command so a large source is not
/// copied just to keep it available for later line reads.
pub(crate) struct ChartStreamDocument {
    bytes: Arc<Vec<u8>>,
    line_ranges: Arc<[LineRange]>,
}

impl ChartStreamDocument {
    /// Build a `LINES` frame for one validated line range.
    fn lines_frame(&self, start: usize, count: usize) -> Result<Vec<u8>> {
        let end = start
            .checked_add(count)
            .ok_or_else(|| "invalid_line_range".to_string())?;
        if start > self.line_ranges.len() || end > self.line_ranges.len() {
            return Err("invalid_line_range".into());
        }
        let mut total = 2u64;
        for (offset, range) in self.line_ranges[start..end].iter().enumerate() {
            total = total
                .checked_add(range.len() as u64 + u64::from(offset > 0))
                .ok_or("chart_lines_too_large")?;
        }
        if total > MAX_LINE_READ_BYTES {
            return Err("chart_lines_too_large".into());
        }
        let mut raw = Vec::with_capacity(total as usize);
        raw.push(b'[');
        for (offset, range) in self.line_ranges[start..end].iter().enumerate() {
            if offset > 0 {
                raw.push(b',');
            }
            raw.extend_from_slice(&self.bytes[range.start..range.end]);
        }
        raw.push(b']');
        let start = u32::try_from(start).map_err(|_| "chart_line_index_overflow".to_string())?;
        let count = u32::try_from(count).map_err(|_| "chart_line_index_overflow".to_string())?;
        encode_lines_frame(start, count, &raw)
    }

    /// Read one UTF-8 byte slice of a line, capped to the chunk size.
    fn line_chunk(&self, index: usize, offset: u64, length: u64) -> Result<Vec<u8>> {
        let range = self
            .line_ranges
            .get(index)
            .ok_or_else(|| "invalid_line_range".to_string())?;
        let line_length = range.len() as u64;
        if offset > line_length {
            return Err("invalid_line_range".into());
        }
        let take = length.min(MAX_LINE_CHUNK_BYTES).min(line_length - offset);
        let start = range.start + offset as usize;
        let end = start + take as usize;
        Ok(self.bytes[start..end].to_vec())
    }
}

/// Metadata returned by a streaming open; the chart itself arrives in frames.
#[derive(Serialize)]
pub struct OpenedStream {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) chart_name: String,
    pub(crate) entries: Vec<Entry>,
    pub(crate) packed: bool,
    pub(crate) disk_snapshot: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) rejected_external_resources: Vec<String>,
    pub(crate) line_count: usize,
}

/// Open a document and stream its chart as binary frames.
///
/// The source is scanned and indexed before the first frame is sent, so a
/// malformed chart fails without leaving a partially registered document.
#[tauri::command]
pub async fn open_document_stream(
    app: tauri::AppHandle,
    state: State<'_, DocumentHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    path: String,
    on_stream: JavaScriptChannelId,
    on_progress: Option<JavaScriptChannelId>,
    allow_external_resources: Option<bool>,
    include_lines: Option<bool>,
    webview: Webview,
) -> Result<OpenedStream> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    // `Channel<Vec<u8>>` would JSON-encode every byte. `InvokeResponseBody::Raw`
    // is Tauri's binary channel payload and keeps frame bytes exact.
    let stream_channel: Channel<InvokeResponseBody> = on_stream.channel_on(webview.clone());
    let progress_channel: Option<Channel<LoadProgress>> =
        on_progress.map(|id| id.channel_on(webview));

    let path = fs::canonicalize(path).map_err(error)?;
    let parent = path.parent().ok_or("Invalid document path")?;
    let packed = matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("pez" | "zip")
    );

    let mut entries = Vec::new();
    let chart_name;
    let chart_bytes;
    let selected_info;
    if packed {
        let (name, bytes, archive_entries, info) = read_pez_chart(&path, |completed, total| {
            if let Some(channel) = &progress_channel {
                let _ = channel.send(LoadProgress { completed, total });
            }
        })?;
        chart_name = name;
        chart_bytes = bytes;
        entries = archive_entries;
        selected_info = info;
    } else {
        chart_bytes = read_file_limited(&path, MAX_CHART_BYTES, "chart_too_large")?;
        chart_name = path
            .file_name()
            .ok_or("Document path has no file name")?
            .to_string_lossy()
            .into_owned();
        selected_info = None;
    }

    let mut scan = match scan_chart_json(&chart_bytes) {
        Ok(scan) => scan,
        Err(scan_error) => {
            let message = scan_error.to_string();
            let _ = stream_channel.send(InvokeResponseBody::Raw(encode_error_frame(
                "invalid_chart",
                &message,
                "$",
            )?));
            return Err(message);
        }
    };
    if let Some(info) = &selected_info {
        apply_info_metadata(&mut scan.header, info);
    }
    let built = match build_chart_index(&chart_bytes, &scan) {
        Ok(built) => built,
        Err(index_error) => {
            let _ = stream_channel.send(InvokeResponseBody::Raw(encode_error_frame(
                "invalid_chart_index",
                &index_error,
                "$",
            )?));
            return Err(index_error);
        }
    };
    let line_count = scan.line_ranges.len();
    let header_frame =
        encode_json_frame(FRAME_HEADER, &header_frame_value(&scan.header, line_count))?;
    let index_frame = encode_json_frame(FRAME_INDEX, &built.index)?;

    let mut resources = HashMap::new();
    let mut rejected_external_resources = Vec::new();
    if packed {
        // Packed assets are read from the archive on demand; the placeholder
        // keeps `read_asset`'s name check on the same path as `open_document`.
        resources.insert("extra.json".into(), parent.join("extra.json"));
    } else {
        let names = built.resource_names.clone();
        let extra_path = resolve_reference(parent, "extra.json")
            .ok()
            .filter(|reference| reference.internal && reference.path.is_file())
            .map(|reference| reference.path);
        let extra = extra_path
            .as_deref()
            .map(|path| read_file_limited(path, MAX_SIDECAR_BYTES, "sidecar_too_large"))
            .transpose()?
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        let mut authorized = load_external_grants(&app, &path);
        if allow_external_resources.unwrap_or(false) {
            let mut discovery_names = names.clone();
            if let Some(extra) = &extra {
                discovery_names.extend(resource_names(extra));
            }
            let mut discovered = ExternalResources::default();
            let references =
                resolve_named_references(&path, discovery_names, &ExternalResources::default())?;
            for target in references.external.values() {
                discovered.insert(target.clone());
            }
            let mut changed = false;
            for target in discovered.paths() {
                changed |= authorized.insert(target.clone());
            }
            if changed {
                store_external_grants(&app, &path, &authorized)?;
            }
        }
        let chart_references = resolve_named_references(&path, names, &authorized)?;
        let extra_references = extra
            .as_ref()
            .map(|value| resolve_references(&path, value, &authorized))
            .transpose()?;
        rejected_external_resources = rejected_reference_names(
            std::iter::once(&chart_references).chain(extra_references.iter()),
        );
        if !rejected_external_resources.is_empty() {
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
        let mut resource_total = 0u64;
        for (name, target) in &chart_references.allowed {
            let size = fs::metadata(target)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
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
            let size = fs::metadata(extra_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
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
                if entries.iter().any(|entry| &entry.name == name) {
                    continue;
                }
                let size = fs::metadata(target)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
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
        resources = chart_references.allowed;
        if let Some(references) = extra_references {
            for (name, target) in references.allowed {
                resources.entry(name).or_insert(target);
            }
        }
        if let Some(extra_path) = extra_path {
            resources.insert("extra.json".into(), extra_path);
        }
    }

    let loaded = Document {
        path: path.clone(),
        chart_name: chart_name.clone(),
        packed,
        resources,
    };
    let disk_snapshot = watch::disk_snapshot(&loaded)?;
    let id = uuid::Uuid::new_v4().to_string();
    let bytes = Arc::new(chart_bytes);
    let line_ranges: Arc<[LineRange]> = Arc::from(scan.line_ranges);
    let stream_document = ChartStreamDocument {
        bytes: bytes.clone(),
        line_ranges: line_ranges.clone(),
    };
    state
        .documents
        .lock()
        .map_err(error)?
        .insert(id.clone(), loaded.clone());
    match state.streams.lock() {
        Ok(mut streams) => {
            streams.insert(id.clone(), stream_document);
        }
        Err(lock_error) => {
            state.documents.lock().map_err(error)?.remove(&id);
            return Err(error(lock_error));
        }
    }
    if let Err(watch_error) = watch::watch_document(&app, &state, &id, &loaded) {
        unregister(&state, &id);
        return Err(watch_error);
    }
    if let Err(send_error) = send_frames(
        &stream_channel,
        header_frame,
        index_frame,
        &bytes,
        &line_ranges,
        &built.index,
        include_lines.unwrap_or(true),
    ) {
        unregister(&state, &id);
        return Err(send_error);
    }

    Ok(OpenedStream {
        id,
        path: path.to_string_lossy().into_owned(),
        chart_name,
        entries,
        packed,
        disk_snapshot,
        rejected_external_resources,
        line_count,
    })
}

/// Serve one bounded line range as a `LINES` frame.
#[tauri::command]
pub fn read_chart_lines(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    state: State<'_, DocumentHost>,
    id: String,
    start: u32,
    count: u32,
) -> Result<Response> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let stream = {
        let streams = state.streams.lock().map_err(error)?;
        let stream = streams
            .get(&id)
            .ok_or_else(|| "Document is not streaming.".to_string())?;
        ChartStreamDocument {
            bytes: stream.bytes.clone(),
            line_ranges: stream.line_ranges.clone(),
        }
    };
    Ok(Response::new(
        stream.lines_frame(start as usize, count as usize)?,
    ))
}

/// Serve one UTF-8 byte slice of a single line for sources whose line exceeds
/// the batch frame ceiling. The caller concatenates slices before decoding.
#[tauri::command]
pub fn read_chart_line_chunk(
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: Request<'_>,
    state: State<'_, DocumentHost>,
    id: String,
    index: u32,
    offset: u64,
    length: u64,
) -> Result<Response> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    let (bytes, line_ranges) = {
        let streams = state.streams.lock().map_err(error)?;
        let stream = streams
            .get(&id)
            .ok_or_else(|| "Document is not streaming.".to_string())?;
        (stream.bytes.clone(), stream.line_ranges.clone())
    };
    let stream = ChartStreamDocument { bytes, line_ranges };
    Ok(Response::new(stream.line_chunk(
        index as usize,
        offset,
        length,
    )?))
}

/// Send header, index, optional line batches, and the end frame.
fn send_frames(
    channel: &Channel<InvokeResponseBody>,
    header_frame: Vec<u8>,
    index_frame: Vec<u8>,
    bytes: &[u8],
    line_ranges: &[LineRange],
    index: &index::ChartIndex,
    include_lines: bool,
) -> Result<()> {
    channel
        .send(InvokeResponseBody::Raw(header_frame))
        .map_err(error)?;
    channel
        .send(InvokeResponseBody::Raw(index_frame))
        .map_err(error)?;
    if include_lines {
        send_line_batches(channel, bytes, line_ranges)?;
    }
    let digest = combine_content_fingerprint(index.header_digest(), &index.line_digests());
    let end_frame = encode_json_frame(
        FRAME_END,
        &json!({
            "digest": digest,
            "bytes": bytes.len(),
        }),
    )?;
    channel
        .send(InvokeResponseBody::Raw(end_frame))
        .map_err(error)?;
    Ok(())
}

/// Send the complete chart as byte-bounded line batches.
fn send_line_batches(
    channel: &Channel<InvokeResponseBody>,
    bytes: &[u8],
    line_ranges: &[LineRange],
) -> Result<()> {
    let mut start = 0usize;
    while start < line_ranges.len() {
        let mut end = start;
        let mut batch_bytes = 2usize;
        while end < line_ranges.len() && end - start < MAX_STREAM_BATCH_LINES {
            let extra = line_ranges[end].len() + usize::from(end > start);
            if end > start && batch_bytes.saturating_add(extra) > MAX_STREAM_BATCH_BYTES {
                break;
            }
            batch_bytes = batch_bytes.saturating_add(extra);
            end += 1;
        }
        if end == start {
            end = start + 1;
        }
        let mut raw = Vec::with_capacity(batch_bytes);
        raw.push(b'[');
        for (offset, range) in line_ranges[start..end].iter().enumerate() {
            if offset > 0 {
                raw.push(b',');
            }
            raw.extend_from_slice(&bytes[range.start..range.end]);
        }
        raw.push(b']');
        let frame_start =
            u32::try_from(start).map_err(|_| "chart_line_index_overflow".to_string())?;
        let frame_count =
            u32::try_from(end - start).map_err(|_| "chart_line_index_overflow".to_string())?;
        let frame = encode_lines_frame(frame_start, frame_count, &raw)?;
        channel
            .send(InvokeResponseBody::Raw(frame))
            .map_err(error)?;
        start = end;
        std::thread::yield_now();
    }
    Ok(())
}

/// Remove every registration for one document id.
fn unregister(state: &DocumentHost, id: &str) {
    if let Ok(mut watchers) = state.watchers.lock() {
        watchers.remove(id);
    }
    if let Ok(mut streams) = state.streams.lock() {
        streams.remove(id);
    }
    if let Ok(mut documents) = state.documents.lock() {
        documents.remove(id);
    }
}

/// Build the header frame value: `META`, `BPMList`, optional arrays, extras,
/// and `lineCount`, matching `chartHeaderFromScan` in TypeScript.
fn header_frame_value(header: &Map<String, Value>, line_count: usize) -> Value {
    const KNOWN: [&str; 7] = [
        "META",
        "BPMList",
        "judgeLineGroup",
        "blockAreaList",
        "effects",
        "shaderEvents",
        "markers",
    ];
    let mut frame = Map::new();
    frame.insert(
        "META".into(),
        match header.get("META") {
            Some(Value::Object(meta)) => Value::Object(meta.clone()),
            _ => Value::Object(Map::new()),
        },
    );
    frame.insert(
        "BPMList".into(),
        match header.get("BPMList") {
            Some(Value::Array(list)) => Value::Array(list.clone()),
            _ => Value::Array(Vec::new()),
        },
    );
    for key in [
        "judgeLineGroup",
        "blockAreaList",
        "effects",
        "shaderEvents",
        "markers",
    ] {
        if let Some(Value::Array(values)) = header.get(key) {
            frame.insert(key.into(), Value::Array(values.clone()));
        }
    }
    let mut extras = header.clone();
    for key in KNOWN {
        extras.remove(key);
    }
    frame.insert("extras".into(), Value::Object(extras));
    frame.insert(
        "lineCount".into(),
        Value::Number((line_count as u64).into()),
    );
    Value::Object(frame)
}

/// Fill metadata gaps in the header from the selected package's Info.txt.
///
/// Only the header frame and header digest see the filled values; the stored
/// line bytes stay verbatim, so a later save path must persist the metadata.
fn apply_info_metadata(header: &mut Map<String, Value>, info: &str) {
    let Some(meta) = header.get_mut("META").and_then(Value::as_object_mut) else {
        return;
    };
    apply_info_metadata_to_meta(meta, info);
}

/// Read the selected chart entry from a PEZ without reading media entries.
///
/// The first pass records entry metadata and reads only JSON candidates and
/// `Info.txt`; the selected chart is read again into memory for random access.
fn read_pez_chart(
    path: &Path,
    mut progress: impl FnMut(usize, usize),
) -> Result<(String, Vec<u8>, Vec<Entry>, Option<String>)> {
    let mut archive = ZipArchive::new(File::open(path).map_err(error)?).map_err(error)?;
    if archive.len() > MAX_PEZ_ENTRIES {
        return Err("pez_entry_limit".into());
    }
    let count = archive.len();
    let mut entries = Vec::new();
    let mut candidates = Vec::new();
    let mut infos = Vec::new();
    let mut total = 0u64;
    let mut chart_bytes = 0u64;
    let mut info_bytes = 0u64;
    let mut names = HashSet::new();
    progress(0, count);

    for index in 0..count {
        let mut file = archive.by_index(index).map_err(error)?;
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
            progress(index + 1, count);
            continue;
        }
        entries.push(Entry {
            name: name.clone(),
            size: file.size(),
        });
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".json") {
            let declared = file.size();
            if declared > MAX_PEZ_CHART_BYTES.saturating_sub(chart_bytes) {
                return Err("pez_chart_size_limit".into());
            }
            chart_bytes = chart_bytes
                .checked_add(declared)
                .ok_or("pez_sidecar_size_overflow")?;
            let bytes = read_entry_limited(
                &mut file,
                declared,
                MAX_PEZ_CHART_BYTES,
                "pez_chart_size_limit",
            )?;
            if bytes.len() as u64 != declared {
                return Err("pez_entry_size_mismatch".into());
            }
            if name.rsplit('/').next() != Some("extra.json") && scan_chart_json(&bytes).is_ok() {
                if candidates.len() >= MAX_PEZ_CHART_CANDIDATES {
                    return Err("pez_chart_candidates_limit".into());
                }
                candidates.push(name);
            }
        } else if lower == "info.txt" || lower.ends_with("/info.txt") {
            let declared = file.size();
            if declared > MAX_PEZ_INFO_BYTES.saturating_sub(info_bytes) {
                return Err("pez_info_size_limit".into());
            }
            info_bytes = info_bytes
                .checked_add(declared)
                .ok_or("pez_sidecar_size_overflow")?;
            let bytes = read_entry_limited(
                &mut file,
                declared,
                MAX_PEZ_INFO_BYTES,
                "pez_info_size_limit",
            )?;
            if bytes.len() as u64 != declared {
                return Err("pez_entry_size_mismatch".into());
            }
            let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
            infos.push((name, String::from_utf8_lossy(bytes).into_owned()));
        }
        progress(index + 1, count);
    }

    if candidates.is_empty() {
        return Err("No RPE chart found in the PEZ archive.".into());
    }
    let index = select_pez_chart(&candidates, &infos)?;
    let selected_name = candidates[index].clone();
    let selected_info = infos
        .iter()
        .find(|(info_name, text)| {
            let Some(reference) = info_field(text, "Chart") else {
                return false;
            };
            let parent = info_name
                .rsplit_once('/')
                .map(|(parent, _)| format!("{parent}/"))
                .unwrap_or_default();
            super::open::normalize_pez_path(&format!("{parent}{reference}"))
                == super::open::normalize_pez_path(&selected_name)
        })
        .map(|(_, text)| text.clone());
    let mut file = archive.by_name(&selected_name).map_err(error)?;
    let declared = file.size();
    let bytes = read_entry_limited(&mut file, declared, MAX_CHART_BYTES, "pez_chart_size_limit")?;
    if bytes.len() as u64 != declared {
        return Err("pez_entry_size_mismatch".into());
    }
    Ok((selected_name, bytes, entries, selected_info))
}

#[cfg(test)]
mod tests {
    use super::{header_frame_value, read_pez_chart, send_frames, ChartStreamDocument};
    use crate::documents::chart_stream::frames::{
        encode_json_frame, FRAME_END, FRAME_HEADER, FRAME_INDEX, FRAME_LINES,
    };
    use crate::documents::chart_stream::index::build_chart_index;
    use crate::documents::chart_stream::json_scan::{scan_chart_json, LineRange};
    use std::{
        fs,
        io::Write,
        sync::{Arc, Mutex},
    };
    use tauri::ipc::{Channel, InvokeResponseBody};
    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn stream(bytes: Vec<u8>) -> ChartStreamDocument {
        let scan = scan_chart_json(&bytes).unwrap();
        let ranges: Arc<[LineRange]> = Arc::from(scan.line_ranges);
        ChartStreamDocument {
            bytes: Arc::new(bytes),
            line_ranges: ranges,
        }
    }

    #[test]
    fn lines_frame_returns_the_requested_ranges() {
        let bytes =
            br#"{"META":{},"BPMList":[],"judgeLineList":[{"a":1},{"b":[2,3]},{"c":"x"}]}"#.to_vec();
        let document = stream(bytes);

        let frame = document.lines_frame(1, 2).unwrap();
        assert_eq!(frame[4], FRAME_LINES);
        let payload = &frame[5..];
        assert_eq!(&payload[..4], &1u32.to_le_bytes());
        assert_eq!(&payload[4..8], &2u32.to_le_bytes());
        assert_eq!(&payload[8..], br#"[{"b":[2,3]},{"c":"x"}]"#);
    }

    #[test]
    fn line_chunks_cover_a_line_and_reject_invalid_offsets() {
        let bytes = br#"{"META":{},"BPMList":[],"judgeLineList":[{"text":"abcdef"}]}"#.to_vec();
        let document = stream(bytes.clone());
        let range = &document.line_ranges[0];
        let expected = &bytes[range.start..range.end];
        let mut assembled = Vec::new();
        let mut offset = 0u64;
        while offset < range.len() as u64 {
            assembled.extend(document.line_chunk(0, offset, 4).unwrap());
            offset += 4;
        }
        assert_eq!(assembled, expected);
        assert!(document
            .line_chunk(0, range.len() as u64, 4)
            .unwrap()
            .is_empty());
        assert!(document.line_chunk(0, range.len() as u64 + 1, 4).is_err());
        assert!(document.line_chunk(1, 0, 4).is_err());
    }

    #[test]
    fn open_sequence_sends_header_index_lines_and_end() {
        let bytes =
            br#"{"META":{"name":"Song"},"BPMList":[],"judgeLineList":[{"a":1},{"b":2},{"c":3}]}"#
                .to_vec();
        let scan = scan_chart_json(&bytes).unwrap();
        let built = build_chart_index(&bytes, &scan).unwrap();
        let ranges: Arc<[LineRange]> = Arc::from(scan.line_ranges);
        let header = encode_json_frame(
            FRAME_HEADER,
            &header_frame_value(&scan.header, ranges.len()),
        )
        .unwrap();
        let index = encode_json_frame(FRAME_INDEX, &built.index).unwrap();
        let frames = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let sink = frames.clone();
        let channel = Channel::<InvokeResponseBody>::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                sink.lock().unwrap().push(bytes);
            }
            Ok(())
        });

        send_frames(&channel, header, index, &bytes, &ranges, &built.index, true).unwrap();

        let frames = frames.lock().unwrap();
        assert_eq!(frames.len(), 4);
        assert_eq!(frames[0][4], FRAME_HEADER);
        assert_eq!(frames[1][4], FRAME_INDEX);
        assert_eq!(frames[2][4], FRAME_LINES);
        assert_eq!(frames[3][4], FRAME_END);
        assert_eq!(&frames[2][13..], br#"[{"a":1},{"b":2},{"c":3}]"#);
    }

    #[test]
    fn lines_frame_rejects_out_of_range_requests() {
        let bytes = br#"{"judgeLineList":[{"a":1}]}"#.to_vec();
        let document = stream(bytes);

        assert_eq!(
            document.lines_frame(1, 1).unwrap_err(),
            "invalid_line_range"
        );
        assert_eq!(
            document.lines_frame(0, 2).unwrap_err(),
            "invalid_line_range"
        );
        assert_eq!(
            document.lines_frame(usize::MAX, 1).unwrap_err(),
            "invalid_line_range"
        );
        assert!(document.lines_frame(1, 0).is_ok());
    }

    #[test]
    fn header_frame_has_line_count_and_extras() {
        let bytes = br#"{"META":{"name":"Song"},"custom":1,"judgeLineList":[{}]}"#;
        let scan = scan_chart_json(bytes).unwrap();
        let frame = header_frame_value(&scan.header, scan.line_ranges.len());

        assert_eq!(frame["lineCount"], 1);
        assert_eq!(frame["META"]["name"], "Song");
        assert_eq!(frame["BPMList"], serde_json::json!([]));
        assert_eq!(frame["extras"]["custom"], 1);
        assert!(frame.get("judgeLineList").is_none());
    }

    #[test]
    fn pez_open_reads_only_the_selected_chart_entry() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.pez");
        let chart = br#"{"META":{"name":"Song"},"BPMList":[],"judgeLineList":[{"Name":"L"}]}"#;
        {
            let mut writer = ZipWriter::new(fs::File::create(&path).unwrap());
            let options = SimpleFileOptions::default();
            writer.start_file("info.txt", options).unwrap();
            writer.write_all(b"Chart: chart.json\n").unwrap();
            writer.start_file("chart.json", options).unwrap();
            writer.write_all(chart).unwrap();
            writer.start_file("song.ogg", options).unwrap();
            writer.write_all(b"audio").unwrap();
            writer.start_file("cover.png", options).unwrap();
            writer.write_all(b"image").unwrap();
            writer.finish().unwrap();
        }

        let (name, bytes, entries, info) = read_pez_chart(&path, |_, _| {}).unwrap();

        assert_eq!(name, "chart.json");
        assert_eq!(bytes.as_slice(), chart.as_slice());
        assert!(info.unwrap().contains("Chart: chart.json"));
        assert!(entries.iter().any(|entry| entry.name == "song.ogg"));
        assert!(entries.iter().any(|entry| entry.name == "cover.png"));
    }

    #[test]
    fn pez_info_selects_one_of_multiple_charts() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.pez");
        {
            let mut writer = ZipWriter::new(fs::File::create(&path).unwrap());
            let options = SimpleFileOptions::default();
            writer.start_file("info.txt", options).unwrap();
            writer.write_all(b"Chart: b.json\n").unwrap();
            for name in ["a.json", "b.json"] {
                writer.start_file(name, options).unwrap();
                writer
                    .write_all(br#"{"META":{},"judgeLineList":[]}"#)
                    .unwrap();
            }
            writer.finish().unwrap();
        }

        let (name, _, _, _) = read_pez_chart(&path, |_, _| {}).unwrap();
        assert_eq!(name, "b.json");
    }

    #[test]
    fn pez_open_reports_ambiguous_packages() {
        let root = tempdir().unwrap();
        let path = root.path().join("chart.pez");
        {
            let mut writer = ZipWriter::new(fs::File::create(&path).unwrap());
            let options = SimpleFileOptions::default();
            for name in ["a.json", "b.json"] {
                writer.start_file(name, options).unwrap();
                writer
                    .write_all(br#"{"META":{},"judgeLineList":[]}"#)
                    .unwrap();
            }
            writer.finish().unwrap();
        }

        let error = match read_pez_chart(&path, |_, _| {}) {
            Ok(_) => panic!("expected an ambiguous package to fail"),
            Err(error) => error,
        };
        assert!(error.contains("multiple charts"));
        assert!(error.contains("a.json"));
        assert!(error.contains("b.json"));
    }
}
