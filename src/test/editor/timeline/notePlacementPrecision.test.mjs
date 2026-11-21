/** Snapped placement stores the exact grid beat even when the division does not divide 10000. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { moveTimelineNote } from "../../../core/edit/timeline/dragPreview.ts";
import { placeTimelineNote } from "../../../core/edit/timeline/placement.ts";
import { snappedBeatTriple } from "../../../core/edit/timeline/timelineCoordinates.ts";

const tempo = {
  seconds(beat, factor = 1) {
    const value = Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat;
    return (value * 0.5) / factor;
  },
  beat(seconds, factor = 1) {
    return seconds * 2 * factor;
  },
};
const scale = { origin: 0, factor: 1, scale: 500, judgementOffset: 56 };
const height = 800;

/** Canvas row whose unsnapped beat is exactly `beat` for this constant tempo. */
function rowFor(beat) {
  return height - scale.judgementOffset - tempo.seconds(beat) * scale.scale;
}

test("a twelfth-grid placement keeps its exact beat triple", () => {
  const beat = snappedBeatTriple(rowFor(1 / 12), height, scale, 12, tempo);
  assert.deepEqual(beat, [0, 1, 12]);

  const session = new EditorSession(createChart());
  assert.equal(placeTimelineNote(session, 1, beat, 0, 0, null), null);
  assert.equal(session.notes.length, 1);
  assert.deepEqual(session.notes[0].startTime, [0, 1, 12]);
  assert.deepEqual(session.notes[0].endTime, [0, 1, 12]);
});

test("a two-click Hold keeps both snapped anchors exact", () => {
  const first = snappedBeatTriple(rowFor(1 / 12), height, scale, 12, tempo);
  const second = snappedBeatTriple(rowFor(1 / 4), height, scale, 12, tempo);
  assert.deepEqual(first, [0, 1, 12]);
  assert.deepEqual(second, [0, 1, 4]);

  const session = new EditorSession(createChart());
  const pending = placeTimelineNote(session, 2, first, 0, 0, null);
  assert.ok(pending);
  assert.deepEqual(pending.beat, [0, 1, 12]);
  assert.equal(placeTimelineNote(session, 2, second, 0, 0, pending), null);
  assert.equal(session.notes.length, 1);
  assert.deepEqual(session.notes[0].startTime, [0, 1, 12]);
  assert.deepEqual(session.notes[0].endTime, [0, 1, 4]);
});

test("dragging a twelfth-grid note to a quarter beat lands on 1/4, not 7499/30000", () => {
  const session = new EditorSession(createChart());
  const twelfth = snappedBeatTriple(rowFor(1 / 12), height, scale, 12, tempo);
  placeTimelineNote(session, 1, twelfth, 0, 0, null);
  assert.deepEqual(session.notes[0].startTime, [0, 1, 12]);

  const moved = moveTimelineNote(
    session.notes[0],
    {
      kind: "move",
      anchor: 0,
      lineIndex: 0,
      start: { x: 0, y: rowFor(1 / 12) },
      current: { x: 0, y: rowFor(1 / 4) },
    },
    session,
    {
      tempo,
      origin: 0,
      scale: scale.scale,
      division: 12,
      panelWidth: 1000,
      inset: 0,
      gridCount: 11,
      snapX: true,
      factor: 1,
    },
  );
  assert.deepEqual(moved.startTime, [0, 1, 4]);
  assert.deepEqual(moved.endTime, [0, 1, 4]);
});
