/**
 * Event overlap detection and the incremental chart issue monitor.
 *
 * The tests pin open-interval semantics, per-track isolation, extended-layer
 * context, and the cache behavior that keeps selection-only session changes from
 * republishing or rescanning unchanged lines.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eventOverlapPairs } from "../../../core/edit/validation/eventOverlap.ts";
import {
  chartIssueCount,
  EventIssueMonitor,
} from "../../../core/edit/validation/eventIssueMonitor.ts";
import { MAX_BASE_EVENT_LAYERS } from "../../../core/global/chart/chartVocabulary.ts";

/** Build one event with exact beat triples from whole beats. */
function event(start, end, id) {
  return {
    startTime: [start, 0, 1],
    endTime: [end, 0, 1],
    start: 0,
    end: 1,
    easingType: 1,
    ...(id ? { id } : {}),
  };
}

/** Build one line with a normal layer and optional extended tracks. */
function line(id, name, layers, extended = {}) {
  return {
    id,
    Name: name,
    eventLayers: layers,
    extended,
  };
}

/** Build a chart around a line list. */
function chart(lines) {
  return { judgeLineList: lines };
}

test("eventOverlapPairs reports open intervals and ignores touching ranges", () => {
  const pairs = eventOverlapPairs([
    event(0, 10, "a"),
    event(5, 15, "b"),
    event(15, 25, "c"),
    event(30, 40, "d"),
    event(40, 50, "e"),
  ]);
  assert.deepEqual(
    pairs.map((pair) => [pair.firstIndex, pair.secondIndex]),
    [[0, 1]],
  );
  assert.deepEqual(pairs[0].startTime, [5, 0, 1]);
  assert.deepEqual(pairs[0].endTime, [10, 0, 1]);
});

test("eventOverlapPairs sorts an unsorted track and finds every pair", () => {
  const pairs = eventOverlapPairs([
    event(10, 20, "late"),
    event(0, 15, "early"),
    event(2, 12, "middle"),
  ]);
  assert.equal(pairs.length, 3);
  assert.deepEqual(
    pairs.map((pair) => [pair.firstIndex, pair.secondIndex]),
    [
      [1, 2],
      [0, 1],
      [0, 2],
    ],
  );
});

test("eventOverlapPairs does not treat zero-length or end-to-start events as overlaps", () => {
  assert.deepEqual(eventOverlapPairs([event(5, 5, "a"), event(5, 5, "b")]), []);
  assert.deepEqual(eventOverlapPairs([event(0, 5, "a"), event(5, 10, "b")]), []);
});

test("monitor publishes once, reuses unchanged lines, and ignores selection rescans", () => {
  const lineTwo = line("line-2", "Second", [
    { moveXEvents: [event(0, 10, "c"), event(5, 15, "d")] },
  ]);
  const firstChart = chart([
    line("line-1", "First", [{ moveXEvents: [event(0, 10, "a"), event(5, 15, "b")] }]),
    lineTwo,
  ]);
  const monitor = new EventIssueMonitor();
  const first = monitor.update(firstChart);
  assert.equal(first.issues.length, 2);
  assert.equal(monitor.update(firstChart), first);

  let notifications = 0;
  const unsubscribe = monitor.state.subscribe(() => {
    notifications += 1;
  });
  monitor.update(firstChart);
  assert.equal(notifications, 0);

  const second = monitor.update(
    chart([line("line-1", "First", [{ moveXEvents: [event(0, 10, "a")] }]), lineTwo]),
  );
  assert.notEqual(second, first);
  assert.equal(notifications, 1);
  assert.equal(second.issues.length, 1);
  assert.equal(second.issues[0].lineIndex, 1);
  assert.equal(
    second.issues[0],
    first.issues.find((issue) => issue.lineIndex === 1),
    "the unchanged line must reuse its issue object",
  );
  unsubscribe();
});

test("a cloned line refreshes issue context while reusing unchanged range inputs", () => {
  const original = line("line-1", "First", [{ moveXEvents: [event(4, 4, "bad")] }]);
  const monitor = new EventIssueMonitor();
  const first = monitor.update(chart([original]));
  const cloned = { ...original, Name: "Renamed" };
  const second = monitor.update(chart([cloned]));

  assert.equal(first.issues.length, 1);
  assert.equal(second.issues.length, 1);
  assert.equal(second.issues[0].lineName, "Renamed");
  assert.notEqual(second.issues[0], first.issues[0]);
});

test("monitor isolates tracks and reports the extended layer's synthetic index", () => {
  const monitor = new EventIssueMonitor();
  const snapshot = monitor.update(
    chart([
      line("line-1", "First", [
        { moveXEvents: [event(0, 10, "a")] },
        { moveXEvents: [event(5, 15, "b")] },
      ]),
      line("line-2", "Second", [], {
        scaleXEvents: [event(0, 10, "c"), event(5, 15, "d")],
      }),
    ]),
  );
  assert.equal(snapshot.issues.length, 1);
  assert.equal(snapshot.issues[0].lineIndex, 1);
  assert.equal(snapshot.issues[0].extended, true);
  assert.equal(snapshot.issues[0].layer, MAX_BASE_EVENT_LAYERS);
  assert.equal(snapshot.issues[0].track, "scaleXEvents");
});

test("monitor treats a zero-length hooked event as authored intent", () => {
  const hooked = { ...event(4, 4, "hooked"), inst: 1 };
  const snapshot = new EventIssueMonitor().update(
    chart([line("line-1", "First", [{ moveXEvents: [hooked] }])]),
  );
  assert.equal(snapshot.issues.length, 0);
});

test("monitor still reports a reversed hooked event", () => {
  const reversed = { ...event(6, 4, "reversed"), inst: 1 };
  const snapshot = new EventIssueMonitor().update(
    chart([line("line-1", "First", [{ moveXEvents: [reversed] }])]),
  );
  assert.deepEqual(
    snapshot.issues.map((issue) => [issue.kind, issue.target]),
    [["invalid-range", "event"]],
  );
});

test("monitor reports non-positive events and holds as chart issues", () => {
  const badEvent = event(4, 4, "equal");
  const badHold = createHold(6, 6, "hold");
  const snapshot = new EventIssueMonitor().update(
    chart([
      line("line-1", "First", [{ moveXEvents: [badEvent] }]),
      { ...line("line-2", "Second", []), notes: [badHold] },
    ]),
  );
  assert.equal(snapshot.issues.length, 2);
  assert.equal(chartIssueCount.get(), 2);
  assert.deepEqual(
    snapshot.issues.map((issue) => [issue.kind, issue.target]),
    [
      ["invalid-range", "event"],
      ["invalid-range", "hold"],
    ],
  );
});

test("monitor reports negative beats for events and notes", () => {
  const snapshot = new EventIssueMonitor().update(
    chart([
      line("line-1", "First", [{ moveXEvents: [event(-1, 1, "negative-event")] }]),
      { ...line("line-2", "Second", []), notes: [createHold(-2, -1, "negative-note")] },
    ]),
  );
  assert.deepEqual(
    snapshot.issues.map((issue) => [issue.kind, issue.target]),
    [
      ["negative-beat", "note"],
      ["negative-beat", "event"],
    ],
  );
});

function createHold(start, end, id) {
  return {
    id,
    type: 2,
    startTime: [start, 0, 1],
    endTime: [end, 0, 1],
    positionX: 0,
  };
}
