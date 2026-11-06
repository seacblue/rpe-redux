//! Crash-recovery drafts: writes, lists, reads, and clears the SQLite rows the
//! editor offers after an unclean shutdown.
//!
//! Drafts are implementation data, not user files. They share `redux.db` with the
//! library and preferences, so no recovery directory is created and no draft is
//! listed on the files settings page.

use super::{
    decode_session_chunk, error, recovery_store, recovery_store::RecoveryDraftInput, save,
    AssetSource, ChartPayload, DocumentHost, RecoverySession, Result, MAX_CHART_BYTES,
};
use crate::storage::data_dir;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, State,
};
use zip::ZipArchive;

/// Recovery draft metadata sent at the start of a staged write.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryRequest {
    id: String,
    path: Option<String>,
    chart: Option<ChartPayload>,
    view_state: Value,
    limit: usize,
}

/// Start a recovery draft and return its session id.
///
/// The chart may already be parsed, or arrive later through
/// [`write_recovery_chart`]; resources are staged in a temporary directory until
/// [`finish_recovery`] commits the draft.
#[tauri::command]
pub async fn begin_recovery(
    state: State<'_, DocumentHost>,
    request: RecoveryRequest,
) -> Result<String> {
    let RecoveryRequest {
        id,
        path,
        chart,
        view_state,
        limit,
    } = request;
    // Large charts arrive as JSON text from the serializer worker, either once
    // here or through `write_recovery_chart` chunks. Parse them on a blocking
    // worker so the command executor stays free.
    let chart = match chart {
        Some(chart) => Some(
            tauri::async_runtime::spawn_blocking(move || chart.into_value())
                .await
                .map_err(error)??,
        ),
        None => None,
    };
    // Assets are staged outside application data until the draft is complete.
    // The temporary directory is removed with the session and never becomes a
    // user-visible recovery folder.
    let staging = tempfile::Builder::new()
        .prefix(".rpe-redux-recovery-")
        .tempdir()
        .map_err(error)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    state.recoveries.lock().map_err(error)?.insert(
        session_id.clone(),
        RecoverySession {
            id,
            path,
            chart,
            chart_bytes: Vec::new(),
            view_state,
            limit,
            staging,
            asset_names: Vec::new(),
            asset_bytes: 0,
        },
    );
    Ok(session_id)
}

/// Append one validated chart chunk to a recovery session.
fn stage_recovery_chart(session: &mut RecoverySession, chunk: &[u8]) -> Result<()> {
    if session.chart.is_some() {
        return Err("chart_chunks_not_allowed".into());
    }
    save::stage_chart_chunk(&mut session.chart_bytes, chunk)
}

/// Stage one validated resource for a recovery session.
fn stage_recovery_asset(session: &mut RecoverySession, name: &str, bytes: &[u8]) -> Result<()> {
    let root = session.staging.path().to_path_buf();
    save::stage_asset(&root, name, bytes, &mut session.asset_bytes)?;
    session.asset_names.push(name.to_owned());
    Ok(())
}

/// Append one raw chart-text chunk to a pending recovery session.
#[tauri::command]
pub fn write_recovery_chart(state: State<'_, DocumentHost>, request: Request<'_>) -> Result<()> {
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err("chart_chunks_binary_required".into()),
    };
    let (session_id, chunk) = decode_session_chunk(body)?;
    let mut recoveries = state.recoveries.lock().map_err(error)?;
    let session = recoveries
        .get_mut(&session_id)
        .ok_or("Recovery session does not exist or has ended.")?;
    stage_recovery_chart(session, chunk)
}

/// Stage one resource for a recovery session as binary IPC data.
#[tauri::command]
pub fn write_recovery_asset(state: State<'_, DocumentHost>, request: Request<'_>) -> Result<()> {
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.as_slice(),
        InvokeBody::Json(_) => return Err("Recovery resources must be sent as binary data.".into()),
    };
    let (session_id, name, bytes) = save::decode_save_asset(body)?;
    let mut recoveries = state.recoveries.lock().map_err(error)?;
    let session = recoveries
        .get_mut(&session_id)
        .ok_or("Recovery session does not exist or has ended.")?;
    stage_recovery_asset(session, &name, bytes)
}

/// Commit a staged recovery session into the database.
#[tauri::command]
pub async fn finish_recovery(
    app: AppHandle,
    state: State<'_, DocumentHost>,
    session_id: String,
) -> Result<()> {
    let session = state
        .recoveries
        .lock()
        .map_err(error)?
        .remove(&session_id)
        .ok_or("Recovery session does not exist or has ended.")?;
    let RecoverySession {
        id,
        path,
        chart,
        chart_bytes,
        view_state,
        limit,
        staging,
        asset_names,
        asset_bytes: _,
    } = session;
    tauri::async_runtime::spawn_blocking(move || {
        let chart = match chart {
            Some(chart) => chart,
            None => serde_json::from_slice(&chart_bytes)
                .map_err(|_| "invalid_save_chart".to_string())?,
        };
        let assets = AssetSource::Staged {
            root: staging.path(),
            names: &asset_names,
        };
        write_recovery_blocking(app, id, path, chart, assets, view_state, limit)
    })
    .await
    .map_err(error)??;
    Ok(())
}

