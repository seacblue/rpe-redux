/** Focused contracts for pre-decoded event selection indexes. */
import assert from "node:assert/strict";
import test from "node:test";
import { eventKey } from "../../../core/edit/events/eventTracks.ts";
import { selectedEventIndexesForType } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";

test("decoded selection indexes match canonical event-key membership", () => {
  const selection = new Set([
    eventKey("moveXEvents", 0),
    eventKey("moveXEvents", 12),
    eventKey("moveYEvents", 3),
    "moveXEvents:01",
    "moveXEvents:-1",
    "moveXEvents:12.0",
    "moveXEvents:other",
  ]);
  const actual = selectedEventIndexesForType(selection, "moveXEvents");
  const expected = [0, 12].filter((index) => selection.has(eventKey("moveXEvents", index)));

  assert.deepEqual(
    [...actual].sort((left, right) => left - right),
    expected,
  );
  assert.deepEqual([...selectedEventIndexesForType(selection, "moveYEvents")], [3]);
});

test("empty selections reuse an immutable empty index set", () => {
  const first = selectedEventIndexesForType(new Set(), "moveXEvents");
  const second = selectedEventIndexesForType(new Set(), "moveYEvents");

  assert.strictEqual(first, second);
  assert.equal(first.size, 0);
});
