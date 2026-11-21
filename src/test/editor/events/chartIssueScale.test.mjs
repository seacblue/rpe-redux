/**
 * Scale contract for the chart issue scan.
 *
 * The scan is the only part of the check that grows with the chart, so this
 * suite pins the shapes that matter: a full-size chart (1000 lines, 100000
 * notes, 250000 events) completes well inside the background budget, and the
 * density estimate stays conservative rather than silently dropping notes.
 *
 * The timing bound is deliberately loose. It runs on a developer machine while
 * the unit suite is loading, and the point is the order of magnitude, not a
 * benchmark: a scan that regresses to a per-frame cost will miss it by orders.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { scanChartIssues } from "../../../core/edit/validation/chartIssueScan.ts";
import { DEFAULT_NOTE_DENSITY_OPTIONS } from "../../../core/edit/validation/noteDensityScan.ts";

/** The documented large-chart size for this repository. */
const LINE_COUNT = 1000;
const NOTE_COUNT = 100000;
const EVENT_COUNT = 250000;
/** Background budget: the check may be slow, but not editor-visible. */
const SCAN_BUDGET_MS = 5000;

/** Build a chart at the documented large scale. */
function largeChart() {
  const notesPerLine = Math.ceil(NOTE_COUNT / LINE_COUNT);
  const eventsPerLine = Math.ceil(EVENT_COUNT / LINE_COUNT);
  const judgeLineList = [];
  for (let lineIndex = 0; lineIndex < LINE_COUNT; lineIndex += 1) {
    const notes = [];
    for (let noteIndex = 0; noteIndex < notesPerLine; noteIndex += 1) {
      // Four notes per beat across the whole line, so a line spans the chart.
      const beat = noteIndex * 0.25;
      const whole = Math.floor(beat);
      const numerator = Math.round((beat - whole) * 4);
      notes.push({
        id: `note-${lineIndex}-${noteIndex}`,
        type: noteIndex % 8 === 0 ? 2 : 1,
        startTime: [whole, numerator, 4],
        endTime: noteIndex % 8 === 0 ? [whole + 1, numerator, 4] : [whole, numerator, 4],
        positionX: (noteIndex % 7) * 90 - 270,
      });
    }
    const moveXEvents = [];
    const speedEvents = [];
    for (let eventIndex = 0; eventIndex < eventsPerLine; eventIndex += 1) {
      const beat = eventIndex;
      const source = {
        startTime: [beat, 0, 1],
        endTime: [beat + 1, 0, 1],
        start: -300,
        end: 300,
        easingType: 1,
      };
      moveXEvents.push(source);
      speedEvents.push({ ...source, start: 1, end: 1.5 });
    }
    judgeLineList.push({
      id: `line-${lineIndex}`,
      Name: `Line ${lineIndex}`,
      eventLayers: [{ moveXEvents, speedEvents }],
      notes,
    });
  }
  return {
    META: { name: "Scale" },
    BPMList: [{ bpm: 180, startTime: [0, 0, 1] }],
    judgeLineList,
  };
}

test("a full-size chart scans inside the background budget", () => {
  const chart = largeChart();
  const started = performance.now();
  const result = scanChartIssues({
    chart,
    options: {
      checks: { overlap: true, "invalid-range": true, "negative-beat": true, density: true },
      densityOptions: DEFAULT_NOTE_DENSITY_OPTIONS,
    },
  });
  const elapsed = performance.now() - started;
  assert.ok(
    elapsed < SCAN_BUDGET_MS,
    `scan took ${elapsed.toFixed(0)} ms, over the ${SCAN_BUDGET_MS} ms background budget`,
  );
  // The synthetic chart puts notes on whole and quarter beats, so the estimate
  // must have found something dense rather than silently returning zero.
  assert.ok(result.densityPeak >= 1, "the density estimate found no notes at all");
});

test("the density estimate reports every line that contributes notes", () => {
  const chart = largeChart();
  const result = scanChartIssues({
    chart,
    options: {
      checks: { overlap: false, "invalid-range": false, "negative-beat": false, density: true },
      densityOptions: {
        ...DEFAULT_NOTE_DENSITY_OPTIONS,
        caution: 0,
        maxIssues: 1000,
      },
    },
  });
  assert.ok(result.issues.length > 0, "a dense chart produced no density issue");
  for (const issue of result.issues) {
    assert.equal(issue.kind, "density");
    assert.ok(issue.lineIndex >= 0 && issue.lineIndex < LINE_COUNT);
    assert.ok((issue.peak ?? 0) > 0, "a density issue must carry its peak");
  }
});
