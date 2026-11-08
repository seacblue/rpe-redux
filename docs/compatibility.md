# Chart compatibility and resources

RPE Redux reads and writes RPE charts and PEZ packages, and imports/exports Phigros official JSON and PhiEdit PEC charts through a conversion layer. Native RPE/PEZ remains the lossless working format; external formats keep the playable chart and report the editor-only features they cannot carry.

## Contents

- [Chart representation](#chart-representation)
- [External charts](#external-charts)
- [PEZ package layout](#pez-package-layout)
- [Version conversion](#version-conversion)
- [Noise areas](#noise-areas)
- [Resource resolution](#resource-resolution)
- [Assets and licensing](#assets-and-licensing)
- [Compatibility corpus](#compatibility-corpus)

## Chart representation

Keep unknown fields, empty event layers, array ordering, and untouched beat strings. Derived indexes and editor-only metadata belong outside the serialized source object. JSON and PEZ round trips compare semantic content and leave the reference input unchanged.

Chart math and serialization changes need coverage of exact beat boundaries, defaults, event-layer stacking, parent-line behavior, note counts, resource references, and Next trajectory extensions.

Speed events integrate the eased speed value. Events are sorted by time before integration, and accumulated distance uses RPE's 120 px per speed unit per second.

## External charts

`core/global/chart/formats/` owns the conversion layer. Detection is by content, not extension: an official chart has `formatVersion` and `judgeLineList`, while PEC is command text and may be stored under a `.json` name by PhiEdit.

- **Phigros official JSON** uses one BPM per line, 1/32-beat time units, normalized move coordinates and linear-only events. Import writes a global RPE tempo map and RPE events; export samples the live runtime at 1/32-beat boundaries, bakes easing and parent transforms, and computes the official floor positions. `formatVersion` 1 and 3 are read; export always writes 3.
- **PhiEdit PEC** is line-oriented text with one BPM list, paired XY movement, 30 judge lines and no metadata. Import maps `cp`/`cm`, `cd`/`cr`, `ca`/`cf`, `cv`, and `n1`–`n4` commands plus the `#`/`&` note continuations. Export samples the runtime into linear PEC commands. PEC cannot carry textures, event layers, parent lines, note-level alpha/size/y-offset/visible time or metadata, and is refused when the chart needs more than 30 lines.
- External imports are converted into an RPE chart and written through the library importer, so the original official/PEC file is never registered as the live document. Folder/archive media and `info.txt` / `info.csv` / `info.yml` sidecars supply metadata and the song/cover references.
- An archive opened as a chart file goes through the native RPE/PEZ reader first. When that reader finds no RPE chart and the archive is a supported external package, the same file is converted, imported, and opened, so a PE package (`info.csv` plus a PEC chart) does not fail as a chart-less PEZ; an archive that is neither still reports the native error.
- RPE migration reads `Settings.json`, `Hotkey.txt`, and the optional `UI.txt` / `UI.json` appearance sidecar. Recognized beat-line and playhead colours are carried over; otherwise the timeline uses RPE's reading default: red whole-beat lines, green subdivisions, and a grey playhead.
- The import/export warnings are part of the contract: a converter must not silently drop a feature it cannot represent.

## PEZ package layout

PEZ is a flat ZIP: the chart entry, media, `Info.txt`, and optional `extra.json` share the archive root. A new Redux export writes the chart as `<id>.json`, sets `META.id` to the same id, and writes `Path: <id>` in `Info.txt`; re-saving an opened package keeps its existing chart entry. An author-supplied `META.id` is preserved; a chart without one receives a stable numeric id, because RPE 1.5 and later scan only numeric folders under `Resources`. Exports also fill the neutral `alphaControl`/`posControl`/`sizeControl`/`skewControl`/`yControl` tracks and an empty `extended.inclineEvents` when a line lacks them. Notes receive the complete record native RPE writes (`above`, `alpha`, `isFake`, `speed`, `size`, `yOffset`, `visibleTime`), non-speed events receive their bezier, easing-range and link-group fields, and speed events receive their easing and link-group fields. RPE reads those records directly, so an imported chart that omitted them can otherwise open with invisible or unmoving notes. The projection lives in [`exportProjection.ts`](../src/core/global/chart/exportProjection.ts) and [`package.ts`](../src/core/global/document/package.ts).

## Version conversion

Charts created by RPE Redux declare `META.RPEVersion` 170. Opening a chart whose version is missing or lower requires conversion: the editor sets the version to 170 and materializes line defaults, notably `rotateWithFather`, whose absent value means false. A child line keeps its own angle unless an explicit flag opts into the parent's rotation. Conversion preserves unknown fields and explicit values.

File exports also write `META.ReduxVersion`, the semantic application version that produced the file. Opening compares that string with the running version and warns when the export comes from a newer Redux release. Chart writers always set both `RPEVersion` and `ReduxVersion`; the library copy keeps only the working chart without the export marker.

A converted chart is serialized in the current layout and may not open correctly in the software that originally authored it. The conversion prompt states this before the chart replaces the current document. Confirming the prompt writes the converted chart to the local library immediately, so the project keeps one current representation.

## Noise areas

`blockAreaList` holds noise areas in RPE coordinates and beats. Each area keeps `moveXEvents`, `moveYEvents`, `scaleXEvents`, `scaleYEvents`, and `rotateEvents`, plus `activeIntervals` with an optional ready flash. The preview renders those areas with the bundled NoiseField effect, or as a flat translucent fill when the editor toolbar's actual-noise switch is off. Chart serialization preserves the stored area objects.

Noise-line editing keeps its local settings on the library chart. The line owns a unit square centred on its transform origin: `scaleXEvents` and `scaleYEvents` carry the square's width and height (size X/Y), and an empty or zero track keeps the area hidden. Because the projected base is 1x1, the editor size value and the RPE `scale` multiplier are the same number. `activeIntervals` is authored directly as ranges and starts empty; an area with no intervals shows only the inactive appearance. PEZ exports and JSON document saves project those settings to `blockAreaList` and omit the editor-only field. The projection is owned by [`noiseLine.ts`](../src/core/global/chart/noise/noiseLine.ts).

A noise area has no judge-line parent relation, so ancestor translation and rotation are flattened into the area's own tracks; static or linear ancestors project exactly. Anchors offset only the hidden line texture around the same transform origin the area uses, so the area rectangle follows the line origin. Trajectories, animated parent chains, and multi-layer stacks use sampled events; see [`bakeNoiseLine.ts`](../src/core/global/chart/noise/bakeNoiseLine.ts).

## Resource resolution

`META.song` and `META.background` name the music and background; a sibling `Info.txt` may name the same resources as `Song` and `Picture`. `resourceReferences()` resolves a declared archive entry, then a same-kind file in the chart directory, then a declared name without bytes, then nothing.

Music extensions are `mp3`, `ogg`, `wav`, `flac`, `m4a`, `aac`, `opus`, and `webm`. Background extensions are `png`, `jpg`/`jpeg`, `webp`, `gif`, `bmp`, and `avif`.

Asset references stay chart-relative. The native host resolves a relative name against the chart's folder and admits it only when the canonical target remains inside that folder; `..`, symlink escapes, drive letters, and UNC paths cannot silently widen the document. Absolute references are external: they are read only after an explicit per-document grant, recorded in `user-data/document-external-resources.json`. Without a grant they stay out of the document's resource map, so opening, media serving, and disk watching never touch them. The editor shows a missing-resource warning that names the default deny policy, and an open failure adds the same explanation. After a successful open, the editor lists the rejected references, offers a per-document grant for absolute ones, and reopens that document once after confirmation. Relative paths that escape the folder stay unloaded even after a grant because no grant can make them valid; the editor reports that remainder without offering another reopen. Declining the prompt keeps the default-deny result and writes no grant.

A PEZ save rejects any out-of-bounds reference with `unsafe_save_asset_path`; an authorized external resource can be displayed but must be copied into the project before it can be packaged. The editor reports that the chart cannot be packaged until the external resources are copied into the chart folder. PEZ entry names remain package-relative. Library import treats resources under the selected RPE `Resources` folder as project resources, copies external ones under `external/`, and rejects targets outside that tree. Exported resources are written beside the chart. The optional `reduxAssetFolders` array carries the asset library's organization view; charts without it round-trip unchanged.

## Assets and licensing

Preserve `LICENSE`, `NOTICE`, and resource manifests. Built-in themes, note skins, and Extensions are build-time packages under `src/assets/`; application-owned runtime assets live under `src/public/assets/` and are served at `assets/`.

Note skins and theme packages use folder manifests with relative paths. Referenced files are validated and loaded on demand. The icon component uses PNG alpha as a mask and paints it with the active theme ink; authored SVG is reserved for decorative artwork.

## Compatibility corpus

`src/test/fixtures/corpus/` lists chart compatibility samples and their provenance. The committed corpus contains the generated smoke fixture; real-chart coverage is added deliberately with redistribution rights and kept small. The catalogue records what has been tested.
