/** The toolbar and the rail scroll with a real bar, not arrow buttons. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const toolbarSource = read("frontend/chrome/toolbar/Toolbar.tsx");
const toolbarStyles = read("frontend/chrome/toolbar/toolbar.less");
const scrollbarStyles = read("frontend/chrome/toolbar/toolbarScrollbar.less");
const scrollbarSource = read("frontend/chrome/toolbar/ToolbarScrollbar.tsx");
const sidebarStyles = read("frontend/chrome/sidebar/sidebar.less");
const progressStyles = read("frontend/chrome/transport/chartProgress.less");

test("the toolbar has no arrow affordance left", () => {
  // The component that drew the two chevrons is gone, not merely hidden.
  assert.equal(
    existsSync(new URL("frontend/chrome/toolbar/ToolbarScrollControls.tsx", root)),
    false,
  );
  assert.doesNotMatch(toolbarSource, /ToolbarScrollControls/u);
  assert.doesNotMatch(toolbarStyles, /redux-toolbar-scroll-affordance/u);
  assert.doesNotMatch(toolbarSource, /scrollStart|scrollEnd/u);
});

test("the toolbar rows scroll under one horizontal bar", () => {
  assert.match(toolbarSource, /<ToolbarScrollbar toolbarRef=\{toolbarRef\}/u);
  assert.match(toolbarSource, /data-toolbar-overflow=/u);
  // The rows still scroll; they simply never paint a bar of their own, because
  // two native bars would drift apart from the one shared position.
  assert.match(toolbarStyles, /overflow-x: auto;/u);
  assert.match(toolbarStyles, /scrollbar-width: none;/u);
  assert.match(toolbarStyles, /\.redux-toolbar-line::-webkit-scrollbar \{/u);
  assert.match(scrollbarStyles, /\.redux-toolbar > \.redux-toolbar-scrollbar \{/u);
  assert.match(scrollbarStyles, /overflow-x: auto;/u);
  // The bar must not declare the standard properties: Chromium then paints its
  // native bar, ignores `::-webkit-scrollbar`, and needs more room than the seam
  // has, which leaves the bar invisible.
  const barSection =
    scrollbarStyles.match(/\.redux-toolbar > \.redux-toolbar-scrollbar \{([\s\S]*?)\n\}/u)?.[1] ??
    "";
  assert.doesNotMatch(barSection, /scrollbar-width:/u);
  assert.doesNotMatch(barSection, /scrollbar-color:/u);
  assert.match(scrollbarStyles, /::-webkit-scrollbar-button \{[\s\S]*?display: none;/u);
});

test("the wheel moves the toolbar along its own axis", () => {
  // A horizontal run has no vertical scroll to give a normal wheel to.
  assert.match(toolbarSource, /node\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/u);
  assert.match(toolbarSource, /line\.scrollLeft \+= delta;/u);
});

test("the bar and both rows share one position", () => {
  // Whichever element the gesture moved is the source; the others follow it, so a
  // row is never left at a position the bar does not describe.
  assert.match(scrollbarSource, /const sharePosition = \(source: HTMLElement\) => \{/u);
  assert.match(scrollbarSource, /const followBar = \(\) => \{/u);
  assert.match(scrollbarSource, /const followRows = \(event: Event\) => \{/u);
  assert.match(scrollbarSource, /sharePosition\(event\.currentTarget\)/u);
  assert.match(scrollbarSource, /bar\?\.addEventListener\("scroll", followBar/u);
  assert.match(scrollbarSource, /line\.addEventListener\("scroll", followRows/u);
  assert.match(scrollbarSource, /sharedScrollRange\(linesRef\.current\)/u);
});

test("a shorter row is given the longer row's range", () => {
  // Without the placeholder a short row cannot reach the position the bar means.
  assert.match(scrollbarSource, /calculateSharedScrollCompensation/u);
  assert.match(
    scrollbarSource,
    /line\.style\.setProperty\("--toolbar-scroll-extra", `\$\{compensation\[index\]\}px`\)/u,
  );
  assert.match(toolbarStyles, /flex: 0 0 var\(--toolbar-scroll-extra, 0px\);/u);
});

test("the track is sized from the rows, not from a hidden bar", () => {
  // A bar that hides itself while the rows fit measures zero wide, which used to
  // leave the spacer exactly one viewport long: a thumb filling the whole track.
  assert.match(scrollbarSource, /const width = bar\.clientWidth \+ range;/u);
  assert.match(scrollbarSource, /requestAnimationFrame\(syncTrack\)/u);
});

test("the bar only exists while the rows overflow", () => {
  assert.match(
    scrollbarStyles,
    /\.redux-toolbar\[data-toolbar-overflow="false"\] > \.redux-toolbar-scrollbar \{\s*display: none;/u,
  );
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
