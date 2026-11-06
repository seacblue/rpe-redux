//! Signed in-app updates and the pre-update data snapshot.
//!
//! The release repository and public key are runtime settings, so each request
//! builds an updater with explicit endpoints. The Tauri updater verifies the
//! package signature before the NSIS installer is launched; this module never
//! executes an unverified download.

use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Download progress emitted on `redux-update-progress`.
#[derive(Clone, Serialize)]
struct UpdateProgress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

/// Pre-update data snapshot returned to the frontend.
#[derive(Serialize)]
pub struct UpdateBackup {
    pub path: String,
}

/// Verified bytes remain in the host until the frontend completes its final checks.
#[derive(Default)]
pub struct UpdateHost {
    prepared: Arc<Mutex<Option<PreparedUpdate>>>,
}

/// Which handoff applies one verified update.
#[derive(Clone, Copy, PartialEq, Eq)]
enum PreparedKind {
    /// Run the signed NSIS/AppImage installer.
    Installer,
    /// Replace the installation files in place from a signed portable ZIP.
    #[cfg_attr(not(windows), allow(dead_code))]
    Portable,
}

/// Verified release or local installer held until the frontend installs it.
struct PreparedUpdate {
    id: uuid::Uuid,
    kind: PreparedKind,
    update: Option<Update>,
    version: String,
    bytes: Vec<u8>,
    signature: Option<Vec<u8>>,
    backup: Option<String>,
    resources: Option<crate::update::update_guard::ResourceSnapshot>,
}

/// Whether a GitHub owner or repository component is safe to place in a URL.
fn valid_github_component(value: &str) -> bool {
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
}

/// Normalise `owner/repo` or its GitHub URL form.
fn normalize_repo(repo: &str) -> Result<String, String> {
    let trimmed = repo.trim().trim_end_matches('/');
    let trimmed = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .unwrap_or(trimmed);
    let parts: Vec<&str> = trimmed.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() != 2 || parts.iter().any(|part| !valid_github_component(part)) {
        return Err("Update repository must be a GitHub owner/repository pair.".to_owned());
    }
    Ok(format!("{}/{}", parts[0], parts[1]))
}

/// Whether a release tag contains only URL-safe characters.
fn valid_tag(tag: &str) -> bool {
    !tag.is_empty() && valid_github_component(tag)
}

/// Public key compiled into the binary. The renderer may display a matching
/// value, but it must never choose the trust anchor: a compromised renderer
/// could otherwise install a package signed with an attacker-controlled key.
pub(crate) const UPDATE_PUBLIC_KEY: &str = match option_env!("REDUX_UPDATE_PUBLIC_KEY") {
    Some(value) => value,
    None => "",
};

/// Build the `latest.json` endpoint for a tagged or latest release.
fn endpoint_for(repo: &str, tag: Option<&str>) -> Result<tauri::Url, String> {
    endpoint_for_manifest(repo, tag, "latest.json")
}

/// Build the portable ZIP manifest endpoint for a tagged or latest release.
fn portable_endpoint_for(repo: &str, tag: Option<&str>) -> Result<tauri::Url, String> {
    endpoint_for_manifest(repo, tag, "redux-latest.json")
}

/// Build one signed-manifest endpoint for a tagged or latest release.
fn endpoint_for_manifest(
    repo: &str,
    tag: Option<&str>,
    manifest: &str,
) -> Result<tauri::Url, String> {
    let repo = normalize_repo(repo)?;
    let url = match tag.map(str::trim).filter(|value| !value.is_empty()) {
        Some(tag) if valid_tag(tag) => {
            format!("https://github.com/{repo}/releases/download/{tag}/{manifest}")
        }
        Some(_) => return Err("Update release tag contains unsupported characters.".to_owned()),
        None => format!("https://github.com/{repo}/releases/latest/download/{manifest}"),
    };
    tauri::Url::parse(&url).map_err(|error| error.to_string())
}

