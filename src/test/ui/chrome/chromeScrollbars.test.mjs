/** The toolbar uses edge chevrons while the rail keeps its reachable scrollbar. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const toolbarSource = read("frontend/chrome/toolbar/Toolbar.tsx");
const controlsSource = read("frontend/chrome/toolbar/ToolbarScrollControls.tsx");
const toolbarStyles = read("frontend/chrome/toolbar/toolbar.less");
const sidebarStyles = read("frontend/chrome/sidebar/sidebar.less");
const progressStyles = read("frontend/chrome/transport/chartProgress.less");
const appStyles = read("frontend/app/appStyles.less");

test("the toolbar exposes left and right chevrons when it overflows", () => {
  assert.match(toolbarSource, /<ToolbarScrollControls toolbarRef=\{toolbarRef\}/u);
  assert.match(controlsSource, /icon="chevronLeft"/u);
  assert.match(controlsSource, /icon="chevronRight"/u);
  assert.match(controlsSource, /chrome\.toolbar\.scrollStart/u);
  assert.match(controlsSource, /chrome\.toolbar\.scrollEnd/u);
  assert.match(toolbarStyles, /redux-toolbar-scroll-affordance/u);
  assert.match(toolbarStyles, /\.is-start \{/u);
  assert.match(toolbarStyles, /\.is-end \{/u);
});

test("the toolbar rows stay synchronized behind the chevrons", () => {
  assert.match(controlsSource, /calculateSharedScrollCompensation/u);
  assert.match(controlsSource, /synchronizeToolbarScrollPosition/u);
  assert.match(controlsSource, /scrollToolbarRows\(toolbarRef\.current/u);
  assert.match(controlsSource, /scrollTo\(\{ left: target, behavior: "smooth" \}\)/u);
  assert.match(toolbarSource, /data-toolbar-overflow=/u);
  assert.match(toolbarStyles, /overflow-x: auto;/u);
  assert.match(toolbarStyles, /scrollbar-width: none;/u);
  assert.match(toolbarStyles, /\.redux-toolbar-line::-webkit-scrollbar \{/u);
  assert.equal(existsSync(new URL("frontend/chrome/toolbar/ToolbarScrollbar.tsx", root)), false);
  assert.equal(existsSync(new URL("frontend/chrome/toolbar/toolbarScrollbar.less", root)), false);
  assert.doesNotMatch(appStyles, /toolbarScrollbar\.less/u);
});

test("the wheel moves the toolbar along its own axis", () => {
  // A horizontal run has no vertical scroll to give a normal wheel to.
  assert.match(toolbarSource, /node\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/u);
  assert.match(toolbarSource, /line\.scrollLeft \+= delta;/u);
});

test("a shorter row is given the longer row's range", () => {
  // Without the placeholder a short row cannot reach the position the chevrons mean.
  assert.match(
    controlsSource,
    /line\.style\.setProperty\("--toolbar-scroll-extra", `\$\{compensation\[index\]\}px`\)/u,
  );
  assert.match(toolbarStyles, /flex: 0 0 var\(--toolbar-scroll-extra, 0px\);/u);
});

test("the rail owns a vertical bar instead of clipping its entries", () => {
  const section = sidebarStyles.match(/\.sidebar-content \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  assert.match(section, /overflow-y: auto;/u);
  assert.match(section, /&::-webkit-scrollbar-thumb \{/u);
  // The old rule hid the bar, which silently made extra routes unreachable.
  assert.doesNotMatch(section, /scrollbar-width: none;/u);
  assert.doesNotMatch(section, /&::-webkit-scrollbar \{\s*width: 0;/u);
});

test("the rail bar has no stepper at either end", () => {
  const section = sidebarStyles.match(/\.sidebar-content \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  // A declared `scrollbar-width` switches Chromium to the native bar, which paints
  // an arrow at each end and ignores the custom track.
  assert.doesNotMatch(section, /scrollbar-width:/u);
  assert.doesNotMatch(section, /scrollbar-color:/u);
  assert.match(section, /&::-webkit-scrollbar-button \{[\s\S]*?display: none;/u);
});

test("the progress card fits the toolbar at every scale", () => {
  // A floor on any track or on the scrub wrap clips the card once the toolbar is
  // scaled down; every track follows the frame's inner height instead.
  const barSection =
    toolbarStyles.match(/\.transport-host \.redux-status-card \{([\s\S]*?)\n\}/u)?.[1] ?? "";
  assert.match(barSection, /grid-template-rows: minmax\(0, 1fr\) auto auto;/u);
  assert.match(barSection, /min-height: 0;/u);
  assert.doesNotMatch(toolbarStyles, /min-height: 48px;/u);
  assert.doesNotMatch(toolbarStyles, /minmax\((?:30|38)px, 1fr\)/u);
  assert.doesNotMatch(progressStyles, /min-height: 48px;/u);
  assert.doesNotMatch(progressStyles, /minmax\(40px, 1fr\)/u);
});
