# Redux Default skin

A complete built-in skin. Copy the folder, give it a unique id, and update `manifest.json` before editing. Paths are relative to the manifest.

## Layout

- `note/` — note heads, hold body, and hold end images.
- `event/` — event-layer images such as `event_bar.png`.
- `judgeline/` — default judge-line image.
- `particle/` — sequential `img-1.png` … `img-N.png` hit particles.
- `sound/` — OGG hit sounds with source/licence notices.

## Manifest

The package name is either one plain string or a language map such as `{ "en": "Built-in - Original", "zh": "内置 - 原版" }`; the picker selects the current interface language. `notes` and `events` map semantic names to image files. Each image may carry a `useful` rectangle in source pixels; the renderer aligns that box and draws the complete image around it. The judge line has its own `judgeline.line` slot.

The bundled manifest spells out the reference `useful` rectangles for the shipped note images. Custom skins may add their own rectangles when transparent padding or glow needs alignment.
