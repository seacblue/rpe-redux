/** Direct note drags use relative grid steps without absolute lane snapping. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { moveTimelineNote } from "../../../core/edit/timeline/dragPreview.ts";

function drag(currentX) {
  return {
    kind: "move",
    anchor: 0,
    lineIndex: 0,
    start: { x: 0, y: 100 },
    current: { x: currentX, y: 100 },
    scrolled: false,
  };
}

function context() {
  return {
    tempo: {
      beat: (seconds) => seconds,
      seconds: (beat) => (Array.isArray(beat) ? beat[0] + beat[1] / beat[2] : beat),
    },
    origin: 0,
    scale: 1,
    division: 4,
    panelWidth: 1350,
    inset: 0,
    gridCount: 11,
    snapX: true,
    factor: 1,
  };
}

test("a snapped drag moves by grid spacing from the original note position", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = [createNote(1, 0, 37)];
  const session = new EditorSession(chart);
  const moved = moveTimelineNote(
    session.chart.judgeLineList[0].notes[0],
    drag(100),
    session,
    context(),
  );

  assert.equal(moved.positionX, 172);
});
