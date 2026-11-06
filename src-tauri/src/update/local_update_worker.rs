//! Background handoff for a verified local installer on Windows.
//!
//! A copied helper waits for the editor to exit, rechecks the resource snapshot,
//! authenticates the staged installer again, and invokes it without another UI.
use crate::update::portable_update::CandidateOutcome;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

/// The payload kind one helper request carries.
#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum HelperMode {
    /// A signed NSIS installer executed with `/S /UPDATE`.
    #[default]
    Installer,
    /// A signed portable ZIP applied in place over the install root.
    Portable,
}

/// Handoff specification written beside the helper executable.
#[derive(Serialize, Deserialize)]
struct HelperRequest {
    nonce: String,
    parent_pid: u32,
    /// Whether the helper should relaunch the editor after applying the update.
    #[serde(default = "default_restart")]
    restart: bool,
    #[serde(default)]
    mode: HelperMode,
    source_version: String,
    target_version: String,
    original_exe: PathBuf,
    data_dir: PathBuf,
    args: Vec<String>,
    roots: Vec<PathBuf>,
    resources: crate::update::update_guard::ResourceSnapshot,
}

/// Preserve the historical immediate-restart behavior for older staged requests.
fn default_restart() -> bool {
    true
}

/// Result of a background handoff that failed after the editor exited.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUpdateFailure {
    pub detail: String,
}

/// Record that lets the next launch confirm the helper and remove its stage.
#[derive(Serialize, Deserialize)]
struct HelperCleanup {
    stage: PathBuf,
    nonce: String,
    /// Version the replacement executable must report before health is accepted.
    #[serde(default)]
    target_version: String,
    /// Helper process whose exit must be observed before the stage is removed.
    #[serde(default)]
    helper_pid: u32,
}

/// How long the replacement executable must stay alive before it reports health.
const PORTABLE_HEALTH_DELAY: Duration = Duration::from_secs(5);
/// How long the helper waits for the replacement executable's health marker.
const PORTABLE_HEALTH_TIMEOUT: Duration = Duration::from_secs(120);
/// How long cleanup waits for the helper process to exit after the handshake.
const HELPER_EXIT_TIMEOUT: Duration = Duration::from_secs(120);

fn issue(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Whether the replacement executable left the matching health marker.
fn health_reported(stage: &Path, nonce: &str) -> bool {
    fs::read_to_string(stage.join("health"))
        .ok()
        .is_some_and(|value| value.trim() == nonce)
}

/// A failed health probe and the candidate stage it represents.
struct HealthFailure {
    outcome: CandidateOutcome,
    detail: String,
}

/// Wait for the replacement executable to report health or exit.
///
/// A launch that exits before writing the marker is unhealthy even when the
/// process itself started, so the caller restores the previous files.
fn wait_for_health(
    child: &mut Child,
    stage: &Path,
    nonce: &str,
    timeout: Duration,
) -> Result<(), HealthFailure> {
    let deadline = Instant::now() + timeout;
    loop {
        let status = child.try_wait().map_err(|error| HealthFailure {
            outcome: CandidateOutcome::ProbeFailed,
            detail: format!("could not query candidate executable: {error}"),
        })?;
        if health_reported(stage, nonce) {
            // The marker is only useful while the process that wrote it is alive.
            if let Some(status) = status {
                return Err(HealthFailure {
                    outcome: CandidateOutcome::ExitedAfterHealth,
                    detail: format!("candidate executable exited after health: {status}"),
                });
            }
            return Ok(());
        }
        if let Some(status) = status {
            return Err(HealthFailure {
                outcome: CandidateOutcome::ExitedBeforeHealth,
                detail: format!("candidate executable exited before health: {status}"),
            });
        }
        if Instant::now() >= deadline {
            return Err(HealthFailure {
                outcome: CandidateOutcome::HealthTimeout,
                detail: "candidate executable health check timed out".into(),
            });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Stop a candidate that did not report health so Windows releases its image
/// before the previous executable is restored.
fn stop_candidate(child: &mut Child) -> Result<(), String> {
    if child.try_wait().map_err(issue)?.is_some() {
        return Ok(());
    }
    child.kill().map_err(issue)?;
    child.wait().map_err(issue)?;
    Ok(())
}

/// Append an update diagnostic line to the data-root log.
///
/// The caller reports a failed write instead of discarding it, so a cleanup or
/// restore failure still leaves a trace when the failure record cannot be written.
fn record_update_log(data_root: &Path, detail: &str) -> Result<(), String> {
    let logs = data_root.join("logs");
    fs::create_dir_all(&logs).map_err(issue)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("update.log"))
        .map_err(issue)?;
    writeln!(file, "{detail}").map_err(issue)
}

/// Wait for a process to exit; returns false when it is still alive at the
/// deadline or the caller cannot prove that it exited.
#[cfg(windows)]
fn wait_for_process_exit(pid: u32, timeout: Duration) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject},
    };
    if pid == 0 {
        return false;
    }
    // A failed open means the process already exited.
    let handle = unsafe { OpenProcess(0x00100000, 0, pid) };
    if handle.is_null() {
        return true;
    }
    let timeout_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
    let waited = unsafe { WaitForSingleObject(handle, timeout_ms) };
    unsafe {
        CloseHandle(handle);
    }
    waited == 0
}

