/** Overlap menus open only for clicks, never for real note drags. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canOpenOverlapMenu,
  updateOverlapPress,
} from "../../../core/edit/timeline/overlapPress.ts";

test("an overlap press opens its menu when released in place", () => {
  const press = { start: { x: 10, y: 20 }, moved: false };

  assert.equal(canOpenOverlapMenu(updateOverlapPress(press, { x: 13, y: 22 })), true);
});

test("an overlap press becomes a drag after crossing the pointer slop", () => {
  const press = { start: { x: 10, y: 20 }, moved: false };

  assert.equal(canOpenOverlapMenu(updateOverlapPress(press, { x: 15, y: 20 })), false);
});
