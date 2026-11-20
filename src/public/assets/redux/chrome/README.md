# Editor chrome artwork

Editor-owned sprites served from `assets/redux/chrome/`. These are interface
marks, not chart resources: a chart cannot reference them and a note-skin pack
cannot replace them.

- `line_pointer.png` marks the selected judge line in the live preview. It is a
  256×256 white alpha mask whose anchor is the image centre. An equilateral
  triangle sits on that anchor with its base on the judge line and its apex up
  the line's local normal, and a smaller equilateral triangle is removed from
  the middle of that base. The notch splits the base into two feet, so the
  marker still reads as a direction when the line itself is transparent. The
  runtime tints it with `--canvas-preview-line-selected`.

Redraw the mask rather than editing it in place: the anchor and the notch are
geometry the renderer relies on. The Canvas2D fallback in
`src/frontend/screens/editor/workspace/preview/drawing/previewGuides.ts` repeats
the same outline for surfaces where the sprite fails to decode, so both must
change together.
