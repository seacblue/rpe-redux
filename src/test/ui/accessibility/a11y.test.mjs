/** Accessibility contracts: keyboard names and listbox navigation. */
import assert from "node:assert/strict";
import test from "node:test";
import { ariaShortcutText } from "../../../core/shortcuts/keys.ts";
import { listboxNavigation } from "../../../design/patterns/list/useListbox.ts";

test("shortcut bindings use the ARIA keyshortcuts grammar", () => {
  assert.equal(ariaShortcutText({ key: "S", modifiers: ["CTRL", "SHIFT"] }), "Control+Shift+S");
  assert.equal(ariaShortcutText({ key: "SPACE", modifiers: ["CTRL"] }), "Control+Space");
  assert.equal(ariaShortcutText({ key: "LEFTARROW" }), "ArrowLeft");
  assert.equal(ariaShortcutText({ key: "DELETE" }), "Delete");
  assert.equal(ariaShortcutText({ key: "F3" }), "F3");
  assert.equal(ariaShortcutText({ key: "MOUSE0" }), "");
  assert.equal(ariaShortcutText({ key: "WHEELDOWN" }), "");
  // A held-key chord has no `aria-keyshortcuts` spelling.
  assert.equal(ariaShortcutText({ key: "MOUSE2", keys: ["E"] }), "");
});

test("listbox navigation wraps and honours Home/End", () => {
  assert.equal(listboxNavigation("ArrowDown", 2, 3), 0);
  assert.equal(listboxNavigation("ArrowUp", 0, 3), 2);
  assert.equal(listboxNavigation("Home", 2, 3), 0);
  assert.equal(listboxNavigation("End", 0, 3), 2);
  assert.equal(listboxNavigation("Enter", 1, 3), null);
  assert.equal(listboxNavigation("ArrowDown", 0, 0), null);
});
