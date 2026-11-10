/**
 * The settings window: categories, every field label and description, its own
 * pages, plus the start-up view.
 *
 * The schema (`src/core/settings/types.ts`) stores *keys* here
 * rather than text, so `MessageKey` is what makes a typo in a label a compile
 * error instead of a key rendered on screen. Group headings and search are
 * resolved through the same catalog, because a user searches what they see.
 *
 * Keys follow one shape per kind of text:
 *   settings.category.<id>.label         one settings category
 *   settings.field.<id>.label|description  one settings row
 *   settings.group.<id>                 a row heading shared by several rows
 *   settings.option.<fieldId>.<value>   one option of a select row
 *   settings.*                          the pages that own their own markup
 *
 * A `description` is a full sentence, so it ends with the language's full stop;
 * `*.label` and option text stay fragmentary. The catalog test enforces it.
 */
export default {
  "settings.group.localAi": "AI-assisted development",
  "settings.group.runtimePorts": "Runtime ports",
  "settings.field.frontend-port.label": "Frontend port",
  "settings.field.frontend-port.description": "Port used by the local frontend development host.",
  "settings.field.backend-port.label": "Backend port",
  "settings.field.backend-port.description": "Port used by the local chart service.",
  "settings.field.ai-port.label": "AI service port",
  "settings.field.ai-port.description": "Loopback port used by the Code Cell bridge.",
  "settings.restartRequired": "Takes effect after restarting the application",
  "settings.field.code-execution-enabled.label": "Allow AI code cells",
  "settings.field.code-execution-enabled.description":
    "Allow sandboxed JavaScript cells to edit this chart and the assets of its library project; they cannot read or change other library projects, or save or delete documents.",
  "settings.codeCell.enableWarning.title": "Allow code cells",
  "settings.codeCell.enableWarning.description":
    "Code cells run sandboxed JavaScript that can edit this chart and the assets of its library project, but cannot read or change other library projects, access the network or host DOM, or save or delete documents. Enable only if you trust the code.",
  "settings.codeCell.enableWarning.confirm": "Allow code cells",
  "settings.field.code-cell-access.label": "AI access details",
  "settings.codeCell.cellGuide": "Code-cell guide",
  "settings.codeCell.cellRun": "Code-cell run",
  "settings.codeCell.nothingEnabled": "Enable AI code cells to expose an endpoint.",
  "settings.codeCell.copyPrompt": "Copy AI prompt",
  "settings.codeCell.copyPromptSuccess": "Prompt copied",
  "settings.codeCell.copyPromptFailed": "Could not copy the prompt",
  "settings.codeCell.promptEdit": "Adjust prompt",
  "settings.codeCell.promptTitle": "AI prompt",
  "settings.codeCell.aiPrompt":
    "You are helping edit a chart in RPE Redux through the local code-cell API.\n" +
    "1. Read the guide at {guide}; it contains the read/write SDK, chart field names, and the transaction grammar available to this installation.\n" +
    '2. Run a cell with POST {run}, header "Content-Type: application/json", body {"source":"..."}. Inspect ok; for a transaction inspect value.status and value.issues.\n' +
    "3. Read the chart first with redux.document.state() and redux.chart.snapshot(); check BPMList and META.offset. Use redux.document.state().fingerprint as the revision you are editing, and pass it as expected.chartFingerprint in the run body when a stale write must fail before it starts.\n" +
    "4. To edit, call redux.transaction.apply(request) inside the cell. It can replace timing.bpmList, patch metadata, insert judge lines, and insert/update/delete notes and events; it cannot delete judge lines or create/open/save/close/delete the document. Notes and events use beat triples, not seconds.\n" +
    "5. To manage assets, use the redux.library.current handle for the open document's library project, then call its addAsset / removeAsset methods. Other library projects are not readable or writable. Ask the user to save the document before asset commits, and update metadata or line Texture references in a transaction when an asset changes. Project deletion is not available.\n" +
    "6. Inspect the returned status and issues, re-read the changed objects, then summarize what changed. A conflict means the chart changed: re-read and rebuild the request instead of retrying the stale one.",
  "settings.codeCell.desktopOnly":
    "AI-assisted development is available in the desktop application.",
  "settings.startup.reportTitle": "RPE Redux — startup failure",
  "settings.startup.reportTime": "Time: {time}",
  "settings.startup.reportRuntime": "Runtime: {runtime}",
  "settings.startup.logGuide":
    "The call stack was saved automatically. Please upload frontend.log with your bug report.",
  "settings.startup.logPath": "Log file: {path}",
  "settings.startup.logUnavailable":
    "The log file could not be written. Copy the report below for your bug report.",
  "settings.startup.copyReport": "Copy error report",
  "settings.startup.copySuccess": "Report copied",
  "settings.startup.copyFailed": "Copy failed",
  "settings.startup.openLogs": "Open log folder",

  // ------------------------------------------------------------- categories
  "settings.category.general.label": "General",
  "settings.category.appearance.label": "Appearance",
  "settings.category.editor.label": "Editor",
  "settings.category.audio.label": "Audio",
  "settings.category.extensions.label": "Extensions",
  "settings.category.shortcuts.label": "Shortcuts",
  "settings.category.help.label": "Help",
  "settings.category.about.label": "About",
  "settings.category.developer.label": "Developer",

  // ------------------------------------------------------- row group headings
  "settings.group.files": "Files & data",
  "settings.group.display": "Display",
  "settings.group.pointer": "Pointer & input",
  "settings.group.advancedEditing": "Advanced editing",
  "settings.group.interface": "Interface",
  "settings.group.noteSkin": "Note skin",
  "settings.group.timeline": "Timeline & input",
  "settings.group.events": "Events",
  "settings.group.preview": "Live preview",
  "settings.group.audioPlayback": "Playback & analysis",
  "settings.group.editingNoteFeatures": "Note properties",
  "settings.group.editingEventFeatures": "Event properties",
  "settings.group.editingLineFeatures": "Judge-line properties",

  "settings.field.editing-note-speed-enabled.label": "Note speed",
  "settings.field.editing-note-y-offset-enabled.label": "Y offset",
  "settings.field.editing-note-visible-time-enabled.label": "Visible time",
  "settings.field.editing-fake-notes-enabled.label": "Fake Note",
  "settings.field.editing-note-size-enabled.label": "Note size",
  "settings.field.editing-note-alpha-enabled.label": "Note alpha",
  "settings.field.editing-note-color-enabled.label": "Colour",
  "settings.field.editing-note-color-enabled.description":
    "Show the custom note colour field and batch colour channels.",
  "settings.field.editing-note-hitsound-enabled.label": "Hit sound",
  "settings.field.editing-note-hitsound-enabled.description":
    "Show the custom note hit-sound field and batch hit-sound action.",

  "settings.field.editing-event-layers-enabled.label": "Layers 1-3",
  "settings.field.editing-extended-events-enabled.label": "Extended events (special layer)",
  "settings.field.editing-linkgroup-enabled.label": "Linkgroup",
  "settings.field.editing-easing-range-enabled.label": "Easing range limits",
  "settings.field.editing-bezier-enabled.label": "Bézier curves",
  "settings.field.editing-line-extended-enabled.label": "Extended line properties",
  "settings.field.editing-parent-lines-enabled.label": "Parent and child lines",
  "settings.field.editing-line-bpmfactor-enabled.label": "BPM Factor",
  "settings.field.editing-line-anchor-enabled.label": "Anchor",
  "settings.editingAccess.aiUse": "AI access",
  "settings.editingAccess.visible": "Shown",
  "settings.editingAccess.aiUseCheckbox": "Allow AI to read and write: {field}",
  "settings.editingAccess.visibleCheckbox": "Show and allow editing: {field}",

  "settings.group.background": "Background",
  "settings.group.coverBackground": "Page backgrounds",
  "settings.group.beatLines": "Beat lines",
  "settings.group.judgeLines": "Judgement lines",
  "settings.group.timelineBeatLines": "Timeline beat lines",
  "settings.group.timelineEvents": "Event editing",
  "settings.group.notes": "Notes",
  "settings.group.wheel": "Wheel",
  "settings.group.timelineLayout": "Layout & batch editing",
  "settings.group.overview": "Timeline overview",
  "settings.group.noteOverlap": "Note overlap",
  "settings.field.render-fps.label": "Frame-rate cap",
  "settings.field.multi-line-event-window-count.label": "Same-screen event-window count",
  "settings.option.render-fps.30": "30 fps",
  "settings.option.render-fps.60": "60 fps",
  "settings.option.render-fps.90": "90 fps",
  "settings.option.render-fps.120": "120 fps",
  "settings.option.render-fps.144": "144 fps",
  "settings.field.window-display-mode.label": "Window mode",
  "settings.option.window-display-mode.windowed": "Windowed",
  "settings.option.window-display-mode.fullscreen": "Fullscreen",
  "settings.option.window-display-mode.exclusive": "Exclusive (compatibility mode)",
  "settings.field.window-resolution.label": "Window resolution",
  "settings.option.window-resolution.auto": "Automatic",
  "settings.option.window-resolution.1280x720": "1280 × 720",
  "settings.option.window-resolution.1600x900": "1600 × 900",
  "settings.option.window-resolution.1920x1080": "1920 × 1080",
  "settings.option.window-resolution.2560x1440": "2560 × 1440",
  "settings.option.window-resolution.3840x2160": "3840 × 2160",
  "settings.group.livePreviewLines": "Preview display",
  "settings.group.previewScope": "Preview scope",

  "settings.group.volume": "Volume and hit sounds",
  "settings.group.backup": "Application data",
  "settings.group.extensions": "Extensions",

  "settings.extensions.disclaimer": "Sandboxed runtime",
  "settings.extensions.disclaimer.label": "I understand that Extensions run in an isolated sandbox",
  "settings.extensions.disclaimer.description":
    "Extensions run sandboxed without host DOM, IPC, or network access. Enable only packages you trust.",
  "settings.extensions.risk":
    "Extensions run in an isolated sandbox and can only reach the capability-gated bridge exposed to them.",
  "settings.extensions.empty": "No Extensions are loaded.",
  "settings.extensions.reorderHandle": "Drag {name} to change load order",
  "settings.extensions.dataOnly.label": "Data package (no code)",
  "settings.extensions.error.unknown": "The Extension operation failed.",
  "settings.extensions.error.detail": "Extension error: {value}",
  "settings.extensions.error.entryActivateRequired":
    "The Extension entry must provide an activate function.",
  "settings.extensions.error.invalidTranslations":
    "The Extension i18n path or translations are invalid: {value}.",
  "settings.extensions.error.capabilityDenied":
    "The Extension tried to use a capability it did not declare.",
  "settings.extensions.error.invalidCapabilities":
    "The Extension declares an invalid capability list: {value}.",
  "settings.extensions.error.invalidCollaboration":
    "The Extension declares an invalid collaboration scope: {value}.",
  "settings.extensions.error.incompatibleHostVersion":
    "This Extension requires host version {required}, but this application is {version}.",
  "settings.extensions.error.invalidHostVersionRange":
    "This Extension declares an invalid host version range ({required}); this application is {version}.",
  "settings.extensions.error.invalidProvenance":
    "The Extension declares invalid provenance: {value}.",
  "settings.extensions.error.consentStale":
    "The Extension content changed since it was trusted. Review it and confirm again.",
  "settings.extensions.error.dependencyMissing": "A required Extension dependency is not loaded.",
  "settings.extensions.error.dependencyDisabled": "A required Extension dependency is not enabled.",
  "settings.extensions.error.dependencyCycle":
    "The Extension dependency graph contains a cycle: {value}.",
  "settings.extensions.error.conflictEnabled":
    "The Extension conflicts with enabled Extension: {value}.",
  "settings.extensions.error.dependentEnabled":
    "An enabled Extension depends on this Extension: {value}.",
  "settings.extensions.installed.title": "Extensions",
  "settings.extensions.install.open": "Install from GitHub…",
  "settings.extensions.install.safeModeHint":
    "Extension safe mode is active; restart without the safe-mode flag before installing a package.",
  "settings.extensions.install.title": "Install Extension from GitHub",
  "settings.extensions.install.description":
    "Paste a GitHub repository or a /tree/<ref>/<path> link. Inspecting the link reads the manifest and declared package files; nothing is installed or executed until you confirm the review.",
  "settings.extensions.install.source": "GitHub link",
  "settings.extensions.install.sourceDescription":
    "A repository root works when it contains one manifest.json. Use a /tree/<ref>/<path> link for a package inside a larger repository.",
  "settings.extensions.install.sourcePlaceholder":
    "https://github.com/owner/repo/tree/main/extensions/example",
  "settings.extensions.install.inspect": "Inspect package",
  "settings.extensions.install.inspecting": "Inspecting…",
  "settings.extensions.install.reviewTitle": "Install {name}?",
  "settings.extensions.install.reviewDescription":
    "This is the exact package the host will write and enable. Check the author, description, source, engine range, capabilities, and files before you continue.",
  "settings.extensions.install.back": "Back",
  "settings.extensions.install.confirm": "Install and enable",
  "settings.extensions.install.installing": "Installing…",
  "settings.extensions.install.successTitle": "Extension installed",
  "settings.extensions.install.success": "{id} is installed and enabled.",
  "settings.extensions.install.successDisabled":
    "{id} was updated and stays disabled because it was disabled before the update.",
  "settings.extensions.install.successHint":
    "The package is available immediately. Open its scripts, panels, or sidebar entries from the editor.",
  "settings.extensions.install.unknownAuthor": "Author not declared",
  "settings.extensions.install.noDescription":
    "The package does not declare an English description.",
  "settings.extensions.install.id": "Package id",
  "settings.extensions.install.engine": "Host version requirement",
  "settings.extensions.install.engineMissing": "not declared",
  "settings.extensions.install.repository": "Source",
  "settings.extensions.install.commit": "Commit",
  "settings.extensions.install.content": "Content",
  "settings.extensions.install.codeContent": "Code package",
  "settings.extensions.install.files": "{count} package files",
  "settings.extensions.install.bytes": "{count} bytes",
  "settings.extensions.install.risk":
    "Install and enable only if you trust this author and are willing to run this code. {notice}",
  "settings.extensions.install.error.code": "Error code",
  "settings.extensions.install.error.phase": "Failed phase",
  "settings.extensions.install.error.source": "Request",
  "settings.extensions.install.error.status": "HTTP status",
  "settings.extensions.install.error.detail": "Technical detail",
  "settings.extensions.install.error.cause": "Underlying cause",
  "settings.extensions.install.error.hint": "What to try",
  "settings.extensions.install.error.desktopOnly":
    "Extension installation is only available in the desktop application.",
  "settings.extensions.install.error.invalidUrl": "The GitHub link is not valid.",
  "settings.extensions.install.error.unsupportedSource":
    "Only GitHub repository and raw links are supported.",
  "settings.extensions.install.error.network": "The network request failed.",
  "settings.extensions.install.error.timeout": "The request timed out.",
  "settings.extensions.install.error.httpError": "The server returned an HTTP error.",
  "settings.extensions.install.error.rateLimited": "The GitHub API rate limit was reached.",
  "settings.extensions.install.error.manifestMissing": "No Extension manifest was found.",
  "settings.extensions.install.error.manifestMultiple":
    "The repository contains several Extension packages.",
  "settings.extensions.install.error.manifestParse": "The manifest is not valid JSON.",
  "settings.extensions.install.error.manifestInvalid":
    "The manifest did not pass the host validation rules.",
  "settings.extensions.install.error.packageFileMissing": "A declared package file is missing.",
  "settings.extensions.install.error.packageFileTooLarge": "A package file is too large.",
  "settings.extensions.install.error.packageFileInvalid": "A package file is invalid.",
  "settings.extensions.install.error.repoTooLarge":
    "The GitHub repository is too large to inspect.",
  "settings.extensions.install.error.packageLimit":
    "The package or marketplace exceeds a count limit.",
  "settings.extensions.install.error.writeFailed": "The host could not write the package folder.",
  "settings.extensions.install.error.loadFailed":
    "The package was written but the runtime did not register it.",
  "settings.extensions.install.error.shadowed":
    "Another root already provides an Extension with the same id.",
  "settings.extensions.install.error.enableFailed":
    "The package was installed but could not be enabled.",
  "settings.extensions.install.error.removeFailed":
    "The Extension is still in use and was not removed.",
  "settings.extensions.install.error.safeMode":
    "Extension installation is disabled while Extension safe mode is active.",
  "settings.extensions.install.error.notInstalled": "The Extension is not installed.",
  "settings.extensions.install.error.marketplaceInvalid":
    "The marketplace URL or JSON document is invalid.",
  "settings.extensions.install.error.catalogTooLarge": "The marketplace catalog is too large.",
  "settings.extensions.install.error.marketplaceSchema":
    "The marketplace document does not match the catalog schema.",
  "settings.extensions.install.error.marketplaceEntry": "A marketplace entry is invalid.",
  "settings.extensions.install.error.unknown": "The install failed for an unknown reason.",
  "settings.extensions.install.phase.input": "Input",
  "settings.extensions.install.phase.marketplace": "Marketplace",
  "settings.extensions.install.phase.resolve": "Repository resolution",
  "settings.extensions.install.phase.download": "File download",
  "settings.extensions.install.phase.validate": "Validation",
  "settings.extensions.install.phase.persist": "Writing the package",
  "settings.extensions.install.phase.load": "Runtime registration",
  "settings.extensions.install.phase.enable": "Activation",
  "settings.extensions.consent.title": "Permissions requested",
  "settings.extensions.consent.description":
    "This package declares the capabilities below. Read access is preselected; write and sensitive access starts unchecked, and every row must be confirmed before installation.",
  "settings.extensions.consent.empty": "This package declares no capabilities.",
  "settings.extensions.consent.required": "Still unchecked:",
  "settings.extensions.consent.groups.read": "Read-only",
  "settings.extensions.consent.groups.write": "Writes host state",
  "settings.extensions.consent.groups.sensitive": "Sensitive",
  "settings.extensions.consent.sensitiveConfirm.title": "Allow a sensitive capability?",
  "settings.extensions.consent.sensitiveConfirm.description": "This package requests {capability}.",
  "settings.extensions.consent.sensitiveConfirm.detail":
    "Sensitive capabilities can change documents, library assets, or host dialogs on your behalf. Allow it only if you trust this package.",
  "settings.extensions.consent.sensitiveConfirm.confirm": "Allow capability",
  "settings.extensions.consent.sensitiveConfirm.cancel": "Keep unchecked",
  "settings.extensions.review.safeMode": "Extension safe mode is active: {value}",
  "settings.extensions.safeMode.query": "the launch URL requested it",
  "settings.extensions.safeMode.flag": "the desktop host requested it",
  "settings.extensions.safeMode.interrupted": "the previous Extension startup did not finish",
  "settings.extensions.safeMode.unknown": "Extension code was skipped",
  "settings.extensions.action.enable": "Enable",
  "settings.extensions.action.disable": "Disable",
  "settings.extensions.action.reload": "Reload",
  "settings.extensions.action.remove": "Remove",
  "settings.extensions.remove.title": "Remove Extension?",
  "settings.extensions.remove.description":
    "Remove {name} from the loaded Extensions? The package files stay on disk; the Extension reappears if its manifest changes or you install it again.",
  "settings.extensions.remove.installedDescription":
    "Remove {name} from the loaded Extensions and delete its managed package folder? This cannot be undone.",

  "settings.backup.description":
    "Export settings and the chart library, imported theme packages, external note skins, and extensions.",
  "settings.backup.action": "Export application-data backup",
  "settings.backup.busy": "Preparing backup…",
  "settings.backup.success": "Backup exported to {path}.",
  "settings.backup.error": "Backup export failed: {message}",
  "settings.backup.preferenceWarning": "Some preferences are not durable yet: {message}",
  "settings.backup.part.database": "Settings and chart library",
  "settings.backup.part.themes": "Imported themes",
  "settings.backup.part.skins": "External note skins",
  "settings.backup.part.extensions": "External extensions",
  "settings.backup.noParts": "Select at least one item to include.",
  "settings.backup.import": "Import backup…",
  "settings.backup.importConfirmTitle": "Replace selected app data?",
  "settings.backup.importConfirmDescription":
    "The selected parts are overwritten from the backup file.",
  "settings.backup.importSuccess": "Restored {count} item(s).",
  "settings.backup.importRestart":
    "Restored {count} item(s). Settings and library take effect the next time the app starts.",
  "settings.backup.resourceConflict":
    "The external resource cannot be restored because the destination is occupied or unsafe: {path}",
  "settings.backup.importError": "Backup import failed: {message}",

  // ------------------------------------------------------- appearance (8 rows)
  "settings.field.appearance-skin.label": "Interface theme",
  "settings.field.realtime-alpha.label": "Overlay preview opacity",

  // --------------------------------------------------------- editing (14 rows)
  "settings.field.editor-preview-background-enabled.label": "Editor preview background",
  "settings.field.editor-preview-background-enabled.description":
    "Shows the chart or custom image behind the editor preview.",
  "settings.field.editor-preview-background-blur.label": "Editor preview background blur",
  "settings.field.editor-preview-background-brightness.label":
    "Editor preview background brightness",
  "settings.field.custom-background.label": "Custom background image",
  "settings.field.custom-background.error": "The custom background could not be loaded.",
  "settings.field.welcome-cover-background-enabled.label": "Welcome page background",
  "settings.field.welcome-cover-background-enabled.description":
    "Shows the selected chart's cover behind the home page.",
  "settings.field.welcome-cover-background-blur.label": "Welcome page background blur",
  "settings.field.welcome-cover-background-brightness.label": "Welcome page background brightness",
  "settings.field.editor-cover-background-enabled.label": "Editor window background",
  "settings.field.editor-cover-background-enabled.description":
    "Shows the chart cover behind the editor window; the custom background overrides it.",
  "settings.field.editor-cover-background-blur.label": "Editor window background blur",
  "settings.field.editor-cover-background-brightness.label": "Editor window background brightness",
  "settings.field.bar-width.label": "Beat line width",
  "settings.field.bar-alpha.label": "Beat line brightness",
  "settings.field.timeline-playhead-height.label": "Playhead line distance from bottom",
  "settings.field.timeline-playhead-width.label": "Playhead line thickness",
  "settings.field.timeline-playhead-color.label": "Playhead line color",
  "settings.field.default-line-thickness.label": "Default judgement-line width",
  "settings.field.default-line-color.label": "Default judgement-line colour",
  "settings.field.timeline-event-marquee-color.label": "Event marquee colour",
  "settings.field.timeline-note-marquee-color.label": "Note marquee colour",
  "settings.field.timeline-sweep-add-color.label": "Left-button sweep colour",
  "settings.field.timeline-sweep-add-color.description":
    "Colour used while left-button sweep selection adds timeline objects.",
  "settings.field.timeline-sweep-remove-color.label": "Right-button sweep colour",
  "settings.field.timeline-sweep-remove-color.description":
    "Colour used while right-button sweep selection removes timeline objects.",
  "settings.field.selected-note-color.label": "Selected note colour",
  "settings.field.selected-event-color.label": "Selected event colour",
  "settings.field.collaboration-selected-note-color.label": "Collaboration selected note colour",
  "settings.field.collaboration-selected-event-color.label": "Collaboration selected event colour",
  "settings.field.default-particle-color.label": "Default particle colour",
  "settings.field.particle-effects-enabled.label": "Render hit particles",
  "settings.field.particle-effects-enabled.description":
    "Draws the skin hit animation and its square burst at every hit during preview playback.",
  "settings.field.note-size.label": "Preview note size",
  "settings.field.timeline-note-size.label": "Timeline note size",
  "settings.field.hit-effect-size.label": "Hit effect size",
  "settings.field.note-opacity.label": "Note opacity",
  "settings.field.highlight-notes.label": "Highlight simultaneous notes",
  "settings.field.highlight-notes.description": "Highlights notes that share the same hit time.",
  "settings.field.event-cut-density.label": "Event cut density",
  "settings.field.event-cut-density.description":
    "Multiplies the current beat-line count when cutting events; higher values cut more finely.",
  "settings.field.xy-binding.label": "Global X/Y binding",
  "settings.field.xy-binding.description":
    "Creating, deleting, or pasting an X/Y event also syncs the matching time span on the other axis.",
  "settings.field.event-value-threshold.label": "Minimum width for event values",
  "settings.field.event-value-threshold.description":
    "Hides event values when the bar is narrower than this many pixels.",
  "settings.field.event-curve-threshold.label": "Minimum width for event curves",
  "settings.field.event-curve-threshold.description":
    "Hides easing curves when the event bar is narrower than this many pixels.",
  "settings.field.event-curves-enabled.label": "Show event curves",
  "settings.field.event-curves-enabled.description":
    "Draws easing curves once the event bar reaches the width threshold.",
  "settings.field.event-opacity.label": "Event bar opacity",
  "settings.field.event-bar-width.label": "Event bar width ratio",
  "settings.field.note-source-hover.label": "Mark the source line when hovering a note",

  // -------------------------------------------------------- timeline (5 rows)
  "settings.field.scroll-speed.label": "Wheel seek speed",
  "settings.field.timeline-exclusive-width.label": "Exclusive timeline width",
  "settings.field.multi-edit-history-limit.label": "Batch edit history entries",
  "settings.field.multi-edit-history-limit.description":
    "Applied parameter sets kept for reuse; newest first.",
  "settings.field.multi-line-merge-notes.label": "Merge notes",
  "settings.field.multi-line-merge-notes.description":
    "Show notes from selected judge lines in one multi-line editing field.",
  "settings.field.multi-line-note-line-numbers.label":
    "Show judge-line numbers while merging notes",
  "settings.field.scroll-acceleration.label": "Accelerate wheel scrolling",
  "settings.field.scroll-acceleration.description":
    "Makes repeated wheel edits use larger value steps.",
  "settings.field.key-press-label-enabled.label": "Show key-press label",
  "settings.field.mouse-trail-enabled.label": "Show mouse trail",
  "settings.field.hover-guides-enabled.label": "Highlight nearest grid lines",
  "settings.field.timeline-density-bars-enabled.label": "Show timeline overview bars",
  "settings.field.timeline-density-bars-enabled.description":
    "Shows the overview bars on both sides of the timeline.",
  "settings.field.timeline-overview-strip-width.label": "Overview bar width",
  "settings.field.timeline-overview-strip-width.description":
    "Width of the overview bars on both sides of the timeline.",
  "settings.field.timeline-hover-preview-enabled.label": "Show overview hover preview",
  "settings.field.note-overlap-threshold.label": "Note overlap warning distance",
  "settings.field.note-overlap-threshold.description":
    "Mark same-beat notes closer than this many units as overlapping; 0 disables the warning.",
  "settings.field.timeline-grid-color-1.label": "1/1 beat-line color",
  "settings.field.timeline-grid-color-2.label": "1/2 beat-line color",
  "settings.field.timeline-grid-color-3.label": "1/3 beat-line color",
  "settings.field.timeline-grid-color-4.label": "1/4 beat-line color",
  "settings.field.timeline-grid-color-6.label": "1/6 beat-line color",
  "settings.field.timeline-grid-color-8.label": "1/8 beat-line color",
  "settings.field.timeline-grid-color-12.label": "1/12 beat-line color",
  "settings.field.timeline-grid-color-16.label": "1/16 beat-line color",
  "settings.field.timeline-grid-color-default.label": "Default beat-line color",
  "settings.field.timeline-vertical-grid-color.label": "Vertical grid line color",
  "settings.field.timeline-vertical-grid-color.description":
    "Shared by the note and event timelines when a vertical grid line is not highlighted.",
  "settings.field.timeline-vertical-grid-center-color.label": "Center vertical grid line color",
  "settings.field.timeline-vertical-grid-center-color.description":
    "Used by the note timeline's center line when the configured grid includes one.",
  "settings.field.timeline-grid-highlight-color.label": "Highlighted grid line color",
  "settings.field.timeline-grid-highlight-color.description":
    "Semi-transparent color painted over the horizontal and vertical grid lines nearest the pointer.",

  // -------------------------------------------------------- playback
  "settings.field.preview-show-game-ui.label": "Show in-game UI in preview",
  "settings.field.preview-show-game-ui.description":
    "Overlay score, combo, judgement and other game UI elements in the preview.",
  "settings.field.preview-game-ui-corner-compression.label": "Compress long GameUI corner text",
  "settings.field.preview-game-ui-corner-compression.description":
    "Horizontally fit long song names and levels between the preview edges and the center HUD.",
  "settings.field.line-numbers.label": "Show judgement-line numbers",
  "settings.field.line-arrows.label": "Show direction arrows",
  "settings.field.current-line-color.label": "Current judgement-line colour",
  "settings.field.merge-line-numbers.label": "Merge nearby numbers pointing the same way",
  "settings.field.merge-line-numbers.description":
    "Draws overlapping same-direction line numbers once to reduce dense-preview clutter.",
  "settings.field.pick-preview-lines.label": "Click a preview line to switch the edited line",
  "settings.field.preview-non-current-opacity.label": "Non-current line opacity",

  "settings.field.preserve-pitch.label": "Keep pitch when changing speed",

  // ----------------------------------------------------------- audio (3 rows)
  "settings.field.volume.label": "Music volume",
  "settings.field.background-volume.label": "Background volume",
  "settings.field.background-volume.description":
    "Volume relative to the current level while the window is in the background.",
  "settings.hitsound.slot.tap": "Tap / Hold volume",
  "settings.hitsound.slot.drag": "Drag volume",
  "settings.hitsound.slot.flick": "Flick volume",
  "settings.hitsound.slot.custom": "Custom hit sound volume",
  "settings.hitsound.offset.tap": "Tap / Hold hit-sound offset (ms)",
  "settings.hitsound.offset.drag": "Drag hit-sound offset (ms)",
  "settings.hitsound.offset.flick": "Flick hit-sound offset (ms)",
  "settings.hitsound.offset.custom": "Custom hit-sound offset (ms)",
  "settings.field.audio-analysis-enabled.label": "Show waveform in the note area",
  "settings.field.audio-analysis-alpha.label": "Waveform opacity",
  "settings.field.audio-analysis-width.label": "Waveform width",
  "settings.field.audio-analysis-curve.label": "Waveform emphasis",

  // ----------------------------------------------------- files & saving (3 rows)
  "settings.field.session-restore.label": "Recover the last chart after a crash or update",
  "settings.field.autosave-enabled.label": "Enable autosave",
  "settings.field.autosave-seconds.label": "Autosave interval",
  "settings.field.autosave-limit.label": "Backups kept per chart",
  "settings.field.open-data-folder.label": "Open application data folder",
  "settings.field.open-data-folder.description":
    "Open the folder that contains the database, logs, and cached resources.",
  // -------------------------------------------------------- select options
  // ------------------------------------------------------ skins & appearance

  // ------------------------------------------------------ the settings window

  "settings.reset.label": "Reset {name} to its default",
  "settings.reset.tooltip": "Reset to default",
  "settings.search.heading": "Search “{query}”",
  "settings.search.emptyTitle": "No matching settings",
  "settings.search.emptyDescription": "Try a different word or clear the search.",
  "settings.search.skinKeywords": "note skin texture png zip",
  "settings.search.backupKeywords": "backup export database preferences library",
  "settings.search.extensionKeywords":
    "extension plugin script import sandbox isolated github marketplace install",
  "settings.search.helpKeywords":
    "help update survey changelog release onboarding guide walkthrough",
  "settings.search.aboutKeywords": "about version author rights licence license credits",
  "settings.search.developerKeywords":
    "developer environment runtime version channel system GPU path performance HUD note borders diagnostic bundle logs",
  "settings.search.shortcutsKeywords": "shortcut key binding hotkey keyboard mouse wheel",

  "settings.action.close": "Close settings",
  "settings.action.openLinkFailed": "Could not open the link: {message}",
  "settings.action.openDataFolderFailed": "Could not open the application data folder: {message}",
  "settings.control.file.choose": "Choose image",
  "settings.control.file.replace": "Replace image",
  "settings.control.file.none": "No image selected",

  // ------------------------------------------------------------- note skins
  "settings.skin.action.importTheme": "Import theme…",
  "settings.skin.action.importPhira": "Import skin pack…",
  "settings.skin.action.exportPhira": "Export skin pack…",
  "settings.skin.action.edit": "Edit",
  "settings.skin.action.newPhira": "Add a skin…",
  "settings.theme.preview.label": "Theme preview",
  "settings.theme.preview.primary": "Confirm",
  "settings.theme.preview.secondary": "Play",
  "settings.theme.preview.iconButton": "Theme settings",
  "settings.theme.preview.select": "Theme preview sample",
  "settings.theme.preview.option": "Sample control",
  "settings.theme.preview.workspace": "Workspace",
  "settings.theme.preview.inspector": "Inspector",
  "settings.theme.preview.status": "Status",
  "settings.theme.group.layout": "Layout",
  "settings.theme.group.surface": "Surface",
  "settings.theme.group.motion": "Motion",
  "settings.theme.trait.density.compact": "Compact",
  "settings.theme.trait.density.comfortable": "Comfortable",
  "settings.theme.trait.density.spacious": "Spacious",
  "settings.theme.trait.inspector.docked": "Docked inspector",
  "settings.theme.trait.inspector.floating": "Floating inspector",
  "settings.theme.trait.inspector.overlay": "Overlay inspector",
  "settings.theme.trait.side.left": "Inspector left",
  "settings.theme.trait.side.right": "Inspector right",
  "settings.theme.trait.sidebar.rail": "Rail sidebar",
  "settings.theme.trait.sidebar.floating": "Floating rail",
  "settings.theme.trait.sidebar.top": "Top navigation",
  "settings.theme.trait.sidebar.inspector": "Inspector panels grid",
  "settings.theme.trait.toolbar.docked": "Docked toolbar",
  "settings.theme.trait.toolbar.floating": "Floating toolbar",
  "settings.theme.trait.toolbarPlacement.top": "Toolbar on top",
  "settings.theme.trait.toolbarPlacement.left": "Left toolbar",
  "settings.theme.trait.toolbarFlow.rows": "Registered rows",
  "settings.theme.trait.toolbarFlow.single": "Single flow",
  "settings.theme.trait.toolbarFlow.grid": "Grid flow",
  "settings.theme.trait.toolbarColumns.two": "2-column grid",
  "settings.theme.trait.toolbarColumns.three": "3-column grid",
  "settings.theme.trait.toolbarColumns.four": "4-column grid",
  "settings.theme.trait.titlebar.compact": "Compact title bar",
  "settings.theme.trait.titlebar.normal": "Normal title bar",
  "settings.theme.trait.titlebar.tall": "Tall title bar",
  "settings.theme.trait.windowControls.system": "System caption buttons",
  "settings.theme.trait.windowControls.compact": "Compact caption buttons",
  "settings.theme.trait.windowControls.capsule": "Capsule caption buttons",
  "settings.theme.trait.menu.hamburger": "Hamburger application menu",
  "settings.theme.trait.menu.expanded": "Expanded menu bar",
  "settings.theme.trait.transport.toolbar": "Transport in toolbar",
  "settings.theme.trait.transport.floating": "Floating transport",
  "settings.theme.trait.transportAnchor.topLeft": "Top left",
  "settings.theme.trait.transportAnchor.topRight": "Top right",
  "settings.theme.trait.transportAnchor.bottomLeft": "Bottom left",
  "settings.theme.trait.transportAnchor.bottomRight": "Bottom right",
  "settings.theme.trait.transportDraggable": "Draggable",
  "settings.theme.trait.transportFixed": "Fixed position",
  "settings.theme.trait.customEmpty": "Custom empty inspector",
  "settings.theme.trait.customRail": "Custom rail anatomy",
  "settings.theme.trait.customMenu": "Custom menu trigger",
  "settings.theme.trait.customWindow": "Custom window controls",
  "settings.theme.customUi.badge": "custom UI",
  "settings.theme.customUi.title": "Install this theme's custom UI?",
  "settings.theme.customUi.description":
    "This theme replaces: {surfaces}. Themes are data-only frontend packages: they cannot access the SDK, files, network, or host DOM. Custom anatomy changes what a host button shows; the action still belongs to the host.",
  "settings.theme.customUi.confirm": "Install theme",
  "settings.theme.customUi.separator": ", ",
  "settings.theme.customUi.inspectorEmpty": "empty inspector",
  "settings.theme.customUi.railItem": "rail item anatomy",
  "settings.theme.customUi.menuTrigger": "menu trigger anatomy",
  "settings.theme.customUi.windowControl": "window control anatomy",
  "settings.theme.trait.statusbar.docked": "Docked status bar",
  "settings.theme.trait.statusbar.floating": "Floating status bar",
  "settings.theme.trait.statusbar.hidden": "No status bar",
  "settings.theme.trait.shape.square": "Square corners",
  "settings.theme.trait.shape.soft": "Soft corners",
  "settings.theme.trait.shape.round": "Round corners",
  "settings.theme.trait.material.solid": "Solid surfaces",
  "settings.theme.trait.material.raised": "Raised surfaces",
  "settings.theme.trait.material.glass": "Glass surfaces",
  "settings.theme.trait.material.flat": "Flush surfaces",
  "settings.theme.trait.pattern.none": "Plain backdrop",
  "settings.theme.trait.pattern.grid": "Grid backdrop",
  "settings.theme.trait.pattern.dots": "Dot backdrop",
  "settings.theme.trait.pattern.scanlines": "Scanline backdrop",
  "settings.theme.trait.ambient.none": "No ambient light",
  "settings.theme.trait.ambient.aurora": "Aurora ambient",
  "settings.theme.trait.ambient.pulse": "Pulse ambient",
  "settings.theme.trait.motion.none": "No motion",
  "settings.theme.trait.motion.subtle": "Subtle motion",
  "settings.theme.trait.motion.expressive": "Expressive motion",
  "settings.theme.trait.hover.none": "No hover feedback",
  "settings.theme.trait.hover.lift": "Hover lift",
  "settings.theme.trait.hover.glow": "Hover glow",
  "settings.theme.trait.entrance.none": "No entrance",
  "settings.theme.trait.entrance.fade": "Fade entrance",
  "settings.theme.trait.entrance.rise": "Rise entrance",
  "settings.theme.trait.entrance.slide": "Slide entrance",
  "settings.skin.error.invalidTheme":
    "That file is not a valid theme package. Layout and motion values must use the documented presets.",
  "settings.skin.notice.themeImported": "Imported theme: {name}",
  "settings.skin.field.label": "Note skin",
  "settings.skin.option.missing": "Missing: {id}",
  "settings.skin.warning.missingActive":
    "The active note skin could not be found: {id}. Choose another skin.",
  "settings.skin.error.list": "Could not read the skin library: {message}",
  "settings.skin.error.action": "Skin package action failed: {message}",
  "settings.skin.error.bundledUnavailable": "The bundled note skin is unavailable.",
  "settings.skin.error.bundledAssetUnavailable": "A bundled note skin asset is unavailable: {name}",
  // ------------------------------------------------------------ help / about
  "settings.help.version": "Version {version}",
  "settings.version.test": "Beta",
  "settings.help.upstreamBy": "Upstream by cmdysj",
  "settings.help.poweredBy": "Powered by SOLST-II",
  "settings.help.rightsLine": "All rights remain with their respective holders.",
  "settings.help.licenseLine": "PolyForm Noncommercial License 1.0.0",
  "settings.help.solstLabel": "SOLST-II logo",
  "settings.field.survey.label": "Survey",
  "settings.field.docs.label": "Extension development docs",
  "settings.field.docs.openFailed": "Could not open the extension development docs: {message}",
  "settings.field.onboarding-guide.label": "Open this panel's tutorial",
  "settings.help.developer.title": "Developer options",
  "settings.help.developer.environment.title": "Runtime environment",
  "settings.help.developer.environment.version": "Version",
  "settings.help.developer.environment.channel": "Channel",
  "settings.help.developer.environment.channel.stable": "Stable",
  "settings.help.developer.environment.channel.beta": "Beta",
  "settings.help.developer.environment.channel.development": "Development",
  "settings.help.developer.environment.tauri": "Tauri",
  "settings.help.developer.environment.webview": "WebView2",
  "settings.help.developer.environment.chromium": "Chromium",
  "settings.help.developer.environment.system": "System",
  "settings.help.developer.environment.gpu": "GPU / WebGL",
  "settings.help.developer.environment.theme": "Theme",
  "settings.help.developer.environment.language": "Language",
  "settings.help.developer.environment.dataDirectory": "Data directory",
  "settings.help.developer.environment.developerMode": "Developer mode",
  "settings.help.developer.environment.mode.host": "Desktop developer mode",
  "settings.help.developer.environment.mode.browser": "Browser development mode",
  "settings.help.developer.environment.mode.reveal": "About-page reveal",
  "settings.help.developer.environment.mode.standard": "Standard build",
  "settings.help.developer.environment.notDetected": "Not detected",
  "settings.help.developer.environment.noBrowserData": "No data directory in a browser build",
  "settings.help.developer.copySummary": "Copy summary",
  "settings.help.developer.copySucceeded": "Copied to the clipboard",
  "settings.help.developer.copyFailed": "Copy failed; check clipboard permission",
  "settings.help.developer.performanceHud": "Enable performance monitor",
  "settings.help.developer.performanceHudHint":
    "Show FPS, draw time, memory and render-load graphs.",
  "settings.help.developer.noteBorders": "Enable note borders",
  "settings.help.developer.noteBordersHint":
    "Draw a red border around every preview note; a Hold shows head, body, and tail borders. Click a border to turn it green and show its parameters.",
  "settings.help.developer.exportBundle": "Export diagnostic bundle",
  "settings.help.developer.exportBundleHint":
    "Package the environment summary, redacted diagnostics snapshot, recent logs, extension list, and current chart summary into one zip.",
  "settings.help.developer.exportBundleBusy": "Exporting…",
  "settings.help.developer.exportBundleSuccess": "Diagnostic bundle exported to {path}.",
  "settings.help.developer.exportBundleFailed": "Could not export the diagnostic bundle: {message}",
  "settings.help.developer.exportBundleDesktopOnly":
    "The diagnostic bundle can only be exported from the desktop app.",

  // ------------------------------------------------------- the chart library

  // The intro and the offline hint are split around inline `<code>` elements, so
  // the surrounding spaces are part of the strings: Chinese needs none of them.

  // --------------------------------------------------------------- start-up
  "settings.startup.failed": "Start-up did not finish",
  "settings.startup.preparing": "Preparing the workspace",
  "settings.startup.retry": "Start again",
  "settings.startup.progress": "Starting the editor…",
  "settings.startup.testWarning.title": "Test feature notice",
  "settings.startup.testWarning.description":
    "RPE Redux is still in testing; you may see visual glitches or occasional instability. Report problems from Help > Survey.",
  "settings.startup.testWarning.dontShow": "Do not show again",
  // --------------------------------------------------------------- updates
  "settings.updates.autoCheck.label": "Automatically check for updates",
  "settings.updates.task.label": "Update package",
  "settings.updates.downloadPolicy.label": "Update package download policy",
  "settings.updates.downloadPolicy.description":
    "Download a found update package in the background; installation still requires your action.",
  "settings.updates.downloadPolicy.all": "Wi-Fi and metered networks",
  "settings.updates.downloadPolicy.wifi": "Wi-Fi only",
  "settings.updates.downloadPolicy.never": "Never download automatically",
  "settings.updates.prereleases.label": "Beta channel (pre-releases)",
  "settings.updates.verify.label": "Check for updates",
  "settings.updates.verify.action": "Check for updates",
  "settings.updates.localHandoffFailed":
    "The background update stopped: {message}. Your update backup was retained.",
  "settings.updates.localInvalid":
    "The installer or its adjacent .sig file could not be verified as a newer Windows update.",
  "settings.updates.check": "Check now",
  "settings.updates.updateNow": "Update now",
  "settings.updates.current": "Current version: {version}",
  "settings.updates.checking": "Checking for updates…",
  "settings.updates.available": "Version {version} is available.",
  "settings.updates.downloaded": "Version {version} is downloaded and ready to install.",
  "settings.updates.scheduled":
    "Version {version} will be installed silently after you close the app.",
  "settings.updates.restartPrompt.title": "Update package downloaded",
  "settings.updates.restartPrompt.description":
    "Restart now to install version {version}? If you choose not to restart, the update will be installed silently after you close the app.",
  "settings.updates.restartPrompt.defer": "Do not restart",
  "settings.updates.restartPrompt.restartNow": "Restart now",
  "settings.updates.upToDate": "You are up to date.",
  "settings.updates.unconfigured": "Set a GitHub repository to enable update checks.",
  "settings.updates.installUnconfigured":
    "Automatic installation also needs the updater public key.",
  "settings.updates.error.generic": "The update could not be completed.",
  "settings.updates.error.not-found": "The repository has no releases.",
  "settings.updates.error.rate-limit": "GitHub rate limit reached. Try again later.",
  "settings.updates.error.network": "Could not reach GitHub.",
  "settings.updates.error.timeout": "The update check timed out. Check the network and try again.",
  "settings.updates.error.invalid-repo": "Enter a GitHub owner/repository pair.",
  "settings.updates.error.invalid-response": "GitHub returned an invalid release list.",
  "settings.updates.error.public-key": "Configure the updater public key before installing.",
  "settings.updates.error.portable":
    "Portable builds cannot install updates in place. Download the new version and replace this folder.",
  "settings.updates.error.resource-conflict":
    "Resources are being changed or could not be read: {message}. Close the program using them and retry.",
  "settings.updates.error.tasks-active":
    "Wait for background tasks to finish or cancel them before installing an update.",
  "settings.updates.error.save-first": "Save the current chart before installing an update.",
  "settings.updates.error.install": "The update could not be installed: {message}",
  "settings.updates.verifying": "Verifying the local installer…",
  "settings.updates.preparing": "Preparing a data backup…",
  "settings.updates.downloading": "Downloading update… {downloaded} / {total}",
  "settings.updates.downloadingUnknown": "Downloading update… {downloaded}",
  "settings.updates.installing": "Installing… the app will restart.",
  "settings.updates.installed": "Installed. Restart the app to use the new version.",
  "settings.updates.updated": "Updated from {from} to {to}.",
  "settings.updates.backup": "Pre-update backup: {path}",
  "settings.updates.noNotes": "No release notes.",
  "settings.updates.prerelease": "Pre-release",
  "settings.updates.releaseLink": "View on GitHub",
  "settings.updates.updatedBanner": "Update complete",
  "settings.updates.date": "Published {date}",
  "settings.group.timingDetection": "New chart timing",
  "settings.field.timing-detection-on-new-chart.label": "Auto-detect BPM & offset on new charts",
  "settings.option.timing-detection-on-new-chart.ask": "Ask each time",
  "settings.option.timing-detection-on-new-chart.always": "Always detect",
  "settings.option.timing-detection-on-new-chart.never": "Never detect",
  "settings.field.timeline-undo-jump.label": "Jump to the changed time after undo or redo",
  "settings.field.timeline-undo-jump.description":
    "Moves the playhead and view to the edited time when an undo or redo step completes.",
  "settings.field.timeline-clipboard-range-bars-enabled.label":
    "Show clipboard and paste ranges on overview bars",
  "settings.field.timeline-clipboard-range-color.label": "Clipboard range colour",
  "settings.field.timeline-paste-range-color.label": "Paste range colour",
  "settings.field.timeline-range-bar-opacity.label": "Range area opacity",
  "settings.field.timeline-range-bar-opacity.description":
    "Opacity of the clipboard and paste ranges on the timeline overview bars.",
} as const;
