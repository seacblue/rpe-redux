/**
 * Chart issue scanning and publishing.
 *
 * The tests pin the two contracts this area owns: what the pure scan finds
 * (open-interval semantics, per-track isolation, extended-layer context,
 * negative beats, and the density estimate) and how the publisher collapses
 * requests and avoids republishing an unchanged list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eventOverlapPairs } from "../../../core/edit/validation/eventOverlap.ts";
import { scanChartIssues } from "../../../core/edit/validation/chartIssueScan.ts";
import {
  chartIssueBadgeTone,
  chartIssueCount,
  EventIssueMonitor,
} from "../../../core/edit/validation/eventIssueMonitor.ts";
import {
  DEFAULT_NOTE_DENSITY_OPTIONS,
  scanNoteDensity,
} from "../../../core/edit/validation/noteDensityScan.ts";
import { MAX_BASE_EVENT_LAYERS } from "../../../core/global/chart/chartVocabulary.ts";

/** Scan options with the density estimate off, so structure is the only subject. */
function structuralOnly() {
  return {
    checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: false },
    densityOptions: DEFAULT_NOTE_DENSITY_OPTIONS,
  };
}

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
  return { judgeLineList: lines, BPMList: [{ bpm: 120, startTime: [0, 0, 1] }] };
}

/** Run the structural scan over a line list. */
function scan(lines) {
  return scanChartIssues({ chart: chart(lines), options: structuralOnly() });
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

test("the scan isolates tracks and reports the extended layer's synthetic index", () => {
  const result = scan([
    line("line-1", "First", [
      { moveXEvents: [event(0, 10, "a")] },
      { moveXEvents: [event(5, 15, "b")] },
    ]),
    line("line-2", "Second", [], {
      scaleXEvents: [event(0, 10, "c"), event(5, 15, "d")],
    }),
  ]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].lineIndex, 1);
  assert.equal(result.issues[0].extended, true);
  assert.equal(result.issues[0].layer, MAX_BASE_EVENT_LAYERS);
  assert.equal(result.issues[0].track, "scaleXEvents");
  assert.equal(result.issues[0].kind, "overlap");
});

test("the scan reports non-positive events and holds as chart issues", () => {
  const result = scan([
    line("line-1", "First", [{ moveXEvents: [event(4, 4, "equal")] }]),
    { ...line("line-2", "Second", []), notes: [createHold(6, 6, "hold")] },
  ]);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(
    result.issues.map((issue) => [issue.kind, issue.target]),
    [
      ["invalid-range", "event"],
      ["invalid-range", "hold"],
    ],
  );
});

test("the scan reports negative beats for events and notes", () => {
  const result = scan([
    line("line-1", "First", [{ moveXEvents: [event(-1, 1, "negative-event")] }]),
    { ...line("line-2", "Second", []), notes: [createHold(-2, -1, "negative-note")] },
  ]);
  assert.deepEqual(
    result.issues.map((issue) => [issue.kind, issue.target]),
    [
      ["negative-beat", "note"],
      ["negative-beat", "event"],
    ],
  );
});

test("the publisher scans once, merges the result, and counts it", async () => {
  let scans = 0;
  const monitor = new EventIssueMonitor(async (input) => {
    scans += 1;
    return scanChartIssues(input);
  });
  const first = chart([
    line("line-1", "First", [{ moveXEvents: [event(0, 10, "a"), event(5, 15, "b")] }]),
  ]);
  monitor.request({ chart: first, options: structuralOnly() });
  await settle();
  assert.equal(scans, 1);
  assert.equal(monitor.state.get().issues.length, 1);
  // An overlap breaks playback, so it is an error and reaches the badge.
  assert.equal(chartIssueCount.get(), 1);
  assert.equal(monitor.state.get().status, "ready");
});

test("the publisher collapses a burst into one scan of the newest chart", async () => {
  const scanned = [];
  const monitor = new EventIssueMonitor(async (input) => {
    scanned.push(input.chart);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return scanChartIssues(input);
  });
  const first = chart([line("line-1", "First", [{ moveXEvents: [event(0, 10, "a")] }])]);
  const second = chart([line("line-1", "First", [{ moveXEvents: [event(4, 4, "bad")] }])]);
  monitor.request({ chart: first, options: structuralOnly() });
  monitor.request({ chart: second, options: structuralOnly() });
  await settle(20);
  assert.deepEqual(scanned, [first, second]);
  assert.deepEqual(
    monitor.state.get().issues.map((issue) => issue.kind),
    ["invalid-range"],
  );
});

