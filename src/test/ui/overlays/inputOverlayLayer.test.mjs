/** The input overlay must paint above every other in-window surface. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../../..");
const styles = readFileSync(
  resolve(root, "src/frontend/screens/editor/workspace/stage/inputOverlays/inputOverlays.less"),
  "utf8",
);

test("input overlays paint above the performance HUD", () => {
  const match = styles.match(/\.input-overlays\s*\{([\s\S]*?)\n\}/u);
  assert.ok(match, "input overlay host is missing");
  assert.match(
    match[1],
    /z-index:\s*calc\(var\(--z-performance-hud\)\s*\+\s*1\);/u,
    "input overlay host must stay above the performance HUD",
  );
});
