//! Sidecar host for the Go + SQLite service (`src/backend/`).
//!
//! The Go + SQLite service ships as a helper beside the desktop executable.
//! The web layer talks to it over loopback HTTP.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Loopback port of the local service.
const SERVER_PORT: &str = "47821";

/// The room server rides in the same sidecar but keeps the default URL used by
/// the standalone `npm run collab` contract.
const COLLAB_PORT: &str = "47830";

/// Default ports written to the user-editable runtime configuration file.
const DEFAULT_FRONTEND_PORT: u16 = 4173;
const DEFAULT_BACKEND_PORT: u16 = 47821;
const DEFAULT_AI_PORT: u16 = 47822;

/// Ports that take effect on the next application start.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePorts {
    pub frontend_port: u16,
    pub backend_port: u16,
    pub ai_port: u16,
}

/// One-process port overrides supplied by a desktop launch or its development
/// wrapper. Overrides are intentionally not persisted, so parallel test runs
/// can choose isolated ports without changing the user's normal profile.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct RuntimePortOverrides {
    frontend: Option<u16>,
    backend: Option<u16>,
    ai: Option<u16>,
}

impl Default for RuntimePorts {
    fn default() -> Self {
        Self {
            frontend_port: DEFAULT_FRONTEND_PORT,
            backend_port: DEFAULT_BACKEND_PORT,
            ai_port: DEFAULT_AI_PORT,
        }
    }
}

fn runtime_ports_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::storage::data_dir(app)?.join("runtime-ports.json"))
}

/// Parse one explicit port value and reject the ephemeral-port sentinel used
/// by the standalone Go service; desktop clients need a stable URL.
fn parse_runtime_port(flag: &str, value: &str) -> Result<u16, String> {
    let port = value
        .parse::<u32>()
        .map_err(|_| format!("{flag} must be an integer between 1 and 65535"))?;
    if !(1..=u32::from(u16::MAX)).contains(&port) {
        return Err(format!("{flag} must be between 1 and 65535"));
    }
    Ok(port as u16)
}

/// Parse desktop launch arguments in both `--flag=value` and `--flag value`
/// forms. Unknown application arguments remain untouched by this helper.
fn parse_runtime_port_args<I, S>(args: I) -> Result<RuntimePortOverrides, String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut overrides = RuntimePortOverrides::default();
    let mut args = args.into_iter().map(Into::into).peekable();
    while let Some(argument) = args.next() {
        let (name, inline) = if let Some(value) = argument.strip_prefix("--frontend-port=") {
            ("frontend", Some(value.to_owned()))
        } else if let Some(value) = argument.strip_prefix("--backend-port=") {
            ("backend", Some(value.to_owned()))
        } else if let Some(value) = argument.strip_prefix("--ai-port=") {
            ("ai", Some(value.to_owned()))
        } else if matches!(
            argument.as_str(),
            "--frontend-port" | "--backend-port" | "--ai-port"
        ) {
            let value = args
                .next()
                .ok_or_else(|| format!("{argument} requires a port value"))?;
            (argument.trim_start_matches("--"), Some(value))
        } else {
            continue;
        };
        let flag = format!("--{name}-port");
        let value = parse_runtime_port(&flag, inline.as_deref().unwrap_or_default())?;
        match name {
            "frontend" => overrides.frontend = Some(value),
            "backend" => overrides.backend = Some(value),
            "ai" => overrides.ai = Some(value),
            _ => unreachable!("only known runtime ports are parsed"),
        }
    }
    Ok(overrides)
}

/// Read optional process environment overrides used by `npm run desktop`.
fn runtime_port_env_overrides() -> Result<RuntimePortOverrides, String> {
    let read = |name: &str, flag: &str| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| parse_runtime_port(flag, &value))
            .transpose()
    };
    Ok(RuntimePortOverrides {
        frontend: read("REDUX_FRONTEND_PORT", "--frontend-port")?,
        backend: read("REDUX_BACKEND_PORT", "--backend-port")?,
        ai: read("REDUX_AI_PORT", "--ai-port")?,
    })
}

/// Apply process-only overrides over the persisted next-launch configuration.
fn effective_runtime_ports(mut ports: RuntimePorts) -> Result<RuntimePorts, String> {
    let environment = runtime_port_env_overrides()?;
    let arguments = parse_runtime_port_args(std::env::args())?;
    ports.frontend_port = arguments
        .frontend
        .or(environment.frontend)
        .unwrap_or(ports.frontend_port);
    ports.backend_port = arguments
        .backend
        .or(environment.backend)
        .unwrap_or(ports.backend_port);
    ports.ai_port = arguments.ai.or(environment.ai).unwrap_or(ports.ai_port);
    Ok(ports)
}

