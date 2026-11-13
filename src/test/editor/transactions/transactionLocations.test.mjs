/**
 * Exercises the shared location index for events and the cache invariants that
 * keep batch id lookups linear in chart size.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  createLine,
  createNote,
  EVENT_TRACKS,
} from "../../../core/global/chart/chart.ts";
import { createChartObjectId } from "../../../core/global/chart/identity.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  applyRequest,
  fingerprint,
  transactionChart,
} from "../../../core/edit/transaction/apply.ts";
import {
  chartLocationDiagnostics,
  ensureChartLocations,
  findEvent,
  locateLine,
  locateNote,
  resetChartLocationDiagnostics,
} from "../../../core/edit/transaction/locations.ts";
import { applyChartTransaction } from "../../../core/edit/transaction/preview.ts";
import { installChartRevisionSeed } from "../../../core/edit/document/chartRevision.ts";
import { lineContentFingerprintParts } from "../../../core/global/chart/chartContentHash.ts";

/** Build a chart with one normal layer and one extended track per line. */
function makeEventChart(lineCount = 5, eventsPerTrack = 50) {
  const chart = createChart();
  chart.judgeLineList = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [];
    line.eventLayers = [
      {
        moveXEvents: Array.from({ length: eventsPerTrack }, (_, index) =>
          createEvent(index, index + 1, index, index + 1),
        ),
      },
    ];
    line.extended = {
      scaleXEvents: Array.from({ length: eventsPerTrack }, (_, index) =>
        createEvent(index, index, index, index + 1),
      ),
    };
    chart.judgeLineList.push(line);
  }
  return chart;
}

/** Every event id in index order, matching the locator's first-occurrence rule. */
function eventIds(chart) {
  const ids = [];
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const track of EVENT_TRACKS) {
        for (const event of layer[track] ?? []) {
          if (typeof event.id === "string") {
            ids.push(event.id);
          }
        }
      }
    }
  }
  return ids;
}

function stateFor(chart) {
  return {
    chart: transactionChart(chart),
    issues: [],
    affected: [],
    usedIds: new Set(),
    relationTouched: new Set(),
    clonedLines: new Set(),
  };
}

test("500 event updates share one index scan instead of rescanning per id", () => {
  const chart = makeEventChart(5, 50);
  const ids = eventIds(chart);
  assert.equal(ids.length, 500);
  const state = stateFor(chart);
  resetChartLocationDiagnostics();
  const updates = ids.map((id, index) => ({ id, patch: { start: index - 250 } }));

  applyRequest(state, { events: { update: updates } });

  assert.equal(state.issues.length, 0);
  const diagnostics = chartLocationDiagnostics();
  assert.equal(diagnostics.indexBuilds, 1, "one batch index build");
  assert.equal(diagnostics.eventScans, 1, "one full event scan for the batch");
  assert.equal(diagnostics.eventLookups, 500, "one indexed lookup per update");
  assert.equal(findEvent(state.chart, ids[0])?.event.start, -250);
  assert.equal(findEvent(state.chart, ids.at(-1))?.event.start, 249);
});

test("a batch delete resolves locations before splicing and rebuilds once", () => {
  const chart = makeEventChart(4, 30);
  const ids = eventIds(chart);
  const state = stateFor(chart);
  ensureChartLocations(state.chart);
  resetChartLocationDiagnostics();
  const deleted = ids.filter((_, index) => index % 2 === 0);
  const remaining = ids.filter((_, index) => index % 2 === 1);

  applyRequest(state, { events: { delete: deleted } });

  assert.equal(state.issues.length, 0);
  const diagnostics = chartLocationDiagnostics();
  assert.equal(diagnostics.eventLookups, deleted.length);
  assert.equal(diagnostics.indexBuilds, 1, "one rebuild after the delete batch");
  for (const id of deleted) {
    assert.equal(findEvent(state.chart, id), null);
  }
  for (const id of remaining) {
    assert.ok(findEvent(state.chart, id));
  }
});

