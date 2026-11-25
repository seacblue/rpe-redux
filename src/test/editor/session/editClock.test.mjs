/** Verify persisted chart time grows only during foreground editing. */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorEditClock } from "../../../core/edit/state/editClock.ts";

test("edit clock continues an imported total and excludes inactive intervals", () => {
  const now = 0;
  const clock = new EditorEditClock(() => now);
  clock.setBaseline(1159.0699582, () => now);

  clock.advance(1000, true);
  clock.advance(5000, false);
  clock.advance(6000, true);

  assert.ok(Math.abs(clock.seconds - 1161.0699582) < 1e-9);
});

test("pausing the clock prevents a suspended foreground frame from catching up", () => {
  const clock = new EditorEditClock(() => 0);
  clock.advance(1000, true);
  clock.pause(() => 1000);
  clock.pause(() => 6000);
  clock.advance(6000, true);

  assert.equal(clock.seconds, 1);
});
