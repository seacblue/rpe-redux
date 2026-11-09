# Development

This guide covers the local workflow, the required checks, and the runtime contracts a change must preserve. Ownership boundaries are in [Architecture](architecture.md); packaging and update details are in [Desktop runtime](desktop.md).

## Contents

- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Commands](#commands)
- [Repository tour](#repository-tour)
- [Verification](#verification)
- [Runtime contracts](#runtime-contracts)
- [Contribution patterns](#contribution-patterns)
- [React and rendering](#react-and-rendering)
- [Debugging](#debugging)
- [Documentation](#documentation)

## Quick start

```powershell
npm ci
npm run dev            # Go service + Vite, hot reload, default browser
npm run dev:desktop    # Tauri window when the change needs native behaviour
npm run test:unit      # fast feedback while editing
npm run check          # the source gate before you report work
```

`npm run dev` is the fast development loop: it starts the Go service and Vite together, injects the worktree's fixed ports into the page, and opens the editor in the default browser. It does not stage FFmpeg or Cloudflared, build the sidecar executable, compile Rust, or open a Tauri window. Interface, editor, settings, and chart-library changes reload in place.

The browser loop uses `.scratch/dev/data/` as its profile, so experiments do not touch the desktop library. Native file dialogs, OS file drops, update installation, Extension installation, and the collaboration tunnel still need the desktop window. Export and chart import have browser paths; use `npm run dev:desktop` when the change touches the native host.

`npm run dev:desktop` stages the Go sidecar and media helpers, then opens the Tauri window. Both loops keep one fixed port set per checkout in `.scratch/dev/ports.json`, so parallel checkouts and AI runs do not fight over the backend address. The first run chooses free ports below the Windows ephemeral range; later runs reuse them. Pass `--new-ports` to rotate the set, or pin one value with a flag:

```powershell
npm run dev -- --backend-port=48121 --no-open
npm run dev:desktop -- --frontend-port=4174 --backend-port=48121 --ai-port=48122
```

The flags accept either `--name-port=value` or `--name-port value`. They update the worktree port record for later runs and are not written to the desktop Runtime ports settings. The browser loop also accepts `--data-dir <path>`; its default is `.scratch/dev/data`.

A good first hour looks like this:

1. Open the editor and go through the chart library, create a chart, and press `Ctrl+K` to see the settings pages.
2. Read [Architecture](architecture.md) for the layers, then `frontend/app/` (`App`, `Shell`, `Workbench`) for how the window is composed.
3. Follow one feature from registry to surface in [Repository tour](#repository-tour).
4. Add a focused unit test in the matching `src/test/<topic>/` folder and run `npm run test:unit`; add the desktop check only after the source gate is green.

## Prerequisites

Node.js 22.18+ and Go 1.25.3+ cover the browser loop. The desktop loop additionally needs Rust with the native linker for the selected target and the platform webview (WebView2 on Windows, WebKitGTK 4.1 on Linux). Install JavaScript dependencies with `npm ci`. On Debian/Ubuntu, install `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf` before the first desktop build.

## Commands

```powershell
npm run dev                  # Go service + Vite in the browser with hot reload
npm run dev:desktop          # stage native helpers and launch Tauri
npm run dev:web              # Vite only, no service (UI shell and fixtures)
npm run dev:server           # Go service only on its default port
npm run build                # release installer + staged portable folder
npm run build -- --portable  # portable folder only
npm run build -- --fast      # release-shaped smoke build with thin LTO
npm run build -- --debug     # debug executable for smoke tests
npm run build -- --help      # list the build modes
npm run build:web            # frontend bundle only
npm run build:docs           # Extension SDK documentation site
npm run build:server         # target-specific Go sidecar
npm run build:icons          # regenerate both theme icon packages
npm run check                # types, lint, style, docs, icons, SDK, extensions, unit, and Go tests
npm run check:native         # Rust formatting and compile check
npm run verify               # check + formatting
npm run test:unit            # TypeScript unit tests only
npm run test:server          # embedded Go service and room tests
npm run smoke                # P0 desktop journeys (needs build -- --debug)
npm run smoke -- --list      # smoke group names
npm run dev:collab           # standalone collaboration room server
```

`npm run check` is the gate; [Testing](testing.md) explains what each part covers, how to run a single test, and where fixtures live.

### Publishing a desktop release

Every path below produces the same GitHub Release with the same signed assets. The prepare job creates the Release when it does not exist yet and reuses it when it does, so re-running a release is safe: existing assets are replaced with `--clobber`.

1. **Push a semver tag.** The tag push creates the published Release, then builds and uploads the packages:

   ```powershell
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Publish a Release in the GitHub UI.** Releases → **Draft a new release**, choose or create the tag, then **Publish release**. The `release` event runs the same pipeline against that Release; no local tag is required.

3. **Run the workflow from the Actions tab.** Actions → **Release desktop builds** → **Run workflow**, enter the version without the leading `v` (for example `1.0.0` or `1.1.0-beta.1`). The run creates the tag at the selected branch head, publishes the Release, and builds it in one go.

All three paths require `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to carry the released version; the prepare job fails fast with the mismatched file instead of publishing installers with the wrong version.

A version with a hyphen (for example `1.1.0-beta.1`) is published as a GitHub pre-release. GitHub only surfaces the newest stable release on the repository home page, so an alpha or beta series appears there as a tag count until a stable release exists; the Releases page lists every release. The desktop app filters pre-releases unless **Settings → Help → Beta channel** is enabled.

The release workflow builds the Windows x64, Windows ARM64, Windows x86, and Linux x64 packages and uploads them to the Release. `npm run build -- --debug` is unrelated: it produces the executable the smoke suite drives locally.

The desktop window is the supported product. `npm run dev` starts the browser development loop; `npm run dev:web` runs only the Vite server. Release builds stage the portable application at `release/RPE-Redux-portable/RPE-Redux/`.

`--fast` keeps the release code paths and installer shape but uses thin LTO and parallel codegen. Use it for local acceptance and CI smoke builds; publish with the normal `npm run build`.

## Repository tour

Read in this order; each step narrows from the whole window to one feature.

| Path | Owns |
| --- | --- |
| `src/core/global/chart/` | Chart rules, timing, serialization, resources. Host-free: no React, Tauri, storage, or network. |
| `src/core/edit/` | Editing session, operations, transactions, history, shortcuts, sampling. |
| `src/core/global/document/`, `src/core/global/library/` | Document lifecycle and the chart library. |
| `src/core/api/` | The frozen host facade Extensions receive; `window.redux` exists only in development and automation. |
| `src/design/` | Tokens, controls, icons, and reusable visual patterns. No product domain types. |
| `src/frontend/app/` | The window frame: `App`, `Shell`, `Workbench`, theme chrome. |
| `src/frontend/chrome/` | Persistent chrome: title bar, menus, toolbar frame, transport, sidebar rail, status bar. |
| `src/frontend/screens/` | Full-surface screens: `welcome`, `startup`, `editor`, `global`, `settings`. |
| `src/frontend/overlays/` | Shared surfaces above the screens: modals, context menus, help, notices. |
| `src/frontend/platform/` | Browser and desktop host adapters. |
| `src/i18n/` | English and Chinese message catalogs; every user-visible string goes here. |
| `src-tauri/` | Desktop host: window, native files, updater, sidecar lifecycle. |
| `src/backend/` | Local Go/SQLite service: library, revisions, assets, preferences, rooms. |
| `src/test/` | Unit suite, P0 smoke journeys, and fixtures (see [Testing](testing.md)). |
| `scripts/` | Build, release, docs, and check tooling. |
| `docs/` and `docs-sdk/` | Internal engineering contracts and the public Extension site. |

Two area READMEs go deeper than this table: [src/README.md](../src/README.md) maps the source directories and their ownership, and [src/backend/README.md](../src/backend/README.md) lists the local service's routes, ports, and commands.

The composition root is `src/frontend/app/App.tsx`. It mounts `frontend/screens/editor/workspace/runtime/composition/EditorProviderTree.tsx`, and `EditorAssembly.ts` connects the document, playback, preview, timeline, inspector, session, and update runtimes. `runtime/bindings/` and `runtime/commands/` expose the operations that toolbar actions, shortcuts, sidebar items, and inspector actions call.

A feature arrives as a registered contribution beside its owner: a toolbar row, inspector pane, drawer page, sidebar item, settings section, shortcut, or command. To add one, find the owning module, register beside it, and let the existing registry compose it. [Architecture](architecture.md) has the full ownership map and the rules that keep the layers apart.

## Verification

Run from the repository root before reporting work complete:

```powershell
npm run check
npm run verify
npm run build
npm run build -- --debug
npm run smoke
```

`npm run check` is the source gate: it type-checks incrementally, runs the TypeScript unit suite, reuses the ESLint and Prettier caches, compiles the Less manifest, checks the SDK, and runs the Go tests. `npm run verify` adds formatting.

`npm run smoke` launches the debug application and runs the P0 scenarios in `src/test/e2e/`: API and Extension contract, document open/create/save, settings pages, and session restore. Build the debug executable first. Feature-specific regression suites are not part of the default run; [Testing](testing.md) lists the groups and their commands. The harness drives WebView2 over CDP, so the smoke suite runs on Windows only; Linux acceptance is manual until a WebDriver harness exists.

Source checks verify types, lint, unit behavior, and formatting. Inspect the running desktop app for input, rendering, playback, native dialogs, and other behavior that only exists in the packaged product.

## Runtime contracts

### Local service

The desktop host starts `redux-service`, waits for its JSON listening event, and reuses an already-healthy instance. The service owns the SQLite library, revisions, content-addressed assets, preferences, document occupancy, and collaboration rooms.

### Collaboration

The sidecar hosts rooms on `ws://127.0.0.1:47830` by default and stores room data under `<database directory>/collaboration`. Creating a room uses the bundled Cloudflare Quick Tunnel or a configurable LAN bridge and returns an `rperedux://` invitation link. Joiners can also enter a custom `ws://` or `wss://` address. On Windows, invitation links register the scheme under HKCU and are consumed by `src-tauri/src/app/deep_link.rs`; Linux builds keep the paste-link path until a desktop-file scheme registration ships.

The room server is authoritative for ordering, locks, undo audit, and asset integrity. The host keeps the app and Tunnel alive while the room is active. Room data contains host resume tokens and uploaded media; treat it as credential material.

Extensions remain client-local. A manifest may classify an Extension as `local`, `chart`, or `shared-service`; only the latter requires the same package on clients using that feature. The room does not install, transfer, or execute Extension code. Its existing chunked transfer is reserved for validated chart assets, so the Extension installer can keep its own fingerprint, consent, and sandbox boundary. The scope is currently descriptive; room admission does not auto-install or reject packages based on it.

### Code Cells

Code Cells are the product AI entry point. They are available only over `GET /api/cell/guide` and `POST /api/cell/run`. The canonical guide is `sdk/llm-guide.md`; the HTTP route serves the same text the application binds at startup. The service also exposes a private authenticated editor bridge at `/api/cell/bridge` and its handshake at `/api/cell/endpoint`; these are internal implementation details, not client-facing tool protocols. All Code Cell routes require both the listener and the peer to be loopback.

An external cell runs with the `write` profile by default: it reads the open document, can apply chart transactions, and can add or remove library assets. It cannot create, open, save, close, or delete a document or project. The `read` profile is read-only. The in-app AI activity pane is a read-only, session-only log of Code Cell requests and responses; the AI client remains the only caller.

### Updates

`npm run build` produces the platform packages (NSIS on Windows; deb, rpm, and AppImage on Linux) and the portable folder. Release CI uses `src-tauri/updater.conf.json` to enable signed updater artifacts. Stable and beta releases share the workflow; GitHub's prerelease flag is the channel marker. Bump `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together before publishing a tag; the release workflow checks that all three match the tag.

The checked-in build has no update source: `UPDATE_REPOSITORY` and `UPDATE_PUBLIC_KEY` in `src/core/platform/desktop/updateConfig.ts` are empty, so the in-app update page reports that updates are not configured. See [Desktop runtime](desktop.md#updates) for the signing and endpoint inputs.

## Contribution patterns

Add settings to `src/core/settings/features/` and matching English and Chinese keys to `src/i18n/messages/`. Register shared actions, shortcuts, and sidebar items through their registries at startup; register the surface's toolbar rows, inspector panes, and drawer pages from the owning module. Keep action IDs stable and namespaced.

The screen roots are `frontend/screens/global`, `frontend/screens/editor`, `frontend/screens/welcome`, `frontend/screens/startup`, and `frontend/screens/settings`. `frontend/app` owns the frame, `frontend/chrome` owns persistent chrome, `frontend/overlays` owns shared overlays, and `frontend/platform` owns host bridges.

Document lifecycle belongs in `core/global/document/` and `frontend/screens/editor/workspace/document/`; editor document bindings stay in `core/edit/document/`. Chart rules belong in `core/global/chart/`, and React components call them through the owning runtime.

## React and rendering

React owns layout and low-frequency state. Frame timestamps, pointer positions, and per-frame draw data stay in the renderer. Canvas and WebGL resources are created by the feature that owns the surface and are disposed with the document. Use narrow subscriptions or direct renderer calls instead of broad React state updates.

## Debugging

- **DevTools exist only in debug builds.** `npm run build -- --debug` produces an executable with F12 DevTools, element inspection, and the preview probe; release builds answer developer actions with `unavailable:devtools`.
- **Isolated profiles and CDP.** The debug executable accepts `--user-data-dir=<directory>` for a throwaway profile and `--remote-debugging-port=<port>` for the WebView2 debugging protocol. The smoke harness uses both; point a browser or CDP client at the printed port to inspect the live window.
- **Performance monitor.** F3 opens it in ordinary builds. The rest of the developer overlay needs developer mode: the host flag, or ten activations of the About logo.
- **Logs and data.** Application logs live in `user-data/logs/`; **Settings → General → Files → Open app data folder** reveals them with the SQLite library.

## Documentation

Keep comments in English. Document the purpose and contract of a feature, not its historical detours. Update the relevant README or ownership document when a public contract or directory changes. When publishing, replace the section in `CHANGELOG.md`; the release workflow publishes that section as the GitHub release body, and the desktop changelog fetches that body and shows the section for the interface language. Release notes support `@name` attribution markers (bold and underlined in the app, never links) and `<red>text</red>` theme colour spans; the syntax is listed in `CHANGELOG.md`.

The recurring frontend ownership and shared-primitive review is covered by [Repository rules](../AGENTS.md).
