# Window lifecycle and display modes on Tauri 2 / Windows

## Scope and version baseline

This note is a read-only investigation for the RPE Redux desktop host. It does not change product code. The repository currently locks the following relevant versions:

- Tauri Rust: `2.12.2` (`src-tauri/Cargo.lock`)
- Tao: `0.37.1` (`src-tauri/Cargo.lock`)
- Tauri JavaScript API and CLI: `2.12.x` (`package-lock.json`)
- Windows desktop runtime: WebView2 hosted by Tauri/Wry; exact WebView2 and Windows build are deployment variables.

The conclusions below apply to the Tauri 2 APIs and the Tauri/Tao sources at those versions. Links to `dev` documentation or source are used only where the official versioned page does not expose a stable anchor; the behavior was also checked against the locked local crates.

## Repository facts

The relevant startup path is:

1. [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) declares a frameless main window (`decorations: false`) with a 1440x810 default, minimum 1000x680, and a native background color.
2. [`src-tauri/src/main.rs`](../../src-tauri/src/main.rs) changes every configured window to `create: false` before building the Tauri application. The `setup` hook then calls `app::startup::create_windows`.
3. [`src-tauri/src/app/startup.rs`](../../src-tauri/src/app/startup.rs) calls `WebviewWindowBuilder::from_config(...).build()` without overriding visibility. Tauri's default visibility is `true`.
4. [`src-tauri/src/app/window_state.rs`](../../src-tauri/src/app/window_state.rs) reads the cached state only after the window has been built, then calls `set_size`, conditionally `set_position`, and finally `maximize`.
5. [`src/frontend/chrome/topbar/windowControls/windowControls.ts`](../../src/frontend/chrome/topbar/windowControls/windowControls.ts) routes minimize, maximize/restore, and close through the Tauri window API. [`desktopLifecycle.ts`](../../src/frontend/platform/desktopLifecycle.ts) intercepts `closeRequested`, performs save/confirmation work, and finally calls `destroy()`.
6. [`src/frontend/chrome/topbar/TitleBar.tsx`](../../src/frontend/chrome/topbar/TitleBar.tsx) already provides a drag region, and `WindowControls` is mounted globally in [`src/frontend/app/App.tsx`](../../src/frontend/app/App.tsx), not inside the welcome page.

## 1. Removing the startup geometry flash

### Cause in this repository

`create: false` already prevents Tauri from creating the configured window automatically. It does not make a manually built window hidden: the config default for `visible` is `true`, and `WebviewWindowBuilder::build()` creates the window at the configured/default geometry. The subsequent `restore()` calls are therefore visible native window mutations. On a fast desktop this can look like a default blank window followed by a jump to the cached rectangle; on a slower WebView2 startup the same window can be visible while its page is still blank.

Tauri's configuration reference explicitly documents both halves of this contract: `create: false` requires manual construction through `WebviewWindowBuilder::from_config`, while `visible` controls whether the window is visible and defaults to `true`.

### Recommended lifecycle

The robust sequence is:

```text
read and validate cached state
        |
build window with visible = false
        |
apply geometry/mode while hidden
        |
wait for a defined frontend-ready point
        |
show and focus once
```

The smallest safe change is to set `visible: false` in the window config or call `builder.visible(false)` in the Rust builder, then call `show()` only after `restore()` completes. `WebviewWindowBuilder::visible` is specifically defined as controlling immediate visibility at creation. `show()` makes the window visible later. Both are Tauri 2 APIs.

For a stronger result, read the state before `build()` and provide the initial position/size to the builder, still hidden. This removes even hidden post-creation resizing and lets the OS calculate the initial non-client frame once. Be careful with units: builder width/height and creation coordinates are logical pixels, while this repository's state code intentionally uses `PhysicalSize`/`PhysicalPosition`. Convert using the target monitor's scale factor, or keep the hidden post-build restore in physical units.

The show point should be chosen deliberately:

- `PageLoadEvent::Finished` is a reasonable native readiness barrier for avoiding an empty document, but it is not proof that RPE Redux's asynchronous backend/session startup is complete.
- An explicit one-shot frontend-ready signal is stronger if the requirement is “show only after the welcome/startup surface is painted”. It should have a timeout/failure fallback so a startup error cannot leave the window invisible forever.
- Keep all restore and show operations on the native window lifecycle. The welcome page should not independently show or reposition the main window.

