//! Availability of the optional third-party tools a desktop build may omit.
//!
//! FFmpeg and the Cloudflare Tunnel client are downloaded at build time from the
//! latest stable releases. A local build can skip both downloads, so the host answers
//! which ones it carries and the interface falls back with a warning instead of
//! failing a task halfway through.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Stable error code the interface maps to a localized warning notice.
pub(crate) const TUNNEL_CLIENT_MISSING: &str = "collab_tunnel_client_missing";

/// Bundled encoder file name for the host platform.
pub(crate) const FFMPEG_FILE: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

/// Bundled tunnel client file name for the host platform.
const CLOUDFLARED_FILE: &str = if cfg!(windows) {
    "cloudflared.exe"
} else {
    "cloudflared"
};

/// Which optional tools this installation carries.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledToolStatus {
    encoder: bool,
    tunnel: bool,
}

/// Resource folders one bundled tool can be staged in, in precedence order.
///
/// Installed layouts place resources beside the executable under `resources/`;
/// a debug build can also run straight from the staged source folder.
fn resource_candidates(app: &AppHandle, folder: &str, file: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("resources").join(folder).join(file));
        candidates.push(resources.join(folder).join(file));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("resources").join(folder).join(file));
            candidates.push(directory.join(folder).join(file));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(folder)
                .join(file),
        );
    }
    candidates
}

/// Locate the bundled FFmpeg encoder when this installation carries one.
pub(crate) fn encoder_path(app: &AppHandle) -> Option<PathBuf> {
    resource_candidates(app, "ffmpeg", FFMPEG_FILE)
        .into_iter()
        .find(|path| path.is_file())
}

/// Locate the Cloudflare Tunnel client.
///
/// The bundled copy comes first; an explicit developer override and `PATH` keep
/// a source build usable with a system installation.
pub(crate) fn tunnel_client_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("REDUX_CLOUDFLARED_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(path) = resource_candidates(app, "cloudflared", CLOUDFLARED_FILE)
        .into_iter()
        .find(|path| path.is_file())
    {
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
    Err(TUNNEL_CLIENT_MISSING.into())
}

/// Report which optional tools this build carries.
#[tauri::command]
pub fn bundled_tool_status(app: AppHandle) -> BundledToolStatus {
    BundledToolStatus {
        encoder: encoder_path(&app).is_some(),
        tunnel: tunnel_client_path(&app).is_ok(),
    }
}
