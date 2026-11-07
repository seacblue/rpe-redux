# Note skins

A note skin is a data package: a manifest plus textures and optional audio or particle files. `src/core/media/noteSkin.ts` owns the manifest schema and validation; `src/core/platform/desktop/noteSkinPackages.ts` discovers packaged folders on desktop; `src/frontend/platform/noteSkinBridge.ts` decodes the bundled default. The built-in package is `src/assets/skins/default/`.

```text
default/
  manifest.json
  note/
    tap.png
    drag.png
    flick.png
    hold_head.png
    hold_body.png
    hold_end.png
  event/
    event_bar.png
  judgeline/
    line.png
  particle/
    img-*.png
  sound/
    tap.ogg
```

Each direct child folder with a manifest is one package, and the folder name is its stable package id. Subfolders inside a package hold assets; a package uses either `manifest.json` or `skin.json`, never both. Copy `default/` to start a new skin and change its manifest name.

## Manifest

| Field       | Contract                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| `name`      | A string or a language-to-string map.                                     |
| `notes`     | Map of note texture slots to `{ file, useful? }`.                         |
| `events`    | Map of event texture slots to `{ file, useful? }`.                        |
| `judgeline` | Optional `{ line: { file, useful? } }`; absent keeps the bundled default. |
| `particles` | Optional map of named sprite resources to package-relative paths.         |
| `audio`     | Optional map of named sound resources to package-relative paths.          |

Required note textures are `tap`, `drag`, `flick`, `hold_head`, `hold_body`, and `hold_end`. The highlighted variants `tap_highlight`, `drag_highlight`, `flick_highlight`, `hold_head_highlight`, and `hold_body_highlight` are optional, as is `event_bar`. Every `file` path is relative to the manifest. A `useful` rectangle declares the logical image rectangle used to align a texture whose PNG has transparent padding; it must fit inside the decoded image.

Limits: manifest 64 KB; package 64 MB and 256 asset files; each PNG at most 8 MB, 4096×4096, and 16 million pixels.

## Discovery

Skins are discovered from the portable `skins/` folder beside the executable and from the packaged resource directory. The portable root wins an id collision; the picker shows the built-in default once. Both roots are polled while the app runs, so dropping a package in place updates the picker without a restart.

Each discovered package carries a content signature derived from its files. Changing a manifest or texture refreshes the package list and reloads the active preview when that package is selected.
