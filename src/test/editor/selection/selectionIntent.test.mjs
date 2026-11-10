/** Covers marquee Inspector routing and precise overlapping-note geometry. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { restoreSelection } from "../../../core/edit/session/selectionHistory.ts";
import { timelineNoteCandidates } from "../../../core/edit/timeline/hitTest.ts";
import { resolveSelectionPane } from "../../../frontend/screens/editor/workspace/runtime/bridge/selectionPaneRouting.ts";
import { previewNoteContains } from "../../../frontend/screens/editor/workspace/preview/interaction/previewHitGeometry.ts";

const paneState = {
  activePane: "notes",
  multiEditCommitting: false,
  trajectoryActive: false,
  curveEditorOpen: false,
  pointerSelection: true,
};

test("one marquee-selected note or event opens multi-edit, while a click opens its single pane", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes.push(createNote(1, 1, 0));
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1)];
  const session = new EditorSession(chart);
  session.selection.add(0);
  session.focus = "notes";
  session.marqueeSelection = "notes";
  session.selectionMode = "multi";
  const marquee = session.selectionState();
  assert.deepEqual(resolveSelectionPane(session, 0, paneState).action, {
    kind: "open-multi",
    focus: "notes",
  });
  session.marqueeSelection = null;
  session.selectionMode = "single";
  assert.deepEqual(resolveSelectionPane(session, 0, paneState).action, {
    kind: "activate-pane",
    name: "notes",
  });
  restoreSelection(session, marquee);
  assert.equal(session.marqueeSelection, "notes");
  session.focus = "events";
  session.eventSelection.add("moveXEvents:0");
  session.marqueeSelection = "events";
  session.selectionMode = "multi";
  assert.deepEqual(resolveSelectionPane(session, 0, paneState).action, {
    kind: "open-multi",
    focus: "events",
  });
  session.marqueeSelection = null;
  session.selectionMode = "single";
  assert.deepEqual(resolveSelectionPane(session, 0, paneState).action, {
    kind: "activate-pane",
    name: "events",
  });
});

test("multi-selection intent stays multi when one selected object remains", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes.push(createNote(1, 2, 0));
  const session = new EditorSession(chart);
  session.focus = "notes";
  session.selectionMode = "multi";
  session.selection.add(0);
  session.selection.add(1);

  session.selection.delete(1);

  assert.deepEqual(resolveSelectionPane(session, 0, paneState).action, {
    kind: "open-multi",
    focus: "notes",
  });
});

test("undo restores the multi-selection intent separately from its count", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes.push(createNote(1, 1, 0));
  const session = new EditorSession(chart);
  session.selection.add(0);
  session.selectionMode = "multi";
  const before = session.selectionState();

  session.selectionMode = "single";
  session.recordSelection(undefined, before, false);

  assert.equal(session.travel("undo"), true);
  assert.equal(session.selectionMode, "multi");
  assert.deepEqual([...session.selection], [0]);
});

test("re-selecting the active line keeps the note and event selection", () => {
  const chart = createChart();
  chart.judgeLineList.push(createLine("Line 2"));
  const session = new EditorSession(chart);
  session.selection.add(0);
  session.eventSelection.add("moveXEvents:0");

  // Inspector and sidebar navigation can repeat the current line; that is not
  // a line switch and must not clear the objects selected on it.
  session.selectLine(0);
  assert.deepEqual([...session.selection], [0]);
  assert.deepEqual([...session.eventSelection], ["moveXEvents:0"]);

  session.selectLine(1);
  assert.equal(session.selection.size, 0);
  assert.equal(session.eventSelection.size, 0);
});

test("pointer selections replace the curve inspector just like any other pane", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes.push(createNote(1, 1, 0));
  chart.judgeLineList[0].eventLayers[0].moveXEvents = [createEvent(0, 1)];
  const session = new EditorSession(chart);
  const curveState = { ...paneState, activePane: "curve" };

  session.selection.add(0);
  session.focus = "notes";
  assert.deepEqual(resolveSelectionPane(session, 0, curveState).action, {
    kind: "activate-pane",
    name: "notes",
  });

  session.marqueeSelection = "notes";
  session.selectionMode = "multi";
  assert.deepEqual(resolveSelectionPane(session, 0, curveState).action, {
    kind: "open-multi",
    focus: "notes",
  });
  // The marquee marker keeps the intent through the drag even though the
  // revision only advances when the marquee starts. The open curve editor must
  // not reclaim the pane in the middle of that drag.
  assert.deepEqual(
    resolveSelectionPane(session, 0, {
      ...curveState,
      curveEditorOpen: true,
      pointerSelection: false,
    }).action,
    { kind: "open-multi", focus: "notes" },
  );

  // Anchor picking and stray clicks do not advance the revision; the curve
  // pane stays put for those.
  session.selection.clear();
  session.selectionMode = "none";
  session.marqueeSelection = null;
  assert.deepEqual(resolveSelectionPane(session, 0, curveState).action, { kind: "none" });
  // An empty marquee has selected nothing yet, so the curve pane also stays.
  session.marqueeSelection = "notes";
  session.selectionMode = "none";
  assert.deepEqual(resolveSelectionPane(session, 0, curveState).action, { kind: "none" });
  session.marqueeSelection = null;
  session.selection.add(0);
  session.selectionMode = "single";
  assert.deepEqual(
    resolveSelectionPane(session, 0, { ...curveState, pointerSelection: false }).action,
    { kind: "none" },
  );

  const previewState = { ...paneState, activePane: "curve-preview" };
  assert.deepEqual(resolveSelectionPane(session, 0, previewState).action, {
    kind: "activate-pane",
    name: "notes",
  });
  session.selection.clear();
  session.focus = "events";
  session.eventSelection.add("moveXEvents:0");
  assert.deepEqual(resolveSelectionPane(session, 0, previewState).action, {
    kind: "activate-pane",
    name: "events",
  });
});

test("the overlap menu requires the pointer inside the drawn timeline note", () => {
  const entries = [0, 1].map((index) => ({
    index,
    lineIndex: 0,
    start: 1,
    end: 1,
    item: { type: 1 },
  }));
  const geometry = {
    horizontal: () => 50,
    vertical: () => 100,
    width: () => 60,
    halfHeight: () => 3,
    visible: () => true,
  };
  assert.equal(timelineNoteCandidates(entries, { x: 50, y: 106 }, geometry).length, 2);
  assert.equal(timelineNoteCandidates(entries, { x: 50, y: 106 }, geometry, true).length, 0);
  assert.equal(timelineNoteCandidates(entries, { x: 50, y: 102 }, geometry, true).length, 2);
});

test("preview overlap respects the rotated note rectangle and Hold body", () => {
  const note = {
    kind: "note",
    head: { x: 0, y: 0 },
    tail: { x: 0, y: 0 },
    width: 60,
    height: 6,
    rotation: 90,
  };
  assert.equal(previewNoteContains(note, { x: 8, y: 0 }), false);
  assert.equal(previewNoteContains(note, { x: 2, y: 20 }), true);
  const hold = {
    ...note,
    kind: "hold",
    rotation: 0,
    width: 10,
    headLength: 4,
    tailLength: 4,
    tail: { x: 0, y: -60 },
  };
  assert.equal(previewNoteContains(hold, { x: 4, y: -30 }), true);
  assert.equal(previewNoteContains(hold, { x: 8, y: -30 }), false);
  // Caps are centred half a cap outside the anchors, so picking includes the
  // painted overhang on both ends.
  assert.equal(previewNoteContains(hold, { x: 0, y: -63 }), true);
  assert.equal(previewNoteContains(hold, { x: 0, y: -65 }), false);
  assert.equal(previewNoteContains(hold, { x: 0, y: 3 }), true);
  assert.equal(previewNoteContains(hold, { x: 0, y: 5 }), false);
  // A zero-length Hold paints its cap on the fall axis; picking is symmetric.
  const zeroLength = {
    ...hold,
    tail: { x: 0, y: 0 },
    headLength: 0,
    tailLength: 20,
  };
  assert.equal(previewNoteContains(zeroLength, { x: 0, y: 8 }), true);
  assert.equal(previewNoteContains(zeroLength, { x: 0, y: 21 }), false);
  assert.equal(previewNoteContains(zeroLength, { x: 0, y: -8 }), true);
});