/// Read only the persisted values so a process-only launch override is never
/// accidentally written back when the settings page updates another port.
fn read_persisted_runtime_ports_file(app: &AppHandle) -> Result<RuntimePorts, String> {
    let path = runtime_ports_path(app)?;
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("Invalid runtime port configuration: {error}")),
        Err(_) => Ok(RuntimePorts::default()),
    }
}

/// Read the next-launch port configuration, falling back to product defaults.
#[tauri::command]
pub fn read_runtime_ports(app: AppHandle) -> Result<RuntimePorts, String> {
    read_runtime_ports_file(&app)
}

/// Read the next-launch port configuration for host code that already borrows the app.
fn read_runtime_ports_file(app: &AppHandle) -> Result<RuntimePorts, String> {
    effective_runtime_ports(read_persisted_runtime_ports_file(app)?)
}

/// Update one next-launch port in the dedicated runtime configuration file.
#[tauri::command]
pub fn write_runtime_port(app: AppHandle, name: String, port: u16) -> Result<RuntimePorts, String> {
    if port == 0 {
        return Err("Runtime ports must be between 1 and 65535".to_owned());
    }
    let path = runtime_ports_path(&app)?;
    let mut ports = read_persisted_runtime_ports_file(&app)?;
    match name.as_str() {
        "frontend" => ports.frontend_port = port,
        "backend" => ports.backend_port = port,
        "ai" => ports.ai_port = port,
        _ => return Err(format!("Unknown runtime port: {name}")),
    }
    let raw = serde_json::to_vec_pretty(&ports).map_err(|error| error.to_string())?;
    std::fs::write(path, raw).map_err(|error| error.to_string())?;
    Ok(ports)
}

/// Service identity and API version accepted from the readiness line and health.
const SERVICE_NAME: &str = "rpe-redux-server";
const SERVICE_API: u64 = 1;

/// Packaged documentation directory below the Tauri resource directory.
const DOCS_RESOURCE_DIR: &str = "docs-site-dist";

/// Environment override for the documentation directory.
const DOCS_DIR_ENV: &str = "REDUX_DOCS_DIR";

/// How long the host waits for a sidecar that accepted a shutdown request.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the host waits for a freshly spawned sidecar to print readiness.
const READINESS_TIMEOUT: Duration = Duration::from_secs(15);

/// Poll interval while waiting for the sidecar to exit.
const SHUTDOWN_POLL: Duration = Duration::from_millis(50);

/// Holds the child so the app can request its graceful stop before exiting.
pub struct ServerProcess {
    child: Mutex<Option<Child>>,
    /// Set when another frontend still owns the shared backend at exit.
    keep_alive: Mutex<bool>,
    instance_id: Mutex<Option<String>>,
}

impl Default for ServerProcess {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            keep_alive: Mutex::new(false),
            instance_id: Mutex::new(None),
        }
    }
}

/// Stable id this frontend uses for backend instance registration.
#[tauri::command]
pub fn backend_instance_id(app: AppHandle) -> Result<String, String> {
    let state = app.state::<ServerProcess>();
    let mut guard = state.instance_id.lock().map_err(|e| e.to_string())?;
    if let Some(id) = guard.as_ref() {
        return Ok(id.clone());
    }
    let id = uuid::Uuid::new_v4().to_string();
    *guard = Some(id.clone());
    Ok(id)
}

/// Locate the sidecar: an explicit override, then the packaged resource, then
/// the source-tree copy used by local development.
fn binary_path(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    if let Ok(explicit) = std::env::var("REDUX_SERVER_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok((path, false));
        }
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the application: {error}"))?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| "Could not locate the application directory.".to_owned())?;
    let names: &[&str] = if cfg!(windows) {
        &["redux-service.exe", "redux-service"]
    } else {
        &["redux-service"]
    };
    let mut candidates = Vec::new();
    for name in names {
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("resources").join(name));
        }
        candidates.push(executable_dir.join("resources").join(name));
        candidates.push(executable_dir.join(name));
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(name),
        );
    }
    if let Some(path) = candidates.iter().find(|candidate| candidate.is_file()) {
        return Ok((path.clone(), false));
    }
    let searched = candidates
        .iter()
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join("；");
    Err(format!(
        "Backend helper not found. Checked: {searched}. Confirm the installer contains resources/redux-service."
    ))
}

