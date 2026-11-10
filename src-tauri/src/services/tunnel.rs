//! Managed Cloudflare Quick Tunnel for the local collaboration room.
//!
//! The desktop sidecar already owns the authoritative WebSocket server on its
//! configured loopback port. This module only exposes that port through a
//! temporary `trycloudflare.com` HTTPS endpoint and reports the URL to the
//! frontend.

use serde::Serialize;
use std::{
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

/// Bundled tunnel client file name for the host platform.
const CLOUDFLARED_FILE: &str = if cfg!(windows) {
    "cloudflared.exe"
} else {
    "cloudflared"
};
/// How long the client may take to report a public URL.
const START_TIMEOUT: Duration = Duration::from_secs(30);

/// Progress payload sent to the room setup dialog.
#[derive(Clone, Serialize)]
struct CollabProgressEvent {
    stage: String,
}

/// Publish one tunnel stage without making the frontend poll process output.
fn report_progress(app: &AppHandle, stage: &str) {
    let _ = app.emit(
        "redux-collab-progress",
        CollabProgressEvent {
            stage: stage.to_owned(),
        },
    );
}

/// Managed Cloudflare Tunnel process.
pub struct TunnelProcess {
    inner: Mutex<TunnelInner>,
}

/// Running client and the URL it reported.
struct TunnelInner {
    child: Option<Child>,
    url: String,
}

impl Default for TunnelProcess {
    fn default() -> Self {
        Self {
            inner: Mutex::new(TunnelInner {
                child: None,
                url: String::new(),
            }),
        }
    }
}

/// Locate the bundled client first, then explicit developer overrides and PATH.
fn cloudflared_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("REDUX_CLOUDFLARED_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(
            resources
                .join("resources")
                .join("cloudflared")
                .join(CLOUDFLARED_FILE),
        );
        candidates.push(resources.join("cloudflared").join(CLOUDFLARED_FILE));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(
                directory
                    .join("resources")
                    .join("cloudflared")
                    .join(CLOUDFLARED_FILE),
            );
            candidates.push(directory.join(CLOUDFLARED_FILE));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("cloudflared")
            .join(CLOUDFLARED_FILE),
    );
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Ok(path);
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) {
            let path = directory.join(CLOUDFLARED_FILE);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err("Cloudflare Tunnel client is missing. Reinstall the desktop app or set REDUX_CLOUDFLARED_BIN.".into())
}

/// First `https://*.trycloudflare.com` URL in one client log line.
fn extract_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|character: char| character.is_whitespace() || character == '|' || character == '│')
        .unwrap_or(rest.len());
    let url = rest[..end].trim().trim_end_matches(['.', ',', ')']);
    if url.contains(".trycloudflare.com") {
        Some(url.to_owned())
    } else {
        None
    }
}

/// Recent client output, bounded for error messages.
type TunnelLog = Arc<Mutex<Vec<String>>>;

/// Keep the last six non-empty output lines, truncated to 300 characters.
fn remember_line(log: &TunnelLog, line: &str) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    if let Ok(mut lines) = log.lock() {
        lines.push(line.chars().take(300).collect());
        if lines.len() > 6 {
            lines.remove(0);
        }
    }
}

/// Joined recent output suitable for an error message.
fn log_tail(log: &TunnelLog) -> String {
    log.lock()
        .map(|lines| lines.join(" | "))
        .unwrap_or_default()
}

/// Forward output lines from one client stream to the URL channel and log.
fn spawn_reader<R: Read + Send + 'static>(
    stream: R,
    sender: mpsc::Sender<Option<String>>,
    log: TunnelLog,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            remember_line(&log, &line);
            if let Some(url) = extract_url(&line) {
                let _ = sender.send(Some(url));
            }
        }
        let _ = sender.send(None);
    });
}

/// Reuse a live tunnel or start the client and wait for its public URL.
fn start(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<TunnelProcess>();
    let mut guard = state.inner.lock().map_err(|error| error.to_string())?;
    if let Some(child) = guard.child.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            if !guard.url.is_empty() {
                report_progress(app, "reuse");
                return Ok(guard.url.clone());
            }
        } else {
            guard.child = None;
            guard.url.clear();
        }
    }

    report_progress(app, "resolve");
    let binary = cloudflared_path(app)?;
    crate::storage::ensure_executable(&binary)
        .map_err(|error| format!("Cloudflare Tunnel client is not executable: {error}"))?;
    let room_origin = format!(
        "http://127.0.0.1:{}",
        crate::services::server::read_runtime_ports(app.clone())?.collab_port
    );
    let mut command = Command::new(binary);
    command
        .args([
            "tunnel".to_owned(),
            "--url".to_owned(),
            room_origin,
            // Force IPv4 edges so a machine without a working IPv6 route does
            // not spend the startup window retrying unreachable endpoints.
            "--edge-ip-version".to_owned(),
            "4".to_owned(),
            "--no-autoupdate".to_owned(),
        ])
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cloudflare Tunnel failed to start: {error}"))?;
    report_progress(app, "start");
    let (sender, receiver) = mpsc::channel::<Option<String>>();
    let log = Arc::new(Mutex::new(Vec::new()));
    if let Some(stream) = child.stdout.take() {
        spawn_reader(stream, sender.clone(), log.clone());
    }
    if let Some(stream) = child.stderr.take() {
        spawn_reader(stream, sender.clone(), log.clone());
    }
    drop(sender);

    report_progress(app, "wait");
    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        if let Some(code) = child.try_wait().map_err(|error| error.to_string())? {
            let detail = log_tail(&log);
            return Err(if detail.is_empty() {
                format!("Cloudflare Tunnel exited early ({code})")
            } else {
                format!("Cloudflare Tunnel exited early ({code}): {detail}")
            });
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            let _ = child.wait();
            let detail = log_tail(&log);
            return Err(if detail.is_empty() {
                "Cloudflare Tunnel did not report a public URL in time".into()
            } else {
                format!("Cloudflare Tunnel did not report a public URL in time: {detail}")
            });
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(Some(url)) => {
                guard.child = Some(child);
                guard.url = url.clone();
                report_progress(app, "ready");
                return Ok(url);
            }
            Ok(None) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let detail = log_tail(&log);
                return Err(if detail.is_empty() {
                    "Cloudflare Tunnel output closed before a URL was available".into()
                } else {
                    format!("Cloudflare Tunnel output closed before a URL was available: {detail}")
                });
            }
        }
    }
}

/// Start the tunnel and return the public URL guests should use.
#[tauri::command]
pub async fn start_collab_tunnel(app: AppHandle) -> Result<String, String> {
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || match start(&worker) {
        Ok(url) => Ok(url),
        Err(error) => {
            report_progress(&worker, "error");
            Err(error)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Stop the temporary tunnel; the room server stays available on loopback.
#[tauri::command]
pub fn stop_collab_tunnel(app: AppHandle) {
    if let Some(state) = app.try_state::<TunnelProcess>() {
        if let Ok(mut guard) = state.inner.lock() {
            guard.url.clear();
            if let Some(mut child) = guard.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for TunnelProcess {
    fn drop(&mut self) {
        if let Ok(guard) = self.inner.get_mut() {
            if let Some(mut child) = guard.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