/// Drop a staged recovery session and its temporary resources.
#[tauri::command]
pub fn cancel_recovery(state: State<'_, DocumentHost>, session_id: String) -> Result<()> {
    state.recoveries.lock().map_err(error)?.remove(&session_id);
    Ok(())
}

/// Write a complete recovery draft in one call.
#[tauri::command]
pub async fn write_recovery(
    app: AppHandle,
    id: String,
    path: Option<String>,
    chart: Value,
    updates: Vec<super::AssetUpdate>,
    view_state: Value,
    limit: usize,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let assets = AssetSource::Memory(&updates);
        write_recovery_blocking(app, id, path, chart, assets, view_state, limit)
    })
    .await
    .map_err(error)?
}

/// Serialize the draft and hand it to the recovery store.
fn write_recovery_blocking(
    app: AppHandle,
    id: String,
    path: Option<String>,
    chart: Value,
    assets: AssetSource<'_>,
    view_state: Value,
    limit: usize,
) -> Result<()> {
    let title = chart
        .get("META")
        .and_then(|meta| meta.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let chart_bytes = serde_json::to_vec(&chart).map_err(error)?;
    if chart_bytes.len() as u64 > MAX_CHART_BYTES {
        return Err("chart_too_large".into());
    }
    let view_bytes = serde_json::to_vec(&view_state).map_err(error)?;
    let mut total = 0u64;
    let mut asset_bytes = Vec::with_capacity(assets.names().len());
    for name in assets.names() {
        let bytes = assets
            .read(&name)?
            .ok_or_else(|| format!("Recovery asset is missing: {name}"))?;
        save::account_asset_bytes(bytes.len() as u64, &mut total)?;
        asset_bytes.push((name, bytes));
    }
    recovery_store::write(
        &app,
        RecoveryDraftInput {
            document_id: id,
            path,
            title,
            chart: chart_bytes,
            view_state: view_bytes,
            assets: asset_bytes,
            created_at: crate::storage::now_ms() as i64,
            limit,
        },
    )?;
    Ok(())
}

/// Draft summaries, newest first.
#[tauri::command]
pub fn list_recovery(app: AppHandle) -> Result<Vec<Value>> {
    recovery_store::list(&app)
}

/// Delete one recovery draft and its asset rows.
#[tauri::command]
pub fn delete_recovery(app: AppHandle, id: String) -> Result<bool> {
    recovery_store::delete(&app, &id)
}

/// Read one draft with its chart, view state, and asset bytes.
#[tauri::command]
pub fn read_recovery(app: AppHandle, id: String) -> Result<Value> {
    recovery_store::read(&app, &id)
}

/// Import file-backed drafts into SQLite, then remove the directory that held
/// them. A missing directory is the normal case; either way the startup cleanup
/// then prunes ownerless and surplus drafts and unreferenced blobs.
pub(crate) fn migrate_legacy(app: &AppHandle) -> Result<()> {
    let database = recovery_store::database_path(app)?;
    let root = data_dir(app)?.join("recovery");
    if !root.is_dir() {
        return cleanup(&database);
    }
    let mut manifests: Vec<PathBuf> = fs::read_dir(&root)
        .map_err(error)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path.extension().and_then(|extension| extension.to_str()) == Some("json")
        })
        .collect();
    manifests.sort();
    let mut failed = false;
    for manifest in manifests {
        match migrate_legacy_manifest(&root, &manifest, &database) {
            Ok(()) => {}
            Err(error) => {
                failed = true;
                eprintln!(
                    "Could not migrate recovery draft {}: {error}",
                    manifest.display()
                );
            }
        }
    }
    if !failed {
        // Remove only the staging directories this feature created. The directory
        // itself is removed only when empty, so an unknown file is never deleted.
        for entry in fs::read_dir(&root)
            .map_err(error)?
            .filter_map(|entry| entry.ok())
        {
            let path = entry.path();
            if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".rpe-redux-recovery-")
                {
                    let _ = fs::remove_dir_all(path);
                }
            } else if path.extension().and_then(|extension| extension.to_str()) == Some("pez") {
                let _ = fs::remove_file(path);
            }
        }
        let _ = fs::remove_dir(&root);
    }
    cleanup(&database)
}

/// Run the retention and orphan cleanup without blocking recovery import on a
/// storage failure; a stale row is better than a failed startup.
fn cleanup(database: &Path) -> Result<()> {
    let limit = recovery_store::stored_limit(database);
    if let Err(error) = recovery_store::cleanup_at(database, limit) {
        eprintln!("Could not clean recovery drafts: {error}");
    }
    Ok(())
}

