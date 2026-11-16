# Download-task and Changelog controls research

## Scope and conclusion

This started as a read-only investigation of the clean worktree at the requested main-based checkout. The implementation below is now applied in this worktree.

The version-download row can already be removed through the existing title-bar Background tasks popover. The operation is deliberately two-phase for active work: `removeLongTask(id)` requests cancellation, leaves the row in `cancelling`, and removes it only after the runner settles. The update downloader already observes the task `AbortSignal` and discards the verified package after cancellation. However, the native `update_download` command has no cancellation handle or command; an in-flight updater network request is not proven to stop immediately. “Pause” is not represented anywhere in the current update or long-task state model.

The best existing Changelog insertion point is the update modal footer, not the release-note body: `openChangelog("update")` supplies `ChangelogUpdateActions`. The implementation reuses those same three button slots: while downloading they become Pause, Stop, and the locked Updating primary action; while paused or idle they return to Skip, Later, and Resume/Update.

## 1. Task lifecycle and deletion

### Existing lifecycle API

- `LongTaskStatus` is `running | cancelling | completed | failed | cancelled`; each task retains label, detail, stage, progress, timestamps, and error. `LongTaskContext` exposes an `AbortSignal`, progress reporting, and mutable detail. `longTaskActions` is the declared contribution registry, but no current source consumer or contributor was found. (`src/core/state/longTasks.ts:4-40`)
- `startLongTask` creates an `AbortController`, inserts a retained row, runs the caller with the signal, and converts settlement into `completed`, `failed`, or `cancelled`. Controllers are deleted in `finally`; a queued removal is applied only after settlement. (`src/core/state/longTasks.ts:101-174`)
- `cancelLongTask(id)` changes an active row to `cancelling` and calls `AbortController.abort()`. (`src/core/state/longTasks.ts:177-184`)
- `dismissLongTask(id)` removes only an already-settled row; it is a no-op while a controller exists. `removeLongTask(id)` dismisses settled rows immediately, or marks an active row for post-cleanup removal and calls cancellation. (`src/core/state/longTasks.ts:186-207`)
- `getLongTasks` and `subscribeLongTasks` are the read/notification surface for React hosts. (`src/core/state/longTasks.ts:84-92`)

### Version-download behavior

`startDownloadTask` wraps a download runner with the long-task lifecycle and returns `{ id, done }`; the runner receives the signal and progress callback, and `done` resolves to `completed`, `cancelled`, or `failed`. (`src/core/state/downloadTask.ts:4-27`, `src/core/state/downloadTask.ts:28-54`)

The update store creates the version-download task with label `settings.updates.task.label`, reports byte progress, and invokes the native `update_download` command. If the signal is aborted, it calls `update_discard` and throws a cancellation error; the outcome then resets the update state to `available` with no prepared version. (`src/frontend/screens/settings/updates/updateStore.ts:524-610`)

The task is already deletable from the UI. `LongTaskControl` shows all retained rows, uses the title-bar task menu, and invokes `removeLongTask(task.id)` for both active and settled rows. Active rows are labelled “Cancel and remove task,” settled rows “Dismiss,” and the control is disabled while cancellation is already in progress. (`src/frontend/chrome/topbar/LongTaskControl.tsx:25-46`, `src/frontend/chrome/topbar/LongTaskControl.tsx:124-163`)

The existing tests make this contract explicit: removing active work aborts its signal, retains the row as `cancelling` until cleanup, then removes it; the mock update download resolves `{ status: "cancelled" }` and the row disappears. (`src/test/network/tasks/longTasks.test.mjs:53-78`, `src/test/network/tasks/downloadTask.test.mjs:42-70`)

### Native cancellation gap

The Rust command accepts repository, key, tag, and prerelease inputs, but no operation id or cancellation signal. It awaits `download_release`, which awaits updater `check()` and `download(...)` before returning. (`src-tauri/src/update/updater.rs:356-435`, `src-tauri/src/update/updater.rs:437-484`)

`update_discard` only clears the prepared in-memory update. It is not a network-cancel command. (`src-tauri/src/update/updater.rs:519-585`) Therefore the current frontend task can enter `cancelling` immediately, but the row may remain until the native invocation returns. This is the key open implementation risk for a user-visible “stop” promise.

## 2. Changelog structure and control placement

`openChangelog` refreshes update settings, fetches releases if needed, and presents one shared modal. Current-release mode has no footer; update mode adds `ChangelogUpdateActions` with Skip, Later, and Update now callbacks. (`src/frontend/screens/settings/updates/changelog.ts:31-72`)

The modal body selects either the running release or newest future release from the subscribed update store and renders parsed release-note blocks. It is not an update-progress surface today. (`src/frontend/screens/settings/updates/ChangelogContent.tsx:22-53`, `src/frontend/screens/settings/updates/useUpdateState.ts:1-7`)

`ChangelogUpdateActions` owns the update footer. It calls `changelogUpdateAction(state.phase)`, disables all three buttons while `preparing`, `verifying`, `downloading`, or `installing`, and closes after `scheduled` or `installed`. (`src/frontend/screens/settings/updates/ChangelogContent.tsx:84-117`, `src/frontend/screens/settings/updates/updatePresentation.ts:30-40`, `src/frontend/screens/settings/updates/updateStore.ts:87-95`)

