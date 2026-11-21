/** The RPE drag prekey is read from the dispatcher's held-key set. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dragPrekeyHeld,
  deferPlainZMovement,
  selectedHoldTarget,
} from "../../../core/edit/timeline/dragPrekey.ts";
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

test("a Z drag owns exactly one selected Hold", () => {
  const hold = { lineIndex: 2, index: 5, note: { type: 2 } };
  const tap = { lineIndex: 0, index: 1, note: { type: 1 } };

  assert.equal(selectedHoldTarget([hold]), hold);
  assert.equal(selectedHoldTarget([hold, { ...hold, index: 6 }]), null);
  assert.equal(selectedHoldTarget([tap]), null);
  assert.equal(selectedHoldTarget([]), null);
});

test("plain Z movement waits for key-up, while chords stay immediate", () => {
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z" }), true);
  assert.equal(deferPlainZMovement("playback.step.previous", { key: "z" }), true);
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z", ctrlKey: true }), false);
  assert.equal(deferPlainZMovement("selection.nudge.left", { key: "Z", shiftKey: true }), false);
  assert.equal(deferPlainZMovement("selection.nudge.right", { key: "X" }), false);
  assert.equal(deferPlainZMovement("selection.scale.narrower", { key: "Z", altKey: true }), false);
});
