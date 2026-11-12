/** The timing page uses one shared list/property composition in both states. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pageSource = read("frontend/screens/global/sections/timing/page.tsx");
const layoutSource = read("frontend/screens/global/sections/timing/TimingPageLayout.tsx");
const styles = read("frontend/screens/global/global.less");
const splitSource = read("frontend/chrome/inspectorPage/InspectorPageSplit.tsx");

test("compact and expanded timing states use the shared page layout", () => {
  assert.match(pageSource, /TimingPageLayout layout="compact"/u);
  assert.match(pageSource, /TimingPageLayout layout="expanded"/u);
  assert.match(layoutSource, /<GlobalTimingWorkspace \/>/u);
  assert.match(layoutSource, /<GlobalTimingInspector \/>/u);
  assert.match(layoutSource, /resizable=\{false\}/u);
  assert.match(splitSource, /var\(--space-3\)/u);
  assert.match(
    styles,
    /\.global-timing-list[\s\S]*?margin-right: calc\(-1 \* var\(--space-2\)\);/u,
  );
  assert.doesNotMatch(
    styles,
    /@container inspector-mode[\s\S]*?timing-studio[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/u,
  );
});
