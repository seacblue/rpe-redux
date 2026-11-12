/** Timing workspace presentation keeps the list focused on editable timing points. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pageSource = read("frontend/screens/global/sections/timing/page.tsx");
const workspaceSource = read("frontend/screens/global/sections/timing/GlobalTimingWorkspace.tsx");
const styles = read("frontend/screens/global/global.less");

test("timing workspace omits the timing map and column header", () => {
  assert.doesNotMatch(pageSource, /TimingMap|timing-map/u);
  assert.doesNotMatch(workspaceSource, /global-timing-columns|data-variant/u);
  assert.doesNotMatch(styles, /timing-map|global-timing-columns/u);
});
