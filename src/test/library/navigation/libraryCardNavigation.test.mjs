/** Card scrolling only moves the viewport when the selected card is outside it. */
import assert from "node:assert/strict";
import test from "node:test";
import { librarySelectionScrollTop } from "../../../frontend/screens/welcome/library/libraryCardNavigation.ts";

test("does not write scrollTop for a visible selected card", () => {
  assert.equal(
    librarySelectionScrollTop(
      { scrollTop: 100, clientHeight: 300, scrollHeight: 900, top: 40 },
      { top: 120, bottom: 200 },
    ),
    null,
  );
});

test("reveals a selected card above or below the viewport", () => {
  assert.equal(
    librarySelectionScrollTop(
      { scrollTop: 100, clientHeight: 300, scrollHeight: 900, top: 40 },
      { top: -20, bottom: 60 },
    ),
    40,
  );
  assert.equal(
    librarySelectionScrollTop(
      { scrollTop: 100, clientHeight: 300, scrollHeight: 900, top: 40 },
      { top: 390, bottom: 470 },
    ),
    230,
  );
});

test("clamps correction to the real scroll range at the list edges", () => {
  assert.equal(
    librarySelectionScrollTop(
      { scrollTop: 0, clientHeight: 300, scrollHeight: 480, top: 40 },
      { top: 210, bottom: 600 },
    ),
    180,
  );
  assert.equal(
    librarySelectionScrollTop(
      { scrollTop: 180, clientHeight: 300, scrollHeight: 480, top: 40 },
      { top: -180, bottom: -100 },
    ),
    0,
  );
});
