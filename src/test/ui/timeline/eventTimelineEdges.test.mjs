/** Multi-line timeline panels keep direct CSS borders at their calculated edges. */
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

test("multi-line timeline fields mount per-panel CSS edge elements", () => {
  assert.doesNotMatch(canvases, /timeline-(?:note|event)-edges/u);
  assert.match(canvases, /function TimelinePanelEdges/u);
  assert.match(canvases, /className="timeline-panel-edges"/u);
  assert.match(canvases, /className="timeline-panel-edge"/u);
  assert.match(
    styles,
    /\.timeline-notes\s*\{[\s\S]*?border-left:\s*1px solid var\(--edge-emphasis\);[\s\S]*?border-right:\s*1px solid var\(--edge-emphasis\);/u,
  );
  assert.match(
    styles,
    /\.timeline-events\s*\{[\s\S]*?border-left:\s*1px solid var\(--edge-emphasis\);[\s\S]*?border-right:\s*1px solid var\(--edge-emphasis\);/u,
  );
  assert.match(
    styles,
    /\.timeline-panel-edge\s*\{[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*var\(--timeline-panel-left\);[\s\S]*?width:\s*var\(--timeline-panel-width\);[\s\S]*?border-left:\s*1px solid var\(--edge-emphasis\);[\s\S]*?border-right:\s*1px solid var\(--edge-emphasis\);/u,
  );
  assert.match(
    styles,
    /\.timeline-panel-edges\s*\{[^}]*?border-left:\s*1px solid var\(--edge-emphasis\);[^}]*?border-right:\s*1px solid var\(--edge-emphasis\);[^}]*\}/u,
  );
});

test("the cue stays below the direct note border", () => {
  assert.match(styles, /\.timeline-notes-cue\s*\{[\s\S]*?z-index:\s*4;/u);
});