test("the publisher ignores a repeated request for the same chart", async () => {
  let scans = 0;
  const monitor = new EventIssueMonitor(async (input) => {
    scans += 1;
    return scanChartIssues(input);
  });
  const only = chart([line("line-1", "First", [{ moveXEvents: [event(0, 10, "a")] }])]);
  monitor.request({ chart: only, options: structuralOnly() });
  await settle();
  monitor.request({ chart: only, options: structuralOnly() });
  await settle();
  assert.equal(scans, 1);
});

test("density reports the same-time peak and locates it by beat", () => {
  const stack = [];
  for (let index = 0; index < 40; index += 1) {
    stack.push(event(4, 4, `n${index}`));
  }
  const notes = stack.map((source, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: source.startTime,
    endTime: source.startTime,
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ id: "line-1", Name: "Dense", notes }],
  };
  const options = {
    ...DEFAULT_NOTE_DENSITY_OPTIONS,
    caution: 10,
  };
  const result = scanNoteDensity(subject, options);
  assert.equal(result.peak, 40);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0].peak, 40);
  assert.deepEqual(result.ranges[0].lines, [0]);
});

test("the peak is a note count, not a note-second integral", () => {
  // Twenty notes spread over one beat, each visible for its own visible time.
  // The peak must stay at the number of notes that physically overlap, never the
  // sum of their visible durations.
  const notes = [];
  for (let index = 0; index < 20; index += 1) {
    notes.push({
      id: `note-${index}`,
      type: 1,
      startTime: [index, 0, 8],
      endTime: [index, 0, 8],
      positionX: 0,
      visibleTime: 999999,
    });
  }
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ id: "line-1", Name: "Sparse", notes }],
  };
  const result = scanNoteDensity(subject, {
    ...DEFAULT_NOTE_DENSITY_OPTIONS,
    caution: 1,
  });
  assert.ok(result.peak <= 20, `peak ${result.peak} exceeds the note count`);
  assert.ok(result.peak >= 1, "the estimate found nothing at all");
});

test("density stays silent below its caution threshold", () => {
  const notes = [0, 1, 2].map((index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ id: "line-1", notes }],
  };
  const result = scanNoteDensity(subject, {
    ...DEFAULT_NOTE_DENSITY_OPTIONS,
    caution: 10,
  });
  assert.equal(result.peak, 3);
  assert.deepEqual(result.ranges, []);
});

test("the rail badge counts every published issue, warnings included", async () => {
  const monitor = new EventIssueMonitor(scanChartIssues);
  // One structural error and one dense passage, so the two kinds both count.
  const denseNotes = Array.from({ length: 40 }, (_, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      { id: "line-1", Name: "Broken", eventLayers: [{ moveXEvents: [event(4, 4, "bad")] }] },
      { id: "line-2", Name: "Dense", notes: denseNotes },
    ],
  };
  monitor.request({
    chart: subject,
    options: {
      checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: true },
      densityOptions: { ...DEFAULT_NOTE_DENSITY_OPTIONS, caution: 10 },
    },
  });
  await settle(20);
  const issues = monitor.state.get().issues;
  assert.ok(
    issues.some((issue) => issue.kind === "density"),
    "the density hint must publish",
  );
  assert.equal(
    chartIssueCount.get(),
    issues.length,
    "the rail badge must show how many issues the pane can list",
  );
  assert.ok(
    issues
      .filter((issue) => issue.kind === "density")
      .every((issue) => issue.severity === "warning"),
    "a density issue is a warning, never an error",
  );
});

test("a changed threshold rescans the same chart", async () => {
  let scans = 0;
  const monitor = new EventIssueMonitor(async (input) => {
    scans += 1;
    return scanChartIssues(input);
  });
  const stack = Array.from({ length: 20 }, (_, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ id: "line-1", Name: "Stack", notes: stack }],
  };
  const options = (caution) => ({
    checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: true },
    densityOptions: { ...DEFAULT_NOTE_DENSITY_OPTIONS, caution },
  });
  // A threshold above the stack reports nothing.
  monitor.request({ chart: subject, options: options(100) });
  await settle(20);
  assert.equal(scans, 1);
  assert.equal(monitor.state.get().issues.filter((issue) => issue.kind === "density").length, 0);
  // The chart object is unchanged; only the threshold moved. The publisher must
  // still rescan, or the pane would keep the old verdict forever.
  monitor.request({ chart: subject, options: options(10) });
  await settle(20);
  assert.equal(scans, 2);
  assert.ok(
    monitor.state.get().issues.some((issue) => issue.kind === "density"),
    "the new threshold must take effect without an edit",
  );
});

