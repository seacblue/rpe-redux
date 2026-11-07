# NSIS artwork and hooks

The installer uses the app icon from `../icons/icon.ico`; the uninstaller uses
`uninstaller.ico` (derived from `uninstaller.svg`) so its entry is visually
distinct from the launch shortcut.
The installer also includes `installer.nsh`, which removes the deployment-local
`user-data` and `webview-data` folders when the user selects Tauri's delete-data
checkbox. Updates keep those folders intact.

The bundle uses these two bitmaps:

- `header.bmp` — 150 x 57, shown on installer pages.
- `sidebar.bmp` — 164 x 314, shown on the welcome and finish pages.

Both bitmaps are generated from the RPE Redux brand lockup on the editor's
`#0b0d12` surface. Replace them together with the brand assets so the installer,
title bar, and about page keep the same mark.
