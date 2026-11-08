# Architecture

RPE Redux separates host-independent domain logic, reusable visual primitives, and the product surfaces that compose them. This document is the ownership map; specific behavior lives in the module that owns it.

## Contents

- [Layers](#layers)
- [Screen directories](#screen-directories)
- [Runtime composition](#runtime-composition)
- [Authoring surface](#authoring-surface)
- [Host boundaries](#host-boundaries)
- [Feature areas](#feature-areas)
- [Rules](#rules)

## Layers

- `src/core/` owns chart rules, editor state, document lifecycle, media, settings, state values, platform seams, and the public API facade. It imports core modules only, and `core/global/chart/` stays free of React, Tauri, storage, and network dependencies.
- `src/design/` owns tokens, controls, icons, and interaction patterns. It does not import product domain types; use a local structural type when needed.
- `src/frontend/` owns visible surfaces and composes them from core modules. It may import core implementation modules directly.
- `src/frontend/contracts/` owns the narrow seams between persistent chrome and the screens: the editor host runtime, the chrome command ports, the document identity model, the transport DOM surface, and the spectrum worker port. It imports core and shared overlay types only, never a screen implementation.
- `src-tauri/` is the desktop host. `src/backend/` is the local Go/SQLite service. Both live outside `src/` because they have separate runtime boundaries.

## Screen directories

The frontend tree follows the visible interface:

- `src/frontend/app/` owns the window frame: `App`, `Shell`, `Workbench`, and the shell/profile styles.
- `src/frontend/chrome/` owns the persistent chrome: title bar, shared toolbar frame, transport card, sidebar rail, document drawer mode, and status bar. It does not import the editor screen or the surface registry; editor runtime values, document identity, and commands arrive through `frontend/contracts/`. A screen-owned badge or shortcut binding may still be rendered directly, and carries no editor runtime dependency.
- `src/frontend/screens/` owns the full-surface screens:
  - `welcome/` is the start screen and chart library.
  - `startup/` is the boot and failure screen.
  - `editor/` owns the editing workspace, object inspector, canvas, metadata, curve events, line-selection preferences, and its toolbar controls and fields under `editor/toolbar/`.
  - `global/` owns the document-wide drawer pages under `global/sections/` and the shared metadata form.
  - `settings/` owns the settings window and its update panels.
- `src/frontend/overlays/` owns shared surfaces above the screens: modals, context menus, help video, performance HUD, and Extension notices.
- `src/frontend/platform/` owns host adapters and bridges.

`src/core/global/` owns chart rules, document lifecycle, and the library. `src/core/edit/` owns the editing session, editing operations, and editor services. The design system remains in `src/design/`.

## Runtime composition

`frontend/app/App.tsx` mounts the shell and the editor provider tree. `frontend/screens/editor/workspace/runtime/composition/EditorProviderTree.tsx` creates the providers; `EditorAssembly.ts` connects document, playback, preview, timeline, inspector, session, and update runtimes. `runtime/bindings/` and `runtime/commands/` expose the operations used by actions, toolbar, sidebar, shortcuts, and inspector actions.

`EditorProviderTree` publishes the open document's display identity through `frontend/contracts/editorHostReact.tsx`, and `EditorRuntime.tsx` exposes the narrow host runtime the transport card and rail read. `frontend/screens/editor/workspace/runtime/composition/editorChromeHost.ts` binds the editor's document, transport, view, navigation, inspector, and spectrum-worker ports to `frontend/contracts/` before `frontend/app/Shell.tsx` registers built-in actions. Chrome therefore depends on the contract, not on the editor runtime or its commands.

### Authoring surface

The window has one authoring surface. The custom title bar is the only top-level chrome: it hosts the application menu in the theme's chosen form, either one hamburger sheet or expanded triggers, and there is no mode switcher. The editor owns the workspace, the object inspector, the rail, and its toolbar rows.

Document-wide pages register under `frontend/screens/global/sections/*/drawer.tsx` (`timing`, `lines`, `assets`). `frontend/chrome/sidebar/navigation.ts` merges those pages with the inspector routes into the window's single sidebar. A drawer page is the inspector's second content mode: it renders inside `#inspector` and replaces the ordinary pane, with no separate overlay or title bar. `frontend/chrome/drawer/` owns that mode's registration, width reveal, and the single open/pane record. `core/shell/drawerPane.ts` is the late-bound reader core-side callers use, so the SDK reads the visible selection instead of keeping a second copy; `core/shell/drawerOpen.ts` is the corresponding late-bound opener. Opening a page widens the inspector left by the fixed list column while its right edge stays on the grid track, so the stage, canvas, WebGL context, and DOM handles keep their size. The list is clipped behind the inspector's own edge when collapsed; both columns share the inspector surface. List pages use `DrawerSplit`'s left list / right properties columns. The page selection and drawer state are restored with the session.

`frontend/app/modeRegistry.ts` resolves the single editor surface declared in `frontend/screens/editor/mode.tsx`; `Shell` hands its toolbar rows to `Toolbar`, `Workbench` hands its sidebar descriptor to `Sidebar`, and `InspectorPanel` renders its inspector slot. There is no top-level mode state, no mode-filtered toolbar or sidebar entry, and no competing surface kept mounted.

Chart metadata is an ordinary inspector page with a single form and no list column; it is the first document destination in the sidebar. The application menu exposes the same toolbar actions as the bar; a toolbar button or menu item calls the action's own `run` callback directly, and the shortcut registry keeps stable action ids so bindings stay rebindable. Developer commands stay out of the application menu; they use their shortcuts and the small developer overlay.

Shared state uses `core/state/values.ts` for live values and `core/state/preferences.ts` for durable sections. Settings, menus, shortcuts, inspector panes, toolbar rows, drawer panes, and sidebar items register through their owning registries; each feature extends the list beside its owner.

React owns DOM layout and low-frequency state. Canvas hosts are rendered by the feature that owns them and passed to the imperative renderer through a local surface handle. React keeps node ownership, and the renderer draws into the handles it receives.

## Host boundaries

- `src-tauri/` owns window creation, native dialogs and files, the signed updater, window geometry, startup migration, and the sidecar lifecycle. Host source is grouped by responsibility under `src-tauri/src/`: `app/` (startup, migration, deep links, window geometry, IPC token), `documents/` (document lifecycle and recovery), `storage/` (data root, path policy, backups), `update/` (signed manifest, helper, and portable swap), `services/` (sidecar, LAN bridge, tunnel, room session), `assets/` (skins, themes, Extensions), `chart/` (RPE scan), `io/` (external chart scan and recording), and `diagnostics/` (developer commands and performance HUD). `main.rs` keeps only the entry point, plugin and command registration, and module declarations.
- `src/backend/` owns the local HTTP service, the v1 SQLite schema, the chart library, revisions, content-addressed assets, the preference blob, live frontend instance leases, and per-document occupancy. Preference writes require the per-process token in `preferences-endpoint.json`, and a production launch trusts only the desktop CORS origins.
- `src/core/platform/` adapts browser and desktop capabilities. Product code calls the adapter, not the host constructor.
- `src/core/api/` assembles the frozen host facade. Extensions see a capability-gated view through `context.api`; `window.redux` is installed only for development and automation builds. Internal features use the owning runtime and registries instead.

## Feature areas

- Documents: `core/global/document/`, `core/edit/document/`, and `frontend/screens/editor/workspace/document/`.
- Shared contracts: `core/contracts/` owns cross-layer result envelopes; the public facade re-exports them from `core/api/contract.ts`.
- Editor: `core/edit/`, `frontend/screens/editor/workspace/editor/`, timeline, preview, and inspector surfaces.
- Workspace sampling: `core/edit/sampling/` owns snapping, durable guide spacing and XY-binding preferences, and the one transaction that writes an event's start/end anchors together with its easing curve (preset, Bézier control points, and easing range); `frontend/screens/editor/sampling/` owns the shared draft and the one curve model that validates and normalizes Bézier points for every entry point; `design/components/easing/EasingCurveEditor.tsx` renders that model for the event inspector and the inspector sampling surface. `inspector/sampling/` and `workspace/stage/sampling/` own the pane and the workspace overlay. Guide spacing is adjustable per axis: XY defaults to 50, rotation to 30°, opacity to 20, speed to 2 (speed range 0–20), and helper-line opacity defaults to 50%. The registered sampling guide shortcut can hide grid guides temporarily while the overlay is dragging and also disables snapping; the sampled start/end points, path, and pointer readout remain visible.
- Background tasks: `core/state/longTasks.ts` owns task lifecycle and action contributions; `frontend/chrome/topbar/LongTaskControl.tsx` presents them.
- Runtime and local I/O: `core/runtime/` owns scheduling, retry pacing, and heartbeat timing; `core/io/` owns storage failure classification, byte budgets, path caching, and load/fallback state. Both stay host-independent.
- Collaboration: `core/collaboration/` owns the room protocol, object-addressed changes, roles, capabilities, leases, undo authorization, asset transfer, the bounded outgoing queue, presence, invitation links, and the room client; `frontend/screens/editor/workspace/collaboration/` owns the room surface and remote cursors. The desktop sidecar hosts rooms in `src/backend/collab_*.go`; `scripts/collaborationServer.mjs` remains a developer-only standalone Node server for LAN tests and direct TLS.
- Themes: `core/theme/` owns package validation, registration, palette resolution, glyph overrides, the data-only chrome recipe, and the declarative UI tree. The recipe carries layout/surface/motion presets, title-bar framing, bounded frame metrics, and a registered-command order override. `frontend/app/ themeChrome.less` maps preset names onto host-authored styles; `frontend/platform/themeUi.tsx` renders the declarative slot/component trees with design primitives; `core/platform/browser/themeSurface.ts` writes palette, preset names, and bounded metrics onto the document; `core/theme/chromeState.ts` and `core/theme/uiState.ts` expose the active recipe to React hosts. A theme cannot inject CSS or code, invent a sidebar destination, hide critical chrome, or change a window/menu command. Themes are frontend-only presentation packages: they never receive the SDK, backend, document, filesystem, network, or host DOM, and declarative actions can only re-present registered sidebar items. See [Theme packages](../src/assets/themes/README.md).
- Code Cells: `core/codecell/` owns the one-shot runtime and its profiles; `core/edit/codecell/` owns the mounted adapter, guide filtering, endpoint handshake, and bounded activity log. `frontend/platform/codeCellBridge.ts` connects the active editor to the local service over an authenticated WebSocket, while `src/backend/internal/codecell/cell.go` exposes only `GET /api/cell/guide` and `POST /api/cell/run` on a loopback listener and peer. `frontend/platform/extensionSandbox.tsx` runs the same opaque iframe in cell mode. `frontend/screens/editor/inspector/aiActivity/` renders the session-only activity log. `core/settings/editingAiAccess.ts` owns the per-feature AI permission, `core/edit/aiEditingPolicy.ts` maps it to transaction fields, and `core/edit/codecell/aiGuide.ts` removes restricted passages from the served guide. There is no JSON-RPC tool surface, in-app source editor, HTTP apply route, or durable run history.
- Video recording: `frontend/screens/editor/workspace/recording/`, the desktop adapter in `core/platform/desktop/recording.ts`, and `src-tauri/src/io/recording.rs`. `recordingVideoEncoder.ts` selects the platform H.264 encoder through WebCodecs when it accepts the output geometry and otherwise keeps the PNG fallback.
- Media and audio: `core/media/` decodes music once for playback and analysis, with a media element as the fallback. When pitch preservation is enabled, the worklet copies decoded PCM at 1× and uses WSOLA at other speeds. Both paths share the worklet clock and restart crossfade. Slow playback aligns detected attacks to source time, carries the early decay across grain joins, and fades displaced copies into nearby audio. The editor routes music and hit sounds through one background gain. The home library owns its cross-fading preview player. Window focus applies the Audio setting's background multiplier through audio-thread gain ramps, and an editor worker keeps hit-sound scheduling alive while the window is in the background. `core/media/beatDetection.ts` owns fixed-tempo detection, beat-phase detection, and `detectAutoTiming`, which always returns a single fixed-tempo answer plus a confidence value (silent input falls back to 120 BPM / 0 ms / confidence 0); `frontend/screens/editor/ workspace/timingDetection/` owns the worker, preview, dialog host, confidence warning, and pending-request state. The timing drawer opens the dialog, and the new-chart preference is declared in `core/settings/features/audio.ts`.
- RPE migration: `core/migration/` maps Settings.json and Hotkey.txt; `frontend/platform/desktop/rpeFolder.ts` picks and scans a native root; `frontend/screens/welcome/rpeImport.ts` applies settings/shortcuts and imports chart folders through the existing document store and library importer; `src-tauri/src/chart/rpe.rs` owns the bounded folder read.
- External chart formats: `core/global/chart/formats/` owns Phigros official JSON and PhiEdit PEC detection, conversion and serialization; `frontend/screens/welcome/externalImport.ts` pairs sidecars/media and writes the converted chart through the library importer; `frontend/platform/desktop/externalChart.ts` and `src-tauri/src/io/external.rs` provide the bounded native folder read. `frontend/screens/editor/workspace/document/export/` offers PEZ, official JSON and PEC export, with single-file text writes supplied by `documents::write_export_text`.
- Settings: `core/settings/features/` defines schemas; `frontend/screens/settings/` renders a task-oriented rail (General, Appearance, Editor, Audio, Shortcuts, Extensions, Help, About) with one root open at a time. General owns behaviour and data, Appearance owns visuals, and Editor owns editing interaction. Custom controls, group column headings, and whole pages register in `frontend/screens/settings/settingsContributions.ts` beside their component; the window reads those registries instead of naming built-in keys. Search matches translated text and control values: current or reset numbers, slider readouts, select options, and shortcut key caps. Extension settings use the standard schema controls. Help owns update status and the survey as sections, without a second navigation level; About is the single product-information surface.
- Updates: `frontend/screens/settings/updates/` owns update state and release data; `src-tauri/src/update/updater.rs` owns the signed manifest flow, `update/local_update_worker.rs` the post-exit handoff, and `update/portable_update.rs` the in-place payload swap. The frontend's automatic package-download policy uses the cost-aware host network status in `src-tauri/src/network.rs`; Linux prefers NetworkManager/portal metering and only falls back to connection type. The frontend never inspects adapter names or addresses.
- Sessions: `frontend/screens/editor/workspace/session/` for last-workspace sampling and restore; `core/edit/session/workspaceSession.ts` for the stored shape.
- Onboarding: `frontend/onboarding/` owns the first-run choice, the step list, and the anchored coach card. Owning components register guide anchors through `anchors.ts`; the guide never searches the document for shell markup.
- Extensions: `core/extensions/`, `frontend/platform/` (loader, installer, and bridge), `frontend/overlays/extensions/` (shared notice styles), `src/assets/extensions/`, the managed `user-data/extensions/` root, and the generated `sdk/`. Extension style sheets are wrapped in an owner-scoped `@scope` against the panel/overlay mount, so a package can style only its own surfaces, never the host chrome.

## Rules

- Put a rule beside the data it governs and a visual fact beside its surface.
- Use the type roles in `src/design/styles/tokens.less`; see the [design system](../src/design/README.md) for what each role is for.
- Register a feature through its contribution registry instead of editing a central category, panel, or action table.
- Declare dependent settings with `SettingDefinition.enabledWhen` or `disabledWhen`; dependent rows stay visible and become disabled. `visibleWhen` still controls row visibility, but built-in settings do not use it. The settings window does not special-case product keys.
- Paint every surface that leaves normal flow on the ordered `--z-*` ladder in `src/design/styles/tokens.less`: a floating layer names its rung (or offsets that rung for its own children) and never writes a number. Only sibling ordering inside one component's own stacking context keeps a local integer in -1…9. The style gate rejects other raw `z-index` values, `--z-*` names the ladder does not define, and inline `zIndex` styles. A modal stack publishes a relative layer index and CSS resolves it against `--z-modal`.
- Render every modal through `design/components/modal/Modal.tsx`. It portals dialogs into the app-root host registered by the entry point, so a dialog opened from another dialog is a peer of its window rather than a child of that window's stacking context; the shared scrim stays below the active dialog. The toast host is a peer of the app shell and the topmost in-window layer, so a modal scrim never blurs, hides, or disables notices.
- Keep `core/` host-independent; host operations belong behind `core/platform/`.
- Persistent chrome reaches the editor through `frontend/contracts/`; a chrome module never imports `screens/editor/`.
- Keep chart serialization and resource references stable; see [Compatibility](compatibility.md).