/// Snapshot durable data only for the verified release held by the host.
#[tauri::command]
pub async fn update_prepare(
    app: AppHandle,
    host: State<'_, UpdateHost>,
    to_version: String,
) -> Result<UpdateBackup, String> {
    let store = host.prepared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared_id = {
            let guard = store.lock().map_err(|error| error.to_string())?;
            let prepared = guard.as_ref().ok_or("No verified update is ready.")?;
            if prepared.version != to_version {
                return Err("The verified update version changed.".into());
            }
            prepared.id
        };
        let roots = crate::update::update_guard::user_roots()?;
        let resources = crate::update::update_guard::snapshot(&roots)?;
        let from_version = app.package_info().version.to_string();
        let path = crate::storage::backup::create_update_backup(&app, &from_version, &to_version)?;
        crate::update::update_guard::verify(&resources, &roots)?;
        let mut guard = store.lock().map_err(|error| error.to_string())?;
        let prepared = guard.as_mut().ok_or("No verified update is ready.")?;
        if prepared.version != to_version || prepared.id != prepared_id {
            return Err("The verified update changed during preparation.".into());
        }
        prepared.backup = Some(path.clone());
        prepared.resources = Some(resources);
        Ok(UpdateBackup { path })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Download and verify a release without starting the installer.
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    host: State<'_, UpdateHost>,
    repo: String,
    public_key: String,
    tag: Option<String>,
) -> Result<String, String> {
    let key = UPDATE_PUBLIC_KEY.trim();
    if key.is_empty() {
        return Err("Configure the updater public key before installing an update.".to_owned());
    }
    // The build owns the trust anchor. Reject a renderer that tries to replace
    // it, even if the caller-supplied value is well-formed.
    if !public_key.trim().is_empty() && public_key.trim() != key {
        return Err("The updater public key does not match this build.".to_owned());
    }

    // Windows prefers the signed portable payload: it replaces files in place
    // on exit instead of running the NSIS installer. A missing or broken
    // manifest falls back to the installer endpoint.
    #[cfg(windows)]
    if let Ok(endpoint) = portable_endpoint_for(&repo, tag.as_deref()) {
        if let Ok((update, bytes)) = download_release(&app, endpoint, key).await {
            let version = update.version.clone();
            *host.prepared.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
                id: uuid::Uuid::new_v4(),
                kind: PreparedKind::Portable,
                update: Some(update),
                version: version.clone(),
                bytes,
                signature: None,
                backup: None,
                resources: None,
            });
            return Ok(version);
        }
    }

    let endpoint = endpoint_for(&repo, tag.as_deref())?;
    let (update, bytes) = download_release(&app, endpoint, key).await?;
    let version = update.version.clone();
    let signature = update.signature.as_bytes().to_vec();
    *host.prepared.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
        id: uuid::Uuid::new_v4(),
        kind: PreparedKind::Installer,
        update: Some(update),
        version: version.clone(),
        bytes,
        signature: Some(signature),
        backup: None,
        resources: None,
    });
    Ok(version)
}

