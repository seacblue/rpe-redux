/** The RPE drag prekey is read from the dispatcher's held-key set. */
import assert from "node:assert/strict";
import test from "node:test";
import { dragPrekeyHeld, deferPlainZMovement } from "../../../core/edit/timeline/dragPrekey.ts";
import {
  clearShortcutKeys,
  pressShortcutKey,
  releaseShortcutKey,
} from "../../../core/shortcuts/inputKeys.ts";

test("Z is held for the pointer gesture and released with the key", () => {
  clearShortcutKeys();
  pressShortcutKey("KeyZ", "Z");
  assert.equal(dragPrekeyHeld(), true);

  releaseShortcutKey("KeyZ");
  assert.equal(dragPrekeyHeld(), false);
  clearShortcutKeys();
});

test("plain Z movement waits for key-up, while chords stay immediate", () => {
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z" }), true);
  assert.equal(deferPlainZMovement("playback.step.previous", { key: "z" }), true);
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z", ctrlKey: true }), false);
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z", shiftKey: true }), false);
  assert.equal(deferPlainZMovement("selection.nudge.right", { key: "X" }), false);
  assert.equal(deferPlainZMovement("selection.scale.narrower", { key: "Z", altKey: true }), false);
});
