/** The shell seams own their gesture, their keys, and their persisted share. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const splitterSource = read("design/components/splitter/Splitter.tsx");
const splitterStyles = read("design/components/splitter/splitter.less");
const shellStyles = read("frontend/app/shell.less");
const workbenchSource = read("frontend/app/Workbench.tsx");
const shellSource = read("frontend/app/Shell.tsx");
const tokens = read("design/styles/tokens.less");

test("every adjustable region derives its size from a scale token", () => {
  for (const name of [
    "--layout-toolbar-scale",
    "--layout-toolbar-height",
    "--layout-statusbar-scale",
    "--layout-statusbar-height",
    "--layout-inspector-scale",
    "--layout-inspector-width",
    "--layout-sidebar-scale",
    "--layout-sidebar-width",
  ]) {
    assert.match(tokens, new RegExp(`${name}:`, "u"), name);
  }
  // The authored size times the user's scale times the display's density, with no
  // window-relative term: a bigger display must not inflate the chrome, but a
  // denser panel must keep the authored visual size.
  assert.match(
    tokens,
    /--layout-toolbar-height: calc\(90px \* var\(--layout-toolbar-scale\) \* var\(--layout-density\)\);/u,
  );
  assert.match(
    tokens,
    /--layout-statusbar-height: calc\(36px \* var\(--layout-statusbar-scale\) \* var\(--layout-density\)\);/u,
  );
  assert.match(
    tokens,
    /--layout-inspector-width: min\(\s*calc\(400px \* var\(--layout-inspector-scale\) \* var\(--layout-density\)\),\s*57vw\s*\);/u,
  );
  assert.match(
    tokens,
    /--layout-sidebar-width: calc\(56px \* var\(--layout-sidebar-scale\) \* var\(--layout-density\)\);/u,
  );
  assert.match(tokens, /--layout-density: 1;/u);
  assert.doesNotMatch(tokens, /--layout-toolbar-share|--layout-inspector-share/u);
  // The existing aliases still resolve, so no reader had to learn a new name.
  assert.match(tokens, /--inspector-width: var\(--layout-inspector-width\);/u);
  assert.match(tokens, /--chrome-sidebar-track: var\(--layout-sidebar-width\);/u);
});

test("the title bar keeps a fixed caption row", () => {
  assert.match(tokens, /--titlebar-height: 40px;/u);
  assert.doesNotMatch(tokens, /--layout-titlebar/u);
});

test("the toolbar and status bar read the scale instead of a literal height", () => {
  const toolbar = read("frontend/chrome/toolbar/toolbar.less");
  const statusbar = read("frontend/chrome/statusbar/statusBar.less");
  assert.match(toolbar, /height: var\(--layout-toolbar-height\);/u);
  assert.match(toolbar, /min-height: var\(--layout-toolbar-height\);/u);
  assert.doesNotMatch(toolbar, /height: 106px;/u);
  assert.match(statusbar, /min-height: var\(--layout-statusbar-height\);/u);
  // The cover backdrop reads the same row height instead of repeating it.
  assert.match(
    shellStyles,
    /--cover-backdrop-workbench-top: calc\(var\(--titlebar-height\) \+ var\(--layout-toolbar-height\)\);/u,
  );
});

test("the rail keeps the trailing grid track and its own box on one token", () => {
  const sidebar = read("frontend/chrome/sidebar/sidebar.less");
  assert.match(
    sidebar,
    /--sidebar-peek-width: var\(--theme-sidebar-width, var\(--layout-sidebar-width, 56px\)\);/u,
  );
  assert.match(
    shellStyles,
    /grid-template-columns: minmax\(0, 1fr\) auto var\(--chrome-sidebar-track\);/u,
  );
});

test("each seam sits on the edge it moves", () => {
  assert.match(
    shellStyles,
    /\.shell-body > \.layout-splitter--toolbar \{\s*top: calc\(var\(--layout-toolbar-height\) - 4\.5px\);/u,
  );
  assert.match(
    shellStyles,
    /\.shell-body > \.layout-splitter--statusbar \{\s*bottom: calc\(var\(--layout-statusbar-height\) - 4\.5px\);/u,
  );
  assert.match(
    shellStyles,
    /\.workbench-body > \.layout-splitter--inspector \{\s*right: calc\(var\(--chrome-sidebar-track\) \+ var\(--inspector-compact-width\) - 4\.5px\);/u,
  );
  assert.match(
    shellStyles,
    /\.workbench-body > \.layout-splitter--sidebar \{\s*right: calc\(var\(--chrome-sidebar-track\) - 4\.5px\);/u,
  );
  // A hit area along the whole edge, not a zero-width box.
  assert.match(splitterStyles, /\.layout-splitter--horizontal \{\s*inset-inline: 0;/u);
  assert.match(splitterStyles, /\.layout-splitter--vertical \{\s*inset-block: 0;/u);
});

test("the expanded inspector has no compact edge to drag", () => {
  assert.match(
    shellStyles,
    /\.workbench-body:has\(> \.workbench-inspector > \.inspector\[data-mode-surface="true"\]\)\s*> \.layout-splitter--inspector \{\s*display: none;/u,
  );
  // The start page draws neither row, so neither seam may float over it.
  assert.match(
    shellStyles,
    /\.redux-app-root \.redux-app-shell\[data-at-home="true"\] \.shell-body > \.layout-splitter \{\s*display: none;/u,
  );
});

test("the shell places one seam per region", () => {
  for (const name of ["toolbar", "statusbar"]) {
    assert.match(shellSource, new RegExp(`className="layout-splitter--${name}"`, "u"), name);
  }
  for (const name of ["inspector", "sidebar"]) {
    assert.match(workbenchSource, new RegExp(`className="layout-splitter--${name}"`, "u"), name);
  }
  // The status bar sits after the workspace, so its growth runs the other way.
  assert.match(
    shellSource,
    /className="layout-splitter--statusbar"[\s\S]*?onChange=\{statusbarSeam\.setPixels\}\s+invert/u,
  );
});

test("a seam hands its keys to the shared claim instead of matching them itself", () => {
  // The editor dispatcher listens on the window capture phase; a later capture
  // listener cannot outrank it, so the focused seam registers a claim.
  assert.match(
    splitterSource,
    /import \{ registerKeyClaim \} from "\.\.\/\.\.\/\.\.\/frontend\/platform\/shortcuts\/keyClaims\.ts";/u,
  );
  assert.match(splitterSource, /return registerKeyClaim\(\(event, context\) => \{/u);
  assert.match(splitterSource, /if \(document\.activeElement !== seamRef\.current\) \{/u);
  assert.doesNotMatch(splitterSource, /onKeyDown=\{/u);
  // The visible surface stays a separator with its size published to assistive tech.
  assert.match(splitterSource, /role="separator"/u);
  assert.match(splitterSource, /aria-valuenow=\{Math\.round\(value\)\}/u);
  assert.match(splitterSource, /aria-valuemin=\{Math\.round\(min\)\}/u);
  assert.match(splitterSource, /tabIndex=\{0\}/u);
});

test("a seam resizes by drag, by key, and by double click", () => {
  assert.match(splitterSource, /setPointerCapture\(event\.pointerId\)/u);
  assert.match(splitterSource, /onDoubleClick=\{\(\) => onChange\(defaultValue\)\}/u);
  assert.match(splitterSource, /const KEY_STEP = 4;/u);
  assert.match(splitterSource, /const KEY_STEP_LARGE = 16;/u);
  assert.match(splitterSource, /event\.shiftKey/u);
  // The drag stays inside the range the caller published.
  assert.match(
    splitterSource,
    /onChange\(clamp\(current\.value \+ travel \* \(invert \? -1 : 1\)\)\)/u,
  );
});

test("a region that grows scales its contents, not just its track", () => {
  const designStyles = read("design/design.less");
  const iconStyles = read("design/components/icon/icon.less");
  const iconSource = read("design/components/icon/Icon.tsx");
  const railStyles = read("design/patterns/railItem.less");
  const toolbarGrid = read("frontend/screens/editor/toolbar/toolbarGrid.less");
  const tokens = read("design/styles/tokens.less");

  // The authored numeric tokens stay in one place; a region re-derives them.
  assert.match(tokens, /--ui-scale: 1;/u);
  assert.match(tokens, /--type-body: 14px;/u);
  assert.match(designStyles, /\.content-scale\(\) \{/u);
  for (const token of ["--type-body", "--space-2", "--control-height", "--glyph-size-sm"]) {
    assert.match(designStyles, new RegExp(`${token}: calc\\([^)]*var\\(--ui-scale\\)`, "u"), token);
  }

  // Every adjustable region carries its own scale and re-derives the block.
  for (const [selector, variable] of [
    [".shell-body > .redux-toolbar", "--layout-toolbar-scale"],
    [".shell-body > footer", "--layout-statusbar-scale"],
    [".workbench-inspector > .inspector", "--layout-inspector-scale"],
    [".workbench-body > .sidebar", "--layout-sidebar-scale"],
  ]) {
    assert.match(
      shellStyles,
      new RegExp(
        `${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} \\{\\s*--ui-scale: var\\(${variable}, 1\\);\\s*\\.content-scale\\(\\);`,
        "u",
      ),
      selector,
    );
  }

  // A glyph keeps its authored size as data and scales in the stylesheet, so the
  // region decides the painted size instead of a hard-coded inline width.
  assert.match(iconSource, /"--icon-size": `\$\{size\}px`/u);
  assert.doesNotMatch(iconSource, /width: size,/u);
  assert.match(iconStyles, /width: calc\(var\(--icon-size, 18px\) \* var\(--ui-scale, 1\)\);/u);
  assert.match(iconStyles, /height: calc\(var\(--icon-size, 18px\) \* var\(--ui-scale, 1\)\);/u);

  // The toolbar's own cell unit is what sizes its buttons, so it scales too.
  // 36px is the authored desktop density; the glyph fills more than half the
  // cell, which is what keeps the row from reading as loose.
  assert.match(
    toolbarGrid,
    /--tool-cell: calc\(var\(--theme-toolbar-cell, 36px\) \* var\(--ui-scale\)\);/u,
  );
  assert.match(toolbarGrid, /--tool-icon: calc\(16px \* var\(--ui-scale\)\);/u);

  // The rail row grows with its larger glyph instead of clipping it.
  assert.match(railStyles, /height: calc\(41px \* var\(--ui-scale, 1\)\);/u);
  assert.match(railStyles, /min-height: calc\(41px \* var\(--ui-scale, 1\)\);/u);
});
