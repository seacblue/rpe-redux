/** Focused contracts for the per-frame performance fast paths. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createLine,
  createNote,
  normalizeChartObjectIds,
} from "../../../core/global/chart/chart.ts";
import { createChartObjectId, isChartObjectId } from "../../../core/global/chart/identity.ts";
import { History, retainedChangeBytes } from "../../../core/edit/session/history.ts";
import {
  measureElementRect,
  invalidateElementMeasurements,
} from "../../../frontend/screens/editor/canvas/canvas2d.ts";
import {
  sameOverviewFrame,
  sameOverviewStripKey,
} from "../../../frontend/screens/editor/workspace/timeline/overview/overviewFrameKey.ts";
import {
  CompletionTimesCache,
  completionTimesForEntries,
  mergeCompletionTimes,
} from "../../../frontend/screens/editor/workspace/preview/scene/completionTimes.ts";

test("overview frames are reused only while every painted input matches", () => {
  const key = {
    chart: {},
    line: 0,
    layer: 0,
    extended: false,
    duration: 120,
    width: 800,
    historyWidth: 800,
    height: 180,
    historyRevision: 7,
    palette: {},
    markerY: 42,
  };
  assert.equal(sameOverviewFrame(key, { ...key }), true);
  assert.equal(sameOverviewFrame(key, { ...key, markerY: 43 }), false);
  assert.equal(sameOverviewFrame(key, { ...key, historyRevision: 8 }), false);
  assert.equal(sameOverviewFrame(key, { ...key, width: 801 }), false);
  assert.equal(sameOverviewStripKey(key, { ...key, historyRevision: 8 }), false);
  assert.equal(sameOverviewFrame(null, key), false);
});

test("element rectangles are cached until layout or size changes", () => {
  const element = {
    clientWidth: 100,
    clientHeight: 50,
    rectangleReads: 0,
    getBoundingClientRect() {
      this.rectangleReads += 1;
      return {
        left: 10,
        top: 20,
        right: 110,
        bottom: 70,
        width: 100,
        height: 50,
      };
    },
  };
  const first = measureElementRect(element);
  assert.equal(first.left, 10);
  assert.equal(first.top, 20);
  assert.equal(first.right, 110);
  assert.equal(first.bottom, 70);
  assert.equal(first.width, 100);
  assert.equal(first.height, 50);
  measureElementRect(element);
  assert.equal(element.rectangleReads, 1);
  element.clientWidth = 200;
  element.clientHeight = 100;
  measureElementRect(element);
  assert.equal(element.rectangleReads, 2);
  invalidateElementMeasurements();
  measureElementRect(element);
  assert.equal(element.rectangleReads, 3);
});

test("completion times are per-line sorted and merged without re-reading unchanged lines", () => {
  const entry = (start, end, type = 1, isFake = 0) => ({
    note: { type, isFake },
    start,
    end,
  });
  assert.deepEqual(
    completionTimesForEntries([entry(2, 2), entry(1, 3, 2), entry(9, 9, 1, 1)]),
    [2, 3],
  );
  assert.deepEqual(mergeCompletionTimes([[1, 4], [2, 3], [5]]), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeCompletionTimes([]), []);

  const cache = new CompletionTimesCache();
  const tempo = {};
  const sourceOne = [{}];
  const sourceTwo = [{}];
  const entriesOne = [entry(1, 1), entry(2, 3, 2)];
  const entriesTwo = [entry(4, 4)];
  assert.deepEqual(
    cache.update([{ notes: entriesOne }, { notes: entriesTwo }], [sourceOne, sourceTwo], tempo),
    [1, 3, 4],
  );

  const poisoned = new Proxy([entry(4, 4)], {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        throw new Error("unchanged line was re-read");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const nextSourceOne = [{}];
  assert.deepEqual(
    cache.update(
      [{ notes: [entry(0, 0), entry(2, 3, 2)] }, { notes: poisoned }],
      [nextSourceOne, sourceTwo],
      tempo,
    ),
    [0, 3, 4],
  );
});

test("history revision changes only when the read model changes", () => {
  const history = new History(createChart());
  const initial = history.revision;
  assert.equal(history.record("same", history.document), false);
  assert.equal(history.revision, initial);
  assert.equal(
    history.record(
      "rename",
      { ...history.document, META: { ...history.document.META, name: "renamed" } },
      {},
      {},
      { normalized: true, estimatedBytes: 1 },
    ),
    true,
  );
  assert.equal(history.revision, initial + 1);
  assert.equal(history.undo(), true);
  assert.equal(history.revision, initial + 2);
});

test("incremental id normalization only generates ids for changed objects", () => {
  const base = createChart();
  base.judgeLineList = [createLine("A"), createLine("B")];
  base.judgeLineList[0].notes = [createNote(1, 0, 0), createNote(2, 4, 0)];
  normalizeChartObjectIds(base);

  const line = base.judgeLineList[0];
  const replaced = { ...line.notes[0], positionX: 50 };
  const inserted = { ...createNote(1, 8, 0) };
  delete inserted.id;
  const derived = {
    ...base,
    judgeLineList: [{ ...line, notes: [replaced, line.notes[1], inserted] }, base.judgeLineList[1]],
  };
  let generated = 0;
  const factory = {
    next() {
      generated += 1;
      return createChartObjectId();
    },
  };
  normalizeChartObjectIds(derived, factory, base);
  assert.equal(generated, 1);
  assert.equal(replaced.id, line.notes[0].id);
  assert.ok(isChartObjectId(inserted.id));
  assert.equal(derived.judgeLineList[1], base.judgeLineList[1]);
});

test("incremental normalization still repairs a duplicated id in one line", () => {
  const base = createChart();
  base.judgeLineList = [createLine("A")];
  base.judgeLineList[0].notes = [createNote(1, 0, 0)];
  normalizeChartObjectIds(base);

  const line = base.judgeLineList[0];
  const duplicate = { ...line.notes[0] };
  const derived = {
    ...base,
    judgeLineList: [{ ...line, notes: [line.notes[0], duplicate] }],
  };
  let generated = 0;
  normalizeChartObjectIds(
    derived,
    {
      next() {
        generated += 1;
        return createChartObjectId();
      },
    },
    base,
  );
  assert.equal(generated, 1);
  assert.notEqual(duplicate.id, line.notes[0].id);
});

test("retained-byte estimation skips unchanged subtrees", () => {
  const shared = new Proxy(
    { id: "shared" },
    {
      get() {
        throw new Error("unchanged subtree was traversed");
      },
      ownKeys() {
        throw new Error("unchanged subtree was enumerated");
      },
    },
  );
  const before = { list: [shared], meta: { name: "before" } };
  const after = { list: [shared], meta: { name: "after" } };
  const bytes = retainedChangeBytes(before, after);
  assert.ok(bytes > 0);
  assert.equal(retainedChangeBytes(before, before), 0);
});