/// Resolve the database path this process would use.
pub(crate) fn expected_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("REDUX_SERVER_DB") {
        return Ok(PathBuf::from(explicit));
    }
    Ok(crate::storage::data_dir(app)?.join("redux.db"))
}

/// A documentation candidate is usable when it carries the SPA shell.
fn docs_site_dir(path: &Path) -> Option<PathBuf> {
    path.join("index.html")
        .is_file()
        .then(|| path.to_path_buf())
}

/// Select the documentation directory: the explicit override wins, then the
/// packaged resource, then the repository copy used by development launches.
/// An explicit override that is not a usable site disables /docs instead of
/// falling back silently.
fn choose_docs_dir(
    explicit: Option<&Path>,
    resource: Option<&Path>,
    development: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(path) = explicit {
        return docs_site_dir(path);
    }
    resource
        .and_then(docs_site_dir)
        .or_else(|| development.and_then(docs_site_dir))
}

/// Candidate `<ancestor>/docs-site-dist` paths for a development executable.
fn ancestor_docs_candidates(start: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut cursor = Some(start);
    for _ in 0..5 {
        let Some(directory) = cursor else {
            break;
        };
        candidates.push(directory.join(DOCS_RESOURCE_DIR));
        cursor = directory.parent();
    }
    candidates
}

/// Locate the repository documentation bundle for a development launch.
fn development_docs_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(root.join(DOCS_RESOURCE_DIR));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.extend(ancestor_docs_candidates(directory));
        }
    }
    candidates
        .into_iter()
        .find_map(|candidate| docs_site_dir(&candidate))
}

/// Resolve the documentation directory this launch should serve and record one
/// lifecycle line when the surface is unavailable.
fn resolve_docs_dir(app: &AppHandle, data_dir: &Path) -> Option<PathBuf> {
    let explicit = std::env::var_os(DOCS_DIR_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|directory| directory.join(DOCS_RESOURCE_DIR));
    let development = development_docs_dir();
    let resolved = choose_docs_dir(
        explicit.as_deref(),
        resource.as_deref(),
        development.as_deref(),
    );
    match (&resolved, &explicit) {
        (Some(directory), _) => append_log(
            data_dir,
            &format!("serving documentation from {}", directory.display()),
        ),
        (None, Some(directory)) => append_log(
            data_dir,
            &format!(
                "documentation site missing at {}; /docs stays disabled",
                directory.display()
            ),
        ),
        (None, None) => append_log(
            data_dir,
            "documentation site not found; /docs stays disabled",
        ),
    }
    resolved
}

/// Compare two paths after canonicalisation; Windows compares case-insensitively.
fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    let left = std::fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = std::fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

/// Whether a health payload names the database this process would use.
fn health_matches_db(health: &serde_json::Value, expected: &std::path::Path) -> bool {
    health["db"]
        .as_str()
        .is_some_and(|path| same_path(std::path::Path::new(path), expected))
}

/// Whether a health payload reports the version this frontend was built with.
fn health_matches_version(health: &serde_json::Value, expected: &str) -> bool {
    health["version"].as_str() == Some(expected)
}

/// Whether a running sidecar can serve the documentation surface this launch
/// needs. A launch without a usable docs directory accepts either state.
fn docs_reuse_matches(health: &serde_json::Value, docs_requested: bool) -> bool {
    !docs_requested || health["docs"].as_bool() == Some(true)
}

/// Version text for diagnostics; older payloads predate the field.
fn health_version(health: &serde_json::Value) -> &str {
    health["version"]
        .as_str()
        .filter(|version| !version.is_empty())
        .unwrap_or("unknown")
}

/// Bound room port reported by a health payload, preferring the top-level field
/// and falling back to the nested collaboration object.
fn health_collab_port(health: &serde_json::Value) -> Option<u16> {
    health["collabPort"]
        .as_u64()
        .or_else(|| health["collab"]["port"].as_u64())
        .and_then(|port| u16::try_from(port).ok())
}

/// Whether a health payload reports the room port this host expects. A zero
/// port is accepted only when collaboration is explicitly enabled but degraded,
/// because an occupied room port must not stop the main service.
fn health_matches_collab_port(health: &serde_json::Value, expected: u16) -> bool {
    match health_collab_port(health) {
        Some(actual) if actual == expected => true,
        Some(0) => {
            expected != 0 && health["collab"]["enabled"] == true && health["collab"]["ok"] == false
        }
        _ => false,
    }
}

