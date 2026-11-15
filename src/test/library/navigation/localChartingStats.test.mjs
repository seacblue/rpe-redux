/** The installation-local ledger clamps values and rolls back discarded edits. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import { placeTimelineNote } from "../../../core/edit/timeline/placement.ts";

const storageData = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storageData.get(key) ?? null;
  },
  setItem(key, value) {
    storageData.set(key, String(value));
  },
};

const { createLocalChartingStatsTracker, readLocalChartingStats, updateLocalChartingStats } =
  await import("../../../frontend/platform/localChartingStats.ts");

test.beforeEach(() => storageData.clear());

test("local counters clamp signed updates", () => {
  updateLocalChartingStats({ notes: 3, events: 2, seconds: 5 });
  updateLocalChartingStats({ notes: -7, events: -1, seconds: -9 });
  assert.deepEqual(readLocalChartingStats(), { notes: 0, events: 1, seconds: 0 });
});

test("unsaved placements disappear while a successful save keeps them", () => {
  const session = new EditorSession(createChart());
  let seconds = 0;
  const tracker = createLocalChartingStatsTracker({ currentEditSeconds: () => seconds });
  tracker.attach(session);

  let pending = placeTimelineNote(session, 2, 4, 0, 0, null);
  placeTimelineNote(session, 2, 2, 0, 0, pending);
  assert.deepEqual(readLocalChartingStats(), { notes: 1, events: 0, seconds: 0 });
  tracker.discard();
  assert.deepEqual(readLocalChartingStats(), { notes: 0, events: 0, seconds: 0 });

  const savedSession = new EditorSession(createChart());
  tracker.attach(savedSession);
  pending = placeTimelineNote(savedSession, 2, 4, 0, 0, null);
  placeTimelineNote(savedSession, 2, 6, 0, 0, pending);
  seconds = 12;
  tracker.markSaved();
  assert.deepEqual(readLocalChartingStats(), { notes: 1, events: 0, seconds: 12 });
  tracker.discard();
  assert.deepEqual(readLocalChartingStats(), { notes: 1, events: 0, seconds: 12 });
});