`backgroundColor` can make the first native paint match the app theme, but it does not eliminate a visible geometry transition. Tauri's `noRedirectionBitmap` option addresses a different Windows issue: a white flash before WebView content for transparent windows. It is not a replacement for creating the restored window hidden.

The official Tauri window-state plugin is useful as a reference for persisted state, but it does not remove the need to control initial visibility when a host has a custom startup barrier. Its state model separately tracks restored position, size, maximized, visible, decorations, and fullscreen state.

### What this cannot guarantee

Hidden creation removes the application-visible default-rectangle flash, but it cannot promise a pixel-perfect first frame on every Windows/WebView2/DWM combination. WebView2 initialization, compositor scheduling, DPI changes, and driver behavior remain outside Tauri's control. A page-load barrier also cannot guarantee that application-level async data has finished rendering unless the application defines and waits for that readiness signal.

## 2. Decorations, caption buttons, fullscreen, and borderless

### Decorations and caption buttons

In Tauri 2, `decorations` means whether the native window has borders and bars. On Windows, `decorations: false` gives the application a frameless/undecorated window. It removes the system-drawn title bar and caption buttons; it does not mean that the window has no native state machine.

The window options `minimizable`, `maximizable`, and `closable` describe the native button capabilities. In a frameless window there are no native buttons to draw, so an application must provide accessible HTML controls if it wants those actions. The Tauri methods remain separate operations:

- `minimize()` requests minimization.
- `toggleMaximize()` switches between maximized and restored state.
- `close()` requests a close and emits `closeRequested`, allowing the host to veto or delay it.
- `destroy()` force-closes the window instead of emitting the normal close request. It is therefore inappropriate for an unguarded “close” button when unsaved data or collaboration/session cleanup is possible.

This matches the current repository: the custom control calls `close()`, the desktop lifecycle prevents the close while it checks collaboration and saves, and only then calls `destroy()` as the final action.

On Windows, decorations are ultimately implemented through native window styles and non-client-area behavior. Microsoft documents the usual framed `WS_OVERLAPPEDWINDOW` composition (`WS_CAPTION`, `WS_SYSMENU`, `WS_THICKFRAME`, and minimize/maximize boxes) and distinguishes it from `WS_POPUP`. The exact resize borders, shadows, rounded corners, hit testing, and maximized frame insets are OS/DWM and Tao implementation details, not CSS facts.

### Fullscreen is not the same setting as decorations

These states are independent concepts:

- **Frameless/borderless window:** a normal window with native decorations removed. It can remain windowed, movable, resizable, minimized, maximized, and shown in the taskbar according to its other options.
- **Tauri fullscreen:** the Tauri boolean API requests fullscreen. In the locked Tauri 2.12.2 Wry runtime, `set_fullscreen(true)` is translated to Tao `Fullscreen::Borderless(None)`, and `false` restores the saved window placement. This is a borderless fullscreen window on the current monitor; it is not a request to change the monitor's video mode/resolution.
- **Tao exclusive fullscreen:** Tao also has an `Exclusive` variant. On Windows its implementation uses `ChangeDisplaySettingsExW`, changes the display mode, then sizes the window to the selected monitor. This is lower-level Tao behavior and is not what Tauri's public JavaScript `setFullscreen(boolean)` selects.

The Tauri API also exposes `setFullscreenOnMonitor(position)`. It takes a physical point such as `Monitor.position`; if no monitor contains that point, the documented behavior is to do nothing. It should therefore be called only after validating a current monitor snapshot and handling a no-op/error.

### Native controls and custom controls

The feasible design for RPE Redux is the one it already mostly uses: keep `decorations: false`, render one shared custom control strip, and route actions through a frontend desktop adapter. That preserves the close guard and keeps browser builds as no-ops. The adapter should expose only the product actions needed by trusted shell surfaces; it should not be re-created in each page.

## 3. Resolution, monitor work areas, and safe switching

### What to query

Tauri's `Monitor` exposes:

- `position`: the monitor's top-left in the virtual desktop;
- `size`: the full physical monitor rectangle;
- `workArea`: the physical rectangle excluding taskbars/docks;
- `scaleFactor`: the physical-to-logical conversion factor.

