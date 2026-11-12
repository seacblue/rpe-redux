/** Inspector workspace modes hand off to compact panes after their exit motion. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");

test("workspace mode collapse waits for the panel transition before handoff", () => {
  assert.match(inspectorSource, /transitionend/u);
  assert.match(inspectorSource, /data-mode-handoff/u);
  assert.doesNotMatch(
    inspectorSource,
    /setTimeout\(\(\) => \{\s*setDisplayedMode\(null\);\s*\},\s*280\)/u,
  );
});
