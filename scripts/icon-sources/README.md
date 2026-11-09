# UI icon sources

The bundled theme glyphs are rasterised from **Lucide** (ISC License, <https://lucide.dev>), version **1.61.0**, and Microsoft **Fluent UI System Icons** (MIT License, <https://github.com/microsoft/fluentui-system-icons>) for the window-caption buttons.

- Every Lucide source uses the 24×24 grid with round caps and joins. Local geometry glyphs that the library lacks live in the same folder.
- Fluent caption sources live in `fluent/`; their SVGs use `currentColor` fills.
- `scripts/iconSources.mjs` maps each published icon path to its source name and collection.
- `npm run build:icons` renders 192×192 alpha masks into both theme packages: dark uses a 2.0 stroke, light uses 1.75 so dark ink on a light surface keeps the same apparent weight.
- The runtime keeps only the alpha; the icon primitive masks the PNG and paints it with the active theme token, so one shape works for every surface and action state.

Only the source SVGs listed by `scripts/iconSources.mjs` are needed. The full Lucide license is in `LICENSE`, the Fluent license in `fluent/LICENSE`, and the project-level notice names both collections.

To add a glyph:

1. Add the source SVG to `lucide/` or `fluent/`.
2. Add its path to `scripts/iconSources.mjs` and to `iconAssets.ts`.
3. Run `npm run build:icons`.
