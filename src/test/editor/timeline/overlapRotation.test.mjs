/** Same-beat overlap ranks drive the timeline note fan and its rotated hit boxes. */
import assert from "node:assert/strict";
import test from "node:test";
import { overlappingNoteRanks } from "../../../core/edit/timeline/noteOverlap.ts";
import { timelineNoteCandidates } from "../../../core/edit/timeline/hitTest.ts";
import { noteOverlapRotation } from "../../../frontend/screens/editor/workspace/timeline/notes/noteRotation.ts";

/** Minimal non-Hold note for overlap rank tests. */
function note(positionX, beat = 1, type = 1) {
  return { type, positionX, startTime: [beat, 0, 1], endTime: [beat, 0, 1] };
}

test("same-beat notes close in X form one ranked stack", () => {
  const notes = [note(0), note(50), note(90)];
  const ranks = overlappingNoteRanks(notes, 100);
  assert.deepEqual(
    [...ranks.entries()],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
  );
});

test("separate same-beat clusters each start at rank zero", () => {
  const notes = [note(350), note(0), note(300), note(50)];
  const ranks = overlappingNoteRanks(notes, 100);
  assert.equal(ranks.get(0), 1);
  assert.equal(ranks.get(1), 0);
  assert.equal(ranks.get(2), 0);
  assert.equal(ranks.get(3), 1);
});

test("notes on different beats and Holds keep rank zero", () => {
  const notes = [note(0, 1), note(20, 2), note(20, 1, 2), note(300, 1)];
  const ranks = overlappingNoteRanks(notes, 100);
  assert.equal(ranks.size, 0);
});

test("a zero threshold disables overlap ranks", () => {
  assert.equal(overlappingNoteRanks([note(0), note(10)], 0).size, 0);
});

test("overlap ranks rotate notes in the negative direction", () => {
  const step = (15 * Math.PI) / 180;
  assert.equal(noteOverlapRotation(undefined), 0);
  assert.equal(noteOverlapRotation(1), -step);
  assert.equal(noteOverlapRotation(2), -2 * step);
});

test("hit testing follows the rotated note head instead of its axis-aligned box", () => {
  const entries = [0, 1].map((index) => ({
    index,
    lineIndex: 0,
    start: 1,
    end: 1,
    item: { type: 1 },
  }));
  const radians = (15 * Math.PI) / 180;
  const geometry = {
    horizontal: () => 50,
    vertical: () => 100,
    width: () => 60,
    halfHeight: () => 4,
    visible: () => true,
    rotation: (index) => (index === 1 ? radians : 0),
  };
  // (72, 107) sits outside the upright head but inside the second note's
  // 15-degree rotation, so only the rotated note is picked there.
  assert.deepEqual(
    timelineNoteCandidates(entries, { x: 72, y: 107 }, geometry, true).map((entry) => entry.index),
    [1],
  );
  // Near the centre both heads still contain the pointer.
  assert.equal(timelineNoteCandidates(entries, { x: 50, y: 100 }, geometry, true).length, 2);
});