/// Non-Windows builds never run the helper, so a record can only be stale.
#[cfg(not(windows))]
fn wait_for_process_exit(pid: u32, _: Duration) -> bool {
    pid == 0
}

/// One verified payload waiting for the editor to exit.
enum StagedPayload {
    Installer { bytes: Vec<u8>, signature: Vec<u8> },
    Portable { bytes: Vec<u8>, signature: String },
}

/// The payload kind a helper has already authenticated.
#[derive(Clone, Copy)]
enum HelperPayload {
    Installer,
    Portable,
}

/// Start a helper copy and wait for its process-handle handshake.
///
/// Immediate installs close the editor here; deferred installs leave it running
/// while the helper waits for the normal application exit.
#[cfg(windows)]
pub fn handoff(
    app: &AppHandle,
    version: &str,
    backup: &str,
    resources: crate::update::update_guard::ResourceSnapshot,
    bytes: Vec<u8>,
    signature: Vec<u8>,
    restart: bool,
) -> Result<(), String> {
    spawn_handoff(
        app,
        version,
        backup,
        resources,
        StagedPayload::Installer { bytes, signature },
        restart,
    )
}

/// Apply a signed portable ZIP after the editor exits instead of running NSIS.
#[cfg(windows)]
pub fn handoff_portable(
    app: &AppHandle,
    version: &str,
    backup: &str,
    resources: crate::update::update_guard::ResourceSnapshot,
    bytes: Vec<u8>,
    signature: String,
    restart: bool,
) -> Result<(), String> {
    spawn_handoff(
        app,
        version,
        backup,
        resources,
        StagedPayload::Portable { bytes, signature },
        restart,
    )
}

