//! Application lifecycle and window-hosted state for the desktop process.
//!
//! This module owns startup window creation and failure reporting, the on-disk
//! data-format migration that runs before the sidecar opens the database,
//! incoming deep links, persisted main-window geometry, the per-process IPC
//! capability token shared by every path-bearing command, and the availability
//! of the optional bundled tools.

pub(crate) mod bundled_tools;
pub(crate) mod deep_link;
pub(crate) mod ipc_guard;
pub(crate) mod migration;
pub(crate) mod startup;
pub(crate) mod window_state;