/// Import one file-backed draft and delete its manifest and asset archive.
fn migrate_legacy_manifest(root: &Path, manifest_path: &Path, database: &Path) -> Result<()> {
    let created_at = manifest_path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(|| crate::storage::now_ms() as i64);
    let value: Value =
        serde_json::from_slice(&fs::read(manifest_path).map_err(error)?).map_err(error)?;
    let archive_name = value["assetsArchive"].as_str().map(str::to_owned);
    let project_id = value["projectId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            manifest_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    let path = value["path"].as_str().map(str::to_owned);
    let view_state = value.get("viewState").cloned().unwrap_or_else(|| json!({}));
    let mut assets = Vec::new();
    let mut chart = value.get("chart").cloned();
    if let Some(archive_name) = archive_name {
        save::save_zip_name(&archive_name)?;
        let archive_path = root.join(&archive_name);
        let mut archive =
            ZipArchive::new(File::open(&archive_path).map_err(error)?).map_err(error)?;
        let chart_entry = value["chartEntry"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| "chart.json".to_owned());
        save::save_zip_name(&chart_entry)?;
        let expects_chart_checkpoint = chart.as_ref().map_or(true, Value::is_null);
        let mut chart_loaded = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(error)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().map_err(error)?.into_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(error)?;
            if name == chart_entry {
                if expects_chart_checkpoint {
                    chart = Some(serde_json::from_slice(&bytes).map_err(error)?);
                    chart_loaded = true;
                }
                continue;
            }
            if name == "chart.json" && !expects_chart_checkpoint {
                continue;
            }
            assets.push((name, bytes));
        }
        if expects_chart_checkpoint && !chart_loaded {
            return Err("Recovery record is missing the chart checkpoint.".into());
        }
    }
    let chart = chart
        .filter(|value| !value.is_null())
        .ok_or("Recovery record is missing its chart.")?;
    let title = value["title"]
        .as_str()
        .filter(|title| !title.is_empty())
        .or_else(|| {
            chart
                .get("META")
                .and_then(|meta| meta.get("name"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_owned();
    recovery_store::write_at(
        database,
        RecoveryDraftInput {
            document_id: project_id,
            path,
            title,
            chart: serde_json::to_vec(&chart).map_err(error)?,
            view_state: serde_json::to_vec(&view_state).map_err(error)?,
            assets,
            created_at,
            limit: recovery_store::DEFAULT_LIMIT,
        },
    )?;
    fs::remove_file(manifest_path).map_err(error)?;
    if let Some(archive_name) = value["assetsArchive"].as_str() {
        let archive_path = root.join(archive_name);
        if archive_path.is_file() {
            fs::remove_file(archive_path).map_err(error)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{stage_recovery_asset, stage_recovery_chart, RecoverySession};
    use crate::documents::{MAX_CHART_BYTES, MAX_RESOURCE_BYTES, MAX_RESOURCE_TOTAL_BYTES};
    use serde_json::json;

    fn session() -> RecoverySession {
        RecoverySession {
            id: "draft".into(),
            path: None,
            chart: None,
            chart_bytes: Vec::new(),
            view_state: json!({}),
            limit: 10,
            staging: tempfile::tempdir().unwrap(),
            asset_names: Vec::new(),
            asset_bytes: 0,
        }
    }

    #[test]
    fn recovery_chart_chunks_share_the_save_cumulative_limit() {
        let mut session = session();
        let chunk = vec![0u8; super::save::CHART_CHUNK_BYTES];
        while session.chart_bytes.len() < MAX_CHART_BYTES as usize {
            stage_recovery_chart(&mut session, &chunk).unwrap();
        }
        assert_eq!(session.chart_bytes.len(), MAX_CHART_BYTES as usize);

        let error = stage_recovery_chart(&mut session, b"x").unwrap_err();

        assert_eq!(error, "chart_too_large");
        assert_eq!(session.chart_bytes.len(), MAX_CHART_BYTES as usize);
    }

    #[test]
    fn recovery_assets_share_the_save_size_limits() {
        let mut session = session();
        let error = stage_recovery_asset(&mut session, "CON", b"x").unwrap_err();
        assert_eq!(error, "unsafe_save_asset_path");
        assert_eq!(session.asset_bytes, 0);
        assert!(session.asset_names.is_empty());

        session.asset_bytes = MAX_RESOURCE_TOTAL_BYTES;
        let error = stage_recovery_asset(&mut session, "song.ogg", b"x").unwrap_err();
        assert_eq!(error, "save_assets_too_large");
        assert!(session.asset_names.is_empty());

        let mut total = 0;
        let error =
            super::save::account_asset_bytes(MAX_RESOURCE_BYTES + 1, &mut total).unwrap_err();
        assert_eq!(error, "save_asset_too_large");
        assert_eq!(total, 0);
    }
}
