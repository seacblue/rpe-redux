# Source tree

`src/` contains the renderer, shared design system, host-independent domain logic, build-time resources, and the full-flow smoke suite. `src/main.tsx` and `src/frontend/app/` compose the product; `src/core/` owns domain rules and the host API; `src/design/` owns reusable primitives. `src-tauri/` is a separate desktop host, and `src/backend/` is a separate Go process outside the renderer's build graph. Ownership rules are in [Architecture](../docs/architecture.md).

## Layout

```text
backend/    local Go service and SQLite store
core/       host-independent domain logic, state, platform seams, and APIs
  api/      frozen host facade assembly
  codecell/ one-shot read-only code-cell runtime
  edit/     editing session, commands, and editor services
  extensions/ Extension runtime, capability gate, and sandbox contract
  global/   chart rules, document lifecycle, and the library
  media/    decoding, analysis, and asset loading
  platform/ browser and desktop adapters
  settings/ settings schemas and registries
  shell/    global-section state, shell event names, and registries
  shortcuts/ shortcut registry and scope rules
  state/    live values and durable preferences
  theme/    theme package parsing and application
design/     shared visual and interaction primitives
frontend/   product surfaces and runtime composition
  app/      window frame and the active authoring surface
  chrome/   persistent title bar, toolbar, transport, rail, drawer, and status bar
  overlays/ shared modals, menus, help, and notices
  platform/ host bridges and frontend adapters
  screens/  startup, welcome, editor, global drawer pages, and settings
i18n/       English and Chinese message catalogs
assets/     build-time packages: Extensions, note skins, and themes
public/     application-owned runtime resources, served at `assets/`
test/       full-flow desktop smoke journeys and chart fixtures
```

## Ownership

- `frontend/` owns visible surfaces. The editor is the one authoring surface and supplies its workspace, inspector, sidebar, and toolbar rows through `modeContract.ts`; document-wide pages register as drawer panes selected by `core/shell/drawerPane.ts`, and the frame names no concrete page. Editor toolbar controls live under `screens/editor/toolbar/`, the shared transport card under `chrome/transport/`, and global pages under `screens/global/`.
- Canvas hosts are rendered by their feature and passed to the imperative engine through a local surface handle. React keeps node ownership; the engine draws into the handles it receives.
- `core/` owns chart rules, editor state, document lifecycle, media, settings, platform adapters, and the public API. It imports core modules only and never imports `frontend/` or `design/`.
- `core/global/chart/` contains chart rules and calculations only; it does not import React, Tauri, storage, or the network.
- `design/` owns reusable primitives and imports no product domain modules.
- `assets/` holds packaged Extensions, note skins, and theme sources. `public/` holds runtime files served from `assets/`; do not mix the two.
- `test/e2e/` is source-side verification only and is not bundled into the app.

## Related documents

- Chart and resource contracts: [Compatibility](../docs/compatibility.md).
- Development workflows and commands: [Development](../docs/development.md).
- Host, packaging, and updates: [Desktop](../docs/desktop.md).
- Extension packages: [Extensions](../docs/extensions.md).
