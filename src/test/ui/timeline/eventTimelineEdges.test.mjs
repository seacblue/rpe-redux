/** Event timeline edge lines use the divider role and sit above the header canvas. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../../..");
const canvases = readFileSync(
  resolve(root, "src/frontend/screens/editor/workspace/timeline/surface/TimelineCanvases.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(root, "src/frontend/screens/editor/workspace/timeline/surface/timeline.less"),
  "utf8",
);

test("event timeline mounts an edge overlay above the editing canvas", () => {
  assert.match(canvases, /className="timeline-event-edges"/u);
  assert.match(
    styles,
    /\.timeline-event-edges\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?z-index:\s*5;[\s\S]*?border-left:\s*1px solid var\(--edge-emphasis\);[\s\S]*?border-right:\s*1px solid var\(--edge-emphasis\);/u,
  );
});

test("hidden event layouts remove the overlay", () => {
  assert.match(
    styles,
    /\.editor\.events-hidden[\s\S]*?\.timeline-event-edges[\s\S]*?display:\s*none;/u,
  );
});
