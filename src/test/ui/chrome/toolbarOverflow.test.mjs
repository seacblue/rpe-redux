// Toolbar overflow state keeps narrow layouts observable before the rows are scrolled.
import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSharedScrollCompensation,
  calculateToolbarOverflowState,
} from "../../../frontend/chrome/toolbar/toolbarOverflow.ts";

test("gives shorter rows invisible space so both rows share one scroll range", () => {
  assert.deepEqual(
    calculateSharedScrollCompensation([
      { clientWidth: 240, contentWidth: 858 },
      { clientWidth: 240, contentWidth: 653 },
    ]),
    [0, 205],
  );
});

test("a row narrower than the viewport still scrolls with the other", () => {
  // Its own deficit has to be closed as well as the other row's range, otherwise
  // the padding only makes it exactly as wide as the viewport and it cannot move.
  assert.deepEqual(
    calculateSharedScrollCompensation([
      { clientWidth: 760, contentWidth: 763 },
      { clientWidth: 760, contentWidth: 757 },
    ]),
    [0, 6],
  );
  assert.deepEqual(
    calculateSharedScrollCompensation([
      { clientWidth: 760, contentWidth: 1572 },
      { clientWidth: 760, contentWidth: 240 },
    ]),
    [0, 1332],
  );
});

test("marks a toolbar narrow when its measured layout is wider than the viewport", () => {
  assert.equal(
    calculateToolbarOverflowState({
      toolbarWidth: 900,
      toolbarScrollWidth: 1000,
      rows: [{ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 }],
    }).isNarrow,
    true,
  );
});

test("marks a toolbar narrow when a row has hidden actions", () => {
  const state = calculateToolbarOverflowState({
    toolbarWidth: 900,
    toolbarScrollWidth: 900,
    rows: [{ scrollLeft: 0, clientWidth: 500, scrollWidth: 680 }],
  });
  assert.deepEqual(state, {
    isNarrow: true,
    canScrollStart: false,
    canScrollEnd: true,
  });
});

test("does not mark a toolbar narrow when the measured rows fit", () => {
  assert.deepEqual(
    calculateToolbarOverflowState({
      toolbarWidth: 900,
      toolbarScrollWidth: 900,
      rows: [{ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }],
    }),
    {
      isNarrow: false,
      canScrollStart: false,
      canScrollEnd: false,
    },
  );
});
