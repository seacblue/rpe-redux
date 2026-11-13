/**
 * Guards the inherited location index used by single-object transactions.
 *
 * A single note or event edit must not scan the chart or rebuild the whole
 * line/note/event index, and the chart a commit publishes must still answer the
 * next lookup. These tests pin those two properties with the diagnostics
 * counters and check the position bookkeeping after splices and inserts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";
import {
  chartLocationDiagnostics,
  ensureChartLocations,
  findEvent,
  locateNote,
  resetChartLocationDiagnostics,
} from "../../../core/edit/transaction/locations.ts";

/**
 * Builds a chart with `lineCount` judge lines and `notesPerLine` notes each.
 *
 * Every line also carries one alpha event track so event edits have targets, and
 * the scoring count follows the editor convention where Holds do not score.
 *
 * @param {number} lineCount judge line count
 * @param {number} notesPerLine notes per line
 * @returns {import("../../../core/global/chart/chart.ts").Chart} fresh chart
 */
function makeChart(lineCount, notesPerLine) {
  const chart = createChart();
  chart.BPMList = [{ bpm: 180, startTime: [0, 0, 1] }];
  const lines = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex += 1) {
      line.notes.push(createNote(noteIndex % 7 === 0 ? 2 : 1, noteIndex / 4, noteIndex % 100));
    }
    line.numOfNotes = line.notes.reduce((sum, note) => sum + (note.type === 2 ? 0 : 1), 0);
    line.eventLayers[0].alphaEvents = [createEvent(255, 0, 0, 1), createEvent(0, 255, 1, 2)];
    lines.push(line);
  }
  chart.judgeLineList = lines;
  return chart;
}

/**
 * Applies one request and fails the test unless it commits.
 *
 * @param {EditorSession} session editor session to edit
 * @param {object} request transaction request
 * @returns {object} committed result
 */
function apply(session, request) {
  const result = applyChartTransaction(session, request);
  assert.ok(result.status === "committed", `expected a commit, got ${result.status}`);
  return result;
}

/**
 * Asserts that one lookup-style callback performs no counted full index build.
 *
 * @param {() => void} run callback under inspection
 */
function assertNoIndexBuild(run) {
  resetChartLocationDiagnostics();
  run();
  assert.equal(chartLocationDiagnostics().indexBuilds, 0, "unexpected full index build");
}

test("single note update, delete and insert build no full index", () => {
  const session = new EditorSession(makeChart(40, 400));
  const lineIndex = 20;
  const notes = session.chart.judgeLineList[lineIndex].notes;

  const updateTarget = notes[300];
  apply(session, {
    notes: { update: [{ id: updateTarget.id, patch: { positionX: 321 } }] },
  });
  assert.equal(session.chart.judgeLineList[lineIndex].notes[300].positionX, 321);

  const deleteTarget = session.chart.judgeLineList[lineIndex].notes[301];
  apply(session, { notes: { delete: [deleteTarget.id] } });
  assert.equal(locateNote(session.chart, deleteTarget.id), null);

  const inserted = createNote(1, 500, 42);
  apply(session, { notes: { insert: [{ lineIndex, note: inserted }] } });
  const locatedInserted = locateNote(session.chart, inserted.id);
  assert.equal(locatedInserted?.lineIndex, lineIndex);
  assert.equal(locatedInserted?.noteIndex, session.chart.judgeLineList[lineIndex].notes.length - 1);

  assertNoIndexBuild(() => {
    assert.ok(locateNote(session.chart, session.chart.judgeLineList[lineIndex].notes[10].id));
  });
});

test("a committed single-object edit keeps its index for the following transaction", () => {
  const session = new EditorSession(makeChart(30, 200));
  // A batch-style warm-up installs the whole-chart index the commit then carries.
  ensureChartLocations(session.chart);
  const lineIndex = 12;
  const note = session.chart.judgeLineList[lineIndex].notes[120];

  apply(session, { notes: { update: [{ id: note.id, patch: { positionX: -12 } }] } });

  resetChartLocationDiagnostics();
  const neighbour = session.chart.judgeLineList[lineIndex].notes[119];
  const followed = applyChartTransaction(session, {
    notes: { update: [{ id: neighbour.id, patch: { positionX: 77 } }] },
  });
  assert.equal(followed.status, "committed");
  assert.equal(
    chartLocationDiagnostics().indexBuilds,
    0,
    "the committed chart carried a current index",
  );
  assert.equal(locateNote(session.chart, neighbour.id)?.note.positionX, 77);
});

test("a spliced line still resolves shifted note positions", () => {
  const session = new EditorSession(makeChart(8, 50));
  ensureChartLocations(session.chart);
  const lineIndex = 3;
  const notes = session.chart.judgeLineList[lineIndex].notes;
  const target = notes[30];

  // Remove three notes before the target, then resolve it without rebuilding.
  for (const index of [2, 10, 20]) {
    apply(session, { notes: { delete: [notes[index].id] } });
  }
  resetChartLocationDiagnostics();
  const located = locateNote(session.chart, target.id);
  assert.equal(chartLocationDiagnostics().indexBuilds, 0, "no rebuild after a splice");
  assert.equal(located?.note.id, target.id);
  assert.equal(located?.noteIndex, 27);
  assert.equal(session.chart.judgeLineList[lineIndex].notes[27].id, target.id);

  // The next edit through the same shifted line also lands on the right note.
  apply(session, { notes: { update: [{ id: target.id, patch: { positionX: 55 } }] } });
  assert.equal(session.chart.judgeLineList[lineIndex].notes[27].positionX, 55);
});

test("single event update and delete use the same cheap path", () => {
  const session = new EditorSession(makeChart(10, 20));
  const lineIndex = 6;
  const events = session.chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents;
  const updated = events[0];
  const deleted = events[1];

  assertNoIndexBuild(() => {
    apply(session, { events: { update: [{ id: updated.id, patch: { start: 12 } }] } });
    assert.equal(findEvent(session.chart, updated.id)?.event.start, 12);
  });

  assertNoIndexBuild(() => {
    apply(session, { events: { delete: [deleted.id] } });
    assert.equal(findEvent(session.chart, deleted.id), null);
  });

  // The surviving event stays addressable, and an insert is locatable afterwards.
  assert.ok(findEvent(session.chart, updated.id));
  const inserted = createEvent(90, 91, 1, 2);
  apply(session, {
    events: { insert: [{ lineIndex, eventType: "alphaEvents", layer: 0, event: inserted }] },
  });
  const locatedInserted = findEvent(session.chart, inserted.id);
  assert.equal(locatedInserted?.line.index, lineIndex);
  assert.equal(locatedInserted?.track, "alphaEvents");
});

test("repeated single-object edits keep the diagnostics flat", () => {
  const session = new EditorSession(makeChart(25, 120));
  ensureChartLocations(session.chart);
  resetChartLocationDiagnostics();
  const lineIndex = 17;

  for (let index = 0; index < 12; index += 1) {
    const notes = session.chart.judgeLineList[lineIndex].notes;
    const note = notes[(index * 31) % notes.length];
    const result = applyChartTransaction(session, {
      notes: { update: [{ id: note.id, patch: { positionX: index - 6 } }] },
    });
    assert.equal(result.status, "committed");
  }

  assert.equal(chartLocationDiagnostics().indexBuilds, 0, "single edits never rebuild");
  const finalNotes = session.chart.judgeLineList[lineIndex].notes;
  for (let index = 0; index < 12; index += 1) {
    assert.equal(finalNotes[(index * 31) % 120].positionX, index - 6);
  }
});
