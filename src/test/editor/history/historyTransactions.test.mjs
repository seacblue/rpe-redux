/** Exercises history retention, transaction outcomes and stale edit rejection. */
import assert from "node:assert/strict";
import test from "node:test";
import { createChart } from "../../../core/global/chart/chart.ts";
import { History } from "../../../core/edit/session/history.ts";
import { EditorSession } from "../../../core/edit/session/session.ts";
import {
  applyChartTransaction,
  previewChartTransaction,
} from "../../../core/edit/transaction/preview.ts";
import { extensionRegistry } from "../../../core/extensions/runtime.ts";
import { commitTransaction, fingerprint } from "../../../core/edit/transaction/apply.ts";

function named(chart, name) {
  return { ...chart, META: { ...chart.META, name } };
}

test("a new edit discards redo before enforcing the byte limit", () => {
  const history = new History(createChart());
  history.byteLimit = 100;
  history.record(
    "one",
    named(history.document, "one"),
    {},
    {},
    { normalized: true, estimatedBytes: 40 },
  );
  history.record(
    "two",
    named(history.document, "two"),
    {},
    {},
    { normalized: true, estimatedBytes: 40 },
  );
  history.undo();
  history.record(
    "branch",
    named(history.document, "branch"),
    {},
    {},
    { normalized: true, estimatedBytes: 40 },
  );
  assert.deepEqual(
    history.undoStack.map((entry) => entry.label),
    ["one", "branch"],
  );
  assert.equal(history.retainedBytes, 80);
  assert.equal(history.redoStack.length, 0);
});

test("selection-only branching releases redo bytes", () => {
  const session = new EditorSession(createChart());
  const history = session.history;
  history.record(
    "one",
    named(history.document, "one"),
    {},
    {},
    { normalized: true, estimatedBytes: 40 },
  );
  history.record(
    "two",
    named(history.document, "two"),
    {},
    {},
    { normalized: true, estimatedBytes: 40 },
  );
  history.undo();
  const before = session.selectionState();
  session.selection.add(1);
  session.recordSelection("selection", before);
  assert.equal(history.retainedBytes, 40);
  assert.equal(history.redoStack.length, 0);
});

test("an over-limit transaction remains undoable and reports its own committed entry", () => {
  const session = new EditorSession(createChart());
  session.history.byteLimit = 1;
  const before = session.chart;
  const result = applyChartTransaction(session, { label: "large", metadata: { name: "changed" } });
  assert.equal(result.status, "committed");
  assert.equal(result.history.label, "large");
  assert.equal(session.history.undoStack.length, 1);
  assert.equal(session.travel("undo"), true);
  assert.equal(session.chart, before);
  assert.equal(session.travel("redo"), true);
  assert.equal(session.chart.META.name, "changed");
});

test("a cyclic chart still fingerprints instead of overflowing the stack", async () => {
  const { warmChartFingerprintAsync } =
    await import("../../../core/edit/document/chartRevision.ts");
  const chart = createChart();
  // An extension hook can attach a back-reference to the chart; hashing must
  // terminate rather than walk the cycle.
  chart.judgeLineList[0].chart = chart;
  const digest = fingerprint(chart);
  assert.equal(typeof digest, "string");
  assert.ok(digest.length > 0);
  assert.equal(fingerprint(chart), digest);
  assert.equal(await warmChartFingerprintAsync(chart), digest);
});

test("new charts and added lines use the shared Untitled name", () => {
  const chart = createChart();
  assert.equal(chart.judgeLineList[0].Name, "Untitled");
  const session = new EditorSession(chart);
  session.addLine();
  assert.equal(session.chart.judgeLineList[1].Name, "Untitled");
});

test("lines.insert appends a line and later operations can target it by index", () => {
  const session = new EditorSession(createChart());
  const before = session.chart.judgeLineList.length;
  const result = applyChartTransaction(session, {
    label: "insert line",
    lines: { insert: [{ line: { Name: "Added", bpmfactor: 2 } }] },
    notes: {
      insert: [
        {
          lineIndex: before,
          note: {
            type: 1,
            startTime: [0, 1, 1],
            endTime: [0, 1, 1],
            positionX: 0,
            above: 1,
          },
        },
      ],
    },
  });
  assert.equal(result.status, "committed");
  assert.equal(session.chart.judgeLineList.length, before + 1);
  const line = session.chart.judgeLineList[before];
  assert.equal(line.Name, "Added");
  assert.equal(line.bpmfactor, 2);
  assert.equal(line.notes.length, 1);
});

