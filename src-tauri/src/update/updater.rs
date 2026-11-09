//! Signed in-app updates and the pre-update data snapshot.
//!
//! The release repository and public key are runtime settings, so each request
//! builds an updater with explicit endpoints. The Tauri updater verifies the
//! package signature before the NSIS installer is launched; this module never
//! executes an unverified download.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
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
    /// Detached signature text kept separately for a portable payload loaded
    /// from the launch cache, which has no `Update` metadata.
    portable_signature: Option<String>,
    backup: Option<String>,
    resources: Option<crate::update::update_guard::ResourceSnapshot>,
}

/// Directory below the data root that keeps one verified download between launches.
const CACHE_DIR: &str = "update-cache";
/// Cached payload bytes.
const CACHE_PAYLOAD: &str = "payload.bin";
/// Cached base64 signature text for the payload.
const CACHE_SIGNATURE: &str = "payload.sig";
/// Cached release metadata.
const CACHE_META: &str = "meta.json";

/// Cached release metadata shared with the frontend at launch.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedUpdateInfo {
    pub version: String,
    pub tag: String,
    #[serde(default)]
    pub prerelease: bool,
    /// `installer` or `portable`.
    pub kind: String,
}

/// One authenticated cached package ready to become a prepared update.
struct CachedUpdate {
    info: CachedUpdateInfo,
    kind: PreparedKind,
    bytes: Vec<u8>,
    signature: String,
}

/// Compare release versions after stripping a tag prefix; equal strings otherwise.
fn same_version(left: &str, right: &str) -> bool {
    let parse =
        |value: &str| semver::Version::parse(value.trim().trim_start_matches(['v', 'V'])).ok();
    if let (Some(left_version), Some(right_version)) = (parse(left), parse(right)) {
        left_version == right_version
    } else {
        left.trim() == right.trim()
    }
}

/// Name one prepared kind in cache metadata.
fn cache_kind_name(kind: PreparedKind) -> &'static str {
    match kind {
        PreparedKind::Installer => "installer",
        PreparedKind::Portable => "portable",
    }
}

/// Parse one cache metadata kind.
fn cache_kind(value: &str) -> Option<PreparedKind> {
    match value {
        "installer" => Some(PreparedKind::Installer),
        "portable" => Some(PreparedKind::Portable),
        _ => None,
    }
}

/// Path of the launch cache below one data root.
fn cache_dir(data: &Path) -> PathBuf {
    data.join(CACHE_DIR)
}

/// Remove the cached package and its metadata.
fn remove_cache(data: &Path) {
    let _ = fs::remove_dir_all(cache_dir(data));
}

/// Replace a cache file through a sibling temporary file.
fn write_cache_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| "The update cache path has no file name.".to_owned())?;
    let temporary = path.with_file_name(format!("{}.tmp", name.to_string_lossy()));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    let renamed = fs::rename(&temporary, path);
    if renamed.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    renamed.map_err(|error| error.to_string())
}

/// Keep one verified download so the next launch can prompt without fetching it again.
fn write_cache(
    data: &Path,
    kind: PreparedKind,
    version: &str,
    tag: &str,
    prerelease: bool,
    bytes: &[u8],
    signature: &str,
) -> Result<(), String> {
    // Only the Windows host can apply a cached payload without the live
    // `Update` metadata that Tauri's installer path requires on other hosts.
    if !cfg!(windows) {
        return Ok(());
    }
    let directory = cache_dir(data);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let info = CachedUpdateInfo {
        version: version.to_owned(),
        tag: tag.to_owned(),
        prerelease,
        kind: cache_kind_name(kind).to_owned(),
    };
    write_cache_file(&directory.join(CACHE_PAYLOAD), bytes)?;
    write_cache_file(&directory.join(CACHE_SIGNATURE), signature.as_bytes())?;
    let meta = serde_json::to_vec_pretty(&info).map_err(|error| error.to_string())?;
    write_cache_file(&directory.join(CACHE_META), &meta)
}

