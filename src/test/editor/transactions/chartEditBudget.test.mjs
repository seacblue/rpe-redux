/**
 * Guards the per-edit work budget of the chart transaction path.
 *
 * The CRUD benchmark (`scripts/benchmarkChartCrud.mjs`) measures wall-clock cost,
 * which is too noisy for the unit suite. This test pins the work counters and
 * content-digest invariants that make single-object edits cheap:
 *
 *   - a single note update, delete, or insert never rebuilds the full location index;
 *   - the chart a commit publishes still answers the next lookup without rebuilding;
 *   - an unchanged transaction leaves the chart object and fingerprint untouched;
 *   - the canonical fingerprint round-trips through serialization after every edit kind;
 *   - an importer-seeded session keeps that digest exact after a point edit.
 *
 * A regression here means an edit again scales with total chart size, which is the
 * frame-budget failure the benchmark reports as a slow median.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";
import {
  chartFingerprint,
  installChartRevisionSeed,
} from "../../../core/edit/document/chartRevision.ts";
import { lineContentFingerprintParts } from "../../../core/global/chart/chartContentHash.ts";
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
  chart.META = { ...chart.META, name: "crud budget", charter: "bench" };
  chart.BPMList = [{ bpm: 180, startTime: [0, 0, 1] }];
  const lines = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex += 1) {
      line.notes.push(
        createNote(noteIndex % 5 === 0 ? 2 : 1, noteIndex / 4, ((noteIndex * 37) % 1350) - 675),
      );
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
  assertNoIndexBuild(() => {
    apply(session, {
      notes: { update: [{ id: updateTarget.id, patch: { positionX: 321 } }] },
    });
    assert.equal(locateNote(session.chart, updateTarget.id)?.note.positionX, 321);
  });

  const deleteTarget = notes[301];
  assertNoIndexBuild(() => {
    apply(session, { notes: { delete: [deleteTarget.id] } });
    assert.equal(locateNote(session.chart, deleteTarget.id), null);
  });

  const inserted = createNote(1, 500, 42);
  assertNoIndexBuild(() => {
    apply(session, { notes: { insert: [{ lineIndex, note: inserted }] } });
    const located = locateNote(session.chart, inserted.id);
    assert.equal(located?.lineIndex, lineIndex);
    assert.equal(located?.noteIndex, session.chart.judgeLineList[lineIndex].notes.length - 1);
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

test("a no-op transaction keeps the chart object and fingerprint untouched", () => {
  const chart = makeChart(4, 100);
  const session = new EditorSession(chart);
  const before = chartFingerprint(session.chart);
  const chartObject = session.chart;
  const note = session.chart.judgeLineList[0].notes[10];

  const result = applyChartTransaction(session, {
    notes: { update: [{ id: note.id, patch: { positionX: note.positionX } }] },
  });

  assert.equal(result.status, "unchanged");
  assert.equal(result.afterFingerprint, before);
  assert.equal(session.chart, chartObject, "an unchanged edit must not replace the chart");
  assert.equal(chartFingerprint(session.chart), before);
  // A second read is served from the digest cache and must return the same value.
  assert.equal(chartFingerprint(session.chart), before);

  const rejected = applyChartTransaction(session, {
    notes: { update: [{ id: "missing-note", patch: { positionX: 1 } }] },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(session.chart, chartObject);
  assert.equal(chartFingerprint(session.chart), before);
});

test("the canonical fingerprint round-trips through serialization after every edit", () => {
  const chart = makeChart(3, 60);
  const session = new EditorSession(chart);
  const roundTrip = () => chartFingerprint(parseChart(serializeChart(session.chart)));
  assert.equal(chartFingerprint(session.chart), roundTrip());

  const note = session.chart.judgeLineList[1].notes[30];
  const updated = applyChartTransaction(session, {
    notes: { update: [{ id: note.id, patch: { positionX: 42, size: 1.5 } }] },
  });
  assert.equal(updated.status, "committed");
  assert.equal(chartFingerprint(session.chart), roundTrip());
  assert.equal(updated.afterFingerprint, roundTrip());

  const deleted = applyChartTransaction(session, {
    notes: { delete: [session.chart.judgeLineList[2].notes[40].id] },
  });
  assert.equal(deleted.status, "committed");
  assert.equal(chartFingerprint(session.chart), roundTrip());

  const insertion = applyChartTransaction(session, {
    notes: { insert: [{ lineIndex: 0, note: createNote(1, 200, -10) }] },
  });
  assert.equal(insertion.status, "committed");
  assert.equal(chartFingerprint(session.chart), roundTrip());

  const event = session.chart.judgeLineList[1].eventLayers[0].alphaEvents[0];
  const eventUpdate = applyChartTransaction(session, {
    events: { update: [{ id: event.id, patch: { start: event.start === 200 ? 201 : 200 } }] },
  });
  assert.equal(eventUpdate.status, "committed");
  assert.equal(chartFingerprint(session.chart), roundTrip());
});

test("an importer-seeded session keeps the exact digest after a point edit", () => {
  const chart = makeChart(3, 80);
  installChartRevisionSeed(chart, {
    lines: chart.judgeLineList.map((line) =>
      lineContentFingerprintParts(line, { includeValueDigests: true }),
    ),
  });
  const session = new EditorSession(chart);
  const note = session.chart.judgeLineList[1].notes[40];

  const result = applyChartTransaction(session, {
    notes: { update: [{ id: note.id, patch: { positionX: 77 } }] },
  });

  assert.equal(result.status, "committed");
  const reparsed = chartFingerprint(parseChart(serializeChart(session.chart)));
  assert.equal(chartFingerprint(session.chart), reparsed);
  assert.equal(result.afterFingerprint, reparsed);
});