test("timing.bpmList replaces the tempo map and sorts points by beat", () => {
  const session = new EditorSession(createChart());
  const result = applyChartTransaction(session, {
    label: "set timing",
    timing: {
      bpmList: [
        { bpm: 90, startTime: [8, 0, 1] },
        { bpm: 180, startTime: [0, 0, 1] },
      ],
    },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(
    session.chart.BPMList.map((entry) => [entry.bpm, entry.startTime]),
    [
      [180, [0, 0, 1]],
      [90, [8, 0, 1]],
    ],
  );
});

test("timing.bpmList rejects an empty or non-positive tempo map", () => {
  const session = new EditorSession(createChart());
  const before = session.chart;
  for (const bpmList of [[], [{ bpm: 0, startTime: [0, 0, 1] }]]) {
    const result = applyChartTransaction(session, { timing: { bpmList } });
    assert.equal(result.status, "rejected");
    assert.ok(result.issues.length > 0);
    assert.equal(session.chart, before);
  }
});

test("the guide's opening-section example commits in one transaction", () => {
  const session = new EditorSession(createChart());
  const result = applyChartTransaction(session, {
    label: "write the opening section",
    timing: { bpmList: [{ bpm: 180, startTime: [0, 0, 1] }] },
    metadata: { name: "Opening", charter: "AI", offset: 0 },
    lines: { insert: [{ line: { Name: "Main", bpmfactor: 1 } }] },
    notes: {
      insert: [
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: -300, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 1, 2], endTime: [0, 1, 2], positionX: -100, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 1, 1], endTime: [0, 1, 1], positionX: 100, above: 1 },
        },
        {
          lineIndex: 1,
          note: { type: 1, startTime: [0, 3, 2], endTime: [0, 3, 2], positionX: 300, above: 1 },
        },
      ],
    },
    events: {
      insert: [
        {
          lineIndex: 1,
          eventType: "moveXEvents",
          layer: 0,
          event: {
            startTime: [2, 0, 1],
            endTime: [4, 0, 1],
            start: -200,
            end: 200,
            easingType: 6,
          },
        },
      ],
    },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(session.chart.BPMList, [{ bpm: 180, startTime: [0, 0, 1] }]);
  assert.equal(session.chart.META.name, "Opening");
  const line = session.chart.judgeLineList[1];
  assert.equal(line.Name, "Main");
  assert.equal(line.notes.length, 4);
  assert.ok(
    line.eventLayers[0].moveXEvents.some(
      (event) => event.start === -200 && event.end === 200 && event.startTime[0] === 2,
    ),
  );
});

test("a committed transaction echoes its audit origin in the result", () => {
  const session = new EditorSession(createChart());
  const origin = { kind: "code-cell", clientId: "client-1", requestId: "request-1" };
  const result = applyChartTransaction(
    session,
    { label: "audited", metadata: { name: "audited" } },
    undefined,
    { origin },
  );
  assert.equal(result.status, "committed");
  assert.deepEqual(result.history.origin, origin);
  assert.deepEqual(session.history.undoStack[0].origin, origin);
});

test("a previewed transaction can be applied with an audit origin", () => {
  const session = new EditorSession(createChart());
  const preview = previewChartTransaction(session, {
    label: "previewed code cell",
    metadata: { name: "previewed" },
  });
  assert.equal(preview.status, "previewed");
  assert.ok(preview.previewId);
  const origin = { kind: "code-cell", requestId: "cell-1" };
  const result = applyChartTransaction(session, undefined, preview.previewId, { origin });
  assert.equal(result.status, "committed");
  assert.deepEqual(result.history.origin, origin);
  assert.deepEqual(session.history.undoStack[0].origin, origin);
});

test("a stale or invalid transaction leaves document and history untouched", () => {
  const session = new EditorSession(createChart());
  const before = session.chart;
  const stale = applyChartTransaction(session, { metadata: { name: "new" } }, undefined, {
    expectedFingerprint: "stale",
  });
  assert.equal(stale.status, "conflict");
  const invalid = applyChartTransaction(session, {
    metadata: { name: "new" },
    notes: { delete: ["missing"] },
  });
  assert.equal(invalid.status, "rejected");
  assert.equal(session.chart, before);
  assert.equal(session.history.undoStack.length, 0);
});

test("a cancelled commit is rejected without changing the chart or history", () => {
  const session = new EditorSession(createChart());
  const before = session.chart;
  const dispose = extensionRegistry.onHook("session:before-commit", (payload) => {
    payload.cancel = true;
  });
  try {
    const result = applyChartTransaction(session, { metadata: { name: "cancelled" } });
    assert.equal(result.status, "rejected");
    assert.equal(result.beforeFingerprint, result.afterFingerprint);
    assert.equal(session.chart, before);
    assert.equal(session.history.undoStack.length, 0);
  } finally {
    dispose();
  }
});

test("a commit reports the actual chart version after a before-commit hook changes it", () => {
  const session = new EditorSession(createChart());
  const dispose = extensionRegistry.onHook("session:before-commit", (payload) => {
    payload.chart.META.name = "adjusted";
  });
  try {
    const result = applyChartTransaction(session, { metadata: { name: "requested" } });
    assert.equal(result.status, "committed");
    assert.equal(session.chart.META.name, "adjusted");
    assert.equal(result.afterFingerprint, fingerprint(session.chart));
    assert.equal(result.history.afterFingerprint, result.afterFingerprint);
  } finally {
    dispose();
  }
});

test("a stale precomputed transaction is rejected even without explicit options", () => {
  const session = new EditorSession(createChart());
  const oldFingerprint = fingerprint(session.chart);
  const proposal = named(session.chart, "old proposal");
  session.commitChart("new edit", named(session.chart, "new edit"));
  const current = session.chart;
  const result = commitTransaction(session, proposal, "stale", oldFingerprint, []);
  assert.equal(result.status, "conflict");
  assert.equal(session.chart, current);
  assert.equal(session.history.undoStack.length, 1);
});

test("a failing history listener does not abort the committed edit or other listeners", () => {
  const session = new EditorSession(createChart());
  let seen = 0;
  session.history.subscribe(() => {
    throw new Error("listener failure");
  });
  session.history.subscribe(() => {
    seen++;
  });
  const report = console.error;
  console.error = () => {};
  try {
    const result = applyChartTransaction(session, { metadata: { name: "committed" } });
    assert.equal(result.status, "committed");
    assert.equal(session.chart.META.name, "committed");
    assert.equal(session.history.undoStack.length, 1);
    assert.equal(seen, 1);
  } finally {
    console.error = report;
  }
});
