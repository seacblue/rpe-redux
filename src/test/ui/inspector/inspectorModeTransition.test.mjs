/** Inspector workspace modes hand off to compact panes after their exit motion. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");

test("workspace mode collapse waits for the panel transition before handoff", () => {
  assert.match(inspectorSource, /transitionend/u);
  assert.match(inspectorSource, /transitionDurationMs\(element, "width"\)/u);
  assert.doesNotMatch(inspectorSource, /data-mode-handoff|modeHandoff/u);
  assert.doesNotMatch(
    inspectorSource,
    /setTimeout\(\(\) => \{\s*setDisplayedMode\(null\);\s*\},\s*280\)/u,
  );
});

test("workspace mode owns its expanded gutters instead of inheriting field padding", () => {
  assert.match(
    inspectorStyles,
    /\.inspector-content > \[data-panel="workspace-mode"\]\.inspector-mode-surface:not\(\[hidden\]\)[\s\S]*?padding: 0;/u,
  );
  assert.doesNotMatch(inspectorStyles, /data-mode-handoff/u);
});
