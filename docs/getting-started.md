# Getting started

RPE Redux is a desktop editor for Phigros custom charts. This page takes you from installation to a saved first chart. It is the user guide; the codebase guides live in [Development](development.md) and [Architecture](architecture.md).

## Contents

- [Install](#install)
- [First launch: the chart library](#first-launch-the-chart-library)
- [Open, import, or migrate a chart](#open-import-or-migrate-a-chart)
- [Create a chart](#create-a-chart)
- [The editor workspace](#the-editor-workspace)
- [Save, export, and render](#save-export-and-render)
- [Settings, help, and updates](#settings-help-and-updates)
- [Where your data lives](#where-your-data-lives)

## Install

RPE Redux ships as a desktop application for Windows and Linux. Windows 10/11 needs the WebView2 runtime; the installer downloads it when it is missing, so the first install needs internet access. Linux needs WebKitGTK 4.1 and an x64 distribution.

- **Windows:** download the NSIS installer for your architecture (x64, x86, or ARM64) from the repository's Releases page and run it.
- **Linux:** download the `.deb`, `.rpm`, or `.AppImage` package. AppImage is the only format the in-app updater can replace; `.deb` and `.rpm` installs upgrade through the package manager.
- **Portable:** a portable folder keeps every path beside the executable and updates by replacing that folder.

Every build published so far is an alpha pre-release. The repository home page only shows the newest stable release, so an alpha series is listed on the Releases page rather than in the repository sidebar.

Building from source instead is described in the [README](../README.md#build). The first development launch requires Node.js 22.18+, Go 1.25.3+, Rust stable, and the platform C++ toolchain.

## First launch: the chart library

The application opens on the chart library. The list on the right holds one card per library chart; the left column shows the selected chart's details and its Open, Export, and Delete actions. Selecting a card does not start preview audio; that waits for an explicit play.

The library is empty on a fresh install, so start with one of:

- **New chart** — create a blank chart.
- **Import a chart** — pick a JSON, PEZ, official Phigros, or PhiEdit chart.
- Drag a chart file or folder onto the window.
- **More → Import from RPE…** — migrate an existing RPE installation.

On the first run the onboarding card asks whether you already know RPE, are new to charting, or want no guidance, then walks through the workspace. Reopen it from **Help → Open tutorial** or the tutorial row on **Settings → Help**.

## Open, import, or migrate a chart

| Source | Where | Notes |
| --- | --- | --- |
| RPE installation | More → Import from RPE… | Scans the chosen RPE folder, imports its charts, applies `Settings.json`, and offers the `Hotkey.txt` mapping. |
| Official Phigros JSON | Import a chart, or drag and drop | Converts to the RPE chart model and reports conversion differences. |
| PhiEdit PEC package | Import a chart, or drag and drop | Pairs the chart with its media and reports conversion differences. |
| RPE JSON / PEZ file | File → Import JSON / PEZ, or drag and drop | Opens the file and adds it to the library on save. |

Imports that lose or approximate data show a **compatibility report** listing the differences. The report is informational; the imported chart is already usable.

**File → Return to chart library** closes the current document and returns to the library. **Ctrl+Shift+H** (Show chart library) opens the library without closing the chart, so the chart stays open behind it.

## Create a chart

`Ctrl+N` creates a blank chart. Fill it in through the sidebar and inspector:

1. **Chart information** — name, composer, charter, illustration, and level.
2. **Asset library** — music, background, cover images, and GLSL shader files. Select any asset for an inline preview; on a loose desktop chart, **Open externally** launches the associated editor and saved changes are reflected in the preview. Select a project GLSL asset to choose which detected uniforms are exposed and optionally give them user-facing names; shader events then use that asset-library configuration in the inspector. Assets are stored with the chart and travel inside a PEZ package.
3. **Timing** — the BPM list that all beat positions refer to.
4. **Judge line** — the playfield lines; notes and events attach to them.
5. **Note editing** and **Event editing** — the chart contents.

New-chart behaviour (for example, whether the editor asks before adding the first judge line) is configurable in **Settings → Editor**.

## The editor workspace

The window has one authoring surface:

- **Stage** — the centred preview of the chart, with in-game UI and hit effects. Judge lines can be moved and rotated directly on it.
- **Timeline** — notes and events on the current judge line; scroll to move, drag to edit, and use the region switches to change what it shows.
- **Inspector** — the fields of the selected object, or the inspector page chosen in the sidebar.
- **Sidebar** — one ordered list of destinations: chart information, timing, judge line, note and event editing, asset library, waveform/spectrum, curve note fill, curve trajectory generation, multi-line editing, multi editing, chart issues, collaboration, and render chart.
- **Status bar and transport** — playback position, chart readouts, and transport controls.

The most useful view shortcuts:

| Action                                      | Default                    |
| ------------------------------------------- | -------------------------- |
| Preview only / previous complete layout     | `Ctrl+Space`               |
| Note region / event region / preview region | `Ctrl+Shift+Q` / `W` / `E` |
| Notes and events together                   | `Ctrl+Shift+R`             |
| Reset the view                              | `Ctrl+Shift+F`             |
| In-game UI                                  | `Ctrl+Shift+G`             |
| Play / pause                                | `Space`                    |
| Settings                                    | `Ctrl+K`                   |

Placement and editing defaults are in [Keyboard](keyboard.md). Every binding is editable in **Settings → Shortcuts**.

## Save, export, and render

Saving and exporting are different operations:

- **Save** (`Ctrl+S`) writes a named revision into the chart library: the chart plus its assets, in `user-data/redux.db` and the content-addressed asset store. The window title marks unsaved changes with `*`. The library keeps revision history; the home library is the place to reopen it.
- **Export** (**File → Export chart**, or the toolbar export button) writes a file to disk. Choose **RPE package (PEZ)** for the native RPE format, **Phigros official JSON** for an official-format chart, or **PhiEdit PEC** for PhiEdit. Formats that cannot represent every RPE feature report loss warnings before writing.
- **Render chart** (sidebar → Render chart) renders video or audio: MP4, MKV, MOV, WebM, GIF, APNG, and WebP video, or MP3, FLAC, WAV, and OGG audio. It renders a snapshot taken when the export starts, continues while you keep editing, and reports progress through the sidebar task control. Video export needs a decodable music track.

Crash recovery writes drafts to the library database automatically. **Settings → General → Files** controls autosave and how many drafts are kept per chart. The draft store keeps writing; this build does not expose a draft-restore list, so save the chart revision you want to keep.

## Settings, help, and updates

`Ctrl+K` opens settings. Categories are General, Appearance, Editor, Audio, Shortcuts, Extensions, Help, and About. The General page owns behaviour and data, Appearance owns visuals, and Editor owns editing interaction.

- **Help → Open tutorial** starts the anchored walkthrough for the current workspace; the onboarding card explains each surface the first time.
- **Help → Changelog** opens the published release notes in the interface language and the update status. The first launch after an update opens it automatically.
- **Help → Developer docs** opens the Extension SDK site in the browser.
- **Help → About** shows the version, acknowledgements, and licence.

Update checking only exists in builds compiled with an update source. Release builds configure the `seacblue/rpe-redux` repository and its signing key; a build without either reports that updates are not configured, so upgrade by installing a newer package from the Releases page. A configured build checks GitHub Releases, supports a **Beta channel** for pre-releases, replaces a Windows install in place with a rollback copy until the new build starts healthy, and on Linux replaces only the AppImage.

In **Settings → Help**, **Update package download policy** can stage a detected package automatically on Wi-Fi and metered networks, on Wi-Fi only, or never. Staging does not install or restart the application.

Extensions are installed and enabled from **Settings → Extensions**. Start with the [Extension quickstart](extensions-quickstart.md) if you want to write one.

## If something fails

- **The window fails to start:** the startup failure page offers Retry and Extension safe mode. Safe mode starts the application with user Extensions disabled, which is the quickest way to identify a package that breaks startup.
- **The chart library is unavailable:** the library page shows a retry action. The local service may still be starting; retry once before closing the app.
- **An import or export reports warnings:** the compatibility report lists the differences and the operation already completed; nothing is lost silently.

Logs are written to `user-data/logs/`. **Settings → General → Files → Open app data folder** reveals the directory and the SQLite database.

## Where your data lives

The deployment root holds the executable, bundled resources, and a writable `user-data/` folder:

```text
user-data/     library SQLite, preferences, backups, logs, extensions/
webview-data/  WebView2 or WebKitGTK profile
themes/ skins/ extensions/   resources read beside the executable
```

The Windows installer and portable folder keep these beside the executable; a packaged Linux build uses `$XDG_DATA_HOME/io.rperedux.editor`. A portable build adds `portable.marker`, which keeps every path relative to the executable. **Settings → General → Files → Open app data folder** reveals the directory, and `REDUX_PROFILE_DIR` overrides the profile root for isolated runs.

The chart library is the SQLite database, so deleting `user-data/` resets the application. Pre-update backups land in `user-data/backups/`.

## Next steps

- [Keyboard](keyboard.md) — every default binding.
- [Compatibility](compatibility.md) — chart formats, PEZ packages, resources.
- [Desktop runtime](desktop.md) — packaging, updates, recovery, and limits.
- [Extensions](extensions.md) — the Extension platform and SDK.
