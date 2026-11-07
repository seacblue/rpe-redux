/**
 * Startup failure text: the plain-language cause, Extension evidence, the folded
 * technical report, and the one-shot safe-mode confirmation.
 */
export default {
  "startup.failure.render":
    "The interface failed while rendering. Start again; if it keeps happening, use safe mode to rule out an extension surface.",
  "startup.failure.backend":
    "The local service or database did not start. Check the log folder for the service error, then start again.",
  "startup.failure.extension":
    "An extension failed during startup. Start in safe mode to open the editor without extensions, then disable the failing package in Settings → Extensions.",
  "startup.failure.extensionSafeMode":
    "An extension failed while its metadata was registered. Safe mode is already active; disable or remove the failing package in Settings → Extensions, then restart normally.",
  "startup.failure.unknown":
    "The editor stopped for an unexpected reason during startup. The technical details below may identify the cause.",
  "startup.backendPortConflict.title": "The backend port is already in use",
  "startup.backendPortConflict.description":
    "Start the next copy with --backend-port=<different-port>, or change Settings > General > Interface > Backend port, then retry.",

  "startup.report.details": "Technical details",

  "startup.extensions.title": "Possible source",
  "startup.extensions.failures.title": "These extensions failed during startup",
  "startup.extensions.failures.description":
    "One of these packages is the most likely cause. Start in safe mode, then disable or remove it in Settings → Extensions.",
  "startup.extensions.failures.safeModeDescription":
    "Extension safe mode is already active. Disable or remove the failing package in Settings → Extensions.",
  "startup.extensions.activations.title": "These extensions loaded during startup",
  "startup.extensions.activations.description":
    "No extension reported an error, so the cause may be one of these packages.",
  "startup.extensions.activations.safeModeTitle": "These extensions were registered during startup",
  "startup.extensions.activations.safeModeDescription":
    "Extension safe mode is active, so these packages did not run during this launch.",
  "startup.extensions.none": "No extension error was recorded during startup.",
  "startup.extensions.more": "And {count} more.",

  "startup.safeMode.open": "Start in safe mode",
  "startup.safeMode.title": "Start in safe mode?",
  "startup.safeMode.description":
    "This launch skips and disables every extension so the editor can open. Disable or remove the problem extension in Settings → Extensions; the next normal start loads extensions again.",
  "startup.safeMode.confirm": "Start in safe mode",
  "startup.safeMode.requested": "you requested it from the startup failure screen",
};