/// Check and download one signed manifest release, reporting byte progress.
async fn download_release(
    app: &AppHandle,
    endpoint: tauri::Url,
    key: &str,
) -> Result<(Update, Vec<u8>), String> {
    let exit_handle = app.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .pubkey(key)
        .timeout(Duration::from_secs(60))
        .on_before_exit(move || {
            // The updater exits the process directly; stop the sidecar so the
            // installer can replace it, and save the window before the handoff.
            crate::services::server::stop(&exit_handle);
            if let Some(window) = exit_handle.get_webview_window("main") {
                crate::app::window_state::save(&exit_handle, &window);
            }
        })
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No newer signed release is available at the update endpoint.".to_owned())?;
    let progress_handle = app.clone();
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_handle.emit(
                    "redux-update-progress",
                    UpdateProgress {
                        phase: "downloading",
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok((update, bytes))
}

/// Authenticate a selected installer and hold its exact verified bytes for handoff.
#[tauri::command]
pub async fn update_load_local(
    app: AppHandle,
    host: State<'_, UpdateHost>,
    token: State<'_, crate::app::ipc_guard::HostToken>,
    request: tauri::ipc::Request<'_>,
    path: String,
) -> Result<String, String> {
    crate::app::ipc_guard::HostToken::require(token.inner(), request.headers())?;
    if install_kind() == "portable" {
        return Err("local_update_portable".into());
    }
    let store = host.prepared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (info, bytes, signature) = crate::update::local_update::load_candidate(
            std::path::Path::new(&path),
            UPDATE_PUBLIC_KEY,
            &app.package_info().version.to_string(),
        )?;
        let version = info.version;
        *store.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
            id: uuid::Uuid::new_v4(),
            kind: PreparedKind::Installer,
            update: None,
            version: version.clone(),
            bytes,
            signature: Some(signature),
            backup: None,
            resources: None,
        });
        Ok(version)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Discard a verified download when preparation or final checks fail.
#[tauri::command]
pub fn update_discard(host: State<'_, UpdateHost>) -> Result<(), String> {
    *host.prepared.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}

/// Install only the previously verified bytes for the requested version.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    host: State<'_, UpdateHost>,
    version: String,
    restart: bool,
) -> Result<(), String> {
    let store = host.prepared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = store
            .lock()
            .map_err(|error| error.to_string())?
            .take()
            .ok_or("No verified update is ready.")?;
        if prepared.version != version {
            return Err("The verified update version changed.".into());
        }
        let backup = prepared.backup.ok_or("The update backup is not ready.")?;
        let resources = prepared
            .resources
            .ok_or("The update resource snapshot is not ready.")?;
        crate::update::update_guard::verify(
            &resources,
            &crate::update::update_guard::user_roots()?,
        )?;
        crate::app::migration::write_pending_update(
            &app,
            &app.package_info().version.to_string(),
            &version,
            &backup,
        )?;
        let _ = app.emit(
            "redux-update-progress",
            UpdateProgress {
                phase: "installing",
                downloaded: 0,
                total: None,
            },
        );
        if prepared.kind == PreparedKind::Portable {
            let signature = prepared
                .update
                .as_ref()
                .ok_or("No verified remote update.")?
                .signature
                .clone();
            let result = crate::update::local_update_worker::handoff_portable(
                &app,
                &version,
                &backup,
                resources,
                prepared.bytes,
                signature,
                restart,
            );
            if result.is_err() {
                crate::app::migration::clear_pending_update(&app, &version);
            }
            return result;
        }
        if prepared.update.is_none() {
            let signature = prepared.signature.ok_or("Missing local signature.")?;
            let result = crate::update::local_update_worker::handoff(
                &app,
                &version,
                &backup,
                resources,
                prepared.bytes,
                signature,
                restart,
            );
            if result.is_err() {
                crate::app::migration::clear_pending_update(&app, &version);
            }
            return result;
        }
        let update = prepared.update.ok_or("No verified remote update.")?;
        if !restart {
            let signature = prepared.signature.ok_or("Missing remote signature.")?;
            let result = crate::update::local_update_worker::handoff(
                &app,
                &version,
                &backup,
                resources,
                prepared.bytes,
                signature,
                false,
            );
            if result.is_err() {
                crate::app::migration::clear_pending_update(&app, &version);
            }
            return result;
        }
        match update.install(prepared.bytes) {
            Ok(()) => Ok(()),
            Err(error) => {
                crate::app::migration::clear_pending_update(&app, &version);
                match crate::services::server::start(&app) {
                    Ok(()) => Err(error.to_string()),
                    Err(restart) => Err(format!("{error}; backend restart failed: {restart}")),
                }
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Read and clear the result of an update that completed since the last launch.
#[tauri::command]
pub fn update_result(app: AppHandle) -> Option<crate::app::migration::UpdateApplied> {
    crate::app::migration::take_update_result(&app)
}

/// Distinguish the portable folder from a packaged installation.
#[tauri::command]
pub fn install_kind() -> String {
    if crate::storage::portable() {
        "portable".to_owned()
    } else {
        "installed".to_owned()
    }
}

/// Keep the Windows uninstall entry's display version in step with an in-place update.
///
/// The NSIS installer writes this value once. Portable ZIP updates replace the
/// application files without running NSIS, so the entry would otherwise keep
/// showing the version that performed the original install.
#[cfg(windows)]
pub fn refresh_installed_version(app: &AppHandle) {
    // Debug and unpacked builds can sit beside an installed copy; only a release
    // build running from the recorded install location owns that entry.
    if cfg!(debug_assertions) || crate::storage::portable() {
        return;
    }
    use winreg::{enums::KEY_SET_VALUE, RegKey};
    let name = app.package_info().name.clone();
    let path = format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{name}");
    let Ok(key) = RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(path, KEY_SET_VALUE)
    else {
        return;
    };
    let (Ok(exe), Ok(location)) = (
        std::env::current_exe(),
        key.get_value::<String, _>("InstallLocation"),
    ) else {
        return;
    };
    let Some(directory) = exe.parent() else {
        return;
    };
    let directory = directory.to_string_lossy();
    let directory = directory.trim_end_matches(['\\', '/']);
    let location = location.trim_matches('"');
    let location = location.trim_end_matches(['\\', '/']);
    if !directory.eq_ignore_ascii_case(location) {
        return;
    }
    let _ = key.set_value("DisplayVersion", &app.package_info().version.to_string());
}

/// Non-Windows hosts have no uninstall registry entry to refresh.
#[cfg(not(windows))]
pub fn refresh_installed_version(_: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_accepts_owner_and_url_forms() {
        assert_eq!(normalize_repo("acme/rpe").expect("slug"), "acme/rpe");
        assert_eq!(
            normalize_repo("https://github.com/acme/rpe/").expect("url"),
            "acme/rpe"
        );
        assert!(normalize_repo("acme").is_err());
        assert!(normalize_repo("acme/rpe/extra").is_err());
        assert!(normalize_repo("acme/r pe").is_err());
    }

    #[test]
    fn tag_validation_rejects_path_characters() {
        assert!(valid_tag("v1.0.0-a2"));
        assert!(!valid_tag(""));
        assert!(!valid_tag("v1/../../x"));
        assert!(!valid_tag("v1?x"));
    }
}
