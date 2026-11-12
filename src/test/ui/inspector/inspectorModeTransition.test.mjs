/** Inspector workspace modes hand off to compact panes after their exit motion. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");
const globalStyles = read("frontend/screens/global/global.less");

test("workspace mode collapse waits for the panel transition before handoff", () => {
  assert.match(inspectorSource, /transitionend/u);
  assert.match(inspectorSource, /transitionDurationMs\(element, "width"\)/u);
  assert.match(inspectorSource, /"compact" \| "opening" \| "expanded" \| "closing"/u);
  assert.match(inspectorSource, /data-mode-phase=\{modeSurface \? modePhase : undefined\}/u);
  assert.match(
    inspectorSource,
    /const isModeUnderlay = modeSurface && displayedMode\?\.id === id;/u,
  );
  assert.match(inspectorSource, /hidden=\{activeDrawerPane !== null \|\| !isActivePanel\}/u);
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
  assert.doesNotMatch(inspectorStyles, /opacity var\(--design-dur-exit\)/u);
  assert.doesNotMatch(inspectorStyles, /data-mode-handoff/u);
  assert.match(globalStyles, /translateY\(-100%\)/u);
  assert.match(globalStyles, /data-mode-phase="closing"[\s\S]*?translateY\(0\)/u);
});
