/** Multi-line batch edits retain selected events when the visible layer changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { MultiEditPanel } from "../../../frontend/screens/editor/inspector/multiEdit/multiEdit.ts";
import { hasVisibleBatchSelection } from "../../../frontend/screens/editor/workspace/stage/batchControls/batchControls.ts";

/** Build two judge lines with the selected event on the first event layer. */
function sessionWithSelectedEvent() {
  const chart = createChart();
  chart.judgeLineList = [createLine("L0"), createLine("L1")];
  chart.judgeLineList[0].eventLayers = [{}, {}];
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(10, 20, 0, 1)];
  chart.judgeLineList[0].eventLayers[1].moveXEvents = [createEvent(30, 40, 0, 1)];
  const session = new EditorSession(chart);
  session.setMultiLineSelection([0, 1]);
  session.setMultiLineMode("events");
  session.multiSelectionIntent = "events";
  session.multiEventSelection = new Map([[0, new Set(["moveXEvents:0"])]]);
  session.eventSelection = new Set(["moveXEvents:0"]);
  return session;
}

/** Construct the panel with only the timeline contract used by selection signatures. */
function panelFor(session) {
  const panel = new MultiEditPanel(
    () => session,
    { viewport: { division: 1 } },
    {
      invalidate() {},
      notify() {},
      state: { set() {} },
      scrollInspectorToTop() {},
    },
  );
  panel.active = true;
  panel.kind = "events";
  panel.read = () => ({
    field: "both",
    operation: "By",
    lower: "1",
    upper: "1",
    easingType: 1,
    cycle: "1",
    disturbance: "0",
    seed: 1,
    eventApplicationMode: "per-line",
  });
  panel.form = {
    isPreviewEnabled: () => true,
    setResult() {},
  };
  return panel;
}

test("multi-line event editing keeps the selected object editable after a layer switch", () => {
  const session = sessionWithSelectedEvent();
  const panel = panelFor(session);

  panel.refresh();
  assert.equal(panel.result?.changes.length, 1);
  assert.equal(hasVisibleBatchSelection("events", session), true);

  session.eventLayer = 1;
  session.eventSelection.clear();
  panel.refresh();

  assert.equal(panel.result?.changes.length, 1);
  assert.equal(panel.result?.changes[0].before.start, 10);
  assert.equal(panel.result?.changes[0].after.start, 11);
  assert.equal(hasVisibleBatchSelection("events", session), false);
});

test("multi-line event editing does not report a missing selection on an empty layer", () => {
  const session = sessionWithSelectedEvent();
  session.chart.judgeLineList[0].eventLayers[1].moveXEvents = [];
  const panel = panelFor(session);

  panel.refresh();
  session.eventLayer = 1;
  session.eventSelection.clear();
  panel.refresh();

  assert.equal(panel.result?.changes.length, 1);
  assert.equal(panel.result?.changes[0].before.start, 10);
  assert.equal(hasVisibleBatchSelection("events", session), false);
});

test("multi-line event controls remain visible for a selection on another panel", () => {
  const session = sessionWithSelectedEvent();
  session.lineIndex = 0;
  session.multiEventSelection = new Map([[1, new Set(["moveXEvents:0"])]]);
  session.eventSelection.clear();

  assert.equal(hasVisibleBatchSelection("events", session), true);
});
