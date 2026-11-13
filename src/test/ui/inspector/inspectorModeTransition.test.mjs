/** Inspector workspace modes morph the mounted page; no copy is handed over. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const inspectorStyles = read("frontend/screens/editor/inspector/inspector.less");
const pageStyles = read("frontend/chrome/inspectorPage/inspectorPage.less");
const shellStyles = read("frontend/app/shell.less");
const assetStyles = read("frontend/screens/global/sections/assets/assetLibrary.less");
const lineStyles = read("frontend/screens/global/sections/lines/linePanel.less");
const workspaceModesSource = read("frontend/screens/editor/workspace/container/workspaceModes.ts");
const timingPage = read("frontend/screens/global/sections/timing/page.tsx");
const linesPage = read("frontend/screens/global/sections/lines/page.tsx");
const assetsPage = read("frontend/screens/global/sections/assets/page.tsx");
const timingLayout = read("frontend/screens/global/sections/timing/TimingPageLayout.tsx");
const assetModelSource = read("frontend/screens/global/sections/assets/model.ts");
const assetViewSource = read("frontend/screens/global/sections/assets/AssetLibraryView.tsx");
const catalogSource = read("design/components/icon/iconAssets.ts");
const sidebarSource = read("frontend/chrome/sidebar/Sidebar.tsx");
const modeActionsSource = read(
  "frontend/screens/editor/workspace/container/workspaceModeActions.ts",
);
const iconSourcesSource = readFileSync(
  new URL("../../../../scripts/iconSources.mjs", import.meta.url),
  "utf8",
);

test("an expanded mode is the mounted page, not a second page copy", () => {
  // The frame shows the pane the mode names and never mounts a studio surface.
  assert.match(
    inspectorSource,
    /const shownPane = modeSurface && modeDefinition \? modeDefinition\.id : activePane;/u,
  );
  assert.match(
    inspectorSource,
    /const modeSurface = activeWorkspaceMode !== null \|\| modePhase !== "compact";/u,
  );
  // The collapse control keeps the mode record until the geometry lands, so the
  // same page, header, and label stay authoritative through the exit animation.
  // Only that control morphs; a close lands in one frame.
  assert.match(inspectorSource, /const startCollapse = useCallback/u);
  assert.match(inspectorSource, /collapseWorkspaceMode\(runtime\);/u);
  assert.match(inspectorSource, /setModePhase\("compact"\);/u);
  assert.doesNotMatch(
    inspectorSource,
    /modeDefinition\?\.component|activeWorkspaceMode\?\.component/u,
  );
  assert.match(inspectorSource, /panels\.map\(/u);
  assert.doesNotMatch(inspectorSource, /displayedMode|inspector-mode-surface|mode-handoff/u);
  assert.doesNotMatch(inspectorSource, /data-mode-underlay|carryHandoffScroll|handoffScrollers/u);
  // The one page is interactive for the whole motion.
  assert.doesNotMatch(inspectorSource, /inert=\{locked \|\| modeSurface/u);
  assert.match(inspectorSource, /inert=\{locked \|\| undefined\}/u);
});

test("two overlapping progress numbers drive the panel and the page geometry", () => {
  // The master clock runs the whole entrance; arrangement and fill are the two
  // beats the rectangles read, and the fill starts while the arrangement is
  // still moving so the motion never rests between them.
  for (const property of [
    "--inspector-morph",
    "--inspector-morph-shift",
    "--inspector-morph-grow",
  ]) {
    assert.match(
      inspectorStyles,
      new RegExp(`@property ${property} \\{[\\s\\S]*?syntax: "<number>";`, "u"),
    );
    assert.match(inspectorStyles, new RegExp(`  ${property}: 0;`, "u"));
  }
  assert.match(
    inspectorStyles,
    /--inspector-morph-ease: cubic-bezier\(0\.25, 0\.46, 0\.45, 0\.94\);/u,
  );
  assert.match(
    inspectorStyles,
    /--inspector-morph-shift-duration: calc\(var\(--design-dur-enter\) \* 0\.72\);/u,
  );
  assert.match(
    inspectorStyles,
    /--inspector-morph-grow-duration: calc\(var\(--design-dur-enter\) \* 0\.8\);/u,
  );
  assert.match(
    inspectorStyles,
    /transition:\s*--inspector-morph var\(--design-dur-enter\) var\(--design-ease-move\),\s*--inspector-morph-shift var\(--inspector-morph-shift-duration\)\s*var\(--inspector-morph-shift-ease\)\s*var\(--inspector-morph-shift-delay\),\s*--inspector-morph-grow var\(--inspector-morph-grow-duration\)\s*var\(--inspector-morph-grow-ease\)\s*var\(--inspector-morph-grow-delay\);/u,
  );
  // Opening leads with the arrangement and starts the fill at a fifth of the
  // entrance, so the two beats overlap.
  const surfaceRule = inspectorStyles.match(
    /\.inspector\[data-mode-surface="true"\] \{([\s\S]*?)\n\}/u,
  );
  assert.ok(surfaceRule);
  assert.match(surfaceRule[1], /--inspector-morph: 1;/u);
  assert.match(surfaceRule[1], /--inspector-morph-shift: 1;/u);
  assert.match(surfaceRule[1], /--inspector-morph-grow: 1;/u);
  assert.match(surfaceRule[1], /--inspector-morph-shift-delay: 0ms;/u);
  assert.match(
    surfaceRule[1],
    /--inspector-morph-grow-delay: calc\(var\(--design-dur-enter\) \* 0\.2\);/u,
  );
  assert.match(
    surfaceRule[1],
    /--inspector-morph-grow-duration: calc\(var\(--design-dur-enter\) \* 0\.8\);/u,
  );
  // Closing runs the same two numbers together: the panel edge carries the list
  // face rightward while the detail column gives up width at the same rate, and
  // the fold lands before the faces can meet.
  const closingRule = inspectorStyles.match(
    /\.inspector\[data-mode-phase="closing"\] \{([\s\S]*?)\n\}/u,
  );
  assert.ok(closingRule);
  assert.match(closingRule[1], /--inspector-morph: 0;/u);
  assert.match(closingRule[1], /--inspector-morph-shift: 0;/u);
  assert.match(closingRule[1], /--inspector-morph-grow: 0;/u);
  assert.match(closingRule[1], /--inspector-morph-shift-delay: 0ms;/u);
  assert.match(closingRule[1], /--inspector-morph-shift-duration: var\(--design-dur-enter\);/u);
  assert.match(closingRule[1], /--inspector-morph-shift-ease: ease-in-out;/u);
  assert.match(closingRule[1], /--inspector-morph-grow-delay: 0ms;/u);
  assert.match(
    closingRule[1],
    /--inspector-morph-grow-duration: calc\(var\(--design-dur-enter\) \* 0\.54\);/u,
  );
  assert.match(closingRule[1], /--inspector-morph-grow-ease: ease-in-out;/u);
  // The panel grows out of the arrangement number, so its edge cannot drift
  // away from the face geometry.
  assert.match(shellStyles, /width: calc\([\s\S]*?var\(--inspector-compact-width\) \+/u);
  assert.match(
    shellStyles,
    /\(100vw - var\(--workbench-side-track\) - var\(--inspector-compact-width\)\) \*/u,
  );
  assert.match(shellStyles, /var\(--inspector-morph-shift\)/u);
  assert.match(
    shellStyles,
    /border-radius: calc\(var\(--radius-panel\) \* \(1 - var\(--inspector-morph-shift\)\)\);/u,
  );
  assert.doesNotMatch(shellStyles, /data-mode-expanded/u);
  assert.doesNotMatch(shellStyles, /transition: width var\(--design-dur-enter\)/u);
  assert.doesNotMatch(inspectorStyles, /--inspector-morph-phase-duration/u);
});