/// Whether a health payload reports the collaboration listener as degraded.
fn health_collab_degraded(health: &serde_json::Value) -> bool {
    health["collab"]["enabled"] == true && health["collab"]["ok"] == false
}

/// Check the single readiness line emitted by a freshly spawned sidecar.
///
/// Returns whether the room listener is degraded. A version or identity mismatch
/// is an error because the binary beside this app is not the one it was built
/// against.
fn readiness_matches(
    readiness: &serde_json::Value,
    expected_db: &Path,
    expected_version: &str,
    expected_port: u16,
    expected_ai_port: u16,
    expected_collab_port: u16,
) -> Result<bool, String> {
    if readiness["event"].as_str() != Some("listening") {
        return Err("Backend readiness line does not report a listening event.".into());
    }
    if readiness["name"].as_str() != Some(SERVICE_NAME)
        || readiness["api"].as_u64() != Some(SERVICE_API)
    {
        return Err("Backend readiness line names a different service or API version.".into());
    }
    if !health_matches_version(readiness, expected_version) {
        return Err(format!(
            "Backend reported version {} but this app is {expected_version}.",
            health_version(readiness)
        ));
    }
    if readiness["port"].as_u64() != Some(u64::from(expected_port)) {
        return Err(format!(
            "Backend bound port {} instead of {expected_port}.",
            readiness["port"]
        ));
    }
    if readiness["aiPort"].as_u64() != Some(u64::from(expected_ai_port)) {
        return Err(format!(
            "Backend bound AI port {} instead of {expected_ai_port}.",
            readiness["aiPort"]
        ));
    }
    match readiness["db"].as_str() {
        Some(path) if same_path(Path::new(path), expected_db) => {}
        _ => {
            return Err(format!(
                "Backend opened database {} instead of {}.",
                readiness["db"],
                expected_db.display()
            ))
        }
    }
    let actual_collab = health_collab_port(readiness).unwrap_or(0);
    if expected_collab_port != 0 && actual_collab != expected_collab_port {
        if actual_collab == 0 {
            return Ok(true);
        }
        return Err(format!(
            "Backend bound collaboration port {actual_collab} instead of {expected_collab_port}."
        ));
    }
    Ok(false)
}

/// Append a host-side lifecycle line to the sidecar log.
fn append_log(data_dir: &Path, message: &str) {
    let log_dir = data_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.log"))
    {
        let _ = writeln!(log, "desktop: {message}");
    }
}

/// Ask the sidecar to run its graceful shutdown path through the loopback
/// control route. Returns false when the request was not accepted.
fn request_shutdown(addr: SocketAddr) -> bool {
    post_json(addr, "/api/shutdown", &serde_json::json!({}))
        .is_some_and(|value| value["ok"] == true && value["shuttingDown"] == true)
}

/// Wait until nothing accepts connections on the service port.
fn wait_for_listener_close(addr: SocketAddr, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_err() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(SHUTDOWN_POLL);
    }
}

/// Wait until the child exits without terminating it.
fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            Err(_) => return false,
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(SHUTDOWN_POLL);
    }
}

