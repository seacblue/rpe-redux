/**
 * Guards the per-edit work budget of the chart transaction path.
 *
 * The CRUD benchmark (`scripts/benchmarkChartCrud.mjs`) measures wall-clock cost,
 * which is too noisy for the unit suite. This test instead pins the work counters and
 * content-digest invariants that make single-object edits cheap:
 *
 *   - a single note update, delete, or insert never rebuilds the full location index;
 *   - an unchanged transaction leaves the chart object and fingerprint untouched;
 *   - the canonical fingerprint round-trips through serialization and stays exact
 *     after every edit kind;
 *   - the canonical line digest still matches the native streaming index vector
 *     (`src-tauri/src/documents/chart_stream/index.rs` reimplements the same hash and
 *     pins these literals), so the digest algorithm must stay bit-identical.
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
  locateNote,
  resetChartLocationDiagnostics,
} from "../../../core/edit/transaction/locations.ts";

/**
 * Builds a chart with `lineCount` judge lines and `notesPerLine` notes each.
 *
 * Every line also carries an alpha event track so the event operation has a target;
 * note counts follow the editor's scoring convention (holds are not scored).
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
      const beat = noteIndex / 4;
      line.notes.push(
        createNote(noteIndex % 5 === 0 ? 2 : 1, beat, ((noteIndex * 37) % 1350) - 675),
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
 * Asserts that the committed chart already carries a current location index.
 *
 * A single-object edit must leave an index a later lookup can use, otherwise the next
 * operation pays a whole-chart rebuild. `ensureChartLocations` is the observable:
 * on a chart without a usable index it performs exactly one full build, which the
 * `indexBuilds` counter records. `locateNote` then verifies the inherited index is
 * current, and a stale index would force another counted rebuild.
 *
 * @param {EditorSession} session session whose committed chart is checked
 * @param {string} probeId an id that must resolve through the inherited index
 */
function assertIndexInherited(session, probeId) {
  resetChartLocationDiagnostics();
  ensureChartLocations(session.chart);
  const located = locateNote(session.chart, probeId);
  assert.equal(
    chartLocationDiagnostics().indexBuilds,
    0,
    "the committed chart must carry a current location index",
  );
  assert.ok(located, `expected ${probeId} to resolve through the inherited index`);
}

test("single note update, delete and insert inherit a current location index", () => {
  const chart = makeChart(40, 500);
  const session = new EditorSession(chart);
  // Warm the index once so the measured transactions start from an inherited index,
  // mirroring an open document whose first edit already has locations cached.
  ensureChartLocations(session.chart);

  const updateTarget = session.chart.judgeLineList[20].notes[250];
  const updated = applyChartTransaction(session, {
    notes: { update: [{ id: updateTarget.id, patch: { positionX: 123.5 } }] },
  });
  assert.equal(updated.status, "committed");
  assertIndexInherited(session, updateTarget.id);
  const updatedNote = locateNote(session.chart, updateTarget.id);
  assert.equal(updatedNote?.lineIndex, 20);
  assert.equal(updatedNote?.note.positionX, 123.5);

  const deleteTarget = session.chart.judgeLineList[20].notes[251];
  const neighbourId = session.chart.judgeLineList[20].notes[260].id;
  const deleted = applyChartTransaction(session, { notes: { delete: [deleteTarget.id] } });
  assert.equal(deleted.status, "committed");
  assertIndexInherited(session, neighbourId);
  assert.equal(locateNote(session.chart, neighbourId)?.lineIndex, 20);
  assert.equal(locateNote(session.chart, deleteTarget.id), null);

  const inserted = createNote(1, 1000, 42);
  const insertion = applyChartTransaction(session, {
    notes: { insert: [{ lineIndex: 20, note: inserted }] },
  });
  assert.equal(insertion.status, "committed");
  assertIndexInherited(session, inserted.id);
  assert.equal(locateNote(session.chart, inserted.id)?.lineIndex, 20);

  // The index the edits maintained must still serve the next transaction.
  resetChartLocationDiagnostics();
  const nextNote = session.chart.judgeLineList[20].notes[10];
  const followUp = applyChartTransaction(session, {
    notes: { update: [{ id: nextNote.id, patch: { positionX: -321 } }] },
  });
  assert.equal(followUp.status, "committed");
  assert.equal(chartLocationDiagnostics().indexBuilds, 0);
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

test("the canonical line digest keeps the native streaming index vector", () => {
  // `src-tauri/src/documents/chart_stream/index.rs` reimplements this hash for the
  // native open path and pins the same literals, so the TS digest must stay
  // bit-identical. The line is built inline so this check does not depend on another
  // test's fixtures.
  const line = {
    id: "line",
    notes: [{ id: "note", startTime: [0, 0, 1] }],
    eventLayers: [
      {
        alphaEvents: [{ id: "event", startTime: [1, 0, 1], endTime: [2, 0, 1], end: 0 }],
      },
    ],
  };

  const parts = lineContentFingerprintParts(line);

  assert.equal(parts.digest, "e07305ab");
  assert.equal(parts.childDigests.eventLayers, 632912271);
  assert.equal(parts.childDigests.notes, 4181772340);
});
