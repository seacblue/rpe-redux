# Note skins

Note skins use the Phira respack format. `src/core/media/phiraRespack.ts` owns the `info.yml` parser, geometry validation, and the normalized manifest; `src/core/media/phiraSkinDraft.ts` maps the workbench's canonical slots to the fixed file layout and assembles a package; `src/core/platform/desktop/noteSkinPackages.ts` discovers package folders and installs or removes imported packages; `src/frontend/platform/noteSkinBridge.ts` loads the built-in package, preferring the writable override. The built-in package is `src/assets/skins/built_in_original/`.

```text
built_in_original/
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
```

Each direct child folder containing `info.yml` is one package. A package id is derived from its display `name` by the shared rule in `src/core/utils/packageName.ts` (`packageSlug`): ASCII letters and digits survive, every other run collapses to `_`, and a name with no ASCII characters falls back to a stable hash. The built-in name "Built-in - Original" therefore lives in `built_in_original/`. Saving a package always writes the id it was opened with, so editing the built-in keeps one package identity instead of adding a picker entry.

`mh` means the highlight variant. `hold.png` and `hold_mh.png` are vertical atlases; `holdAtlas` and `holdAtlasMH` give their tail and head heights in pixels, while the middle strip is the body. Redux uses the optional `event_hold.png` for event bars and `line.png` at the package root as the judge-line texture.

## `info.yml`

| Field | Contract |
| --- | --- |
| `name` | Required display name; also the source of the package id. |
| `author` / `description` | Optional package metadata. |
| `hitFx` | Required `[columns, rows]` grid for `hit_fx.png`. |
| `holdAtlas` / `holdAtlasMH` | Required `[tailHeight, headHeight]` pixel boundaries for the two Hold atlases. |
| `eventHold` | Optional Redux extension path, defaulting to `event_hold.png` when present. |

Required files are the nine fixed Phira images: `click`, `click_mh`, `drag`, `drag_mh`, `flick`, `flick_mh`, `hold`, `hold_mh`, and `hit_fx`. Audio files are optional. A package is limited to 64 MB and 256 files; each PNG is limited to 8 MB, 4096×4096, and 16 million pixels. Atlas boundaries must leave a non-empty body, and `hitFx` must divide the hit-effect image dimensions exactly. The workbench may save a partial package; the runtime fills missing slots from the built-in package and then from the first installed skin that provides them.

Limits: manifest 64 KB; package 64 MB and 256 asset files; each PNG at most 8 MB, 4096×4096, and 16 million pixels.

## Discovery

Skins are discovered from the writable `skins/` folder beside the executable and from the packaged resource directory. The writable root wins an id collision, so a package saved there shadows the shipped copy with the same id: editing the built-in writes `skins/built_in_original/`, and that override is what renders. The host marks the built-in package so the picker lists it once, and it skips the pre-rename shipped folder id `default`, so upgrading never exposes a second built-in entry. Both roots are polled while the app runs, so dropping a Phira package in place updates the picker without a restart.

Each discovered package carries a content signature derived from its files. Changing a package file refreshes the package list and reloads the active preview when that package is selected.

## Authoring

Settings > Appearance > Note skin > Edit opens the skin workbench. It presents one slot for every fixed Phira image, the Redux event-bar and judge-line textures, and the three optional hit sounds. An empty slot accepts a picked or dropped file; the same menu can reuse the matching field from another installed skin. A board may be saved with unfilled slots; the runtime fills each one from the built-in package, then from the first installed skin that provides it. The note-skin setting shows a warning dot when no installed package can fill a missing slot.

The Hold slots carry a cut editor: drag the two horizontal boundaries or enter the tail and head heights, and the middle strip becomes the stretchable body. Those heights are written to `holdAtlas` and `holdAtlasMH`; the hit-effect slot writes its `hitFx` frame grid. Saving overwrites the package the workbench was opened from through the guarded installer; a new board derives its folder id from its name with the same rule. Editing the built-in package writes a same-id override into the writable library, and the workbench's delete action removes that override to restore the shipped copy. Files the board does not edit, such as optional resources a Phira client understands, are carried through from the source package.

Dropping a Phira ZIP or a folder containing `info.yml` onto the workbench validates and installs it immediately, then opens the package on the board for further edits.

Phira export writes the Redux extensions into the package: `event_hold.png` is always present, using the package's event texture or its Hold body when one is missing, and a judge-line texture is normalized to the package-root `line.png`. An export with missing slots first lists them and fills them from the same fallback order; a slot no package can provide stops the export.
