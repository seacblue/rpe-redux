//! Developer-facing native surfaces.
//!
//! `bundle` writes the support zip, `developer` exposes the debug-only DevTools
//! and host-platform commands, and `performance_hud` owns the separate
//! always-on-top HUD window.

pub(crate) mod bundle;
pub(crate) mod developer;
pub(crate) mod performance_hud;