The Tauri docs state that monitor positions are in physical pixels and that window creation options such as x/y/width/height use logical pixels. Tauri's work area is also physical. On Windows, the underlying Win32 `MONITORINFO` structure expresses both `rcMonitor` and `rcWork` in virtual-screen coordinates, and non-primary monitors may have negative coordinates.

Therefore:

1. Use `availableMonitors()` for a snapshot of all monitors, or `currentMonitor()`/`monitorFromPoint()` for the window's current target.
2. Use `workArea`, not `size`, when placing a normal window that should avoid the taskbar. Tauri's `preventOverflow` helper applies this idea only during creation; later resizes can still overflow.
3. Preserve physical coordinates for persisted native geometry, or convert consistently through the target monitor's `scaleFactor` before using logical creation options. Do not mix a physical cached rectangle with logical `width`/`height` values.
4. Treat negative x/y as valid. The virtual desktop is not guaranteed to start at (0, 0) on a multi-monitor Windows layout.
5. Validate a cached rectangle against the current monitor work areas. If it has no meaningful intersection, clamp it to a safe area on the current, primary, or nearest monitor. The current repository checks intersection with `monitor.size`; using `workArea` would better protect a restored window from taskbars and reserved desktop regions.
6. Re-query immediately before a user-requested switch and handle an empty or stale result. Monitors can disappear, change DPI, or change work area between enumeration and `set_position`/fullscreen. A monitor index is not a stable identity.

Win32 provides the same safety primitives directly: `EnumDisplayMonitors` can enumerate the virtual desktop, `GetMonitorInfo` returns `rcMonitor` and `rcWork`, and `MonitorFromWindow` can choose the monitor with the largest window intersection or fall back to the nearest/primary monitor according to the requested flag. These are queries, not a guarantee that the topology remains unchanged after the call.

### Resolution switching

Changing a window's size to a monitor's `size` is not changing display resolution. It only makes the application window cover that rectangle.

The normal Tauri fullscreen path is borderless and does not select a video mode. A real display-mode change requires an exclusive/fullscreen API and additional handling for unsupported modes, driver rejection, restoration after focus loss, and recovery if the process exits unexpectedly. It is not a safe default for a chart editor and should not be inferred from a “fullscreen” UI label. If the product only needs “fill this monitor”, use borderless fullscreen and select the target monitor by a validated physical point.

### What this cannot guarantee

No Tauri or Win32 query guarantees that a monitor remains present, keeps the same DPI, or keeps the same taskbar/work-area rectangle after it is returned. Hot-plug, docking, display scaling, taskbar auto-hide, remote desktop, and Windows shell changes can invalidate a snapshot. The safe contract is best-effort placement with clamping and a fallback monitor, not a promise to restore an exact rectangle under all topologies.

## 4. Self-drawn top-bar close button and window commands

### Feasibility

Yes. With `decorations: false`, the top bar can draw a close button and call the same desktop adapter used by the existing title-bar controls. A direct Tauri call is technically possible when the capability includes the relevant `core:window` permission, but the product boundary should keep native window operations behind the frontend desktop/platform adapter. The current `controlWindow("close")` path is the correct shape to reuse.

The close button must call `close()`, not `destroy()`, so the existing `onCloseRequested` handler can run collaboration checks, await pending saves, ask about dirty documents, persist session state, and finally destroy the window. A direct `destroy()` would bypass that guard. Double activation should also be made idempotent while a close request is in flight.

Minimize and maximize/restore are equally feasible from the top bar, but they should use the same shared command and state observer as the global controls. If the page also owns a drag region, keep it separate from the buttons: a pointer down on a close button must never start a window drag.

### Main risks

