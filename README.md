<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/public/assets/redux/brand/redux-lockup-on-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="src/public/assets/redux/brand/redux-lockup-on-light.png">
    <img src="src/public/assets/redux/brand/redux-lockup-on-light.png" alt="RPE Redux" width="200">
  </picture>
</p>

<h3 align="center">A modern chart editor for Phigros fanmade charts.</h3>

<p align="center">
  <img alt="Platform: Windows 10/11, Linux x64" src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20%7C%20Linux%20x64-4fd0df?style=flat-square">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square">
  <img alt="React + TypeScript" src="https://img.shields.io/badge/React%20%2B%20TypeScript-087ea4?style=flat-square">
  <img alt="Go 1.25+" src="https://img.shields.io/badge/Go-1.25%2B-00add8?style=flat-square">
  <img alt="License: PolyForm Noncommercial" src="https://img.shields.io/badge/License-PolyForm%20Noncommercial-8b5cf6?style=flat-square">
</p>

<p align="center">
  <sub>English, <a href="README-zh.md">简体中文</a></sub>
</p>

## What is RPE Redux?

RPE Redux is an editor for Phigros fanmade charts.

The project continues the [`rpe-next`](https://github.com/kclg-YSJ/rpe-next) codebase with a rebuilt React shell, a Tauri 2 host, and a local Go/SQLite service, and is suited to charters who want to maintain charts over the long term and value stability and compatibility.

## Quick start

1. Download the installer for your platform from the repository's Releases page and install it. Windows ships NSIS installers for x64, x86, and ARM64; Linux ships deb, rpm, and AppImage packages.
2. Open RPE Redux. The chart library is the start screen.
3. Create a chart, import a chart (JSON, PEZ, official Phigros, or PhiEdit), or migrate an existing RPE installation from the **More** menu.
4. `Ctrl+S` saves a revision into the chart library. **File → Export chart** writes a PEZ package or a converted chart file; **Render chart** in the sidebar renders video or audio.

The [Getting started guide](docs/getting-started.md) covers the first chart, the workspace layout, save and export formats, settings, updates, and where the application keeps its data. Default key bindings are in [Keyboard](docs/keyboard.md).

## Build

**Requirements:** Windows 10/11 with the WebView2 runtime, or Linux with WebKitGTK 4.1; Node.js 22.18+, Go 1.25.3+, and Rust stable with the platform C++ toolchain (MSVC on Windows, `build-essential` on Linux). On Debian/Ubuntu, install the desktop libraries with `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

```powershell
npm ci
npm run dev           # browser development loop with hot reload
npm run dev:desktop   # native Tauri window
npm run build         # NSIS installer on Windows; deb, rpm, and AppImage on Linux
```

`npm run dev` starts the Go service and Vite, then opens the editor in your browser. It needs Node.js and Go, not Rust or the platform webview, and keeps its profile under `.scratch/dev/`. Use `npm run dev:desktop` when a change needs native file dialogs, window behaviour, or the packaged runtime. `npm run build -- --portable` skips the installer. The first desktop build stages FFmpeg, Cloudflared, and the Go sidecar, so it needs network access unless those artifacts are already cached.

> Windows ships x64, x86, and ARM64 NSIS installers. Linux ships x64 deb, rpm, and AppImage packages. Only the AppImage replaces itself through the in-app updater; deb and rpm users upgrade through their package manager.

## Web edition

`npm run dev:web` runs the static page with the browser SQLite library; `npm run build:web` produces `dist/`, and the GitHub Pages workflow deploys that directory. Charts live in the browser's OPFS. **Settings → General → Browser storage** requests persistent storage and downloads or restores a `.sqlite` backup. The desktop app remains the full editor: updates, Extensions, Code Cell, collaboration hosting, and native file access stay desktop-only.

## Development

`npm run dev` is the browser development loop: it starts the Go service and Vite together, uses one fixed port set per checkout, and reloads the page on source edits. `npm run dev:desktop` opens the Tauri window for native-host work. Each checkout chooses its own random port set in `.scratch/dev/ports.json`; keep that record worktree-local so parallel checkouts and AI sessions do not share a backend. Start with [Development](docs/development.md) for the workflow, commands, and a repository tour, and [Testing](docs/testing.md) for the test suites, fixtures, and where a new test belongs. Ownership rules, contribution patterns, and the code conventions are in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Use `npm run dev` for the edit loop and build only for packaged behavior or final acceptance. Before opening a pull request:

```powershell
npm run verify
npm run build -- --debug
npm run smoke
```

`npm run verify` covers types, lint, style, docs links, icons, the SDK, unit tests, Go tests, and formatting. The debug build and smoke suite cover desktop interaction. `npm run build` is the full release build and belongs at the end of the task.

## License and provenance

RPE Redux is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is derived from [`rpe-next`](https://github.com/kclg-YSJ/rpe-next); upstream copyright and asset notices are retained in [NOTICE](NOTICE).

## Documentation

[Docs index](docs/README.md), [Getting started](docs/getting-started.md), [Architecture](docs/architecture.md), [Development](docs/development.md), [Testing](docs/testing.md), [Compatibility](docs/compatibility.md), [Desktop](docs/desktop.md), [Keyboard](docs/keyboard.md), [Extensions](docs/extensions.md)