test("an inserted event is addressable later in the same transaction", () => {
  const chart = makeEventChart(1, 2);
  const state = stateFor(chart);
  ensureChartLocations(state.chart);
  const id = createChartObjectId();

  applyRequest(state, {
    events: {
      insert: [
        {
          lineIndex: 0,
          eventType: "moveXEvents",
          layer: 0,
          event: { ...createEvent(5, 6, 3, 4), id },
        },
      ],
      update: [{ id, patch: { start: 77 } }],
    },
  });

  assert.equal(state.issues.length, 0);
  const located = findEvent(state.chart, id);
  assert.equal(located?.track, "moveXEvents");
  assert.equal(located?.layerIndex, 0);
  assert.equal(located?.event.start, 77);
});

test("findEvent indexes normal layers, the extended layer, and root lists", () => {
  const chart = createChart();
  const line = chart.judgeLineList[0];
  const layerEvent = createEvent(1, 2, 0, 1);
  const extendedEvent = createEvent(3, 4, 0, 1);
  const rootEvent = { ...createEvent(5, 6, 0, 1), line: 0 };
  const shaderEvent = createEvent(7, 8, 0, 1);
  const metadataEvent = createEvent(9, 10, 0, 1);
  line.eventLayers = [{ moveXEvents: [] }, { alphaEvents: [layerEvent] }];
  line.extended = { scaleXEvents: [extendedEvent] };
  chart.effects = [rootEvent];
  chart.shaderEvents = [shaderEvent];
  chart.META.effects = [metadataEvent];
  ensureChartLocations(chart);

  const layer = findEvent(chart, layerEvent.id);
  assert.equal(layer?.layerIndex, 1);
  assert.equal(layer?.track, "alphaEvents");
  assert.equal(layer?.line?.index, 0);

  const extended = findEvent(chart, extendedEvent.id);
  assert.equal(extended?.layerIndex, -1);
  assert.equal(extended?.track, "scaleXEvents");

  const root = findEvent(chart, rootEvent.id);
  assert.equal(root?.track, null);
  assert.equal(root?.layerIndex, null);
  assert.equal(root?.line?.index, 0);
  assert.ok(findEvent(chart, shaderEvent.id));
  assert.ok(findEvent(chart, metadataEvent.id));
});

test("a single uncached event lookup scans owners without building the full index", () => {
  const chart = makeEventChart(40, 80);
  const ids = eventIds(chart);
  resetChartLocationDiagnostics();

  const located = findEvent(chart, ids.at(-1));

  assert.equal(located?.event.id, ids.at(-1));
  assert.equal(chartLocationDiagnostics().indexBuilds, 0);
  assert.equal(chartLocationDiagnostics().eventLookups, 1);
});

test("copy-on-write fingerprint reuse keeps the changed chart digest exact", () => {
  const chart = makeEventChart(3, 3);
  fingerprint(chart);
  const next = transactionChart(chart);
  next.judgeLineList[0] = {
    ...next.judgeLineList[0],
    notes: [createNote(1, 4, 0)],
  };

  const reused = fingerprint(next);
  const independentlyHashed = fingerprint(structuredClone(next));

  assert.notEqual(reused, fingerprint(chart));
  assert.equal(reused, independentlyHashed);
});

test("worker-primed line digests survive a plain chart copy-on-write edit", () => {
  const chart = makeEventChart(2, 20);
  installChartRevisionSeed(chart, {
    lines: chart.judgeLineList.map(lineContentFingerprintParts),
  });

  const next = transactionChart(chart);
  next.judgeLineList[0] = {
    ...next.judgeLineList[0],
    notes: [createNote(1, 4, 0)],
  };

  assert.equal(fingerprint(next), fingerprint(structuredClone(next)));
});

test("worker array seeds stay exact after an in-place note patch", () => {
  const chart = makeEventChart(1, 40);
  const line = chart.judgeLineList[0];
  line.notes = Array.from({ length: 40 }, (_, index) => createNote(1, index, index));
  const parts = lineContentFingerprintParts(line, { includeValueDigests: true });
  installChartRevisionSeed(chart, { lines: [parts] });
  const session = new EditorSession(chart);
  const note = line.notes[17];

  const result = applyChartTransaction(session, {
    notes: { update: [{ id: note.id, patch: { positionX: 999 } }] },
  });

  assert.equal(result.status, "committed");
  assert.equal(result.afterFingerprint, fingerprint(structuredClone(session.chart)));
});

