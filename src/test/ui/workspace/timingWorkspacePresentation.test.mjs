/** Timing workspace presentation keeps the list focused on editable timing points. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pageSource = read("frontend/screens/global/sections/timing/page.tsx");
const timingLayoutSource = read("frontend/screens/global/sections/timing/TimingPageLayout.tsx");
const linesPageSource = read("frontend/screens/global/sections/lines/LinePanel.tsx");
const linesRegistration = read("frontend/screens/global/sections/lines/page.tsx");
const assetsViewSource = read("frontend/screens/global/sections/assets/AssetLibraryView.tsx");
const assetsRegistration = read("frontend/screens/global/sections/assets/page.tsx");
const workspaceSource = read("frontend/screens/global/sections/timing/GlobalTimingWorkspace.tsx");
const styles = read("frontend/screens/global/global.less");
const timingStyles = read("frontend/screens/global/sections/timing/timing.less");
const lineStyles = read("frontend/screens/global/sections/lines/linePanel.less");
const assetStyles = read("frontend/screens/global/sections/assets/assetLibrary.less");
const bpmStyles = read("frontend/screens/editor/inspector/bpm/bpm.less");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");
const inspectorDesignStyles = read("frontend/screens/editor/inspector/inspectorDesign.less");
const drawerSplitSource = read("frontend/chrome/drawer/DrawerSplit.tsx");
const pageSplitSource = read("frontend/chrome/inspectorPage/InspectorPageSplit.tsx");
const pageStyles = read("frontend/chrome/inspectorPage/inspectorPage.less");

test("timing inspector keeps one stable page and omits deleted extras", () => {
  assert.match(pageSource, /TimingPageLayout layout="compact"/u);
  assert.match(pageSource, /TimingPageLayout layout="expanded"/u);
  assert.match(pageSource, /registerWorkspaceMode/u);
  assert.match(pageSource, /layout: "split"/u);
  assert.match(timingLayoutSource, /InspectorPageSplit/u);
  assert.match(linesPageSource, /top=\{treeFace\}/u);
  assert.match(linesRegistration, /layout: "split"/u);
  assert.match(assetsViewSource, /top=\{treeFace\}/u);
  assert.match(assetsRegistration, /layout: "split"/u);
  assert.doesNotMatch(pageSource, /TimingMap|timing-map/u);
  assert.doesNotMatch(workspaceSource, /global-timing-columns|data-variant/u);
  assert.match(workspaceSource, /global-timing-list-shell/u);
  assert.doesNotMatch(styles, /timing-map|global-timing-columns|global-timing-/u);
  assert.match(
    timingStyles,
    /\.global-timing-list-shell[\s\S]*?margin-right: calc\(-1 \* var\(--space-2\)\);/u,
  );
  assert.doesNotMatch(timingStyles, /\.global-timing-list\s*\{[\s\S]*?margin-right:/u);
  assert.doesNotMatch(bpmStyles, /\.bpm-tool\s*\{[\s\S]*?border-top:/u);
});

test("the expanded studio roots fill the inspector body height", () => {
  const studioRoot = styles.match(
    /\.lines-studio,\s*\n\.assets-studio,\s*\n\.timing-studio \{([\s\S]*?)\}/u,
  );
  assert.ok(studioRoot, "the timing studio shares the full-height studio root rule");
  assert.match(studioRoot[1], /display: flex;/u);
  assert.match(studioRoot[1], /flex-direction: column;/u);
  assert.match(studioRoot[1], /height: 100%;/u);
  const studioBody = styles.match(/\.studio-body \{([\s\S]*?)\}/u);
  assert.ok(studioBody);
  assert.match(studioBody[1], /flex: 1 1 auto;/u);
  assert.match(timingLayoutSource, /className="timing-studio"/u);
});

test("the frame owns no pane inset and each page supplies the content layer", () => {
  assert.match(inspectorSource, /className="inspector-body"/u);
  assert.match(inspectorSource, /className="inspector-pane"/u);
  assert.match(inspectorSource, /<InspectorPage>/u);
  assert.doesNotMatch(inspectorSource, /inspector-panel-surface|inspector-panel-content/u);
  assert.match(drawerSplitSource, /<InspectorPage>/u);
  const bodyRule = inspectorStyles.match(/\.inspector-body \{([\s\S]*?)\}/u);
  assert.ok(bodyRule);
  assert.doesNotMatch(bodyRule[1], /padding:|margin:/u);
  const paneRule = inspectorStyles.match(/\.inspector-pane \{([\s\S]*?)\}/u);
  assert.ok(paneRule);
  assert.doesNotMatch(paneRule[1], /padding:|margin:/u);
  const contentRule = pageStyles.match(/\.inspector-page-content \{([\s\S]*?)\}/u);
  assert.ok(contentRule);
  assert.match(contentRule[1], /padding: var\(--space-4\) var\(--inspector-gutter\)/u);
  assert.doesNotMatch(inspectorDesignStyles, /inspector-panel-content|inspector-panel-surface/u);
});

test("a split page is two fixed faces above and below one full-width rule", () => {
  assert.match(pageSplitSource, /inspector-page-split-rule/u);
  assert.match(pageSplitSource, /inspector-page-content/u);
  assert.doesNotMatch(pageSplitSource, /resizable|aria-valuenow|PointerEvent/u);
  const splitRule = pageStyles.match(/\.inspector-page-split \{([\s\S]*?)\}/u);
  assert.ok(splitRule);
  // Flex, not grid: the Inspector handoff animates the upper share to zero.
  assert.match(splitRule[1], /display: flex;/u);
  assert.match(splitRule[1], /flex-direction: column;/u);
  assert.match(pageStyles, /\.inspector-page-split-top \{\s*flex: 0 0 42%;/u);
  assert.match(pageStyles, /\.inspector-page-split-bottom \{\s*flex: 1 1 auto;/u);
  const ruleRule = pageStyles.match(/\.inspector-page-split-rule \{([\s\S]*?)\}/u);
  assert.ok(ruleRule);
  assert.match(ruleRule[1], /height: 1px;/u);
  assert.match(ruleRule[1], /background: var\(--edge-emphasis\);/u);
  const faceRule = pageStyles.match(/\.inspector-page-split-face \{([\s\S]*?)\}/u);
  assert.ok(faceRule);
  assert.match(faceRule[1], /overflow-y: auto;/u);
  assert.match(faceRule[1], /scrollbar-gutter: stable;/u);
  assert.doesNotMatch(faceRule[1], /padding:|margin:/u);
  assert.doesNotMatch(pageStyles, /row-resize|page-split-seam|page-split-grip/u);
  assert.match(pageStyles, /\.inspector-page-scroll \{[\s\S]*?overflow-y: auto;/u);
});

test("stacked page sheets size their own face content instead of padding the frame", () => {
  assert.match(
    lineStyles,
    /\.line-panel\[data-variant="stacked"\] \.inspector-page-split-top \.line-tree \{[\s\S]*?flex: 1 1 auto;/u,
  );
  assert.match(
    lineStyles,
    /\.line-panel\[data-variant="stacked"\] \.inspector-page-split-top \.line-tree-footer \{[\s\S]*?margin: 0;/u,
  );
  assert.match(
    assetStyles,
    /\.inspector-page-split-top \.asset-tree-shell \{[\s\S]*?flex: 1 1 auto;/u,
  );
  assert.doesNotMatch(lineStyles, /\.inspector-content\s*>|\.inspector-panel-content/u);
  assert.doesNotMatch(assetStyles, /\.inspector-content\s*>|\.inspector-panel-content/u);
  assert.doesNotMatch(timingStyles, /\.inspector-content\s*>|\.inspector-panel-content/u);
  assert.doesNotMatch(timingStyles, /inspector-page-split\.is-static/u);
  assert.match(timingStyles, /\.global-timing-workspace \{[\s\S]*?flex: 1 1 auto;/u);
});

test("the scrollbar rides the pane edge rather than an inner gutter", () => {
  assert.match(inspectorStyles, /\.inspector-pane\[hidden\] \{[\s\S]*?display: none;/u);
  assert.doesNotMatch(inspectorStyles, /\.inspector-content\b/u);
  const scrollRule = pageStyles.match(/\.inspector-page-scroll \{([\s\S]*?)\}/u);
  assert.ok(scrollRule);
  assert.doesNotMatch(scrollRule[1], /padding:|margin:/u);
});
