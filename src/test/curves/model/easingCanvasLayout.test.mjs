/**
 * Guards the easing previews against diverging from each other.
 *
 * Both modes share one logical drawing space and one painter in
 * `easingCanvas.ts`. Keeping them on the same frame, palette, and overshoot
 * treatment is what stops a fix in one preview from leaving the other odd.
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
const canvas = new URL("../../../design/components/easing/easingCanvas.ts", import.meta.url);

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

test("both preview canvases share one transparent surface", async () => {
  const source = await readFile(stylesheet, "utf8");
  const ruleOf = (selector) => {
    const match = source.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
    assert.ok(match, `${selector} must have a rule`);
    return match[1];
  };
  for (const selector of ["\\.easing-preview", "\\.bezier-editor"]) {
    const rule = ruleOf(selector);
    assert.match(rule, /background:\s*transparent;/, `${selector} must not paint its own fill`);
    assert.doesNotMatch(rule, /border:\s*1px/, `${selector} must not paint its own border`);
  }
});

test("one painter owns the frame, palette, and overshoot fade", async () => {
  const [easingSource, bezierSource, canvasSource] = await Promise.all([
    readFile(easingPreview, "utf8"),
    readFile(bezierEditor, "utf8"),
    readFile(canvas, "utf8"),
  ]);

  for (const [name, source] of [
    ["easing", easingSource],
    ["Bezier", bezierSource],
  ]) {
    assert.match(
      source,
      /prepareEasingCanvas\(/,
      `${name} preview must share the prepared surface`,
    );
    assert.match(source, /drawEasingFrame\(/, `${name} preview must share the frame painter`);
    assert.match(source, /strokeEasingPolyline\(/, `${name} preview must share the curve painter`);
    assert.doesNotMatch(source, /strokeRect\(/u, `${name} preview must not paint its own frame`);
    assert.doesNotMatch(
      source,
      /getPropertyValue\("--accent"\)/u,
      `${name} preview must not resolve its own palette`,
    );
  }

  // The shared painter keeps the bounded segment at full weight and fades the
  // part that leaves the frame, which is what both previews must agree on.
  assert.match(canvasSource, /EASING_OVERSHOOT_ALPHA = [\d.]+;/);
  assert.match(canvasSource, /EASING_FRAME_ALPHA = [\d.]+;/);
  assert.match(
    canvasSource,
    /context\.globalAlpha = EASING_OVERSHOOT_ALPHA;/,
    "the shared painter must fade the curve outside the frame",
  );
  assert.match(
    canvasSource,
    /context\.clip\(\);/u,
    "the shared painter must clip the bounded segment",
  );
});

test("the frame is solid and the shared plot rect is one constant", async () => {
  const canvasSource = await readFile(canvas, "utf8");
  assert.match(canvasSource, /top: 14,/);
  assert.match(canvasSource, /bottom: 86,/);
  const frameBody = canvasSource.match(/export function drawEasingFrame[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(frameBody, "the frame painter must exist");
  assert.doesNotMatch(frameBody, /setLineDash/, "the frame must be solid, not dashed");
});
