/** Windows-style click and marquee rules shared by selectable editor lists. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createListSelectionState,
  listSelectionAfterClick,
  listSelectionAfterMarquee,
  listSelectionRange,
  listSelectionStateAfterClick,
  listSelectionStateAfterMarquee,
} from "../../../design/patterns/list/listSelection.ts";

const ITEMS = [0, 1, 2, 3, 4, 5];

function selected(result) {
  return result.selection;
}

test("plain click replaces the selection and establishes focus", () => {
  const result = listSelectionAfterClick(ITEMS, new Set([1, 4]), 1, 3);
  assert.deepEqual(selected(result), [3]);
  assert.equal(result.focus, 3);
});

test("Ctrl click toggles one item without disturbing other selected items", () => {
  assert.deepEqual(
    selected(listSelectionAfterClick(ITEMS, new Set([1, 3]), 1, 4, { ctrlKey: true })),
    [1, 3, 4],
  );
  assert.deepEqual(
    selected(listSelectionAfterClick(ITEMS, new Set([1, 3]), 1, 3, { ctrlKey: true })),
    [1],
  );
});

test("Shift click replaces the old selection with the firstLine-to-click range", () => {
  const result = listSelectionAfterClick(ITEMS, new Set([1, 5]), 1, 3, { shiftKey: true });
  assert.deepEqual(selected(result), [1, 2, 3]);
  assert.equal(result.focus, 3);
});

test("repeated Shift clicks move focus to each clicked line", () => {
  const first = listSelectionStateAfterClick(ITEMS, createListSelectionState(ITEMS, [1], 1), 5, {
    shiftKey: true,
  });
  const second = listSelectionStateAfterClick(ITEMS, first, 3, { shiftKey: true });
  assert.deepEqual(selected(first), [1, 2, 3, 4, 5]);
  assert.deepEqual(selected(second), [1, 2, 3]);
  assert.equal(first.firstLine, 1);
  assert.equal(second.firstLine, 1);
  assert.equal(first.focus, 5);
  assert.equal(second.focus, 3);
});

test("repeated Shift clicks keep firstLine fixed while focus advances", () => {
  const initial = createListSelectionState(ITEMS, [2], 2);
  const toY = listSelectionStateAfterClick(ITEMS, initial, 4, { shiftKey: true });
  const toZ = listSelectionStateAfterClick(ITEMS, toY, 5, { shiftKey: true });

  assert.deepEqual(toY.selection, [2, 3, 4]);
  assert.equal(toY.firstLine, 2);
  assert.equal(toY.focus, 4);
  assert.deepEqual(toZ.selection, [2, 3, 4, 5]);
  assert.equal(toZ.firstLine, 2);
  assert.equal(toZ.focus, 5);
});

test("marquee derives replace, add, and toggle previews from one baseline", () => {
  assert.deepEqual(selected(listSelectionAfterMarquee(ITEMS, new Set([1, 5]), [2, 3])), [2, 3]);
  assert.deepEqual(
    selected(listSelectionAfterMarquee(ITEMS, new Set([1, 5]), [2, 3], { shiftKey: true })),
    [1, 2, 3, 5],
  );
  assert.deepEqual(
    selected(listSelectionAfterMarquee(ITEMS, new Set([1, 2, 5]), [2, 3], { ctrlKey: true })),
    [1, 3, 5],
  );
});

test("ranges remain ordered even when the pointer travels upward", () => {
  assert.deepEqual(listSelectionRange(ITEMS, 4, 1), [1, 2, 3, 4]);
});

test("Shift marquee publishes its topmost touched line as focus", () => {
  const items = Array.from({ length: 11 }, (_, index) => index);
  const initial = createListSelectionState(items, [6], 6);
  const marquee = listSelectionStateAfterMarquee(
    items,
    initial,
    items.slice(1),
    { shiftKey: true },
    true,
  );
  assert.deepEqual(marquee.selection, items.slice(1));
  assert.equal(marquee.firstLine, 1);
  assert.equal(marquee.focus, 1);
  const shifted = listSelectionStateAfterClick(items, marquee, 8, { shiftKey: true }, true);
  assert.deepEqual(shifted.selection, items.slice(1, 9));
  assert.equal(shifted.firstLine, 1);
  assert.equal(shifted.focus, 8);
});

test("Shift marquee joins an earlier selection into one ordered union", () => {
  const initial = createListSelectionState(ITEMS, [0, 1, 2], 2);
  const result = listSelectionStateAfterMarquee(ITEMS, initial, [2, 3, 4], {
    shiftKey: true,
  });
  assert.deepEqual(result.selection, [0, 1, 2, 3, 4]);
  assert.equal(result.firstLine, 2);
  assert.equal(result.focus, 2);
});
