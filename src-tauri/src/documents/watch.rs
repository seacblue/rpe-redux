//! Watches a document and its resource folders for external edits and emits the
//! disk-change event the frontend uses to offer reload or retain.

use super::{
    document, error, normalize_resource_name, reference_is_absolute, Document, DocumentHost,
    Result, MAX_SNAPSHOT_FILE_BYTES,
};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs::File, io::Read, path::PathBuf};
use tauri::{AppHandle, Emitter, State};

/// Event emitted when a watched document or resource changes on disk.
pub const DOCUMENT_DISK_CHANGE_EVENT: &str = "redux-document-disk-change";

/// Payload of [`DOCUMENT_DISK_CHANGE_EVENT`].
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDiskChange {
    pub document_id: String,
}

/// Every unique directory that holds the chart or one of its resources.
fn file_roots(document: &Document) -> BTreeSet<PathBuf> {
    let mut roots = BTreeSet::new();
    if let Some(parent) = document.path.parent() {
        roots.insert(parent.to_path_buf());
    }
    for path in document.resources.values() {
        if let Some(parent) = path.parent() {
            roots.insert(parent.to_path_buf());
        }
    }
    roots.retain(|path| path.is_dir());
    roots
}

/// Feed one file's name, length, and bytes into the snapshot hash.
///
/// The file is streamed in fixed-size chunks so a large chart or resource does
/// not have to fit in memory.
fn append_file(hasher: &mut Sha256, name: &str, path: &std::path::Path) -> Result<()> {
    hasher.update((name.len() as u64).to_le_bytes());
    hasher.update(name.as_bytes());
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            hasher.update([0]);
            return Ok(());
        }
        Err(error) => return Err(super::error(error)),
    };
    let length = file.metadata().map_err(super::error)?.len();
    if length > MAX_SNAPSHOT_FILE_BYTES {
        return Err("document_snapshot_too_large".into());
    }
    hasher.update([1]);
    hasher.update(length.to_le_bytes());
    let mut buffer = [0u8; 64 * 1024];
    let mut read_total = 0u64;
    loop {
        let read = file.read(&mut buffer).map_err(super::error)?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(read as u64)
            .ok_or("document_snapshot_too_large")?;
        if read_total > MAX_SNAPSHOT_FILE_BYTES {
            return Err("document_snapshot_too_large".into());
        }
        hasher.update(&buffer[..read]);
    }
    Ok(())
}

/// Hash the chart and its resources, or the complete package when packed.
pub(crate) fn disk_snapshot(document: &Document) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(b"rpe-redux-disk-v1\0");
    if document.packed {
        append_file(&mut hasher, "package", &document.path)?;
    } else {
        append_file(&mut hasher, "chart", &document.path)?;
        let resources = document
            .resources
            .iter()
            .map(|(name, path)| (name.as_str(), path))
            .collect::<BTreeSet<_>>();
        for (name, path) in resources {
            // Project resources must still be normalized before they are
            // hashed. Absolute keys are explicit per-document external grants.
            if !reference_is_absolute(name) {
                normalize_resource_name(name)?;
            }
            append_file(&mut hasher, name, path)?;
        }
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

/// Whether an event kind can change document content.
fn relevant_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

/// Watch the document's folders non-recursively and store the watcher for `id`.
pub(crate) fn watch_document(
    app: &AppHandle,
    state: &DocumentHost,
    id: &str,
    document: &Document,
) -> Result<()> {
    let event_app = app.clone();
    let document_id = id.to_owned();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            if result.as_ref().is_ok_and(relevant_event) {
                let _ = event_app.emit(
                    DOCUMENT_DISK_CHANGE_EVENT,
                    DocumentDiskChange {
                        document_id: document_id.clone(),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(error)?;
    for root in file_roots(document) {
        watcher
            .watch(&root, RecursiveMode::NonRecursive)
            .map_err(error)?;
    }
    state
        .watchers
        .lock()
        .map_err(error)?
        .insert(id.to_owned(), watcher);
    Ok(())
}

/// Current content snapshot of one open document.
#[tauri::command]
pub fn document_disk_snapshot(state: State<'_, DocumentHost>, id: String) -> Result<String> {
    disk_snapshot(&document(&state, &id)?)
}

#[cfg(test)]
mod tests {
    use super::disk_snapshot;
    use crate::documents::Document;
    use std::{collections::HashMap, fs, path::PathBuf};
    use tempfile::tempdir;

    fn document(path: PathBuf, packed: bool, resources: HashMap<String, PathBuf>) -> Document {
        Document {
            path,
            chart_name: "chart.json".into(),
            packed,
            resources,
        }
    }

    #[test]
    fn directory_snapshot_tracks_chart_and_referenced_resources_only() {
        let root = tempdir().unwrap();
        let chart = root.path().join("chart.json");
        let song = root.path().join("song.ogg");
        let unrelated = root.path().join("notes.txt");
        fs::write(&chart, b"chart-v1").unwrap();
        fs::write(&song, b"song-v1").unwrap();
        fs::write(&unrelated, b"unrelated-v1").unwrap();
        let mut resources = HashMap::new();
        resources.insert("song.ogg".into(), song.clone());
        let document = document(chart.clone(), false, resources);

        let first = disk_snapshot(&document).unwrap();
        assert_eq!(first, disk_snapshot(&document).unwrap());
        fs::write(&unrelated, b"unrelated-v2").unwrap();
        assert_eq!(first, disk_snapshot(&document).unwrap());
        fs::write(&song, b"song-v2").unwrap();
        assert_ne!(first, disk_snapshot(&document).unwrap());
        fs::write(&chart, b"chart-v2").unwrap();
        assert_ne!(first, disk_snapshot(&document).unwrap());
    }

    #[test]
    fn package_snapshot_tracks_the_complete_package() {
        let root = tempdir().unwrap();
        let package = root.path().join("chart.pez");
        fs::write(&package, b"package-v1").unwrap();
        let document = document(package.clone(), true, HashMap::new());
        let first = disk_snapshot(&document).unwrap();
        fs::write(&package, b"package-v2").unwrap();
        assert_ne!(first, disk_snapshot(&document).unwrap());
    }
}
