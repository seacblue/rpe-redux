# Desktop runtime

The desktop product runs in a Tauri 2 window with the platform webview (WebView2 on Windows, WebKitGTK on Linux) and a local Go/SQLite sidecar. This document describes the runtime layout, build outputs, updates, and session persistence.

## Contents

- [Layout](#layout)
- [Build outputs](#build-outputs)
- [Documentation site](#documentation-site)
- [Updates](#updates)
- [Session and window state](#session-and-window-state)
- [Crash-recovery drafts](#crash-recovery-drafts)
- [Native input limits](#native-input-limits)
- [Multiple instances](#multiple-instances)
- [Acceptance](#acceptance)

## Layout

The deployment root holds the executable, the bundled resources, and writable user data. Windows installers and portable folders use the executable directory; a packaged Linux build uses `$XDG_DATA_HOME/io.rperedux.editor` (falling back to `~/.local/share/io.rperedux.editor`) because the executable is installed under `/usr`:

```text
rpe-redux(.exe)
resources/redux-service
assets/ themes/ skins/ extensions/
user-data/        SQLite library, preferences, backups, logs, extensions/
                  mcp-endpoint.json (per-process editor-bridge token)
webview-data/     WebView2 or WebKitGTK profile
```

A portable build adds `portable.marker`, which keeps every path beside the executable on any platform. `REDUX_PROFILE_DIR` overrides the user-data and webview roots for isolated test runs.

The running app polls `themes/`, `skins/`, and `extensions/`. Dropping a package into any of those folders updates the relevant picker or Extension list without a restart. GitHub and marketplace installs are written to `user-data/extensions/`; a manually dropped portable package in `extensions/` keeps precedence for the same id.

`user-data/redux.db` is the SQLite library and preference store. Crash recovery writes drafts as rows in the same database; **Settings → General → Files** controls autosave and the per-chart retention limit. This build writes drafts but does not expose a draft-restore list, so the Files page has no recovery action. The Go service creates the v1 library schema on first open; the native host runs the file-format and post-update handoff before starting the service.

Video export uses the bundled FFmpeg distribution for the target architecture to mux MP4 files. The Render chart settings offer a standard rate-control mode and an optional VBR 2x peak mode. Standard mode uses the platform H.264 encoder through WebCodecs with the configured bitrate as its average target when the platform supports it; VBR 2x mode uses PNG frames and FFmpeg with a peak target twice the configured average. The platform save dialog chooses the destination and confirms replacement of an existing file. Resolution, frame rate, video bitrate, rate-control mode, music volume, and hit-sound volume are configurable. The range defaults to the whole song and accepts beats or song time. A bitrate of `-1` selects a target from the output geometry, and the inspector estimates the output size before the export starts. Rendering uses a snapshot captured at export and continues while editing; progress and cancellation are available from the sidebar task control. During encoding, the task exposes the growing fragmented MP4 and publishes the final destination when encoding succeeds. The bundled FFmpeg license and build information are included under `resources/ffmpeg/`.

## Native input limits

The main document receives a per-process capability token through a top-frame initialization script. The script attaches the token to `ipc://` / `http://ipc.localhost` requests; every custom command invoked from the `main` webview rejects calls without it with `host_token_invalid`. Path-bearing native commands also check the token beside their argument parsing. The extension sandbox is a subframe with an opaque origin, so it cannot read the token or run the guarded block. Tauri's own invoke key is still present in every frame and is not a substitute for this token.

Document and import reads have hard byte ceilings. Oversized input returns a stable snake_case error instead of being loaded into memory:

| Input                                  | Ceiling                                             |
| -------------------------------------- | --------------------------------------------------- |
| Chart JSON or one PEZ chart entry      | 512 MiB                                             |
| One chart resource or media response   | 256 MiB                                             |
| One PEZ or loose-document resource set | 1 GiB                                               |
| `extra.json` sidecar                   | 64 MiB                                              |
| Picked file (`read_picked_file`)       | 256 MiB                                             |
| One OS asset drop                      | 512 MiB total, 4096 files                           |
| Save chart stream                      | 256 MiB cumulative                                  |
| Save asset stream                      | 1 GiB total, 256 MiB per asset                      |
| Library project                        | 1 GiB total, 256 MiB per file, 50,000 files         |
| Portable update payload                | 2 GiB total, 1 GiB per file, 20,000 entries         |
| App backup import                      | 8 GiB total, 8 GiB database, 256 MiB per other file |

Disk snapshots stream files through SHA-256 instead of reading them whole, and portable-update extraction caps the bytes actually copied as well as the sizes declared by the ZIP central directory.

## Build outputs

`npm run build` produces the platform packages and stages the portable folder at `release/RPE-Redux-portable/RPE-Redux/`. Windows produces the NSIS installer; Linux produces deb, rpm, and AppImage packages. `npm run build -- --portable` skips the installer. The staging step preserves `RPE-Redux/user-data`, so the library and settings survive a rebuild. `npm run build -- --debug` produces the debug executable used by `npm run smoke`. `npm run build -- --fast` uses thin LTO and parallel codegen for local acceptance; publish with the normal build. Local release builds check the executable's embedded entry page before staging the portable folder; cross-target builds require verification on the target host. `npm run build -- --help` lists every mode.

Every desktop build stages FFmpeg through `scripts/prepareFfmpeg.mjs` and the Cloudflare Tunnel client through `scripts/prepareCloudflared.mjs`. For offline builds, set `REDUX_FFMPEG_ARCHIVE` to the pinned archive before running the preparation script; the archive must match the selected platform and architecture plan, and its checksum is verified.

### Architectures

- **Windows x64** is the default NSIS target.
- **Windows ARM64** is built natively on GitHub's `windows-11-arm` runner. The app and Go sidecar target ARM64; the bundled FFmpeg and Cloudflared helpers are x64 and run under Windows ARM64 emulation.
- **32-bit x86** ships a full NSIS target. The app, Go sidecar, Cloudflared, and FFmpeg target 32-bit Windows; FFmpeg uses the pinned `defisym/FFmpeg-Builds-Win32` n8.1 GPL build.
- **Linux x64** ships deb, rpm, and AppImage packages from GitHub's `ubuntu-22.04` runner. The app, Go sidecar, Cloudflared, and FFmpeg target `x86_64-unknown-linux-gnu`; FFmpeg uses the pinned `BtbN/FFmpeg-Builds` n8.1 GPL build. Linux ARM64 is not built yet.

Release CI uses `src-tauri/updater.conf.json` to enable updater artifacts and requires the signing secret. For a local Authenticode signature, run `src-tauri/signWindowsArtifact.ps1 -Path <installer or executable>`; the helper creates a development certificate when none exists and can reuse a thumbprint or `SignCode.exe` from the parameters.

## Documentation site

`npm run docs:build` generates the static extension-development documentation into `docs-site-dist/`; `npm run build` runs the same generator before Tauri collects bundle resources. The installer carries the folder as `docs-site-dist` in the Tauri resource directory and the Go sidecar serves it read-only on `http://127.0.0.1:47821/docs/`, so **Settings → Help → extension development docs** can open it in the system browser. The route accepts `GET` and `HEAD`, falls back to `index.html` for SPA client routes, and sends `Cache-Control: no-cache` so a rebuilt site is picked up without stale assets.

The host passes `--docs-dir` only when it finds a usable bundle. Resolution order is `REDUX_DOCS_DIR`, then `docs-site-dist` inside the Tauri resource directory, then the repository copy found from the development executable's ancestors. Without a bundle the route answers 503, `/api/health` reports `docs: false`, and a running sidecar that lacks the surface is restarted instead of reused by a launch that expects it.

## Updates

The update source is compiled into the application. `UPDATE_REPOSITORY` and `UPDATE_PUBLIC_KEY` in `src/core/platform/desktop/updateConfig.ts` name the release repository and its public key; the Rust build reads the same key from `REDUX_UPDATE_PUBLIC_KEY` at compile time and treats it as the trust anchor, so the renderer cannot substitute it. The release workflow passes the `REDUX_UPDATE_PUBLIC_KEY` repository variable into the build. A binary compiled without that variable reports **updates are not configured** and refuses to install a downloaded package; users upgrade by installing a newer package.

Two consequences matter when publishing the first signed release:

- Installs produced before the key existed embedded no public key. They cannot verify a signed update and need one manual install of a signed build.
- The release repository must stay public: the host fetches `releases/latest/download/<manifest>` without credentials.

Help → Changelog opens a modal with the running version's published GitHub release notes, rendered in the interface language. An available-update badge opens a separate future-release notes mode; it shows the selected newer release and offers Skip this version, Later, and Update now actions in the footer. The release workflow publishes the matching section of `CHANGELOG.md`, which holds only the current release's notes, as the GitHub release body; that file lists Chinese first and English second. The modal title names the shown release's version and date, and the notes may credit `@name` contributors and colour text (see `CHANGELOG.md`). Opening the surface fetches the notes when the store has not loaded them yet. A check runs when the user presses Verify on Settings → Help, or at startup when **Settings → Help → Automatic updates** is enabled. Selecting an automatic package-download policy also enables the startup check. The manual result is reported as a toast.

**Settings → Help → Update package download policy** controls only background package staging: **Wi-Fi and metered networks**, **Wi-Fi only**, or **Never download automatically**. A staged package is signature-verified and held by the host; installation still requires an explicit restart choice. The Wi-Fi-only policy accepts only the active Wi-Fi class and rejects a known metered connection. Windows uses active adapter classification; Linux prefers NetworkManager's `Metered` and active connection properties, then the XDG NetworkMonitor portal, then `nmcli`.

On Windows, a signed release installs through a portable update payload rather than the NSIS installer. The host fetches `redux-latest.json` from the release, verifies the ZIP with the build's updater key, snapshots durable data, and exits. A background helper waits for the editor and sidecar to stop, replaces the application files in place, and relaunches the new executable. The payload never contains `user-data`, `webview-data`, or `portable.marker`; those paths are rejected if a package carries them. The helper keeps a rollback copy of every replaced file until the relaunched build reports a health handshake from its first startup. A launch failure, an early exit, or a health timeout restores the previous files and relaunches the old build; the rollback copy is removed only after the handshake, and staging cleanup waits for the helper process to exit. A restore that fails keeps the rollback tree and records the combined failure in `logs/update.log`. The first update from a build that predates this manifest still uses the signed NSIS installer in `latest.json`; later updates use the portable path. The NSIS installer remains the first-install and fallback artifact. The next launch refreshes the Windows uninstall entry's displayed version when the executable still runs from the recorded install location.

On Linux, Tauri can replace only an AppImage in place: the running application swaps its own AppImage file. deb and rpm installations do not self-update through this path, so those users upgrade through their package manager or by downloading a new package.

Publishing signed updates:

1. Generate the key pair once with `npx tauri signer generate -w <private-key-file>`. Store the private key and its password in a password manager; both are unrecoverable.
2. Set the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the whole private key file content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Put the public key from `<private-key-file>.pub` in the repository variable `REDUX_UPDATE_PUBLIC_KEY` and in `UPDATE_PUBLIC_KEY` in `src/core/platform/desktop/updateConfig.ts`; keep `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` in sync.
3. Set `UPDATE_REPOSITORY` to the public release repository; the workflow passes `REDUX_UPDATE_PUBLIC_KEY` from the repository variable into the Rust build.
4. Bump `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to the same version, then publish the release tag.

Key handling rules:

- The private key never leaves the release workflow: it is injected only into the `tauri-action` build and the portable-payload signing steps, and it must never appear in the repository, an artifact, a log, or a chat. GitHub secrets are write-only, so keep an offline copy.
- The public key is public: it is embedded in every installer and verified against each release signature. It can be committed and shared freely.
- Losing the private key means older installs cannot accept newly signed builds; a leaked key means an attacker can sign installs, so rotate it by publishing a build with a new key, which needs one manual install to migrate.
- Publishing one version twice is safe: the release job reuses an existing release for the tag and replaces its assets.

The release workflow exposes the signing key only to the steps that sign installers or the portable payload. Checkout, dependency installation, and build steps run without it; a missing key selects the unsigned build path. Every action in the release and source-check workflows is pinned to a full commit SHA with a readable version comment, so update the SHA and its comment together when upgrading an action.

The signed workflow uploads `.sig` files and one merged `latest.json` carrying a platform entry per artifact for the NSIS fallback. It also uploads one `RPE.Redux_<version>_<arch>_portable-update.zip` and `.sig` per Windows architecture, then merges their signatures into `redux-latest.json`. The stable endpoints are `https://github.com/seacblue/rpe-redux/releases/latest/download/latest.json` and `.../redux-latest.json`; an explicit version uses that release's tag endpoint. `scripts/packagePortableUpdate.mjs` stages the payload and signs it with `--app-version`, and `scripts/buildPortableManifest.mjs` merges the signatures.

### Release channels

A beta is a GitHub Release marked **Set as a pre-release**, with a semantic version such as `1.1.0-beta.1` (tag `v1.1.0-beta.1`). The release workflow runs for pre-releases and uploads the same signed assets. GitHub's prerelease flag is the channel marker the app reads.

The app lists releases through the GitHub API and filters them before choosing the newest version:

- Stable users ignore every release whose GitHub prerelease flag is set.
- Users with **Settings → Help → Beta channel (pre-releases)** enabled include prereleases and stable releases, so a later stable release still wins. The switch is available when **Automatic updates** is on.
- Every manual check uses the same filter.

Creating the GitHub release is the publication step: mark the version and the pre-release flag consistently. No separate beta feed or branch is required.

The Verify row on Settings → Help fetches the configured GitHub repository and reports the result as a toast after at most 15 seconds. When a newer release is eligible, the changelog modal offers an install action that downloads it through the signed updater path. The settings UI does not offer a local installer picker or adjacent `.exe.sig` verification; the host checks its own update artifacts before handoff.

Before installation the app flushes preferences, checkpoints SQLite, and writes `user-data/backups/pre-update-<from>-to-<to>-<time>.zip`, including external skins, themes, and extensions. The archive stores a standalone `VACUUM INTO` snapshot of the library instead of the live main/WAL pair, so a sidecar write after the checkpoint cannot make the backup inconsistent. The written archive is reopened and its database must pass `PRAGMA integrity_check`; a failure stops the update before handoff. Backup import validates the staged database as a readable SQLite library with the expected tables before accepting it, and refuses to overwrite existing skin or extension files. The database is applied on the next start: the app moves the live `redux.db` and its `-wal`/`-shm` sidecars to `redux.db.bak-<time>`, installs the staged copy, and keeps the newest such backup. A failed promotion restores the previous files; an interrupted promotion is completed or undone from its journal before the service opens the database. User resources are read from folders beside the executable; packaged resources remain in the installed bundle. The newest five pre-update backups are kept.

The updater checks user resources for active writers and for changes during preparation and before handoff; the local helper checks again after the app exits. A conflict refuses installation and reopens the app with the affected path. The target is recorded in `pending-update.json` at handoff; the next launch records the matching version in `update-result.json`, opens the changelog with the published notes, and clears the marker so later launches stay quiet.

Portable builds carry `portable.marker`, show the published release notes when an update source is configured, and update by replacing the portable folder.

## Session and window state

Files → Startup controls crash and update recovery. When enabled, a launch after an unexpected exit or an update restart reopens the last file or library project and restores its playhead, timeline origin, active line, multi-line selection, active inspector pane, drawer section and open state, and chart-info expansion. A normal close clears the record, so reopening the application starts empty. The record lives in the `session` preference section and is sampled every two seconds; only the sampled record survives an abnormal exit.

Window geometry is always stored in `user-data/window-state.json`; when that file is missing, an existing Roaming `window-state.json` is imported once. The last size, position, and maximized state are restored on the next launch when the rectangle is still visible on a connected monitor.

## Crash-recovery drafts

Autosave writes drafts to `recovery_drafts` in `user-data/redux.db`. Assets are stored once by SHA-256 content hash in `recovery_asset_blobs`, and `recovery_asset_refs` maps each draft and name to that hash. Rewriting a draft or keeping several drafts of the same chart therefore shares the bytes instead of copying them; two drafts that reference identical content share one blob. The `write_recovery_asset` command keeps its staged-upload contract, and an existing database upgrades on first open: legacy `recovery_assets` rows move into the shared tables, duplicate bytes collapse to one blob, and the old table is dropped in the same transaction. An interrupted migration retries from the old table on the next open. After a successful migration the host rebuilds the database file, so the freed pages return to the filesystem instead of staying on SQLite's free list; if the rebuild cannot run, the migrated rows stay usable and later writes reuse those pages.

Draft ownership is stable across restarts:

- A document with a path belongs to `path:<sha256 of the normalised path>`; Windows paths compare case-insensitively.
- A pathless draft whose id names an existing library project belongs to `project:<id>`.
- Every other pathless draft belongs to `untitled:<id>`, where the editor persists one id for its untitled family and one for detached room sessions. Missing or deleted projects never create a new random family.

The Files settings page exposes **Backups kept per chart** (`autosave-limit`, default 10, range 1-100). Each recovery write sends that value and prunes older drafts for the same owner, so it applies per document path, library project, or untitled family. Startup cleanup additionally removes drafts whose library project no longer exists, surplus drafts beyond the configured limit for every family, and blobs no draft references. The same blob collection runs after each write and delete, so removing a draft reclaims its unique assets immediately while blobs still shared by another draft survive. Age alone never deletes a draft, so upgrading keeps every recoverable draft that fits the retention rule.

## Multiple instances

Starting another editor first probes the fixed loopback port. A healthy `rpe-redux-server` that serves the same database and reports the same version is reused; a foreign listener, another database profile, or a version mismatch is an error or a restart. The host asks a stale sidecar to stop through its loopback control route before spawning the current build. Each launch keeps its own window and process, while the first copy owns the sidecar process and every copy registers a frontend instance and heartbeat. The owner leaves the sidecar running while another instance is alive, and the backend exits after its last live instance leaves or expires.

A normal exit requests `POST /api/shutdown` on the owner and waits for the Go process to drain HTTP work, flush collaboration state, and close SQLite; only a timeout falls back to terminating it. The sidecar logs the restart reason to `logs/backend.log`. `/api/health` keeps the existing `name`, `api`, `ok`, `projects`, `instances`, `backendId`, and `db` fields and adds `version` plus `collab: { enabled, ok, port?, error? }`, so a room listener that failed to bind reports `collab.ok: false` instead of appearing fully healthy.

The sidecar writes `user-data/mcp-endpoint.json` when the frontend asks for the bridge path, with the current process's editor-bridge token and bridge path. The desktop frontend reads the path from `GET /api/mcp/endpoint` and loads the file through the native host; other processes cannot open the editor bridge without presenting the token. Treat the file as local credential material; a new sidecar process replaces it.

The library uses SQLite WAL mode with a busy timeout, so concurrent service processes serialize writes. Library commits use the revision check for optimistic concurrency.

The one-room-per-backend claim uses a named kernel mutex on Windows. Linux keeps the claim process-local until an equivalent kernel lock ships, so host or join a room from one instance per data directory there.

A document path or library project has one occupancy owner. Opening it from a second instance raises a warning modal whose choices clear the frontend lock, clear the backend record, repair and retry, or cancel the open. The lease is released when the document closes; an abandoned lease expires with its instance heartbeat.

## Acceptance

Inspect startup, document open/save, playback at every exposed rate, settings persistence, updates, session restore, native dialogs, the title-bar window controls, and the matching window commands in the File menu in the packaged application. On Linux, also confirm the resize frame works under the target desktop's window manager and that data lands under the XDG data directory. For multiple instances, verify backend reuse, duplicate-document occupancy, all four recovery choices, and that closing the owner leaves the sidecar running for the other window. Also verify that a normal exit persists collaboration state, that a version mismatch restarts the sidecar, and that an occupied room port reports `collab.ok: false` without blocking the main service. The P0 smoke suite covers repeatable interaction paths on Windows; it drives WebView2 over CDP, so Linux acceptance stays manual until a WebDriver harness exists. Subjective audio and visual quality need a listening and visual check.
