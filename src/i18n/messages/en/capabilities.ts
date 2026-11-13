/**
 * English consent labels and descriptions for every Extension capability.
 *
 * The keys mirror `CAPABILITY_CATALOG` in
 * `src/core/extensions/capabilityCatalog.ts` one-for-one, so the install dialog
 * and documentation render typed text instead of a capability name. The
 * deprecated `host.patch` row stays here for legacy manifests and is never
 * offered to a new install.
 */
export default {
  "settings.extensions.capability.scripts.label": "Run package scripts",
  "settings.extensions.capability.scripts.description":
    "Register and run the package's own scripts, including declarative steps.",
  "settings.extensions.capability.chart.read.label": "Read chart data",
  "settings.extensions.capability.chart.read.description":
    "Read chart metadata, judge lines, notes, events, and resources.",
  "settings.extensions.capability.chart.write.label": "Edit chart data",
  "settings.extensions.capability.chart.write.description":
    "Change chart metadata, judge lines, notes, and events through validated transactions.",
  "settings.extensions.capability.selection.read.label": "Read the selection",
  "settings.extensions.capability.selection.read.description":
    "Read the current note and event selection.",
  "settings.extensions.capability.selection.write.label": "Change the selection",
  "settings.extensions.capability.selection.write.description":
    "Select, copy, cut, paste, and delete notes or events.",
  "settings.extensions.capability.document.read.label": "Read document state",
  "settings.extensions.capability.document.read.description":
    "Read the open document's name, path, snapshot, and fingerprint.",
  "settings.extensions.capability.document.write.label": "Manage documents",
  "settings.extensions.capability.document.write.description":
    "Create, open, save, and close documents.",
  "settings.extensions.capability.library.read.label": "Read the library",
  "settings.extensions.capability.library.read.description":
    "Read library projects, assets, and revisions.",
  "settings.extensions.capability.library.write.label": "Change the library",
  "settings.extensions.capability.library.write.description":
    "Create, update, duplicate, and remove library projects and revisions.",
  "settings.extensions.capability.assets.write.label": "Change library assets",
  "settings.extensions.capability.assets.write.description":
    "Add or remove assets in the open document's library project.",
  "settings.extensions.capability.playback.read.label": "Read playback",
  "settings.extensions.capability.playback.read.description":
    "Read playback state, rendered textures, frames, and metrics.",
  "settings.extensions.capability.playback.control.label": "Control playback",
  "settings.extensions.capability.playback.control.description":
    "Play, pause, seek, set the rate, and run preview measurements.",
  "settings.extensions.capability.ui.notice.label": "Show notices",
  "settings.extensions.capability.ui.notice.description":
    "Show notices and progress messages in the host interface.",
  "settings.extensions.capability.ui.dialog.label": "Ask the user",
  "settings.extensions.capability.ui.dialog.description":
    "Open host confirm, input, select, guide, and image-picker dialogs.",
  "settings.extensions.capability.ui.guide.label": "Open help and tutorials",
  "settings.extensions.capability.ui.guide.description":
    "Open help or the changelog, or register an extension tutorial.",
  "settings.extensions.capability.ui.panel.label": "Add panels",
  "settings.extensions.capability.ui.panel.description":
    "Register declarative panels inside the editor.",
  "settings.extensions.capability.ui.sidebar.label": "Add sidebar entries",
  "settings.extensions.capability.ui.sidebar.description":
    "Register sidebar icons, routes, and dividers.",
  "settings.extensions.capability.ui.overlay.label": "Draw overlays",
  "settings.extensions.capability.ui.overlay.description":
    "Register stage or window overlays above the editor.",
  "settings.extensions.capability.ui.toolbar.label": "Add toolbar entries",
  "settings.extensions.capability.ui.toolbar.description":
    "Register toolbar actions, fields, controls, dividers, and spacers.",
  "settings.extensions.capability.ui.contextMenu.label": "Add context-menu rows",
  "settings.extensions.capability.ui.contextMenu.description":
    "Register right-click menu rows for host surfaces.",
  "settings.extensions.capability.shortcuts.label": "Register shortcuts",
  "settings.extensions.capability.shortcuts.description":
    "Register categories, shortcuts, and script default bindings.",
  "settings.extensions.capability.shortcuts.read.label": "Read shortcut bindings",
  "settings.extensions.capability.shortcuts.read.description":
    "Read host shortcut bindings through the toolbar shortcut helpers.",
  "settings.extensions.capability.settings.label": "Register settings",
  "settings.extensions.capability.settings.description":
    "Register package settings and settings navigation pages.",
  "settings.extensions.capability.values.label": "Use named values",
  "settings.extensions.capability.values.description":
    "Define and update the package's own named values.",
  "settings.extensions.capability.storage.label": "Store package data",
  "settings.extensions.capability.storage.description":
    "Read and write the package's own preference storage.",
  "settings.extensions.capability.events.label": "Read host events",
  "settings.extensions.capability.events.description":
    "Subscribe to read-only document, selection, and lifecycle events.",
  "settings.extensions.capability.hooks.label": "Compose public hooks",
  "settings.extensions.capability.hooks.description":
    "Register and invoke namespaced Extension hooks with merged JSON payloads.",
  "settings.extensions.capability.services.label": "Compose Extension services",
  "settings.extensions.capability.services.description":
    "Provide or consume namespaced services from other Extensions.",
  "settings.extensions.capability.styles.label": "Add stylesheets",
  "settings.extensions.capability.styles.description":
    "Add styles scoped to the package's own panels and overlays.",
  "settings.extensions.capability.timers.label": "Use timers",
  "settings.extensions.capability.timers.description":
    "Run timeouts, intervals, and animation frames within the host timer budget.",
  "settings.extensions.capability.diagnostics.label": "Read diagnostics",
  "settings.extensions.capability.diagnostics.description":
    "Read diagnostics snapshots and control trace capture.",
  "settings.extensions.capability.hitTest.read.label": "Read chart hit tests",
  "settings.extensions.capability.hitTest.read.description":
    "Query chart objects at an explicit time without changing the editor view.",
  "settings.extensions.capability.preview.read.label": "Read preview geometry",
  "settings.extensions.capability.preview.read.description":
    "Read painted preview objects, hit-test geometry, and layout anchors.",
  "settings.extensions.capability.host.patch.label": "Legacy host patch (deprecated)",
  "settings.extensions.capability.host.patch.description":
    "A retired host-only name kept so older manifests load; it grants no handle and is never offered for new installs.",
};