/// Read and authenticate the cached package for this build and data root.
///
/// Missing, stale, malformed, or unauthenticated entries are removed so a cache
/// can never outlive a successful update or survive a failed signature check.
fn read_cache(data: &Path, key: &str, current: &str) -> Option<CachedUpdate> {
    if !cfg!(windows) {
        return None;
    }
    let directory = cache_dir(data);
    let info = match crate::storage::read_json::<CachedUpdateInfo>(&directory.join(CACHE_META)) {
        Some(info) => info,
        None => {
            remove_cache(data);
            return None;
        }
    };
    let kind = match cache_kind(&info.kind) {
        Some(kind) => kind,
        None => {
            remove_cache(data);
            return None;
        }
    };
    let bytes = match crate::update::local_update::read_bounded(
        &directory.join(CACHE_PAYLOAD),
        crate::update::local_update::MAX_INSTALLER_BYTES,
    ) {
        Ok(bytes) => bytes,
        Err(_) => {
            remove_cache(data);
            return None;
        }
    };
    let signature = match crate::update::local_update::read_bounded(
        &directory.join(CACHE_SIGNATURE),
        crate::update::local_update::MAX_SIGNATURE_BYTES,
    )
    .ok()
    .and_then(|bytes| String::from_utf8(bytes).ok())
    {
        Some(signature) => signature,
        None => {
            remove_cache(data);
            return None;
        }
    };
    let verified = match kind {
        PreparedKind::Installer => {
            crate::update::local_update::verify(&bytes, signature.as_bytes(), key, current)
                .map(|info| info.version)
        }
        PreparedKind::Portable => {
            crate::update::local_update::verify_payload(&bytes, signature.as_bytes(), key, current)
        }
    };
    match verified {
        Ok(version) if same_version(&version, &info.version) => Some(CachedUpdate {
            info,
            kind,
            bytes,
            signature,
        }),
        _ => {
            remove_cache(data);
            None
        }
    }
}

/// Keep one completed download for the next launch without failing the current one.
fn keep_cached_download(
    app: &AppHandle,
    kind: PreparedKind,
    version: &str,
    tag: &str,
    prerelease: bool,
    bytes: &[u8],
    signature: &str,
) {
    let Ok(data) = crate::storage::data_dir(app) else {
        return;
    };
    if let Err(error) = write_cache(&data, kind, version, tag, prerelease, bytes, signature) {
        eprintln!("Could not cache the downloaded update package: {error}");
    }
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
    prerelease: bool,
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
    let cache_tag = tag.clone().unwrap_or_default();

    // Windows prefers the signed portable payload: it replaces files in place
    // on exit instead of running the NSIS installer. A missing or broken
    // manifest falls back to the installer endpoint.
    #[cfg(windows)]
    if let Ok(endpoint) = portable_endpoint_for(&repo, tag.as_deref()) {
        if let Ok((update, bytes)) = download_release(&app, endpoint, key).await {
            let version = update.version.clone();
            let signature = update.signature.clone();
            keep_cached_download(
                &app,
                PreparedKind::Portable,
                &version,
                &cache_tag,
                prerelease,
                &bytes,
                &signature,
            );
            *host.prepared.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
                id: uuid::Uuid::new_v4(),
                kind: PreparedKind::Portable,
                update: Some(update),
                version: version.clone(),
                bytes,
                signature: None,
                portable_signature: Some(signature),
                backup: None,
                resources: None,
            });
            return Ok(version);
        }
    }

    let endpoint = endpoint_for(&repo, tag.as_deref())?;
    let (update, bytes) = download_release(&app, endpoint, key).await?;
    let version = update.version.clone();
    let signature_text = update.signature.clone();
    let signature = signature_text.as_bytes().to_vec();
    keep_cached_download(
        &app,
        PreparedKind::Installer,
        &version,
        &cache_tag,
        prerelease,
        &bytes,
        &signature_text,
    );
    *host.prepared.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
        id: uuid::Uuid::new_v4(),
        kind: PreparedKind::Installer,
        update: Some(update),
        version: version.clone(),
        bytes,
        signature: Some(signature),
        portable_signature: None,
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

