/** Covers the window-captured timeline gesture completion seam. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createNote } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { createSessionSelection } from "../../../frontend/screens/editor/workspace/runtime/bridge/sessionSelection.ts";
import { publishAreaSelectionMode } from "../../../frontend/screens/editor/workspace/timeline/selection/rectangleSelection.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";
import { finishCapturedSelectionGesture } from "../../../frontend/screens/editor/workspace/timeline/selection/selectionGestureCompletion.ts";

test("a captured selection gesture closes its history batch after finishing", () => {
  const session = {};
  const calls = [];
  const timeline = {
    rectangleSelection: () => null,
    sweepSelection: () => ({ drag: {} }),
    finishRectangle: () => {
      calls.push("finish");
      return true;
    },
    gestures: {
      finishSelectionHistory: (receivedSession) => calls.push(["history", receivedSession]),
    },
    getSession: () => session,
  };

  assert.equal(finishCapturedSelectionGesture(timeline, { type: "pointerup" }), true);
  assert.deepEqual(calls, ["finish", ["history", session]]);
});

test("an uncaptured pointer does not close a selection history batch", () => {
  const calls = [];
  const timeline = {
    rectangleSelection: () => null,
    sweepSelection: () => null,
    finishRectangle: () => {
      calls.push("finish");
      return true;
    },
    gestures: {
      finishSelectionHistory: () => calls.push("history"),
    },
    getSession: () => ({}),
  };

  assert.equal(finishCapturedSelectionGesture(timeline, { type: "pointerup" }), false);
  assert.deepEqual(calls, []);
});

test("finishing the captured sweep publishes the multi-edit Inspector route", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes.push(createNote(1, 1, 0));
  const session = new EditorSession(chart);
  session.focus = "notes";
  session.marqueeSelection = "notes";
  session.selection.add(0);
  session.selectionMode = "none";
  const actions = [];
  const routing = createSessionSelection({
    layer: () => 0,
    state: () => ({ multiEditCommitting: false, trajectoryActive: false, curveEditorOpen: false }),
    effects: {
      syncMulti: () => undefined,
      activatePane: (name) => actions.push(name),
      openMulti: () => actions.push("open-multi"),
      deactivateCurve: () => undefined,
      openTrajectory: () => undefined,
      closePane: () => undefined,
    },
  });
  session.addEventListener("change", () => routing.route(session, "notes"));

  const gestures = new TimelineGestures({}, () => session);
  gestures.beginSelectionHistory(session);
  session.notifySelection();
  publishAreaSelectionMode(session, "notes");
  assert.deepEqual(actions, []);

  const timeline = {
    rectangleSelection: () => null,
    sweepSelection: () => ({ drag: {} }),
    finishRectangle: () => true,
    gestures,
    getSession: () => session,
  };
  assert.equal(finishCapturedSelectionGesture(timeline, { type: "pointerup" }), true);
  assert.deepEqual(actions, ["multi", "open-multi"]);
});