test("unknown note and line ids do not rebuild the index", () => {
  const chart = createChart();
  const note = createNote(1, 1, 0);
  chart.judgeLineList[0].notes = [note];
  ensureChartLocations(chart);
  resetChartLocationDiagnostics();

  assert.equal(locateNote(chart, "missing-note"), null);
  assert.equal(locateLine(chart, "missing-line"), null);
  assert.equal(chartLocationDiagnostics().indexBuilds, 0);
});

test("a changed note array rebuilds once while an unknown id still misses cheaply", () => {
  const chart = createChart();
  const note = createNote(1, 1, 0);
  chart.judgeLineList[0].notes = [note];
  ensureChartLocations(chart);
  resetChartLocationDiagnostics();

  chart.judgeLineList[0].notes = [...chart.judgeLineList[0].notes];
  const located = locateNote(chart, note.id);
  assert.equal(located?.note.id, note.id);
  assert.equal(chartLocationDiagnostics().indexBuilds, 1);

  resetChartLocationDiagnostics();
  assert.equal(locateNote(chart, "missing-note"), null);
  assert.equal(chartLocationDiagnostics().indexBuilds, 0);
});

test("mixed updates and deletes keep positions aligned in one track", () => {
  const chart = makeEventChart(1, 20);
  const ids = eventIds(chart);
  const moveIds = ids.slice(0, 20);
  const state = stateFor(chart);
  ensureChartLocations(state.chart);
  resetChartLocationDiagnostics();

  applyRequest(state, {
    events: {
      update: moveIds.slice(0, 10).map((id, index) => ({ id, patch: { start: 100 + index } })),
      delete: moveIds.slice(10),
    },
  });

  assert.equal(state.issues.length, 0);
  for (const [index, id] of moveIds.slice(0, 10).entries()) {
    assert.equal(findEvent(state.chart, id)?.event.start, 100 + index);
  }
  for (const id of moveIds.slice(10)) {
    assert.equal(findEvent(state.chart, id), null);
  }
});

test("root event updates and deletes use the same batch path", () => {
  const chart = createChart();
  const updated = createEvent(1, 2, 0, 1);
  const deleted = createEvent(3, 4, 0, 1);
  chart.effects = [updated, deleted];
  const state = stateFor(chart);
  ensureChartLocations(state.chart);

  applyRequest(state, {
    events: {
      update: [{ id: updated.id, patch: { start: 42 } }],
      delete: [deleted.id],
    },
  });

  assert.equal(state.issues.length, 0);
  assert.equal(findEvent(state.chart, updated.id)?.event.start, 42);
  assert.equal(findEvent(state.chart, deleted.id), null);
});

test("31 note updates build the note index once instead of scanning per id", () => {
  const chart = createChart();
  chart.judgeLineList[0].notes = Array.from({ length: 40 }, (_, index) =>
    createNote(1, index, index),
  );
  const notes = chart.judgeLineList[0].notes;
  const state = stateFor(chart);
  resetChartLocationDiagnostics();
  const updates = notes.slice(0, 31).map((note, index) => ({
    id: note.id,
    patch: { positionX: index + 10 },
  }));

  applyRequest(state, { notes: { update: updates } });

  assert.equal(state.issues.length, 0);
  assert.equal(chartLocationDiagnostics().indexBuilds, 1);
  assert.equal(state.chart.judgeLineList[0].notes[30].positionX, 40);
});

test("commit, undo and redo keep event lookups current", () => {
  const session = new EditorSession(makeEventChart(1, 2));
  const eventId = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].id;
  const original = session.chart.judgeLineList[0].eventLayers[0].moveXEvents[0].start;

  const result = applyChartTransaction(session, {
    events: { update: [{ id: eventId, patch: { start: 99 } }] },
  });
  assert.equal(result.status, "committed");
  assert.equal(findEvent(session.chart, eventId)?.event.start, 99);

  assert.equal(session.travel("undo"), true);
  assert.equal(findEvent(session.chart, eventId)?.event.start, original);

  assert.equal(session.travel("redo"), true);
  assert.equal(findEvent(session.chart, eventId)?.event.start, 99);
});