/// Request a graceful stop, wait for it, and terminate only after a timeout.
fn stop_child(addr: SocketAddr, child: &mut Child) {
    let requested = request_shutdown(addr);
    if wait_for_child_exit(child, SHUTDOWN_TIMEOUT) {
        return;
    }
    if !requested {
        let _ = request_shutdown(addr);
        if wait_for_child_exit(child, Duration::from_millis(500)) {
            return;
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Reuse a matching sidecar, or stop a stale version so the caller can spawn
/// the current one. Returns true when the existing process should be reused.
fn reuse_existing_backend(
    health: &serde_json::Value,
    expected_db: &Path,
    expected_version: &str,
    expected_port: u16,
    expected_collab_port: u16,
    docs_requested: bool,
    addr: SocketAddr,
    data_dir: &Path,
) -> Result<bool, String> {
    if !health_matches_db(health, expected_db) {
        return Err(format!(
            "Backend port {expected_port} is already in use by another Redux database profile. This launch will not switch ports automatically. Start the next copy with --backend-port=<different-port>, or change the Backend port setting, then retry."
        ));
    }
    let version_matches = health_matches_version(health, expected_version);
    let collab_matches = health_matches_collab_port(health, expected_collab_port);
    let docs_matches = docs_reuse_matches(health, docs_requested);
    if version_matches && collab_matches && docs_matches {
        if health_collab_degraded(health) {
            append_log(
                data_dir,
                "reusing degraded backend: collaboration listener is unavailable",
            );
        }
        return Ok(true);
    }
    let actual_version = health_version(health);
    let actual_collab = health_collab_port(health)
        .map(|port| port.to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    let reason = if !version_matches {
        format!("version {actual_version:?} does not match app {expected_version:?}")
    } else if !collab_matches {
        format!("collaboration port {actual_collab} does not match app {expected_collab_port}")
    } else {
        "the running backend does not serve the documentation site".to_owned()
    };
    append_log(data_dir, &format!("restarting backend: {reason}"));
    if !request_shutdown(addr) {
        return Err(format!(
            "Backend {actual_version} (collaboration port {actual_collab}) cannot be reused by this app ({expected_version}, collaboration port {expected_collab_port}): {reason}. It did not accept a shutdown request. Close every Redux window and retry."
        ));
    }
    if !wait_for_listener_close(addr, SHUTDOWN_TIMEOUT) {
        return Err(format!(
            "Backend {actual_version} did not stop within {} seconds. Close every Redux window and retry.",
            SHUTDOWN_TIMEOUT.as_secs()
        ));
    }
    Ok(false)
}

/// Configure the sidecar with its loopback ports, collaboration store, and the
/// optional documentation directory.
fn configure_sidecar(
    command: &mut Command,
    data_dir: &Path,
    docs_dir: Option<&Path>,
    ports: &RuntimePorts,
) {
    let backend_port = ports.backend_port.to_string();
    let ai_port = ports.ai_port.to_string();
    command
        .args([
            "--port",
            &backend_port,
            "--ai-port",
            &ai_port,
            "--host",
            "127.0.0.1",
        ])
        .args(["--collab-port", COLLAB_PORT, "--collab-host", "127.0.0.1"])
        .arg("--collab-data")
        .arg(data_dir.join("collaboration"));
    if let Some(directory) = docs_dir {
        command.arg("--docs-dir").arg(directory);
    }
}

/// Spawn the sidecar and record it on the app handle.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ServerProcess>();
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        *guard = None;
    }
    let data_dir = crate::storage::data_dir(app)?;
    let ports = read_runtime_ports_file(app)?;
    let expected_db = expected_db_path(app)?;
    let expected_version = app.package_info().version.to_string();
    let expected_port = ports.backend_port;
    let expected_ai_port = ports.ai_port;
    let expected_collab_port: u16 = COLLAB_PORT.parse().unwrap();
    let docs_dir = resolve_docs_dir(app, &data_dir);
    let docs_requested = docs_dir.is_some();
    let addr: SocketAddr = format!("127.0.0.1:{}", ports.backend_port).parse().unwrap();
    if let Some(health) = read_health(addr) {
        if reuse_existing_backend(
            &health,
            &expected_db,
            &expected_version,
            expected_port,
            expected_collab_port,
            docs_requested,
            addr,
            &data_dir,
        )? {
            return Ok(());
        }
    } else if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
        // Wait briefly for a sidecar that is still starting.
        let mut settled = false;
        for _ in 0..10 {
            if let Some(health) = read_health(addr) {
                if reuse_existing_backend(
                    &health,
                    &expected_db,
                    &expected_version,
                    expected_port,
                    expected_collab_port,
                    docs_requested,
                    addr,
                    &data_dir,
                )? {
                    return Ok(());
                }
                settled = true;
                break;
            }
            if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_err() {
                settled = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if !settled {
            return Err(format!(
                "Backend port {} is already in use by another program. This launch will not switch ports automatically. Start the next copy with --backend-port=<different-port>, or change the Backend port setting, then retry.",
                ports.backend_port
            ));
        }
    }
    let (path, _) = binary_path(app)?;
    crate::storage::ensure_executable(&path)
        .map_err(|error| format!("Backend is not executable: {error}"))?;
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    // Append so a restart reason written before this spawn stays in the log.
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.log"))
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(&path);
    if std::env::var_os("REDUX_SERVER_DB").is_none() {
        command.arg("--db").arg(data_dir.join("redux.db"));
    }
    configure_sidecar(&mut command, &data_dir, docs_dir.as_deref(), &ports);
    command
        .env("REDUX_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: no console flashes.
    let mut child = command
        .spawn()
        .map_err(|e| format!("Backend failed to start: {e}"))?;
    let readiness = match read_readiness(&mut child, READINESS_TIMEOUT) {
        Ok(readiness) => readiness,
        Err(error) => {
            append_log(&data_dir, &format!("backend startup failed: {error}"));
            stop_child(addr, &mut child);
            return Err(error);
        }
    };
    let degraded = match readiness_matches(
        &readiness,
        &expected_db,
        &expected_version,
        expected_port,
        expected_ai_port,
        expected_collab_port,
    ) {
        Ok(degraded) => degraded,
        Err(error) => {
            append_log(&data_dir, &format!("backend startup rejected: {error}"));
            stop_child(addr, &mut child);
            return Err(error);
        }
    };
    if degraded {
        append_log(
            &data_dir,
            "backend started with a degraded collaboration listener",
        );
    }
    *guard = Some(child);
    Ok(())
}

/// Read the single readiness line a freshly spawned sidecar prints before it
/// starts serving requests.
fn read_readiness(child: &mut Child, timeout: Duration) -> Result<serde_json::Value, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Backend did not expose a readiness pipe.".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });
    let line = match receiver.recv_timeout(timeout) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => return Err(format!("Could not read backend readiness line: {error}")),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            return Err(format!(
                "Backend did not report readiness within {} seconds.",
                timeout.as_secs()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            return Err("Backend readiness reader stopped unexpectedly.".into())
        }
    };
    if line.trim().is_empty() {
        return Err("Backend exited before reporting readiness.".into());
    }
    serde_json::from_str(line.trim())
        .map_err(|error| format!("Backend readiness line is not valid JSON: {error}"))
}

/// Read `/api/health` and accept any payload from the expected service
/// identity, including one whose collaboration listener is degraded.
fn read_health(addr: SocketAddr) -> Option<serde_json::Value> {
    let Ok(mut socket) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) else {
        return None;
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(300)));
    if socket
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return None;
    }
    let mut response = String::new();
    if socket.take(16384).read_to_string(&mut response).is_err() {
        return None;
    }
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.1 200 ") && !headers.starts_with("HTTP/1.0 200 ") {
        return None;
    }
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    (value["name"].as_str() == Some(SERVICE_NAME) && value["api"].as_u64() == Some(SERVICE_API))
        .then_some(value)
}