test("the fixed list column stretches first, then the detail column takes the width", () => {
  // The compact content width feeds the upper face and the left column.
  assert.match(
    pageStyles,
    /--inspector-face-width: calc\(\s*var\(--inspector-compact-width, 400px\) - var\(--inspector-frame-border, 2px\)\s*\);/u,
  );
  // Upper face: compact content width for the whole motion; only the fill beat
  // stretches its height.
  const topRule = pageStyles.match(
    /\.inspector\[data-mode-surface="true"\] \.inspector-page-split-top \{([\s\S]*?)\}/u,
  );
  assert.ok(topRule);
  assert.match(topRule[1], /width: var\(--inspector-face-width\);/u);
  assert.match(topRule[1], /height: calc\(42% \+ 58% \* var\(--inspector-morph-grow\)\);/u);
  // Lower face: pinned to the right edge during arrangement, then grown into
  // the wide column by the fill beat.
  const bottomRule = pageStyles.match(
    /\.inspector\[data-mode-surface="true"\] \.inspector-page-split-bottom \{([\s\S]*?)\}/u,
  );
  assert.ok(bottomRule);
  assert.match(
    bottomRule[1],
    /top: calc\(\(42% \+ 1px\) \* \(1 - var\(--inspector-morph-grow\)\)\);/u,
  );
  assert.match(
    bottomRule[1],
    /left: calc\(\s*\(100% - var\(--inspector-face-width\)\) \* \(1 - var\(--inspector-morph-grow\)\) \+[\s\S]*?var\(--inspector-face-width\) \* var\(--inspector-morph-grow\)\s*\);/u,
  );
  // The two faces never overlap in the ordered motion, so no clip is needed.
  assert.doesNotMatch(bottomRule[1], /clip-path/u);
  // Retracting keeps the lower face joined to the list face: the closing
  // geometry holds its left edge at the compact width until the panel is
  // narrower than two compact columns, then lets it slide with the panel edge.
  // The frame carries the path a motion runs on, so a reversal continues on the
  // path it started with instead of switching paths mid-flight.
  const joinedRule = pageStyles.match(
    /\.inspector\[data-mode-surface="true"\]\[data-mode-geometry="joined"\]\s*\.inspector-page-split-bottom \{([\s\S]*?)\}/u,
  );
  assert.ok(joinedRule);
  assert.match(
    joinedRule[1],
    /left: clamp\(0px, calc\(100% - var\(--inspector-face-width\)\), var\(--inspector-face-width\)\);/u,
  );
  assert.doesNotMatch(
    pageStyles,
    /data-mode-phase="closing"\]\)?\s*\.inspector-page-split-bottom/u,
  );
  // The detail column reads as a document column instead of a stretched form.
  assert.match(pageStyles, /max-width: var\(--inspector-detail-column-width, 760px\);/u);
  // The compact rule returns only once both faces have folded back, and the
  // vertical seam takes its place with the fill beat.
  assert.match(
    pageStyles,
    /opacity: calc\(\(1 - var\(--inspector-morph-shift\)\) \* \(1 - var\(--inspector-morph-grow\)\)\);/u,
  );
  assert.match(pageStyles, /opacity: var\(--inspector-morph-grow\);\s*\n\s*pointer-events: none;/u);
});

