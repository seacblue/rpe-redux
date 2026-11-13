/** Inspector workspace modes hand off to compact panes after their exit motion. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");
const pageStyles = read("frontend/chrome/inspectorPage/inspectorPage.less");
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

test("the handoff sizes both copies from one animated cover length", () => {
  // The cover is registered so it interpolates; the underlay width and the wide
  // page's detail track read it, which is what keeps the two copies aligned.
  assert.match(inspectorStyles, /@property --mode-cover \{[\s\S]*?syntax: "<length>";/u);
  assert.match(
    inspectorStyles,
    /--mode-cover: calc\(var\(--inspector-compact-width, 400px\) - 1px\);/u,
  );
  assert.match(
    inspectorStyles,
    /\.inspector\[data-mode-phase="opening"\] \.inspector-body,[\s\S]*?--mode-cover: calc\(/u,
  );
  assert.match(
    inspectorStyles,
    /transition: --mode-cover var\(--design-dur-enter\) var\(--design-ease-move\);/u,
  );
  const underlayRule = inspectorStyles.match(
    /\.inspector-body\[data-mode-surface="true"\] > \[data-mode-underlay="true"\]:not\(\[hidden\]\) \{([\s\S]*?)\}/u,
  );
  assert.ok(underlayRule);
  assert.match(underlayRule[1], /width: var\(--mode-cover\);/u);
  assert.match(
    globalStyles,
    /grid-template-columns: minmax\(0, 1fr\) minmax\(0, var\(--mode-cover\)\);/u,
  );
  assert.match(inspectorStyles, /var\(--mode-detail-share, 0\.5\)/u);
  assert.match(inspectorSource, /--mode-detail-share/u);
  assert.match(inspectorSource, /activeDefinition\?\.modeDetailShare/u);
});

test("workspace mode is a full-bleed surface and only the upper face leaves", () => {
  const modeRule = inspectorStyles.match(/\.inspector-mode-surface \{([\s\S]*?)\}/u);
  assert.ok(modeRule);
  assert.doesNotMatch(modeRule[1], /padding:|margin:/u);
  assert.doesNotMatch(inspectorStyles, /opacity var\(--design-dur-exit\)/u);
  assert.doesNotMatch(inspectorStyles, /data-mode-handoff/u);
  // The upper face gives its height to the lower one; the lower one takes the
  // wide page's block inset so the handoff frame shows the same pixels.
  assert.match(
    pageStyles,
    /data-mode-phase="opening"[\s\S]*?\.inspector-page-split-top \{[\s\S]*?flex-basis: 0;/u,
  );
  assert.match(
    pageStyles,
    /\.inspector-page-split-top\s*>\s*\.inspector-page-content \{[\s\S]*?transform: translateY\(-100%\);/u,
  );
  assert.match(
    pageStyles,
    /data-mode-phase="opening"[\s\S]*?\.inspector-page-split-bottom\s*>\s*\.inspector-page-content \{[\s\S]*?padding-top: var\(--space-4\);/u,
  );
  assert.match(pageStyles, /scrollbar-gutter: stable;/u);
  // The wide copy's detail waits hidden while the compact copy still carries it.
  assert.match(
    inspectorStyles,
    /data-mode-phase="opening"\] \.inspector-mode-surface \.mode-handoff-detail,[\s\S]*?visibility: hidden;/u,
  );
  // The old directional nudge is gone: the frame reveal is the only motion.
  assert.doesNotMatch(globalStyles, /translateX\(calc\(-1 \* var\(--space-6\)\)\)/u);
  const faceRule = pageStyles.match(/\.inspector-page-split-face \{([\s\S]*?)\}/u);
  assert.ok(faceRule);
  assert.doesNotMatch(faceRule[1], /translateY|transform/u);
});

test("the wide page's list column is masked out instead of reflowing", () => {
  // The list column keeps the expanded layout for the whole motion: its width is
  // the wide page's list track and it is pinned to the compact copy's left edge,
  // so the narrowing frame covers it instead of squeezing it. It reaches zero
  // visible width as the panel reaches its rail, so the unmount removes nothing
  // that was still on screen and no collapsed strip survives the handoff.
  const maskRule = globalStyles.match(
    /\.inspector\[data-mode-phase="opening"\] \.inspector-mode-surface \.timing-studio \.studio-list-pane,[\s\S]*?justify-self: end;\s*\}/u,
  );
  assert.ok(maskRule, "mask rule is missing");
  assert.match(
    maskRule[0],
    /width: calc\(\s*\(1 - var\(--mode-detail-share, 0\.5\)\) \* \(100vw - var\(--workbench-side-track, 0px\)\)\s*\);/u,
  );
  for (const selector of [
    ".timing-studio .studio-list-pane",
    ".lines-studio .line-panel-split-tree",
    "> .asset-tree-shell",
  ]) {
    assert.ok(maskRule[0].includes(selector), `mask rule is missing ${selector}`);
  }
  // The motion keeps both tracks on one full-height row, so neither column sizes
  // to its content while the frame moves.
  const motionTracks = globalStyles.match(
    /\.inspector\[data-mode-phase="opening"\] \.inspector-mode-surface \.timing-studio \.studio-body,[\s\S]*?grid-template-rows: minmax\(0, 1fr\);/u,
  );
  assert.ok(motionTracks, "motion tracks are missing the full-height row");
  assert.match(
    motionTracks[0],
    /grid-template-columns: minmax\(0, 1fr\) minmax\(0, var\(--mode-cover\)\);/u,
  );
});

test("every expanding split page states the share of its detail column", () => {
  const pages = {
    timing: {
      share: 0.5,
      source: read("frontend/screens/global/sections/timing/page.tsx"),
      tracks: /\.timing-studio \.studio-body \{[\s\S]*?minmax\(0, 1fr\) minmax\(0, 1fr\)/u,
      styles: globalStyles,
    },
    lines: {
      share: 0.55,
      source: read("frontend/screens/global/sections/lines/page.tsx"),
      tracks: /\.line-panel-split \{[\s\S]*?minmax\(240px, 0\.9fr\) minmax\(300px, 1\.1fr\)/u,
      styles: read("frontend/screens/global/sections/lines/linePanel.less"),
    },
    assets: {
      share: 0.55,
      source: read("frontend/screens/global/sections/assets/page.tsx"),
      tracks: /\.asset-library-split \{[\s\S]*?minmax\(240px, 0\.9fr\) minmax\(300px, 1\.1fr\)/u,
      styles: read("frontend/screens/global/sections/assets/assetLibrary.less"),
    },
  };
  for (const [id, page] of Object.entries(pages)) {
    assert.match(page.source, new RegExp(`modeDetailShare: ${page.share},`, "u"), id);
    // 0.9fr / 1.1fr gives the detail column 1.1 / 2 = 0.55 of the page.
    assert.match(page.styles, page.tracks, id);
    assert.match(
      page.styles,
      /padding: var\(--space-4\) var\(--inspector-gutter\);|padding: var\(--space-4\);/u,
      id,
    );
  }
});