/// Whether the service identity answers a health probe.
fn healthy(addr: SocketAddr) -> bool {
    read_health(addr).is_some()
}

/// Number of frontends registered with the service, or zero when unknown.
fn active_instance_count(addr: SocketAddr) -> usize {
    read_health(addr)
        .and_then(|value| value["instances"].as_u64())
        .unwrap_or(0) as usize
}

/// Send one small JSON request over loopback and decode a 200 response.
fn post_json(addr: SocketAddr, path: &str, body: &serde_json::Value) -> Option<serde_json::Value> {
    let payload = body.to_string();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-redux-client: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    let mut socket = TcpStream::connect_timeout(&addr, Duration::from_millis(500)).ok()?;
    let _ = socket.set_read_timeout(Some(Duration::from_millis(1_000)));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(1_000)));
    socket.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    socket.take(16384).read_to_string(&mut response).ok()?;
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.1 200 ") && !headers.starts_with("HTTP/1.0 200 ") {
        return None;
    }
    serde_json::from_str(body).ok()
}

/// The loading screen awaits this command. Retrying restarts an exited sidecar.
#[tauri::command]
pub async fn start_backend(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        start(&app)?;
        let port = read_runtime_ports_file(&app)?.backend_port;
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if healthy(addr) {
                return Ok(());
            }
            let state = app.state::<ServerProcess>();
            let mut guard = state.child.lock().map_err(|e| e.to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Some(code) = child.try_wait().map_err(|e| e.to_string())? {
                    return Err(format!(
                        "Backend exited early ({code}). See backend.log for details."
                    ));
                }
            }
            drop(guard);
            if Instant::now() >= deadline {
                stop(&app);
                return Err(
                    "Backend health check timed out after 15 seconds. See backend.log and retry."
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop the sidecar on exit when no other frontend is still using it. The
/// shutdown request drains the HTTP server, collaboration flush, and SQLite
/// close before the host falls back to terminating the process.
pub fn stop(app: &AppHandle) {
    let port = read_runtime_ports_file(app)
        .map(|value| value.backend_port)
        .unwrap_or_else(|_| SERVER_PORT.parse().unwrap());
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    let mut remaining = None;
    if let Some(state) = app.try_state::<ServerProcess>() {
        if let Ok(guard) = state.instance_id.lock() {
            if let Some(id) = guard.as_ref() {
                remaining = post_json(
                    addr,
                    "/api/instances/leave",
                    &serde_json::json!({ "id": id }),
                )
                .and_then(|value| value["remaining"].as_u64())
                .map(|value| value as usize);
            }
        }
    }
    let shared = remaining.unwrap_or_else(|| active_instance_count(addr)) > 0;
    if let Some(state) = app.try_state::<ServerProcess>() {
        if shared {
            if let Ok(mut keep) = state.keep_alive.lock() {
                *keep = true;
            }
            return;
        }
        if let Ok(mut guard) = state.child.lock() {
            if let Some(mut child) = guard.take() {
                stop_child(addr, &mut child);
            }
        }
    }
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        if self.keep_alive.get_mut().map(|keep| *keep).unwrap_or(false) {
            return;
        }
        let addr: SocketAddr = format!("127.0.0.1:{SERVER_PORT}").parse().unwrap();
        if let Ok(guard) = self.child.get_mut() {
            if let Some(mut child) = guard.take() {
                stop_child(addr, &mut child);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal health payload for version matching tests.
    fn health(version: Option<&str>) -> serde_json::Value {
        match version {
            Some(version) => serde_json::json!({ "version": version }),
            None => serde_json::json!({}),
        }
    }

    #[test]
    fn health_version_requires_an_exact_match() {
        let expected = "1.0.0-a6";
        assert!(health_matches_version(&health(Some(expected)), expected));
        assert!(!health_matches_version(&health(Some("1.0.0-a5")), expected));
        assert!(!health_matches_version(&health(None), expected));
    }

    #[test]
    fn missing_health_version_reads_as_unknown() {
        assert_eq!(health_version(&health(None)), "unknown");
        assert_eq!(health_version(&health(Some(""))), "unknown");
        assert_eq!(health_version(&health(Some("1.0.0"))), "1.0.0");
    }

    #[test]
    fn desktop_launch_arguments_override_persisted_ports_without_persisting() {
        let overrides = parse_runtime_port_args([
            "rpe-redux.exe",
            "--backend-port",
            "48121",
            "--ai-port=48122",
            "--frontend-port",
            "4174",
        ])
        .unwrap();
        assert_eq!(
            overrides,
            RuntimePortOverrides {
                frontend: Some(4174),
                backend: Some(48121),
                ai: Some(48122),
            }
        );
    }

    #[test]
    fn desktop_launch_arguments_reject_invalid_ports() {
        assert!(parse_runtime_port_args(["--backend-port=0"]).is_err());
        assert!(parse_runtime_port_args(["--backend-port", "not-a-port"]).is_err());
        assert!(parse_runtime_port_args(["--backend-port"]).is_err());
    }

    /// Build a health payload with the top-level and nested room port fields.
    fn collab_health(port: u16, enabled: bool, ok: bool) -> serde_json::Value {
        serde_json::json!({
            "version": "1.0.0-a6",
            "collabPort": port,
            "collab": { "enabled": enabled, "ok": ok, "port": port },
        })
    }

    #[test]
    fn health_collab_port_requires_the_expected_binding() {
        assert!(health_matches_collab_port(
            &collab_health(47830, true, true),
            47830
        ));
        assert!(!health_matches_collab_port(
            &collab_health(47831, true, true),
            47830
        ));
        let mut nested = collab_health(47831, true, true);
        nested.as_object_mut().unwrap().remove("collabPort");
        nested["collab"]["port"] = serde_json::json!(47830);
        assert!(health_matches_collab_port(&nested, 47830));
    }

    #[test]
    fn degraded_collab_port_zero_is_reusable_only_when_marked() {
        assert!(health_matches_collab_port(
            &collab_health(0, true, false),
            47830
        ));
        assert!(!health_matches_collab_port(
            &collab_health(0, true, true),
            47830
        ));
        assert!(!health_matches_collab_port(
            &collab_health(0, false, false),
            47830
        ));
        assert!(!health_matches_collab_port(
            &serde_json::json!({ "version": "1.0.0-a6" }),
            47830
        ));
    }

    /// Build a minimal readiness line for the startup contract tests.
    fn readiness() -> serde_json::Value {
        serde_json::json!({
            "event": "listening",
            "name": SERVICE_NAME,
            "api": SERVICE_API,
            "port": 47821,
            "aiPort": 47822,
            "db": "redux.db",
            "version": "1.0.0-a6",
            "collabPort": 47830,
        })
    }

    #[test]
    fn readiness_requires_identity_version_database_and_ports() {
        let db = Path::new("redux.db");
        assert_eq!(
            readiness_matches(&readiness(), db, "1.0.0-a6", 47821, 47822, 47830),
            Ok(false)
        );

        let mut wrong_name = readiness();
        wrong_name["name"] = serde_json::json!("other-server");
        assert!(readiness_matches(&wrong_name, db, "1.0.0-a6", 47821, 47822, 47830).is_err());

        let mut wrong_version = readiness();
        wrong_version["version"] = serde_json::json!("1.0.0-a5");
        assert!(readiness_matches(&wrong_version, db, "1.0.0-a6", 47821, 47822, 47830).is_err());

        let mut wrong_port = readiness();
        wrong_port["port"] = serde_json::json!(47822);
        assert!(readiness_matches(&wrong_port, db, "1.0.0-a6", 47821, 47822, 47830).is_err());

        let mut wrong_collab = readiness();
        wrong_collab["collabPort"] = serde_json::json!(47831);
        assert!(readiness_matches(&wrong_collab, db, "1.0.0-a6", 47821, 47822, 47830).is_err());
    }

    #[test]
    fn readiness_accepts_a_degraded_collab_listener() {
        let mut degraded = readiness();
        degraded["collabPort"] = serde_json::json!(0);
        assert_eq!(
            readiness_matches(
                &degraded,
                Path::new("redux.db"),
                "1.0.0-a6",
                47821,
                47822,
                47830
            ),
            Ok(true)
        );
    }

    /// Create one documentation bundle with its SPA shell.
    fn docs_site(root: &Path, name: &str) -> PathBuf {
        let directory = root.join(name);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("index.html"), "<!doctype html>").unwrap();
        directory
    }

    #[test]
    fn docs_directory_requires_the_index_shell() {
        let temp = tempfile::tempdir().unwrap();
        let empty = temp.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(docs_site_dir(&empty), None);
        std::fs::write(empty.join("index.html"), "<!doctype html>").unwrap();
        assert_eq!(docs_site_dir(&empty), Some(empty.clone()));
    }

    #[test]
    fn docs_directory_priority_prefers_override_then_resource_then_development() {
        let temp = tempfile::tempdir().unwrap();
        let explicit = docs_site(temp.path(), "explicit");
        let resource = docs_site(temp.path(), "resource");
        let development = docs_site(temp.path(), "development");

        assert_eq!(
            choose_docs_dir(Some(&explicit), Some(&resource), Some(&development)),
            Some(explicit.clone())
        );
        assert_eq!(
            choose_docs_dir(None, Some(&resource), Some(&development)),
            Some(resource.clone())
        );
        assert_eq!(
            choose_docs_dir(None, None, Some(&development)),
            Some(development.clone())
        );
        assert_eq!(choose_docs_dir(None, None, None), None);
    }

    #[test]
    fn explicit_docs_override_disables_docs_instead_of_falling_back() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        let resource = docs_site(temp.path(), "resource");
        assert_eq!(choose_docs_dir(Some(&missing), Some(&resource), None), None);
    }

    #[test]
    fn ancestor_docs_candidates_walk_up_from_the_executable() {
        let temp = tempfile::tempdir().unwrap();
        let executable_dir = temp.path().join("target").join("debug");
        std::fs::create_dir_all(&executable_dir).unwrap();
        let docs = docs_site(temp.path(), DOCS_RESOURCE_DIR);

        let candidates = ancestor_docs_candidates(&executable_dir);
        assert_eq!(candidates[0], executable_dir.join(DOCS_RESOURCE_DIR));
        assert!(candidates.contains(&docs));
    }

    #[test]
    fn sidecar_arguments_include_docs_only_when_resolved() {
        let data_dir = Path::new("user-data");
        let docs_dir = Path::new("bundle/docs-site-dist");
        let ports = RuntimePorts::default();
        let mut command = Command::new("sidecar");
        configure_sidecar(&mut command, data_dir, Some(docs_dir), &ports);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--docs-dir" && pair[1] == "bundle/docs-site-dist"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--port" && pair[1] == SERVER_PORT));

        let mut bare = Command::new("sidecar");
        configure_sidecar(&mut bare, data_dir, None, &ports);
        assert!(!bare.get_args().any(|arg| arg == "--docs-dir"));
    }

    #[test]
    fn docs_reuse_requires_health_confirmation() {
        let available = serde_json::json!({ "docs": true });
        let missing = serde_json::json!({});
        let disabled = serde_json::json!({ "docs": false });

        assert!(docs_reuse_matches(&available, true));
        assert!(!docs_reuse_matches(&missing, true));
        assert!(!docs_reuse_matches(&disabled, true));
        assert!(docs_reuse_matches(&missing, false));
        assert!(docs_reuse_matches(&available, false));
    }
}
