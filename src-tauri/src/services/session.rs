//! One-room-per-backend guard for multi-window or multi-process runs.
//!
//! Every process that shares the same backend port shares the same authority.
//! Holding a named mutex for the duration of a room prevents a second window
//! from hosting or joining another room against that authority. Separate
//! backend ports are isolated test or development instances and may each hold
//! one room session. The kernel releases the claim when the owning process
//! exits.

use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
/// Owned Windows mutex handle; closed when the claim is released.
struct MutexHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for MutexHandle {}

#[cfg(windows)]
impl Drop for MutexHandle {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        if !self.0.is_null() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
/// Placeholder claim used on hosts without named kernel mutexes.
struct MutexHandle;

/// Managed owner of the single cross-process room claim.
#[derive(Default)]
pub struct CollabSession {
    handle: Mutex<Option<MutexHandle>>,
}

#[cfg(windows)]
/// One machine-wide name per backend port: every instance that shares the
/// backend shares one room session, while isolated ports stay independent.
fn claim_name(app: &AppHandle) -> String {
    let port = crate::services::server::read_runtime_ports(app.clone())
        .map(|ports| ports.backend_port)
        .unwrap_or(crate::services::server::DEFAULT_BACKEND_PORT);
    claim_name_for_port(port)
}

#[cfg(windows)]
/// Named mutex shared by every window attached to the same backend port.
fn claim_name_for_port(port: u16) -> String {
    format!("Local\\rperedux-collab-session-{port}")
}

/// Claim this backend for one host/join session. Re-entrant for the same app.
#[tauri::command]
pub fn claim_collab_session(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<CollabSession>();
    let mut guard = state.handle.lock().map_err(|error| error.to_string())?;
    if guard.is_some() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
        use windows_sys::Win32::System::Threading::CreateMutexW;

        let name = claim_name(&app);
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err("Could not claim the collaboration session".into());
        }
        let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if already_exists {
            unsafe {
                let _ = windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            return Ok(false);
        }
        *guard = Some(MutexHandle(handle));
        return Ok(true);
    }
    #[cfg(not(windows))]
    {
        *guard = Some(MutexHandle);
        Ok(true)
    }
}

/// Release the room claim when the host/guest leaves or the app shuts down.
#[tauri::command]
pub fn release_collab_session(app: AppHandle) {
    if let Some(state) = app.try_state::<CollabSession>() {
        if let Ok(mut guard) = state.handle.lock() {
            guard.take();
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn claim_names_are_scoped_by_backend_port() {
        assert_eq!(claim_name_for_port(47821), claim_name_for_port(47821));
        assert_ne!(claim_name_for_port(47821), claim_name_for_port(47822));
    }
}