/// Load the authenticated download kept from the previous launch, if one is newer.
#[tauri::command]
pub async fn update_restore_cached(
    app: AppHandle,
    host: State<'_, UpdateHost>,
) -> Result<Option<CachedUpdateInfo>, String> {
    let store = host.prepared.clone();
    let data = crate::storage::data_dir(&app)?;
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(cached) = read_cache(&data, UPDATE_PUBLIC_KEY.trim(), &current) else {
            return Ok(None);
        };
        let info = cached.info.clone();
        let signature = cached.signature.clone();
        *store.lock().map_err(|error| error.to_string())? = Some(PreparedUpdate {
            id: uuid::Uuid::new_v4(),
            kind: cached.kind,
            update: None,
            version: info.version.clone(),
            bytes: cached.bytes,
            signature: Some(signature.as_bytes().to_vec()),
            portable_signature: Some(signature),
            backup: None,
            resources: None,
        });
        Ok(Some(info))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Drop the cached package for one version, including its prepared in-memory copy.
#[tauri::command]
pub fn update_cached_remove(
    app: AppHandle,
    host: State<'_, UpdateHost>,
    version: String,
) -> Result<(), String> {
    let data = crate::storage::data_dir(&app)?;
    let directory = cache_dir(&data);
    let cached = crate::storage::read_json::<CachedUpdateInfo>(&directory.join(CACHE_META));
    if cached.is_some_and(|info| same_version(&info.version, &version)) {
        remove_cache(&data);
        let mut prepared = host.prepared.lock().map_err(|error| error.to_string())?;
        if prepared
            .as_ref()
            .is_some_and(|item| same_version(&item.version, &version))
        {
            *prepared = None;
        }
    }
    Ok(())
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
            portable_signature: None,
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
                .portable_signature
                .or_else(|| {
                    prepared
                        .update
                        .as_ref()
                        .map(|update| update.signature.clone())
                })
                .ok_or("No verified portable update.")?;
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

    #[test]
    fn cache_version_matching_ignores_a_tag_prefix() {
        assert!(same_version("v2.0.0", "2.0.0"));
        assert!(same_version("V2.0.0", "2.0.0"));
        assert!(!same_version("2.0.0", "2.0.1"));
        assert!(!same_version("not-a-version", "2.0.0"));
    }

    // These fixtures are a synthetic PE stub signed with a disposable test key.
    // The launch cache is a Windows-only install path.
    #[cfg(windows)]
    const CACHE_KEY: &str =
        include_str!("../../../src/test/fixtures/signed-update/test-public.key");
    #[cfg(windows)]
    const CACHE_FILE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/installer.fixture");
    #[cfg(windows)]
    const CACHE_SIGNATURE: &[u8] =
        include_bytes!("../../../src/test/fixtures/signed-update/installer.fixture.sig");

    /// Decode the fixture signature as the base64 text the updater emits.
    #[cfg(windows)]
    fn cache_signature() -> &'static str {
        std::str::from_utf8(CACHE_SIGNATURE).expect("fixture signature is text")
    }

    #[cfg(windows)]
    #[test]
    fn cached_installer_round_trips_for_the_next_launch() {
        let data = tempfile::tempdir().unwrap();
        write_cache(
            data.path(),
            PreparedKind::Installer,
            "2.0.0",
            "v2.0.0",
            false,
            CACHE_FILE,
            cache_signature(),
        )
        .unwrap();

        let cached = read_cache(data.path(), CACHE_KEY, "1.0.0").expect("verified cache");
        assert_eq!(cached.info.version, "2.0.0");
        assert_eq!(cached.info.tag, "v2.0.0");
        assert_eq!(cached.info.kind, "installer");
        assert_eq!(cached.bytes, CACHE_FILE);
        assert_eq!(cached.signature, cache_signature());
    }

    #[cfg(windows)]
    #[test]
    fn cached_portable_payload_uses_the_signed_bytes() {
        let data = tempfile::tempdir().unwrap();
        write_cache(
            data.path(),
            PreparedKind::Portable,
            "2.0.0",
            "v2.0.0",
            true,
            CACHE_FILE,
            cache_signature(),
        )
        .unwrap();

        let cached = read_cache(data.path(), CACHE_KEY, "1.0.0").expect("verified cache");
        assert_eq!(cached.info.kind, "portable");
        assert!(cached.info.prerelease);
    }

    #[cfg(windows)]
    #[test]
    fn stale_cache_is_removed_after_the_update_lands() {
        let data = tempfile::tempdir().unwrap();
        write_cache(
            data.path(),
            PreparedKind::Installer,
            "2.0.0",
            "v2.0.0",
            false,
            CACHE_FILE,
            cache_signature(),
        )
        .unwrap();

        assert!(read_cache(data.path(), CACHE_KEY, "2.0.0").is_none());
        assert!(!cache_dir(data.path()).exists());
    }

    #[cfg(windows)]
    #[test]
    fn tampered_cache_is_removed_instead_of_being_offered() {
        let data = tempfile::tempdir().unwrap();
        write_cache(
            data.path(),
            PreparedKind::Installer,
            "2.0.0",
            "v2.0.0",
            false,
            CACHE_FILE,
            cache_signature(),
        )
        .unwrap();
        let payload = cache_dir(data.path()).join(CACHE_PAYLOAD);
        let mut bytes = fs::read(&payload).unwrap();
        bytes[100] ^= 1;
        fs::write(&payload, bytes).unwrap();

        assert!(read_cache(data.path(), CACHE_KEY, "1.0.0").is_none());
        assert!(!cache_dir(data.path()).exists());
    }
}
