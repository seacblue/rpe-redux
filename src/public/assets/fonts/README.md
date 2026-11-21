# Fonts

This directory owns the bundled application UI typefaces and their notices:
Saira for Latin text and a Source Han Sans CN face for CJK, kana, and full-width
punctuation. Both are SIL Open Font License 1.1; the license texts and the
product notice stay beside the font files. The generated
`src/design/styles/uiFontFaces.less` references these files, and Vite copies
`src/public/assets/fonts/` to `assets/fonts/` in the packaged frontend.

| File                        | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `Saira-Regular.ttf`         | Latin UI face.                                              |
| `SourceHanSansCN-UI.woff2`  | CJK interface subset; loaded after the editor shell mounts. |
| `ui/*.woff2`                | Unicode-range CJK slices; loaded only for entered characters. |
| `LICENSE-Saira.txt`         | Saira license text.                                         |
| `LICENSE-SourceHanSans.txt` | Source Han Sans license text.                               |
| `NOTICE.txt`                | Required product notice for the bundle.                     |

The full Source Han Sans CN OTF is a regeneration source, not a shipped asset.
It lives at `scripts/fonts/SourceHanSansCN-Regular.otf` so the web build never
downloads its 8 MiB of unused glyphs. Regenerate the UI subset, the on-demand
slices, and their `@font-face` sheet with:

```powershell
npm run build:font
```

The command requires Python 3 with `fontTools` and `brotli`. It reads the
interface, theme, Extension, and skin text under `src/`, so rerun it whenever
user-visible text changes. The UI face loads first; a user-authored character
outside the UI subset makes the browser request only its unicode-range slice.
The system CJK face is only the loading or missing-glyph fallback. Keep the
filenames and license files with any replacement, and update the font
declarations, the licenses, and `NOTICE.txt` in the same edit.
