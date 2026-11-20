/** The layout editor arranges the real chrome: it wraps nothing and copies nothing. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const store = read("core/shell/layoutArrangementStore.ts");
const editorState = read("core/shell/layoutEditorState.ts");
const layout = {
  // One function body from the arrangement module, read with normalized line
  // endings so the split does not depend on how Git checked the file out.
  section: (name) => {
    const source = read("core/shell/layoutArrangement.ts").replace(/\r\n/gu, "\n");
    return source.split(`export function ${name}`)[1]?.split("\n}\n")[0] ?? "";
  },
};
const editor = read("frontend/overlays/layoutEditor/LayoutEditor.tsx");
const catalog = read("frontend/overlays/layoutEditor/layoutEditCatalog.ts");
const targets = read("frontend/overlays/layoutEditor/layoutEditTargets.ts");
const editSurface = read("frontend/app/layout/useLayoutEditSurface.ts");
const toolbarRow = read("frontend/chrome/toolbar/ToolbarRow.tsx");
const scrollbar = read("frontend/chrome/toolbar/ToolbarScrollbar.tsx");
const sidebar = read("frontend/chrome/sidebar/Sidebar.tsx");
const shell = read("frontend/app/Shell.tsx");
const styles = read("frontend/overlays/layoutEditor/layoutEditor.less");
const actions = read("frontend/chrome/topbar/actions/layoutEditorActions.ts");
const menuSpec = read("frontend/chrome/topbar/menuSpec.ts");
const en = read("i18n/messages/en/layoutEditor.ts");

test("each surface keeps its own preference key", () => {
  assert.match(store, /toolbar: "toolbarArrangement",/u);
  assert.match(store, /sidebar: "sidebarArrangement",/u);
  assert.match(store, /\[LAYOUT_ARRANGEMENT_KEYS\[surface\]\]: arrangement\[surface\] \?\? \{\}/u);
});

test("a saved layout survives a restart", () => {
  // The durable preferences arrive from SQLite after the shell mounts, so the
  // chrome has to follow the section instead of reading it once.
  assert.match(editorState, /export function followSavedArrangement/u);
  assert.match(editorState, /preferences\.subscribe\(PREFERENCE_SECTIONS\.layout/u);
  assert.match(shell, /return followSavedArrangement\(\)/u);
});

test("the editor opens on one surface and saves only that one", () => {
  assert.match(editorState, /export const layoutEditorSurface = createValue<LayoutSurfaceId>/u);
  assert.match(editorState, /export function openLayoutEditor\(surface: LayoutSurfaceId\)/u);
  assert.match(editorState, /const surface = layoutEditorSurface\.get\(\);/u);
  assert.match(editorState, /commitSurfaceArrangement\(\s*surface,/u);
});

test("a rule survives being dragged past", () => {
  // Tidying drops a rule that has briefly become leading or trailing. Doing that
  // during a gesture eats the rule the pointer is moving past, so the run is left
  // exactly as the pointer drew it and tidied once, on save.
  assert.doesNotMatch(layout.section("movePlacement"), /tidyPlacements/u);
  assert.match(editorState, /tidyPlacements\(slot\.items\)/u);
  assert.match(editorState, /slots: stored\.slots/u);
});

test("a rule is drawn as a vertical line", () => {
  assert.match(catalog, /return iconName\("linesVertical"\);/u);
});

test("playback is offered once, through its control", () => {
  // `playback.play` is the same toggle the transport control draws.
  assert.match(
    catalog,
    /const DUPLICATED_BY_CONTROL: ReadonlySet<string> = new Set\(\["playback\.play"\]\);/u,
  );
  assert.match(catalog, /if \(DUPLICATED_BY_CONTROL\.has\(entry\.id\)\) \{\s*return false;/u);
});

test("a fresh profile draws the authored toolbar, not every registered command", () => {
  // The registry holds far more commands than the toolbar shows. An entry that
  // declares no `row` has never been on the bar, so the default must not carry it.
  assert.match(
    catalog,
    /filter\(\(entry\) => toolbarEntryPlaceable\(entry\) && drawsAuthoredRow\(entry\)\)/u,
  );
  assert.match(
    catalog,
    /function drawsAuthoredRow\(entry: ToolbarEntry\): boolean \{\s*return entry\.row !== undefined;/u,
  );
  // The list still offers them, one drag away.
  assert.match(
    catalog,
    /export function toolbarCatalog\(t: \(key: string\) => string\): LayoutEntry\[\]/u,
  );
});

test("the menu offers one command per surface", () => {
  assert.match(actions, /id: "view\.customizeToolbar"/u);
  assert.match(actions, /id: "view\.customizeSidebar"/u);
  assert.match(menuSpec, /"view\.customizeToolbar",\s*"view\.customizeSidebar",/u);
});

test("nothing is wrapped: the real cell keeps its own geometry", () => {
  // A wrapper between a strip and its items breaks the `> .redux-button` child
  // selectors that give every toolbar action its one-cell width.
  assert.doesNotMatch(toolbarRow, /<LayoutEditItem/u);
  assert.doesNotMatch(sidebar, /<LayoutEditItem/u);
  assert.doesNotMatch(toolbarRow, /cloneElement/u);
  assert.doesNotMatch(styles, /\.layout-edit-item/u);
  // The strip publishes the container it drew and the ids it drew into it, so the
  // boxes are found by position instead of by a marker on a product component.
  assert.match(
    editSurface,
    /registerLayoutStrip\(\{ surface, slot, node, axis, ids, selector \}\)/u,
  );
  assert.match(toolbarRow, /selector: ":scope > \*"/u);
  assert.match(sidebar, /selector: "\.sidebar-item"/u);
});

test("a strip that overflows still shows its scrollbar", () => {
  // A bar that hides itself while the rows fit measures zero wide, so sizing the
  // track from that measurement leaves the thumb filling the whole track.
  assert.match(scrollbar, /const range = sharedScrollRange\(linesRef\.current\)/u);
  assert.match(scrollbar, /const width = bar\.clientWidth \+ range;/u);
  assert.match(scrollbar, /requestAnimationFrame\(syncTrack\)/u);
});

test("the overlay draws no copy of the toolbar or the rail", () => {
  assert.doesNotMatch(editor, /StripEditor|SortableContext|useSortable/u);
  assert.doesNotMatch(editor, /layoutEditor\.row\./u);
  assert.doesNotMatch(en, /layoutEditor\.row\./u);
});

test("the list is one command a row, not a wrap of chips", () => {
  assert.match(
    styles,
    /\.redux-layout-editor-group \{\s*display: flex;\s*flex-direction: column;/u,
  );
  assert.match(styles, /\.redux-app-root \.redux-layout-editor-row\.redux-button \{/u);
  // The shared button centres a row that carries a glyph through a `:has()` clause,
  // which counts its argument, so the row states its alignment beside it.
  assert.match(styles, /justify-content: flex-start;/u);
  assert.match(editor, /className="redux-layout-editor-row"/u);
});

test("the list holds only the commands that are not on the surface", () => {
  assert.match(editor, /const available = catalog\.filter\(\(item\) => !placed\.has\(item\.id\)/u);
  assert.match(en, /"layoutEditor\.palette": "Available commands",/u);
});

test("a gesture is tracked from the pointer, not the browser's drag protocol", () => {
  // A native drag suppresses `pointermove` while it runs, which leaves a drop
  // unable to see where it ended.
  assert.doesNotMatch(editor, /draggable/u);
  assert.doesNotMatch(editor, /onDragStart|dataTransfer/u);
  assert.match(editor, /window\.addEventListener\("pointermove", onMove/u);
  assert.match(editor, /window\.addEventListener\("pointerup", onUp/u);
  assert.match(editor, /trackLayoutDrag\(event\.clientX, event\.clientY, DRAG_THRESHOLD\)/u);
  // The press that starts it is taken at the surface container.
  assert.match(editSurface, /node\.addEventListener\("pointerdown", onPointerDown, true\)/u);
  assert.match(editSurface, /beginLayoutDrag\(\{ kind: "placed", id: item\.id, surface \}/u);
});

test("the run reflows under the pointer, not at the end of the gesture", () => {
  assert.match(editor, /place\(next\.payload, at\)/u);
  assert.match(
    editor,
    /const here = findPlacement\(currentSlots\(payload\.surface\), payload\.id\)/u,
  );
  assert.match(editor, /if \(here\.slot === at\.slot && here\.index === at\.index\)/u);
  // A command that is not placed yet joins the surface the moment the pointer
  // enters it, so one gesture places and positions.
  assert.match(editor, /if \(!here\) \{\s*addSurfaceItem\(/u);
});

test("a rule is named, never shown by its generated id", () => {
  assert.match(catalog, /export function placementLabel/u);
  assert.match(
    catalog,
    /if \(isDivider \|\| id\.startsWith\(USER_DIVIDER_PREFIX\) \|\| toolbar\.node\(id\)\?\.kind === "divider"\)/u,
  );
  assert.match(editor, /label: placementLabel\(carried, isDivider, catalog, tRaw\)/u);
});

test("the carried command stays listed, so a drop back removes it", () => {
  assert.match(
    editor,
    /const available = catalog\.filter\(\(item\) => !placed\.has\(item\.id\) \|\| item\.id === carried\)/u,
  );
  assert.match(editor, /data-carried=\{carried === item\.id \? "true" : undefined\}/u);
  assert.match(styles, /&\[data-carried="true"\] \{\s*opacity: 0\.55;/u);
});

test("the ghost shows a glyph and its name above everything it crosses", () => {
  assert.match(editor, /<Icon name=\{ghost\.icon\} size=\{14\} \/>/u);
  assert.match(
    styles,
    /\.redux-layout-editor-ghost \{\s*position: fixed;\s*z-index: var\(--z-search\);/u,
  );
});

test("the chrome cannot be operated while it is being arranged", () => {
  // The items keep their pointer events so hover, the tooltip, and the wheel still
  // work; what the editor removes is the effect of a press, which the strip's
  // capture listener cancels.
  assert.doesNotMatch(styles, /\[data-layout-surface\][^{]*\{\s*pointer-events: none;/u);
  assert.match(
    editSurface,
    /for \(const type of INERT_EVENTS\) \{\s*node\.addEventListener\(type, refuse, true\);/u,
  );
  assert.match(editSurface, /const INERT_EVENTS = \["click", "auxclick", "dblclick", "submit"\]/u);
  // A menu is a real control and takes the pointer back: `pointer-events` is
  // inherited, and a popover still inherits from its DOM parent.
  assert.match(styles, /\.redux-layout-editor \.redux-menu-popup \{\s*pointer-events: auto;/u);
});

test("an arranged item paints a surface of its own", () => {
  // Without a background change nothing says which cell the pointer is over.
  assert.match(
    styles,
    /\[data-layout-surface\] > \* \{[\s\S]*?&:hover \{\s*background: var\(--surface-hover\);/u,
  );
  assert.match(
    styles,
    /\[data-layout-surface\] \.sidebar-item \{[\s\S]*?&:hover > \* \{\s*background: var\(--surface-hover\);/u,
  );
});

test("the row menu paints above the dim", () => {
  assert.match(styles, /z-index: var\(--z-content-overlay\);/u);
});

test("a right-click removes the item the chrome resolved under the pointer", () => {
  assert.match(editor, /window\.addEventListener\("contextmenu", onContextMenu, true\)/u);
  assert.match(editor, /layoutItemAt\(candidate, event\.clientX, event\.clientY\)/u);
  const menuBody = editor.match(/<ContextMenuPopup[\s\S]*?<\/ContextMenuPopup>/u)?.[0] ?? "";
  assert.match(menuBody, /label=\{t\("layoutEditor\.remove"\)\}/u);
  assert.doesNotMatch(menuBody, /divider/u);
});

test("a drop is resolved from the boxes the chrome published", () => {
  assert.doesNotMatch(editor, /document\.querySelector/u);
  assert.match(targets, /export function layoutDropTargetAt/u);
  assert.match(targets, /getBoundingClientRect\(\)/u);
  // A strip clips its own overflow, so an item can sit under the pointer while
  // the strip's box no longer does.
  assert.match(targets, /A strip clips its own overflow/u);
});

test("a placed command keeps its strip when nothing more specific is known", () => {
  assert.match(catalog, /return surface === "toolbar" \? toolbarAuthoredSlot\(id\) : 1;/u);
  assert.match(catalog, /export function authoredSlotOf/u);
});