/// Stage one verified payload and start the background helper.
#[cfg(windows)]
fn spawn_handoff(
    app: &AppHandle,
    version: &str,
    _backup: &str,
    resources: crate::update::update_guard::ResourceSnapshot,
    payload: StagedPayload,
    restart: bool,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let (mode, installer, installer_signature, portable, portable_signature) = match payload {
        StagedPayload::Installer { bytes, signature } => (
            HelperMode::Installer,
            Some(bytes),
            Some(signature),
            None,
            None,
        ),
        StagedPayload::Portable { bytes, signature } => (
            HelperMode::Portable,
            None,
            None,
            Some(bytes),
            Some(signature),
        ),
    };
    let staging = tempfile::Builder::new()
        .prefix("redux-update-")
        .tempdir()
        .map_err(issue)?;
    let original = std::env::current_exe().map_err(issue)?;
    let helper = staging.path().join("helper.exe");
    fs::copy(&original, &helper).map_err(issue)?;
    if let Some(bytes) = installer {
        fs::write(staging.path().join("installer.exe"), bytes).map_err(issue)?;
    }
    if let Some(signature) = installer_signature {
        fs::write(staging.path().join("installer.exe.sig"), signature).map_err(issue)?;
    }
    if let Some(bytes) = portable {
        fs::write(staging.path().join("payload.zip"), bytes).map_err(issue)?;
    }
    if let Some(signature) = portable_signature {
        fs::write(staging.path().join("payload.zip.sig"), signature).map_err(issue)?;
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    let spec = HelperRequest {
        nonce: nonce.clone(),
        parent_pid: std::process::id(),
        restart,
        mode,
        source_version: app.package_info().version.to_string(),
        target_version: version.to_owned(),
        original_exe: original,
        data_dir: crate::storage::data_dir(app)?,
        args: std::env::args_os()
            .skip(1)
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect(),
        roots: crate::update::update_guard::user_roots()?,
        resources,
    };
    fs::write(
        staging.path().join("request.json"),
        serde_json::to_vec(&spec).map_err(issue)?,
    )
    .map_err(issue)?;
    let mut child = Command::new(&helper)
        .arg("--redux-local-update-helper")
        .arg(staging.path())
        .arg(&nonce)
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(issue)?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if fs::read_to_string(staging.path().join("ready"))
            .ok()
            .as_deref()
            == Some(&nonce)
        {
            break;
        }
        if let Some(status) = child.try_wait().map_err(issue)? {
            let detail = fs::read_to_string(staging.path().join("helper-error"))
                .unwrap_or_else(|_| status.to_string());
            return Err(format!("local_update_helper_failed:{detail}"));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("local_update_helper_timeout".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let cleanup = HelperCleanup {
        stage: staging.path().to_path_buf(),
        nonce: nonce.clone(),
        target_version: version.to_owned(),
        helper_pid: child.id(),
    };
    if let Err(error) =
        crate::storage::write_json(&spec.data_dir.join("local-update-cleanup.json"), &cleanup)
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let _ = staging.keep();
    if restart {
        crate::services::server::stop(app);
        if let Some(window) = app.get_webview_window("main") {
            crate::app::window_state::save(app, &window);
        }
        app.exit(0);
    }
    Ok(())
}

/// Reject portable payload handoff on non-Windows hosts.
#[cfg(not(windows))]
pub fn handoff_portable(
    _: &AppHandle,
    _: &str,
    _: &str,
    _: crate::update::update_guard::ResourceSnapshot,
    _: Vec<u8>,
    _: String,
    _: bool,
) -> Result<(), String> {
    Err("portable_update_platform_invalid".into())
}

/// Reject local installer handoff on non-Windows hosts.
#[cfg(not(windows))]
pub fn handoff(
    _: &AppHandle,
    _: &str,
    _: &str,
    _: crate::update::update_guard::ResourceSnapshot,
    _: Vec<u8>,
    _: Vec<u8>,
    _: bool,
) -> Result<(), String> {
    Err("local_update_platform_invalid".into())
}

/// Run before Tauri startup only when invoked as an updater helper.
pub fn run_helper_if_requested() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--redux-local-update-helper")) {
        return false;
    }
    #[cfg(windows)]
    {
        if let (Some(stage), Some(nonce)) = (args.next(), args.next()) {
            let stage = Path::new(&stage);
            if let Err(error) = run_helper(stage, &nonce.to_string_lossy()) {
                // Write diagnostics only to a validated updater-owned temporary directory.
                if let (Ok(root), Ok(temp)) =
                    (stage.canonicalize(), std::env::temp_dir().canonicalize())
                {
                    if root.parent() == Some(temp.as_path())
                        && root
                            .file_name()
                            .is_some_and(|name| name.to_string_lossy().starts_with("redux-update-"))
                    {
                        if let Err(write) = fs::write(root.join("helper-error"), &error) {
                            eprintln!("Could not record helper error: {write}");
                        }
                    }
                }
            }
        }
    }
    true
}

/// Revalidate the staged request and installer, then run the installer silently.
#[cfg(windows)]
fn run_helper(stage: &Path, nonce: &str) -> Result<(), String> {
    use crate::update::portable_update::{candidate_failure, rollback_action, RollbackAction};
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, WaitForSingleObject},
    };
    let root = stage.canonicalize().map_err(issue)?;
    let temp = std::env::temp_dir().canonicalize().map_err(issue)?;
    if root.parent() != Some(temp.as_path())
        || !root
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("redux-update-"))
    {
        return Err("invalid updater stage".into());
    }
    let spec: HelperRequest =
        serde_json::from_slice(&fs::read(root.join("request.json")).map_err(issue)?)
            .map_err(issue)?;
    if spec.nonce != nonce {
        return Err("invalid updater token".into());
    }
    let original = spec.original_exe.canonicalize().map_err(issue)?;
    let expected_roots: Vec<_> = ["themes", "skins", "extensions"]
        .iter()
        .map(|name| {
            spec.original_exe
                .parent()
                .unwrap_or(Path::new(""))
                .join(name)
        })
        .collect();
    if expected_roots != spec.roots {
        return Err("invalid resource roots".into());
    }
    let expected_data = std::env::var_os("REDUX_PROFILE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            spec.original_exe
                .parent()
                .unwrap_or(Path::new(""))
                .join("user-data")
        });
    if spec.data_dir != expected_data {
        return Err("invalid data root".into());
    }
    // A helper can only restart the same executable it was copied from.
    let helper_hash =
        Sha256::digest(fs::read(std::env::current_exe().map_err(issue)?).map_err(issue)?);
    if Sha256::digest(fs::read(&original).map_err(issue)?) != helper_hash {
        return Err("updater executable changed".into());
    }
    let payload = match spec.mode {
        HelperMode::Installer => {
            let bytes = crate::update::local_update::read_bounded(
                &root.join("installer.exe"),
                crate::update::local_update::MAX_INSTALLER_BYTES,
            )?;
            let signature = crate::update::local_update::read_bounded(
                &root.join("installer.exe.sig"),
                crate::update::local_update::MAX_SIGNATURE_BYTES,
            )?;
            let info = crate::update::local_update::verify(
                &bytes,
                &signature,
                crate::update::updater::UPDATE_PUBLIC_KEY,
                &spec.source_version,
            )?;
            if info.version != spec.target_version {
                return Err("local_update_version_invalid".into());
            }
            HelperPayload::Installer
        }
        HelperMode::Portable => {
            let bytes = crate::update::local_update::read_bounded(
                &root.join("payload.zip"),
                crate::update::local_update::MAX_INSTALLER_BYTES,
            )?;
            let signature = crate::update::local_update::read_bounded(
                &root.join("payload.zip.sig"),
                crate::update::local_update::MAX_SIGNATURE_BYTES,
            )?;
            let version = crate::update::local_update::verify_payload(
                &bytes,
                &signature,
                crate::update::updater::UPDATE_PUBLIC_KEY,
                &spec.source_version,
            )?;
            if version != spec.target_version {
                return Err("local_update_version_invalid".into());
            }
            HelperPayload::Portable
        }
    };
    // Synchronize on the exact process handle before telling the parent to exit.
    let parent = unsafe { OpenProcess(0x00100000, 0, spec.parent_pid) };
    if parent.is_null() {
        return Err("cannot open editor process".into());
    }
    if let Err(error) = fs::write(root.join("ready"), nonce) {
        unsafe {
            CloseHandle(parent);
        }
        return Err(issue(error));
    }
    let waited = unsafe { WaitForSingleObject(parent, u32::MAX) };
    unsafe {
        CloseHandle(parent);
    }
    let result = (|| -> Result<(), String> {
        if waited != 0 {
            return Err("cannot wait for editor process".into());
        }
        crate::update::update_guard::verify(&spec.resources, &spec.roots)?;
        match payload {
            HelperPayload::Installer => {
                let mut installer = Command::new(root.join("installer.exe"));
                installer.args(["/S", "/UPDATE"]);
                if spec.restart {
                    installer.arg("/R");
                }
                let status = installer
                    .creation_flags(0x08000000)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(issue)?;
                if !status.success() {
                    return Err(format!("local_update_installer_failed:{status}"));
                }
            }
            HelperPayload::Portable => {
                let install_root = original.parent().ok_or("invalid install root")?;
                let exe_name = original.file_name().ok_or("invalid executable name")?;
                let extracted = root.join("extracted");
                crate::update::portable_update::extract(&root.join("payload.zip"), &extracted)?;
                let applied = crate::update::portable_update::apply(
                    &extracted,
                    install_root,
                    &root.join("rollback"),
                    exe_name,
                )?;
                if spec.restart {
                    let mut candidate = match Command::new(&original)
                        .args(&spec.args)
                        .creation_flags(0x08000000)
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .spawn()
                    {
                        Ok(child) => child,
                        Err(error) => {
                            let failure = candidate_failure(
                                CandidateOutcome::LaunchFailed,
                                &error.to_string(),
                            );
                            return Err(crate::update::portable_update::with_rollback(
                                failure,
                                applied.rollback(),
                            ));
                        }
                    };
                    let (outcome, detail) = match wait_for_health(
                        &mut candidate,
                        &root,
                        nonce,
                        PORTABLE_HEALTH_TIMEOUT,
                    ) {
                        Ok(()) => (CandidateOutcome::Healthy, String::new()),
                        Err(failure) => {
                            let mut detail = failure.detail;
                            if let Err(stop) = stop_candidate(&mut candidate) {
                                detail = format!("{detail}; could not stop candidate: {stop}");
                            }
                            (failure.outcome, detail)
                        }
                    };
                    match rollback_action(outcome) {
                        RollbackAction::Commit => {
                            // The new build is running. A leftover rollback tree is
                            // cleanup, not a failed update; the next launch removes
                            // it after the helper exits.
                            if let Err(error) = applied.commit() {
                                let detail = format!("rollback cleanup failed: {error}");
                                if let Err(write) = fs::write(root.join("helper-warning"), &detail)
                                {
                                    eprintln!("Could not write update warning: {write}");
                                }
                                if let Err(log) = record_update_log(&spec.data_dir, &detail) {
                                    eprintln!("Could not record update warning: {log}");
                                }
                            }
                        }
                        RollbackAction::Restore => {
                            let failure = candidate_failure(outcome, &detail);
                            return Err(crate::update::portable_update::with_rollback(
                                failure,
                                applied.rollback(),
                            ));
                        }
                    }
                } else {
                    // With deferred installation there is no candidate process to
                    // probe: the next launch will be the first execution of the new build.
                    applied.commit()?;
                }
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        if let Err(log) = record_update_log(&spec.data_dir, &error) {
            eprintln!("Could not record update failure: {log}");
        }
        let pending = spec.data_dir.join("pending-update.json");
        if crate::storage::read_json::<serde_json::Value>(&pending)
            .and_then(|value| {
                value
                    .get("to_version")
                    .and_then(|item| item.as_str())
                    .map(str::to_owned)
            })
            .as_deref()
            == Some(&spec.target_version)
        {
            let _ = fs::remove_file(pending);
        }
        let failure_path = spec.data_dir.join("local-update-failure.json");
        if let Err(write) = crate::storage::write_json(
            &failure_path,
            &LocalUpdateFailure {
                detail: error.clone(),
            },
        ) {
            eprintln!("Could not write update failure record: {write}");
        }
        // Refuse to relaunch a different or partially replaced executable.
        if spec.restart
            && fs::read(&original)
                .ok()
                .is_some_and(|content| Sha256::digest(content) == helper_hash)
        {
            if let Err(restart) = Command::new(original)
                .args(&spec.args)
                .creation_flags(0x08000000)
                .spawn()
            {
                let detail = format!("{error}; could not restart the previous build: {restart}");
                if let Err(write) = crate::storage::write_json(
                    &failure_path,
                    &LocalUpdateFailure {
                        detail: detail.clone(),
                    },
                ) {
                    eprintln!("Could not write update failure record: {write}");
                }
                if let Err(log) = record_update_log(&spec.data_dir, &detail) {
                    eprintln!("Could not record update failure: {log}");
                }
            }
        }
    }
    let _ = fs::remove_file(root.join("installer.exe"));
    let _ = fs::remove_file(root.join("installer.exe.sig"));
    let _ = fs::remove_file(root.join("payload.zip"));
    let _ = fs::remove_file(root.join("payload.zip.sig"));
    let _ = fs::remove_file(root.join("request.json"));
    // The extracted tree is never needed for recovery; the rollback copy holds
    // the previous files. The next app launch removes the remaining stage once
    // this process has exited.
    let _ = fs::remove_dir_all(root.join("extracted"));
    Ok(())
}

/// Remove updater-owned files once the helper has exited; retries while Windows
/// still has a handle open.
fn cleanup_stage(stage: &Path, record: &Path) {
    for _ in 0..120 {
        for name in [
            "installer.exe",
            "installer.exe.sig",
            "payload.zip",
            "payload.zip.sig",
            "request.json",
            "helper-error",
            "helper-warning",
            "helper.exe",
            "health",
        ] {
            let _ = fs::remove_file(stage.join(name));
        }
        let _ = fs::remove_dir_all(stage.join("extracted"));
        let _ = fs::remove_dir_all(stage.join("rollback"));
        let only_ready = fs::read_dir(stage)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .all(|entry| entry.file_name() == "ready")
            })
            .unwrap_or(false);
        if only_ready {
            let _ = fs::remove_file(stage.join("ready"));
            if fs::remove_dir(stage).is_ok() {
                let _ = fs::remove_file(record);
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Confirm the updated build survived its first start, then remove updater
/// temporary files only after the helper process has exited.
pub fn cleanup_finished_helper(app: &AppHandle) {
    let Ok(data) = crate::storage::data_dir(app) else {
        return;
    };
    let record = data.join("local-update-cleanup.json");
    let Some(cleanup) = crate::storage::read_json::<HelperCleanup>(&record) else {
        return;
    };
    // Health is accepted only from the version the helper installed. An older
    // build that a user starts manually must not consume the rollback copy.
    if cleanup.target_version != app.package_info().version.to_string() {
        return;
    }
    let (Ok(stage), Ok(temp)) = (
        cleanup.stage.canonicalize(),
        std::env::temp_dir().canonicalize(),
    ) else {
        return;
    };
    if stage.parent() != Some(temp.as_path())
        || !stage
            .file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("redux-update-"))
        || fs::read_to_string(stage.join("ready")).ok().as_deref() != Some(&cleanup.nonce)
    {
        return;
    }
    std::thread::spawn(move || {
        // Give the new build time to fail early; an immediate crash leaves no
        // marker, so the helper restores the previous files.
        std::thread::sleep(PORTABLE_HEALTH_DELAY);
        if let Err(error) = fs::write(stage.join("health"), &cleanup.nonce) {
            eprintln!("Could not report update health: {error}");
            return;
        }
        // The helper waits for this marker, commits the rollback copy, and then
        // exits. Removing the stage before that would race the rollback owner.
        if !wait_for_process_exit(cleanup.helper_pid, HELPER_EXIT_TIMEOUT) {
            return;
        }
        cleanup_stage(&stage, &record);
    });
}

/// Return and consume the result of a failed background handoff.
#[tauri::command]
pub fn local_update_failure(app: AppHandle) -> Option<LocalUpdateFailure> {
    let path = crate::storage::data_dir(&app)
        .ok()?
        .join("local-update-failure.json");
    let failure = crate::storage::read_json(&path)?;
    let _ = fs::remove_file(path);
    Some(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::portable_update::{candidate_failure, rollback_action, RollbackAction};

    #[test]
    fn health_marker_must_match_the_nonce() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!health_reported(dir.path(), "nonce"));
        fs::write(dir.path().join("health"), "nonce").unwrap();
        assert!(health_reported(dir.path(), "nonce"));
        assert!(!health_reported(dir.path(), "other"));
    }

    #[cfg(windows)]
    #[test]
    fn wait_for_health_accepts_the_matching_marker() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 10 127.0.0.1 >nul"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        fs::write(dir.path().join("health"), "nonce").unwrap();
        assert!(wait_for_health(&mut child, dir.path(), "nonce", Duration::from_secs(5)).is_ok());
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(windows)]
    #[test]
    fn wait_for_health_does_not_accept_health_from_a_dead_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("cmd")
            .args(["/C", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let _ = child.wait();
        fs::write(dir.path().join("health"), "nonce").unwrap();
        let failure =
            wait_for_health(&mut child, dir.path(), "nonce", Duration::from_secs(5)).unwrap_err();
        assert_eq!(failure.outcome, CandidateOutcome::ExitedAfterHealth);
        assert!(
            failure.detail.contains("exited after health"),
            "{}",
            failure.detail
        );
    }

    #[cfg(windows)]
    #[test]
    fn wait_for_health_reports_an_early_candidate_exit() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("cmd")
            .args(["/C", "exit 3"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let failure =
            wait_for_health(&mut child, dir.path(), "nonce", Duration::from_secs(5)).unwrap_err();
        assert_eq!(failure.outcome, CandidateOutcome::ExitedBeforeHealth);
        assert!(
            failure.detail.contains("exited before health"),
            "{}",
            failure.detail
        );
        let _ = child.wait();
    }

    #[cfg(windows)]
    #[test]
    fn wait_for_health_reports_a_timeout_without_a_marker() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 10 127.0.0.1 >nul"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let failure = wait_for_health(&mut child, dir.path(), "nonce", Duration::from_millis(200))
            .unwrap_err();
        assert_eq!(failure.outcome, CandidateOutcome::HealthTimeout);
        assert!(failure.detail.contains("timed out"), "{}", failure.detail);
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn failed_candidate_codes_match_the_rollback_table() {
        assert_eq!(
            candidate_failure(CandidateOutcome::HealthTimeout, ""),
            "portable_update_health_timeout"
        );
        assert_eq!(
            candidate_failure(CandidateOutcome::LaunchFailed, "missing dll"),
            "portable_update_launch_failed:missing dll"
        );
        assert_eq!(
            rollback_action(CandidateOutcome::ExitedBeforeHealth),
            RollbackAction::Restore
        );
        assert_eq!(
            rollback_action(CandidateOutcome::Healthy),
            RollbackAction::Commit
        );
    }

    #[test]
    fn update_log_keeps_each_failure_line() {
        let dir = tempfile::tempdir().unwrap();
        record_update_log(dir.path(), "first failure").unwrap();
        record_update_log(dir.path(), "rollback failed: access denied").unwrap();
        let log = fs::read_to_string(dir.path().join("logs/update.log")).unwrap();
        assert_eq!(
            log.lines().collect::<Vec<_>>(),
            ["first failure", "rollback failed: access denied"]
        );
    }
}