The modal chrome already provides the correct footer slot; the Changelog-specific stylesheet only sizes the dialog and makes the body scroll. (`src/frontend/screens/settings/updates/changelog.less:4-21`; `src/design/components/modal/Modal.tsx:520-530`, `src/design/components/modal/Modal.tsx:662-667`)

Recommended placement:

1. Add a stop/cancel button to `ChangelogUpdateActions`, conditionally shown while the package download task is active. Keep it in the footer so it remains reachable while release notes scroll.
2. Add an update-store-owned `cancelUpdateDownload()` that knows the current `DownloadTaskHandle`/task id and calls the appropriate long-task API. Do not make Changelog reach into an implementation-local task variable.
3. Keep the existing title-bar task row as the global fallback and make both entry points use the same cancellation path.
4. Do not label the existing action “Pause” unless the native updater can suspend and resume bytes. Current cancellation restarts from the beginning, and no `paused` phase exists.

## 3. Tests, i18n, registries, and constraints

- Task lifecycle and downloader cancellation belong beside the existing tests in `src/test/network/tasks/longTasks.test.mjs` and `src/test/network/tasks/downloadTask.test.mjs`. The update footer state rules are covered by `src/test/network/updates/updatePresentation.test.mjs:38-50`; release selection/rendering contracts are in `src/test/network/updates/releaseNotes.test.mjs:189-237`.
- There is no current Changelog component/DOM test or task-popover interaction test in `src/test/` or `src/test/e2e/` matching these surfaces. Per the testing guide, extract pure state/presentation rules for unit tests and add an e2e journey only if this is a P0 packaged-window interaction. (`docs/testing.md:56-66`, `docs/testing.md:137-145`)
- Existing task labels/statuses and Changelog actions are localized in both catalogs. The task strings are `chrome.tasks.*`; update-download progress and the task label are `settings.updates.*`. (`src/i18n/messages/en/chrome.ts:17-26`, `src/i18n/messages/zh/chrome.ts:6-15`, `src/i18n/messages/en/settings.ts:718-770`, `src/i18n/messages/zh/settings.ts:628-673`)
- Any new stop/pause label, tooltip, or busy-state message needs matching English and Chinese keys. The catalog parity and placeholder test enforces this. (`src/test/settings/i18n/i18nCatalogs.test.mjs:18-57`)
- Changelog opening is already registered through the shared Help action/API, so a footer control does not need a new menu entry or registry category. (`src/frontend/chrome/topbar/registerBuiltins.ts:25-45`, `src/frontend/chrome/topbar/menuSpec.ts:62-71`)
- Architecture assigns long-task lifecycle/action contributions to `core/state/longTasks.ts`, the visible task surface to `frontend/chrome/topbar/LongTaskControl.tsx`, update state/release data to `frontend/screens/settings/updates/`, and the signed host flow to `src-tauri/src/update/updater.rs`. It also requires core to remain host-independent, UI strings to use i18n, and features to use contribution registries where a contribution is actually needed. (`docs/architecture.md:76-78`, `docs/architecture.md:95-107`, `docs/architecture.md:114-121`)

Focused verification in this checkout: the update-presentation tests pass (4 tests), `npm run check` passes with 1,762 unit tests plus Go tests, `npm run verify` passes, and `npm run check:native` passes after compiling the Rust updater.

## Implementation checklist

1. `updateStore.ts` retains the active download task id, exposes pause/stop actions, and clears the id in `finally`; the title-bar task row and Changelog use the same long-task cancellation/removal behavior.
2. `ChangelogUpdateActions` reuses the existing footer area while removing the leftmost Skip slot during transfer. Downloading shows Stop / Pause update; paused shows Stop / Resume update; idle states restore Skip / Later / Update.
3. `updater.rs` owns the resumable cache, writes release-binding metadata, sends `Range: bytes=<offset>-`, validates `Content-Range`, streams progress, and verifies the reconstructed bytes before installation. Stop cleanup closes the file before removing the cache on Windows.
4. Paired English and Chinese labels were added, with presentation coverage for the paused/resume action.

## Implemented in this worktree

The current change adds Changelog footer controls and routes them through the shared download-task handle. **Pause** asks the native updater to flush and retain an unverified `partial.bin`, then cancels the renderer task; **Resume download** rechecks the signed manifest and resumes with an HTTP `Range` request when the URL, signature, version, tag, prerelease mode, and payload identity still match. The complete byte stream is verified with Tauri's updater signature before it is moved into the normal completed-package cache.

**Stop download** uses the existing cancel-and-remove task policy and also removes both partial and completed updater cache files. The native command observes pause/stop between response chunks, so a stalled socket can still take the configured request timeout to settle. If the server does not honor `Range`, a `200` response restarts the payload from byte zero; a malformed `206 Content-Range` is rejected rather than appended.

When an update check discovers a newly available release, the update Changelog is requested immediately if the chart is idle. If the chart is playing, the request remains queued and opens when the shared `editor.playing` value becomes false. Manual opening from the update badge is unaffected, and an already cached verified package continues to use the existing restart prompt.

## Open questions

- Does “stop” need to stop native network I/O immediately, or is “request cancellation, discard verified bytes, and return to Available” sufficient?
- Should stopping remove the task row, retain a cancelled row, or close the Changelog while leaving the global task row visible?
- Which update hosts are expected to honor HTTP `Range`? Hosts that do not support it still work, but resume falls back to a fresh download.
- Should the Changelog show duplicate progress (its footer plus the title-bar task popover), or should it only expose the control and direct users to the existing global progress surface?
