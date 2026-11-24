# Note skins

Note skins use the Phira respack format. `src/core/media/phiraRespack.ts` owns the `info.yml` parser, geometry validation, and the normalized manifest; `src/core/media/phiraSkinDraft.ts` maps the workbench's canonical slots to the fixed file layout and assembles a package; `src/core/platform/desktop/noteSkinPackages.ts` discovers package folders and installs or removes imported packages; `src/frontend/platform/noteSkinBridge.ts` loads the built-in packages, preferring writable overrides. The built-in packages are `src/assets/skins/builtin_reducer_cells/` and `src/assets/skins/builtin_phiskin/`.

```text
builtin_reducer_cells/
  info.yml
  click.png
  click_mh.png
  drag.png
  drag_mh.png
  flick.png
  flick_mh.png
  hold.png
  hold_mh.png
  hit_fx.png
  event_hold.png       # Redux extension
  line.png             # optional Redux judge-line texture
  click.ogg            # optional
  drag.ogg             # optional
  flick.ogg            # optional

builtin_phiskin/
  info.yml
  click.png
  click_mh.png
  drag.png
  drag_mh.png
  flick.png
  flick_mh.png
  hold.png
  hold_mh.png
  hit_fx.png
```

Each direct child folder containing `info.yml` is one package. Set `id` when the package identity must differ from its display `name`; it must contain only ASCII letters, digits, `.`, `_`, or `-`. When `id` is absent, a skin id is made from the trimmed ASCII name stem plus an eight-digit hash of the trimmed display name (or `skin_<hash>` when no ASCII stem remains). The shipped built-ins are `builtin_reducer_cells` (`Reducer Cells`) and `builtin_phiskin` (`Phiskin ~ 圆角简约`), in that order. `Reducer Cells` is the default and first fallback; `Phiskin` is selectable but never becomes the default. The picker keeps built-ins in this fixed order, then lists installed skins by their persisted added time. Saving a package always writes the id it was opened with, so editing a built-in keeps one package identity instead of adding a picker entry.

`mh` means the highlight variant. A simultaneous note renders at the base width multiplied by `click_mh.png` width divided by `click.png` width, exactly as Phira does. `hold.png` and `hold_mh.png` are vertical atlases; `holdAtlas` and `holdAtlasMH` give their tail and head heights in pixels, while the middle strip is the body. A tail or head height may be zero when the pack has no art for that cap. Redux reads two fixed-name extensions: `event_hold.png` at the package root for event bars and `line.png` at the package root as the judge-line texture. Neither needs an `info.yml` entry.

## `info.yml`

| Field | Contract |
| --- | --- |
| `name` | Required display name. |
| `id` | Optional stable package id; ASCII letters, digits, `.`, `_`, and `-`, up to 64 characters. If omitted, the host generates one from `name`. |
| `author` / `description` | Optional package metadata. |
| `hitFx` | Required `[columns, rows]` grid for `hit_fx.png`. |
| `holdAtlas` / `holdAtlasMH` | Required `[tailHeight, headHeight]` pixel boundaries for the two Hold atlases. Either cap may be zero; the body must stay non-empty. |
| `hitFxDuration` | Optional hit-effect lifetime in seconds, defaulting to `0.5`. |
| `hitFxScale` | Optional hit-effect size multiplier, defaulting to `1`. |
| `hitFxRotate` / `hitFxTinted` | Optional rotation and tint switches; rotation follows the note and tint follows the note's hit colour. |
| `hideParticles` | Optional switch that suppresses the four-square burst while keeping the sprite. |
| `holdKeepHead` | Optional switch that keeps the head cap after the Hold reaches the line. |
| `holdRepeat` | Optional switch that tiles the body at its intrinsic height instead of stretching it. |
| `holdCompact` | Optional switch that centres each cap on its anchor so it overlaps the body. |

Required files are the nine fixed Phira images: `click`, `click_mh`, `drag`, `drag_mh`, `flick`, `flick_mh`, `hold`, `hold_mh`, and `hit_fx`. Audio files are optional. A package is limited to 64 MB and 256 files; each PNG is limited to 8 MB, 4096×4096, and 16 million pixels. Atlas boundaries must leave a non-empty body, and `hitFx` must divide the hit-effect image dimensions exactly. The workbench may save a partial package; the runtime fills missing slots from the built-in package and then from the first installed skin that provides them.

The default `Reducer Cells` package uses (`click.png` 989×100, `hold.png` 989×310 with 50px caps, `hold_mh.png` 1089×360 with 50px and 100px caps, and a 6×5 `hit_fx.png`). The optional `Phiskin` package uses (`click.png` 1000×100, `hold.png` 1000×1100 with 50px caps, `hold_mh.png` 1200×1260 with 130px caps, and an 8×7 `hit_fx.png`). Preview note width uses Phira's `note_scale` mapping: a scale of `1` spans 13.175% of the stage, and the setting range is `0.8`–`1.2`.

Limits: manifest 64 KB; package 64 MB and 256 asset files; each PNG at most 8 MB, 4096×4096, and 16 million pixels.

## Discovery

Skins are discovered from the writable `skins/` folder beside the executable and from the packaged resource directory. The writable root wins an id collision, so a package saved there shadows the shipped copy with the same id: editing a built-in writes `skins/builtin_reducer_cells/` or `skins/builtin_phiskin/`, and that override is what renders. The host marks both shipped packages as built-in so the picker lists them once, and it skips the legacy shipped folder ids `default` and `built_in_original`. Both roots are polled while the app runs, so dropping a Phira package in place updates the picker without a restart.

Each discovered package carries a content signature derived from its files. Changing a package file refreshes the package list and reloads the active preview when that package is selected.

## Authoring

Settings > Appearance > Note skin > Edit opens the skin workbench. It presents one slot for every fixed Phira image, the Redux event-bar and judge-line textures, and the three optional hit sounds. An empty slot accepts a picked or dropped file; the same menu can reuse the matching field from another installed skin. A board may be saved with unfilled slots; the runtime fills each one from the built-in package, then from the first installed skin that provides it. The note-skin setting shows a warning dot when no installed package can fill a missing slot.

The Hold slots carry a cut editor: drag the two horizontal boundaries or enter the tail and head heights, and the middle strip becomes the stretchable body. Those heights are written to `holdAtlas` and `holdAtlasMH`; the hit-effect slot writes its `hitFx` frame grid. Saving overwrites the package the workbench was opened from through the guarded installer; a new board derives its folder id from its name with the same rule. Editing the built-in package writes a same-id override into the writable library, and the workbench's delete action removes that override to restore the shipped copy. Files the board does not edit, such as optional resources a Phira client understands, are carried through from the source package.

Dropping a Phira ZIP or a folder containing `info.yml` onto the workbench validates and installs it immediately, then opens the package on the board for further edits.

Phira export writes the Redux extensions into the package: `event_hold.png` is always present, using the package's event texture or its Hold body when one is missing, and a judge-line texture is normalized to the package-root `line.png`. An export with missing slots first lists them and fills them from the same fallback order; a slot no package can provide stops the export.
