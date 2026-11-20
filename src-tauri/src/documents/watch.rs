//! Watches a document and its resource folders for external edits and emits the
//! disk-change event the frontend uses to offer reload or retain.

use super::{
    document, error, normalize_resource_name, reference_is_absolute, Document, DocumentHost,
    Result, MAX_SNAPSHOT_FILE_BYTES,
};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, State};

/// Largest number of per-file digests retained by the snapshot cache.
const MAX_CACHED_FILES: usize = 4096;

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

/// One file's content digest and the metadata it was computed from.
#[derive(Clone, Copy, PartialEq, Eq)]
struct FileDigest {
    length: u64,
    digest: [u8; 32],
}

/// Cached digest retained only while the file's size and modification time
/// still match.
struct CachedDigest {
    length: u64,
    modified: Option<(u64, u32)>,
    digest: [u8; 32],
}

/// Per-file digests for document snapshots.
///
/// A snapshot probe runs after every save and on every watcher event. Media
/// files can be hundreds of megabytes, so re-reading them each time would turn
/// a cheap change check into seconds of disk I/O. A file is re-read only when
/// its size or modification time changed; the snapshot itself still changes
/// with content because it folds in the cached content digest.
#[derive(Default)]
struct SnapshotCache {
    entries: HashMap<PathBuf, CachedDigest>,
    #[cfg(test)]
    computed: usize,
}

/// Modification stamp with the platform's available precision.
fn modified_stamp(metadata: &fs::Metadata) -> Option<(u64, u32)> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| (duration.as_secs(), duration.subsec_nanos()))
}

impl SnapshotCache {
    /// Digest one existing file, reusing the cache when its metadata is unchanged.
    fn file_digest(&mut self, path: &Path, cacheable: bool) -> Result<Option<FileDigest>> {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.entries.remove(path);
                return Ok(None);
            }
            Err(error) => return Err(super::error(error)),
        };
        if !metadata.is_file() {
            return Err("document_snapshot_not_a_file".into());
        }
        let length = metadata.len();
        if length > MAX_SNAPSHOT_FILE_BYTES {
            return Err("document_snapshot_too_large".into());
        }
        let modified = modified_stamp(&metadata);
        if cacheable {
            if let Some(cached) = self.entries.get(path) {
                if cached.length == length && cached.modified == modified {
                    return Ok(Some(FileDigest {
                        length,
                        digest: cached.digest,
                    }));
                }
            }
        }
        let digest = hash_file(path)?;
        if cacheable {
            if self.entries.len() >= MAX_CACHED_FILES {
                self.entries.clear();
            }
            self.entries.insert(
                path.to_path_buf(),
                CachedDigest {
                    length,
                    modified,
                    digest,
                },
            );
            #[cfg(test)]
            {
                self.computed += 1;
            }
        }
        Ok(Some(FileDigest { length, digest }))
    }
}

/// Stream one file through SHA-256 without retaining its bytes.
fn hash_file(path: &Path) -> Result<[u8; 32]> {
    let mut file = File::open(path).map_err(super::error)?;
    let mut hasher = Sha256::new();
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
    Ok(hasher.finalize().into())
}

/// Feed one file's name, length, and content digest into the snapshot hash.
fn append_file(
    hasher: &mut Sha256,
    cache: &mut SnapshotCache,
    name: &str,
    path: &Path,
    cacheable: bool,
) -> Result<()> {
    hasher.update((name.len() as u64).to_le_bytes());
    hasher.update(name.as_bytes());
    match cache.file_digest(path, cacheable)? {
        Some(file) => {
            hasher.update([1]);
            hasher.update(file.length.to_le_bytes());
            hasher.update(file.digest);
        }
        None => hasher.update([0]),
    }
    Ok(())
}

/// Hash the chart and its resources, or the complete package when packed.
///
/// The chart is always read because it is the conflict baseline; resources use
/// the metadata-keyed digest cache so an unchanged song or video costs one stat
/// instead of a full re-read.
pub(crate) fn disk_snapshot(document: &Document) -> Result<String> {
    static CACHE: OnceLock<Mutex<SnapshotCache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(SnapshotCache::default()));
    let mut cache = cache
        .lock()
        .map_err(|_| "document_snapshot_cache_poisoned".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(b"rpe-redux-disk-v2\0");
    if document.packed {
        append_file(&mut hasher, &mut cache, "package", &document.path, true)?;
    } else {
        append_file(&mut hasher, &mut cache, "chart", &document.path, false)?;
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
            append_file(&mut hasher, &mut cache, name, path, true)?;
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
///
/// Hashing can read media files, so it runs on the blocking pool instead of the
/// IPC main thread.
#[tauri::command]
pub async fn document_disk_snapshot(state: State<'_, DocumentHost>, id: String) -> Result<String> {
    let document = document(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || disk_snapshot(&document))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{disk_snapshot, SnapshotCache};
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
        fs::write(&song, b"song-v2-with-more-bytes").unwrap();
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
        fs::write(&package, b"package-v2-with-more-bytes").unwrap();
        assert_ne!(first, disk_snapshot(&document).unwrap());
    }

    #[test]
    fn snapshot_cache_reuses_unchanged_file_digests() {
        let root = tempdir().unwrap();
        let video = root.path().join("video.mp4");
        fs::write(&video, vec![7u8; 128 * 1024]).unwrap();
        let mut cache = SnapshotCache::default();

        let first = cache.file_digest(&video, true).unwrap().unwrap();
        let second = cache.file_digest(&video, true).unwrap().unwrap();
        assert_eq!(cache.computed, 1);
        assert_eq!(first.digest, second.digest);

        fs::write(&video, vec![8u8; 64 * 1024]).unwrap();
        let third = cache.file_digest(&video, true).unwrap().unwrap();
        assert_eq!(cache.computed, 2);
        assert_ne!(first.digest, third.digest);
    }
}
