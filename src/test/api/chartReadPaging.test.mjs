/** Verifies chart reads detach only the requested page and preserve read semantics. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart, createEvent, createLine, createNote } from "../../core/global/chart/chart.ts";
import { ChartDocument } from "../../core/global/chart/streaming/chartDocument.ts";
import { chart } from "../../core/api/chart.ts";
import { connectChartApi, createChartApi, readAllChartItems } from "../../core/edit/chart/api.ts";

function fixture() {
  const chart = createChart();
  chart.judgeLineList = [];
  for (let lineIndex = 0; lineIndex < 4; lineIndex += 1) {
    const line = createLine(`Line ${lineIndex}`);
    line.notes = [createNote(1, lineIndex, lineIndex), createNote(1, lineIndex + 1, lineIndex + 1)];
    line.eventLayers[0].moveXEvents = [createEvent(0, 10, lineIndex, lineIndex + 1)];
    chart.judgeLineList.push(line);
  }
  return chart;
}

test("chart line reads detach only the requested page", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const page = api.read("lines", { limit: 2 });

  assert.equal(page.status, "ok");
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].Name, "Line 0");
  assert.notEqual(page.items[0], chart.judgeLineList[0]);
  assert.ok(Object.isFrozen(page.items[0]));
  assert.ok(page.nextCursor);
});

test("chart range reports authored content bounds in beats and seconds", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });

  assert.deepEqual(api.range(), {
    startBeat: 0,
    endBeat: 4,
    startSeconds: 0,
    endSeconds: 2,
  });
});

test("chart lineGroups returns folder names and line indices without a full snapshot", () => {
  const chart = fixture();
  chart.judgeLineGroup = ["Default", "Lead"];
  chart.judgeLineList[0].Group = 1;
  const api = createChartApi({ chart: () => chart });

  assert.deepEqual(api.lineGroups(), [
    { index: 0, name: "Default", lineIndices: [1, 2, 3] },
    { index: 1, name: "Lead", lineIndices: [0] },
  ]);
});

test("note and event pages keep stable ownership metadata", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const notes = api.read("notes", { limit: 2 });
  const events = api.read("events", { limit: 2 });

  assert.equal(notes.status, "ok");
  assert.equal(events.status, "ok");
  assert.equal(notes.items[0].lineId, chart.judgeLineList[0].id);
  assert.equal(notes.items[0].index, 0);
  assert.notEqual(notes.items[0].note, chart.judgeLineList[0].notes[0]);
  assert.equal(events.items[0].lineId, chart.judgeLineList[0].id);
  assert.equal(events.items[0].eventType, "moveXEvents");
  assert.notEqual(events.items[0].event, chart.judgeLineList[0].eventLayers[0].moveXEvents[0]);
});

test("full snapshots remain detached without building a JSON string", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const snapshot = api.snapshot();

  assert.ok(snapshot);
  assert.notEqual(snapshot, chart);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.judgeLineList.length, chart.judgeLineList.length);
});

test("offset pages address the same items as cursor pages", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const expected = api.notes().map((note) => note.id);
  const seen = [];
  let cursor = null;

  do {
    const page = cursor
      ? api.read("notes", { limit: 3, cursor })
      : api.read("notes", { limit: 3, offset: 0 });
    assert.equal(page.status, "ok");
    assert.equal(page.total, expected.length);
    assert.equal(page.offset, seen.length);
    seen.push(...page.items.map((note) => note.id));
    cursor = page.nextCursor;
  } while (cursor);

  assert.deepEqual(seen, expected);
});

test("a cursor keeps the page size that issued it", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const first = api.read("notes", { limit: 3 });
  assert.equal(first.status, "ok");

  const second = api.read("notes", { cursor: first.nextCursor });
  assert.equal(second.status, "ok");
  assert.equal(second.limit, 3);
  assert.equal(second.items.length, 3);
  assert.equal(second.offset, 3);
});

test("arbitrary offsets and totals match the collection", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });

  const head = api.read("lines", { offset: 0, limit: 2 });
  assert.equal(head.status, "ok");
  assert.equal(head.total, 4);
  assert.equal(head.offset, 0);
  assert.equal(head.limit, 2);
  assert.equal(head.hasMore, true);
  assert.ok(head.nextCursor);

  const tail = api.read("lines", { offset: 2, limit: 2 });
  assert.equal(tail.status, "ok");
  assert.equal(tail.offset, 2);
  assert.equal(tail.hasMore, false);
  assert.equal(tail.nextCursor, null);
  assert.deepEqual(
    tail.items.map((line) => line.Name),
    ["Line 2", "Line 3"],
  );

  const beyond = api.read("notes", { offset: 100, limit: 10 });
  assert.equal(beyond.status, "ok");
  assert.deepEqual(beyond.items, []);
  assert.equal(beyond.total, 8);
  assert.equal(beyond.hasMore, false);
  assert.equal(beyond.nextCursor, null);
});

test("page size is clamped and echoed", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const page = api.read("notes", { limit: 1000 });

  assert.equal(page.status, "ok");
  assert.equal(page.limit, 100);
  assert.equal(page.items.length, 8);
  assert.equal(page.hasMore, false);
});

test("metadata is one item at offset zero", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });

  const first = api.read("metadata");
  assert.equal(first.status, "ok");
  assert.equal(first.total, 1);
  assert.equal(first.items.length, 1);
  assert.equal(first.hasMore, false);

  const past = api.read("metadata", { offset: 1 });
  assert.equal(past.status, "ok");
  assert.equal(past.items.length, 0);
  assert.equal(past.total, 1);
  assert.equal(past.hasMore, false);
});

test("timing reads the tempo map in page order", () => {
  const chart = fixture();
  chart.BPMList = [
    { bpm: 120, startTime: [0, 0, 1] },
    { bpm: 180, startTime: [4, 0, 1] },
    { bpm: 90, startTime: [8, 0, 1] },
  ];
  const api = createChartApi({ chart: () => chart });

  const first = api.read("timing", { limit: 2 });
  assert.equal(first.status, "ok");
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].bpm, 120);
  assert.notEqual(first.items[0], chart.BPMList[0]);
  assert.ok(Object.isFrozen(first.items[0]));
  assert.ok(first.nextCursor);

  const second = api.read("timing", { cursor: first.nextCursor });
  assert.equal(second.status, "ok");
  assert.deepEqual(
    second.items.map((entry) => entry.bpm),
    [90],
  );
  assert.equal(second.hasMore, false);
});

test("readAll timing returns the whole tempo map", () => {
  const source = fixture();
  source.BPMList = [
    { bpm: 120, startTime: [0, 0, 1] },
    { bpm: 180, startTime: [4, 0, 1] },
    { bpm: 90, startTime: [8, 0, 1] },
  ];
  const dispose = connectChartApi({ chart: () => source });
  try {
    const result = chart.readAll("timing", { limit: 1 });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.map((entry) => entry.bpm),
      [120, 180, 90],
    );
  } finally {
    dispose();
  }
});

test("a timing cursor from an earlier revision reports stale_read", () => {
  const source = fixture();
  source.BPMList = [
    { bpm: 120, startTime: [0, 0, 1] },
    { bpm: 180, startTime: [4, 0, 1] },
  ];
  const document = ChartDocument.fromChart(source);
  const api = createChartApi({ chart: () => document.chart });
  const first = api.read("timing", { limit: 1 });
  assert.equal(first.status, "ok");
  assert.ok(first.nextCursor);

  document.syncFromChart(
    {
      ...document.chart,
      BPMList: [{ bpm: 150, startTime: [0, 0, 1] }],
    },
    { changedLineIndexes: [] },
  );

  const stale = api.read("timing", { cursor: first.nextCursor });
  assert.equal(stale.status, "stale_read");
  assert.equal(stale.requestedFingerprint, first.chartFingerprint);
  assert.notEqual(stale.currentFingerprint, first.chartFingerprint);
});

test("invalid paging requests are rejected without touching the chart", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const cursor = api.read("lines", { limit: 1, offset: 0 }).nextCursor;

  assert.deepEqual(api.read("lines", { limit: 0 }), {
    status: "invalid_request",
    reason: "invalid_limit",
  });
  assert.deepEqual(api.read("lines", { limit: 1.5 }), {
    status: "invalid_request",
    reason: "invalid_limit",
  });
  assert.deepEqual(api.read("lines", { offset: -1 }), {
    status: "invalid_request",
    reason: "invalid_offset",
  });
  assert.deepEqual(api.read("lines", { offset: 1.5 }), {
    status: "invalid_request",
    reason: "invalid_offset",
  });
  assert.deepEqual(api.read("lines", { cursor, offset: 0 }), {
    status: "invalid_request",
    reason: "conflicting_paging",
  });
  assert.deepEqual(api.read("lines", { cursor: "not-a-cursor" }), {
    status: "invalid_request",
    reason: "invalid_cursor",
  });
});

test("a cursor from an earlier revision reports stale_read", () => {
  const document = ChartDocument.fromChart(fixture());
  const api = createChartApi({ chart: () => document.chart });
  const first = api.read("notes", { limit: 2 });
  assert.equal(first.status, "ok");
  assert.ok(first.nextCursor);

  const line = document.line(0);
  document.syncFromChart(
    {
      ...document.chart,
      judgeLineList: document.chart.judgeLineList.map((entry, index) =>
        index === 0 ? { ...entry, notes: [line.notes[0]] } : entry,
      ),
    },
    { changedLineIndexes: [0] },
  );

  const stale = api.read("notes", { cursor: first.nextCursor });
  assert.equal(stale.status, "stale_read");
  assert.equal(stale.requestedFingerprint, first.chartFingerprint);
  assert.notEqual(stale.currentFingerprint, first.chartFingerprint);

  const refreshed = api.read("notes", { limit: 2 });
  assert.equal(refreshed.status, "ok");
  assert.equal(refreshed.total, 7);
});

test("readAll assembles every page into one array", () => {
  const chart = fixture();
  const api = createChartApi({ chart: () => chart });
  const expected = api.notes().map((note) => note.id);
  let reads = 0;

  const result = readAllChartItems(
    (collection, options) => {
      reads += 1;
      return api.read(collection, options);
    },
    "notes",
    { limit: 3 },
  );

  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.items.map((note) => note.id),
    expected,
  );
  assert.equal(result.total, expected.length);
  assert.equal(reads, 3);
});

test("readAll fails closed when the chart changes mid-read", () => {
  const document = ChartDocument.fromChart(fixture());
  const api = createChartApi({ chart: () => document.chart });
  let reads = 0;

  const result = readAllChartItems(
    (collection, options) => {
      const page = api.read(collection, options);
      reads += 1;
      if (reads === 1) {
        const line = document.line(0);
        document.syncFromChart(
          {
            ...document.chart,
            judgeLineList: document.chart.judgeLineList.map((entry, index) =>
              index === 0 ? { ...entry, notes: [line.notes[0]] } : entry,
            ),
          },
          { changedLineIndexes: [0] },
        );
      }
      return page;
    },
    "notes",
    { limit: 2 },
  );

  assert.equal(result.status, "stale_read");
  assert.notEqual(result.requestedFingerprint, result.currentFingerprint);
});

test("the public chart handle resolves readAll to one array", () => {
  const dispose = connectChartApi({ chart: () => fixture() });
  try {
    const result = chart.readAll("notes");
    assert.equal(result.ok, true);
    assert.equal(result.value.length, 8);
  } finally {
    dispose();
  }
});

test("the public chart handle reports a stale read as one failure", () => {
  const first = fixture();
  const second = fixture();
  let reads = 0;
  const dispose = connectChartApi({ chart: () => (reads++ === 0 ? first : second) });
  try {
    const result = chart.readAll("notes", { limit: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "stale_read");
  } finally {
    dispose();
  }
});

test("readAll reports an invalid request when paging is rejected", () => {
  const result = readAllChartItems(
    () => ({ status: "invalid_request", reason: "invalid_limit" }),
    "notes",
    { limit: 0 },
  );

  assert.deepEqual(result, { status: "invalid_request", reason: "invalid_limit" });
});

test("a paged facade republishes its snapshot after an in-place edit", () => {
  const document = ChartDocument.fromChart(fixture());
  const api = createChartApi({ chart: () => document.chart });
  const before = api.snapshot();
  assert.equal(before.judgeLineList[0].notes.length, 2);

  const line = document.line(0);
  const lines = document.chart.judgeLineList.map((entry, index) =>
    index === 0 ? { ...entry, notes: [line.notes[0]] } : entry,
  );
  document.syncFromChart({ ...document.chart, judgeLineList: lines }, { changedLineIndexes: [0] });

  const after = api.snapshot();
  assert.notEqual(after, before, "a content revision must invalidate the cached snapshot");
  assert.equal(after.judgeLineList[0].notes.length, 1);
});
