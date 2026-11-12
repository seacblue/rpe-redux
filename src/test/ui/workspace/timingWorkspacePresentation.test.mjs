/** Timing workspace presentation keeps the list focused on editable timing points. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pageSource = read("frontend/screens/global/sections/timing/page.tsx");
const timingLayoutSource = read("frontend/screens/global/sections/timing/TimingPageLayout.tsx");
const linesPageSource = read("frontend/screens/global/sections/lines/LinePanel.tsx");
const assetsViewSource = read("frontend/screens/global/sections/assets/AssetLibraryView.tsx");
const workspaceSource = read("frontend/screens/global/sections/timing/GlobalTimingWorkspace.tsx");
const styles = read("frontend/screens/global/global.less");
const timingStyles = read("frontend/screens/global/sections/timing/timing.less");
const lineStyles = read("frontend/screens/global/sections/lines/linePanel.less");
const assetStyles = read("frontend/screens/global/sections/assets/assetLibrary.less");
const bpmStyles = read("frontend/screens/editor/inspector/bpm/bpm.less");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorDesignStyles = read("frontend/screens/editor/inspector/inspectorDesign.less");
const drawerSplitSource = read("frontend/chrome/drawer/DrawerSplit.tsx");

test("timing inspector keeps one stable page and omits deleted extras", () => {
  assert.match(pageSource, /TimingPageLayout layout="compact"/u);
  assert.match(pageSource, /TimingPageLayout layout="expanded"/u);
  assert.match(pageSource, /registerWorkspaceMode/u);
  assert.match(timingLayoutSource, /InspectorPageSplit/u);
  assert.match(timingLayoutSource, /resizable=\{false\}/u);
  assert.match(linesPageSource, /top=\{treeFace\}[\s\S]*?resizable=\{false\}/u);
  assert.match(assetsViewSource, /top=\{treeFace\}[\s\S]*?resizable=\{false\}/u);
  assert.match(inspectorSource, /className="inspector-panel-surface"/u);
  assert.match(inspectorSource, /className="inspector-panel-content"/u);
  assert.match(drawerSplitSource, /className="inspector-panel-content"/u);
  assert.match(
    inspectorDesignStyles,
    /\.inspector-content\s*>\s*\[data-panel\]:not\(\[hidden\]\)\s*>\s*\.inspector-panel-surface\s*>\s*\.inspector-panel-content[\s\S]*?padding:/u,
  );
  assert.doesNotMatch(
    inspectorDesignStyles,
    /\.inspector-content > \[data-panel\]:not\(\[hidden\]\),\s*\.inspector-content > \.inspector-panel-stack/u,
  );
  assert.doesNotMatch(pageSource, /TimingMap|timing-map/u);
  assert.doesNotMatch(workspaceSource, /global-timing-columns|data-variant/u);
  assert.match(workspaceSource, /global-timing-list-shell/u);
  assert.doesNotMatch(styles, /timing-map|global-timing-columns|global-timing-/u);
  assert.match(styles, /\.inspector-page-split\.is-static/u);
  assert.match(
    styles,
    /\.inspector-page-split\.is-static \.inspector-page-split-seam[\s\S]*?pointer-events: none;/u,
  );
  assert.match(
    styles,
    /\.inspector-page-split\.is-static \.inspector-page-split-seam::before[\s\S]*?width: 100%;/u,
  );
  assert.match(
    styles,
    /\.inspector-page-split\.is-static > \.inspector-page-split-top[\s\S]*?scrollbar-gutter: auto;/u,
  );
  assert.match(
    timingStyles,
    /\.inspector-page-split\.is-static > \.inspector-page-split-top[\s\S]*?padding: 0;/u,
  );
  assert.match(
    timingStyles,
    /\.inspector-page-split\.is-static > \.inspector-page-split-bottom[\s\S]*?padding:/u,
  );
  assert.match(
    timingStyles,
    /\.inspector-content\s*>\s*\[data-panel="timing"\]:not\(\[hidden\]\)\s*>\s*\.inspector-panel-surface\s*>\s*\.inspector-panel-content[\s\S]*?padding: 0;/u,
  );
  assert.match(
    lineStyles,
    /\.inspector-content\s*>\s*\[data-panel="lines"\]:not\(\[hidden\]\)\s*>\s*\.inspector-panel-surface\s*>\s*\.inspector-panel-content[\s\S]*?padding: 0;/u,
  );
  assert.match(
    assetStyles,
    /\.inspector-content\s*>\s*\[data-panel="assets"\]:not\(\[hidden\]\)\s*>\s*\.inspector-panel-surface\s*>\s*\.inspector-panel-content[\s\S]*?padding: 0;/u,
  );
  assert.match(
    lineStyles,
    /line-panel\[data-variant="stacked"\][\s\S]*?inspector-page-split-top[\s\S]*?padding: 0;/u,
  );
  assert.match(assetStyles, /inspector-page-split-top > \.asset-tree-shell[\s\S]*?padding:/u);
  assert.match(
    timingStyles,
    /\.global-timing-list-shell[\s\S]*?margin-right: calc\(-1 \* var\(--space-2\)\);/u,
  );
  assert.doesNotMatch(timingStyles, /\.global-timing-list\s*\{[\s\S]*?margin-right:/u);
  assert.match(
    timingStyles,
    /\.inspector-content:has\(> \[data-panel="timing"\]:not\(\[hidden\]\)\)[\s\S]*?scrollbar-gutter: auto;/u,
  );
  assert.doesNotMatch(bpmStyles, /\.bpm-tool\s*\{[\s\S]*?border-top:/u);
});