- **Duplicated chrome:** a welcome-only strip can drift from the editor and settings controls in labels, theme bindings, active maximize state, hit targets, and localization. Prefer one shell-owned component with a layout variant if the visual placement must change.
- **Close semantics:** raw `destroy()` loses the current guard; raw `close()` still has asynchronous veto behavior and must not be treated as an immediate unmount.
- **Accessibility:** custom caption buttons need translated accessible names, keyboard activation, visible focus behavior, sufficient hit targets, and correct disabled/error handling. Native caption-button affordances no longer supply any of these.
- **Modal/inertness and z-order:** the current app registers its shared control strip as window chrome so modal inertness does not block it. A welcome-local button must preserve the same rule and remain above backdrops/overlays.
- **Drag hit testing:** a broad drag region can swallow button clicks. Keep controls outside the drag element or explicitly exclude them.
- **Capability exposure:** adding broad window permissions to page code expands the privileged surface. Do not expose window commands to extension/sandbox content merely to support a welcome button.
- **Platform parity:** browser mode has no native window to control. The adapter must remain a no-op or an explicit unsupported result outside the desktop host.

### Recommended product contract

Keep the window command owner in the shell/platform layer and render the top-bar affordance through the shared `WindowControls` component. Reuse the existing close lifecycle and shared translations. If the goal is only visual placement, move or theme that shared component rather than creating a second implementation in `WelcomePage`.

## Sources

### Tauri and Tao

- [Tauri 2 configuration reference](https://v2.tauri.app/reference/config/) — `create`, `visible`, `decorations`, `fullscreen`, `preventOverflow`, and initial window options. Applicable to Tauri 2; the repository is on 2.12.2.
- [Tauri JavaScript window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) — `close`, `destroy`, `minimize`, maximize state, decorations, fullscreen, `setFullscreenOnMonitor`, `show`, dragging, monitor fields, permissions, and logical/physical pixel notes. Applicable to the 2.x API; verify the exact method availability when upgrading.
- [Tauri `WebviewWindowBuilder` API](https://docs.rs/tauri/2.12.2/tauri/webview/struct.WebviewWindowBuilder.html) — `visible`, initial position/size, fullscreen, decorations, and page-load hooks for the locked Rust version.
- [Tauri `Monitor` API](https://docs.rs/tauri/2.12.2/tauri/window/struct.Monitor.html) — physical position, size, work area, and scale factor for the locked Rust version.
- [Tauri `Window` API](https://docs.rs/tauri/2.12.2/tauri/window/struct.Window.html) — monitor enumeration, current/primary monitor, fullscreen, geometry, and native window operations.
- [Tauri 2 window-state plugin reference](https://v2.tauri.app/reference/javascript/window-state/) — the official state flags and the distinction between size, position, maximized, visible, decorations, and fullscreen.
- [Tauri runtime source, `set_fullscreen`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/src/lib.rs) — the locked Wry runtime maps the boolean fullscreen request to Tao's `Fullscreen::Borderless` path. The repository locks the matching runtime family through Tauri 2.12.2.
- [Tao window API](https://github.com/tauri-apps/tao/blob/dev/src/window.rs) — fullscreen variants and platform notes.
- [Tao Windows window implementation](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/window.rs) — borderless fullscreen sizing and the separate exclusive display-mode path.

### Microsoft Win32

- [MONITORINFO](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-monitorinfo) — `rcMonitor`, `rcWork`, virtual-screen coordinates, and negative coordinates on non-primary monitors.
- [EnumDisplayMonitors](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaymonitors) — monitor enumeration and virtual-screen behavior.
- [MonitorFromWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-monitorfromwindow) — largest-intersection, nearest, and primary fallback behavior.
- [GetMonitorInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmonitorinfoa) — retrieval contract and required structure initialization.
- [Window styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-styles) — framed versus popup styles and caption/resize/minimize/maximize components.
- [Window features](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features) — native close/maximize/minimize commands and size/position concepts.
- [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) — native size/position/show behavior and frame-change caveats.
- [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect) — virtualized DPI behavior and invisible resize-border caveat.

## Explicit non-guarantees

This note does not claim that a hidden Tauri window will never show a compositor flash, that WebView2 will always be ready at `Finished`, that a cached rectangle can be restored exactly after monitor/DPI changes, or that Tauri's public fullscreen boolean changes the display resolution. Those outcomes depend on the Tauri/Tao version, WebView2 runtime, Windows build, DWM, display topology, taskbar policy, and application readiness. Any implementation should verify the target Windows versions and test cold start, warm start, maximized restore, monitor unplug/replug, mixed DPI, taskbar placement, fullscreen enter/exit, and close-with-unsaved-work flows.