test("the expanded detail face sizes its own content, not the frame", () => {
  assert.match(
    assetStyles,
    /height: calc\(180px \+ \(min\(48vh, 460px\) - 180px\) \* var\(--inspector-morph-grow\)\);/u,
  );
  assert.match(
    pageStyles,
    /padding-top: calc\(\s*var\(--space-2\) \+ \(var\(--space-4\) - var\(--space-2\)\) \* var\(--inspector-morph-grow\)\s*\);/u,
  );
});

test("pages register a mode, not a studio component", () => {
  for (const [name, source] of [
    ["timing", timingPage],
    ["lines", linesPage],
    ["assets", assetsPage],
  ]) {
    assert.match(source, /registerWorkspaceMode/u, name);
    assert.match(source, /workspaceMode: "/u, name);
    assert.doesNotMatch(source, /modeDetailShare/u, name);
    assert.doesNotMatch(source, /Studio\(\)|className="(?:lines|assets|timing)-studio"/u, name);
  }
  assert.match(timingPage, /component: TimingPageLayout/u);
  assert.doesNotMatch(timingLayout, /layout="expanded"|timing-studio/u);
  assert.match(timingLayout, /InspectorPageSplit/u);
  assert.doesNotMatch(workspaceModesSource, /component: ComponentType|component: ComponentType;/u);
});

test("a motion interrupted at any point reverses in place on its own path", () => {
  // A toggle click before the entrance settles must not wait for a fresh run's
  // delays; the exit reverses both numbers together, on the entrance path.
  assert.match(inspectorSource, /const \[modeReverse, setModeReverse\] = useState\(false\);/u);
  assert.match(
    inspectorSource,
    /const \[modeGeometry, setModeGeometry\] = useState<InspectorGeometry>\("blend"\);/u,
  );
  assert.match(inspectorSource, /data-mode-reverse=\{modeReverse \? "true" : undefined\}/u);
  assert.match(inspectorSource, /data-mode-geometry=\{modeSurface \? modeGeometry : undefined\}/u);
  assert.match(
    inspectorSource,
    /const interrupted =\s*Number\.isFinite\(shift\) && Number\.isFinite\(grow\) && \(shift < 0\.999 \|\| grow < 0\.999\);/u,
  );
  // A settled entrance retracts along the joined path; anything mid-motion
  // keeps the path it started on.
  assert.match(inspectorSource, /if \(!interrupted\) \{[\s\S]*?setModeGeometry\("joined"\);/u);
  // The exit can be resumed while it is still running.
  assert.match(
    inspectorSource,
    /const startExpand = useCallback\(\(\) => \{[\s\S]*?setModePhase\(\(phase\) => \(phase === "closing" \? "opening" : phase\)\);/u,
  );
  assert.match(
    inspectorSource,
    /if \(modePhase === "closing"\) \{\s*startExpand\(\);\s*return;\s*\}/u,
  );
  // A running motion is never disabled: the toggle stays available so it can be
  // reversed, and the close control can still close the task.
  assert.doesNotMatch(inspectorSource, /disabled=\{modePhase === "closing"\}/u);
  assert.match(inspectorSource, /icon=\{modeSurface \? "inspectorCollapse" : "inspectorExpand"\}/u);
  // One reverse timing block covers both directions.
  const reverseRule = inspectorStyles.match(
    /\.inspector\[data-mode-surface="true"\]\[data-mode-reverse="true"\] \{([\s\S]*?)\n\}/u,
  );
  assert.ok(reverseRule);
  assert.match(reverseRule[1], /--inspector-morph-grow-delay: 0ms;/u);
  assert.match(reverseRule[1], /--inspector-morph-shift-delay: 0ms;/u);
  assert.match(
    reverseRule[1],
    /--inspector-morph-grow-duration: calc\(var\(--design-dur-enter\) \* 0\.45\);/u,
  );
  assert.match(reverseRule[1], /--inspector-morph-shift-duration: var\(--design-dur-enter\);/u);
  assert.match(reverseRule[1], /--inspector-morph-shift-ease: ease-in-out;/u);
});

test("closing from the task lands on the compact rectangle in one frame", () => {
  // The close control and Escape name their destination. The page and the
  // expanded surface leave in the same commit, so the user sees the closed state
  // immediately instead of an exit they did not ask to watch.
  assert.doesNotMatch(inspectorSource, /closeAfterCollapse/u);
  assert.match(inspectorSource, /const landCompact = useCallback\(\(\) => \{/u);
  assert.match(
    inspectorSource,
    /if \(activeWorkspaceMode \|\| modePhase !== "compact"\) \{[\s\S]*?landCompact\(\);[\s\S]*?closeInspector\(runtime\.ui\.activeInspector\);/u,
  );
  // The morph transitions belong to the expanded surface, so dropping the
  // attribute in the same commit cancels them instead of retracting the panel.
  const surfaceRule = inspectorStyles.match(
    /\.inspector\[data-mode-surface="true"\] \{([\s\S]*?)\n\}/u,
  );
  assert.ok(surfaceRule);
  assert.match(
    surfaceRule[1],
    /transition:\s*--inspector-morph var\(--design-dur-enter\) var\(--design-ease-move\),/u,
  );
  const frameRule = inspectorStyles.match(/\n\.inspector \{([\s\S]*?)\n\}/u);
  assert.ok(frameRule);
  assert.doesNotMatch(frameRule[1], /transition:/u);
  // Reduced motion still removes the surface motion.
  assert.match(
    inspectorStyles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.inspector\[data-mode-surface="true"\] \{\s*transition: none;/u,
  );
});

test("an asset page without assets composes one column", () => {
  // The details pane only previews a selected asset, so an empty library is a
  // single column in the compact stack and in the expanded task.
  assert.match(
    assetModelSource,
    /export function assetPageHasDetails\(assetCount: number\): boolean/u,
  );
  assert.match(assetViewSource, /const hasDetails = assetPageHasDetails\(assetCount\);/u);
  assert.match(assetViewSource, /<InspectorPage>\{treeFace\}<\/InspectorPage>/u);
  assert.match(assetViewSource, /hasDetails \? \(\s*<InspectorPageSplit/u);
  // The single column reads as a centered document column in the task.
  assert.match(
    pageStyles,
    /\.inspector\[data-mode-surface="true"\]\s*\.inspector-page\s*> \.inspector-page-scroll\s*> \.inspector-page-content \{[\s\S]*?max-width: var\(--inspector-detail-column-width, 760px\);/u,
  );
});

test("the icon controls keep their own grow and collapse glyphs", () => {
  assert.match(catalogSource, /inspectorExpand: "icons\/inspector_expand\.png",/u);
  assert.match(catalogSource, /inspectorCollapse: "icons\/inspector_collapse\.png",/u);
  assert.match(
    iconSourcesSource,
    /"icons\/inspector_expand\.png": \{ collection: "lucide", name: "panel-columns" \}/u,
  );
  assert.match(
    iconSourcesSource,
    /"icons\/inspector_collapse\.png": \{ collection: "lucide", name: "panel-collapse-right" \}/u,
  );
});

test("the retired copy handoff leaves no tokens behind", () => {
  for (const [name, source] of [
    ["inspector frame", inspectorStyles],
    ["page layer", pageStyles],
    ["shell", shellStyles],
    ["asset page", assetStyles],
    ["line page", lineStyles],
  ]) {
    assert.doesNotMatch(source, /--mode-cover|--mode-detail-share|mode-handoff/u, name);
    assert.doesNotMatch(source, /data-mode-underlay|data-mode-expanded/u, name);
  }
  assert.doesNotMatch(assetStyles, /asset-library-split/u);
  assert.doesNotMatch(lineStyles, /line-panel-split/u);
  assert.doesNotMatch(inspectorStyles, /inspector-mode-surface/u);
});

test("another route lands the frame without an exit of its own", () => {
  // The rail only routes; the frame decides what taking the route means. A page
  // that owns a mode takes the task over in place, and a plain pane lands the
  // frame on the compact rectangle in the same commit the route is taken.
  assert.doesNotMatch(sidebarSource, /closeWorkspaceMode/u);
  assert.match(sidebarSource, /useActiveWorkspaceModeId/u);
  assert.match(inspectorSource, /workspacePaneForMode/u);
  assert.match(inspectorSource, /workspaceModeForPane/u);
  assert.match(inspectorSource, /if \(!owner \|\| activePane === owner\) \{\s*return;\s*\}/u);
  assert.match(inspectorSource, /switchWorkspaceMode\(nextMode, modeState\.returnPane\);/u);
  // Another page can only take the task over once the expanded surface is open;
  // that guard sits inside the mode branch.
  assert.match(
    inspectorSource,
    /if \(modePhase === "opening" \|\| modePhase === "expanded"\) \{\s*switchWorkspaceMode\(nextMode, modeState\.returnPane\);/u,
  );
  assert.doesNotMatch(
    inspectorSource,
    /if \(modePhase !== "opening" && modePhase !== "expanded"\) \{\s*return;\s*\}/u,
  );
  // A plain pane cannot fill the task, so the frame does not play an exit for a
  // page the user has already left; the landing covers a route taken mid-exit.
  assert.match(
    inspectorSource,
    /const nextMode = workspaceModeForPane\(activePane\);[\s\S]*?landCompact\(\);/u,
  );
  // A drawer page owns the body when the surface leaves; no pane is restored
  // behind it.
  assert.match(inspectorSource, /getDrawerState\(\)\.open/u);
  for (const name of ["workspacePaneForMode", "workspaceModeForPane", "switchWorkspaceMode"]) {
    assert.match(modeActionsSource, new RegExp(`export function ${name}`, "u"), name);
  }
  assert.match(modeActionsSource, /inspectorPanels\.get\(\)\.find/u);
});

test("prefers-reduced-motion settles the morph without a transition", () => {
  assert.match(
    pageStyles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.inspector \{\s*transition: none;/u,
  );
});