test("a switched-off kind produces no issues", async () => {
  const monitor = new EventIssueMonitor(scanChartIssues);
  const stack = Array.from({ length: 20 }, (_, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      { id: "line-1", Name: "Stack", notes: stack },
      { id: "line-2", Name: "Broken", eventLayers: [{ speedEvents: [event(4, 4, "bad")] }] },
    ],
  };
  monitor.request({
    chart: subject,
    options: {
      checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: false },
      densityOptions: { ...DEFAULT_NOTE_DENSITY_OPTIONS, caution: 10 },
    },
  });
  await settle(20);
  const issues = monitor.state.get().issues;
  assert.ok(issues.length > 0, "the enabled kinds must still report");
  assert.ok(
    issues.every((issue) => issue.kind !== "density"),
    "a switched-off kind must not reach the pane at all",
  );
});

test("the rail badge is yellow while every issue is only a caution", async () => {
  const monitor = new EventIssueMonitor(scanChartIssues);
  const denseNotes = Array.from({ length: 40 }, (_, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const dense = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [{ id: "line-1", Name: "Dense", notes: denseNotes }],
  };
  const broken = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      { id: "line-1", Name: "Broken", eventLayers: [{ moveXEvents: [event(4, 4, "bad")] }] },
    ],
  };
  const options = {
    checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: true },
    densityOptions: { ...DEFAULT_NOTE_DENSITY_OPTIONS, caution: 10 },
  };
  monitor.request({ chart: dense, options });
  await settle(20);
  assert.equal(chartIssueBadgeTone.get(), "warning", "a caution must not paint the badge red");

  monitor.request({ chart: broken, options });
  await settle(20);
  assert.equal(chartIssueBadgeTone.get(), "error", "a broken range must paint the badge red");
});

test("every issue carries its range in chart seconds", () => {
  // 120 BPM is half a second per beat. The shared range of events 0-10 and 4-6
  // is beat 4 to beat 6, so the reported range is 2 s to 3 s.
  const result = scan([
    line("line-1", "First", [{ moveXEvents: [event(0, 10, "a"), event(4, 6, "b")] }]),
  ]);
  const overlap = result.issues.find((issue) => issue.kind === "overlap");
  assert.ok(overlap, "the overlap must be reported");
  assert.equal(overlap.startSeconds, 2, "beat 4 at 120 BPM is 2 s");
  assert.equal(overlap.endSeconds, 3, "beat 6 at 120 BPM is 3 s");
});

test("the snapshot separates errors from warnings", async () => {
  const monitor = new EventIssueMonitor(scanChartIssues);
  const denseNotes = Array.from({ length: 40 }, (_, index) => ({
    id: `note-${index}`,
    type: 1,
    startTime: [4, 0, 1],
    endTime: [4, 0, 1],
    positionX: 0,
    visibleTime: 0,
  }));
  const subject = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineList: [
      { id: "line-1", Name: "Broken", eventLayers: [{ moveXEvents: [event(4, 4, "bad")] }] },
      { id: "line-2", Name: "Dense", notes: denseNotes },
    ],
  };
  monitor.request({
    chart: subject,
    options: {
      checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: true },
      densityOptions: { ...DEFAULT_NOTE_DENSITY_OPTIONS, caution: 10 },
    },
  });
  await settle(20);
  const issues = monitor.state.get().issues;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  assert.ok(errors > 0, "the broken range must be an error");
  assert.ok(warnings > 0, "the dense passage must be a warning");
  assert.equal(errors + warnings, issues.length, "every issue has exactly one severity");
});

/** Wait for the publisher's queued work to drain. */
function settle(milliseconds = 5) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createHold(start, end, id) {
  return {
    id,
    type: 2,
    startTime: [start, 0, 1],
    endTime: [end, 0, 1],
    positionX: 0,
  };
}
