/**
 * Guards the easing canvases against a wide-box stretch regression.
 *
 * Both preview modes share the same logical 260x100 drawing space, so their
 * responsive boxes must preserve that ratio instead of forcing a 100px height.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheet = new URL("../../../design/components/easing/easingPicker.less", import.meta.url);
const easingPreview = new URL(
  "../../../design/components/easing/EasingPreview.tsx",
  import.meta.url,
);
const bezierEditor = new URL("../../../design/components/easing/BezierEditor.tsx", import.meta.url);

test("easing and Bezier previews preserve the logical canvas aspect ratio", async () => {
  const source = await readFile(stylesheet, "utf8");
  const previewRule = source.match(/\.easing-preview\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const bezierRule = source.match(/\.bezier-editor\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  for (const [name, rule] of [
    ["easing", previewRule],
    ["Bezier", bezierRule],
  ]) {
    assert.match(rule, /aspect-ratio:\s*2\.6\s*;/, `${name} preview must keep its 260x100 ratio`);
    assert.match(rule, /height:\s*auto\s*;/, `${name} preview must not use a fixed height`);
  }
});

test("both previews draw a closed outer frame", async () => {
  const [easingSource, bezierSource] = await Promise.all([
    readFile(easingPreview, "utf8"),
    readFile(bezierEditor, "utf8"),
  ]);
  assert.match(easingSource, /draw\.strokeRect\(\s*EASING_PLOT_LEFT[\s\S]*?BOTTOM - TOP\s*\)/);
  assert.match(bezierSource, /draw\.strokeRect\(LEFT, TOP, PLOT_WIDTH, PLOT_HEIGHT\)/);
});
