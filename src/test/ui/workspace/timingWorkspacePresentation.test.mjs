/** Timing workspace presentation keeps the list focused on editable timing points. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pageSource = read("frontend/screens/global/sections/timing/page.tsx");
const workspaceSource = read("frontend/screens/global/sections/timing/GlobalTimingWorkspace.tsx");
const styles = read("frontend/screens/global/global.less");
const bpmStyles = read("frontend/screens/editor/inspector/bpm/bpm.less");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");

test("timing inspector keeps one stable page and omits deleted extras", () => {
  assert.match(pageSource, /InspectorPageSplit/u);
  assert.match(pageSource, /resizable=\{false\}/u);
  assert.doesNotMatch(
    pageSource,
    /TimingPageLayout|TimingStudio|registerWorkspaceMode|workspaceMode:/u,
  );
  assert.doesNotMatch(pageSource, /TimingMap|timing-map/u);
  assert.doesNotMatch(workspaceSource, /global-timing-columns|data-variant/u);
  assert.doesNotMatch(styles, /timing-map|global-timing-columns/u);
  assert.match(styles, /\.inspector-page-split\.is-static/u);
  assert.match(
    styles,
    /\.global-timing-list[\s\S]*?margin-right: calc\(-1 \* var\(--space-2\)\);/u,
  );
  assert.match(
    inspectorStyles,
    /\.inspector-content:has\(> \[data-panel="timing"\]:not\(\[hidden\]\)\)[\s\S]*?scrollbar-gutter: auto;/u,
  );
  assert.doesNotMatch(bpmStyles, /\.bpm-tool\s*\{[\s\S]*?border-top:/u);
});
