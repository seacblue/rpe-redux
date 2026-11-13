/* eslint-disable max-lines -- this file keeps the cross-module hot-path contracts together. */
/** Focused contracts for the per-frame performance fast paths. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
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
import { IntervalIndex } from "../../../core/utils/intervalIndex.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { TimelineCache } from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineCache.ts";
import { TimelineGestures } from "../../../frontend/screens/editor/workspace/timeline/interaction/timelineGestures.ts";
import {
  createVerticalAtBeat,
  multiLineChromeKey,
  verticalAtBeat,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventRenderCache.ts";
import {
  drawEventCurve,
  drawEventCurveBatch,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventCurve.ts";
import {
  drawEventOverlapFilter,
  drawEventSelectionFilter,
  drawEventSelectionFilters,
  drawRemoteEventSelectionFilter,
  drawRemoteEventSelectionFilters,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventSelectionDrawing.ts";
import {
  labelGroups,
  labelGroupsFromEntries,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventLabelLayout.ts";
import {
  BEAT_LINE_COLOR_KEYS,
  beatLineColorKeyAt,
  beatLineColorKeys,
} from "../../../frontend/screens/editor/canvas/beatLineColors.ts";
import {
  gridStrokeColor,
  visibleGridTicks,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";
import { eventBeatRangeForTypes } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";

/** Reference implementation retained for differential checks against color-pattern caching. */
function referenceBeatLineColorKeys(lineCount) {
  const count = Math.max(1, Math.trunc(lineCount));
  const previewPatterns = {
    4: ["1", "4", "2", "4"],
    8: ["1", "8", "4", "8", "2", "8", "4", "8"],
    12: ["1", "12", "6", "4", "3", "12", "2", "12", "3", "4", "6", "12"],
  };
  if (previewPatterns[count]) {
    return previewPatterns[count];
  }
  const supportedDenominators = [1, 2, 3, 4, 6, 8, 12, 16];
  const roles = Array.from({ length: count }, () => "default");
  for (const denominator of supportedDenominators) {
    if (count % denominator !== 0) {
      continue;
    }
    const stride = count / denominator;
    const role = String(denominator);
    for (let index = 0; index < count; index++) {
      if (index % stride === 0 && roles[index] === "default") {
        roles[index] = role;
      }
    }
  }
  return roles;
}

/** Reference implementation retained for differential checks against grid color lookup. */
function referenceGridStrokeColor(palette, tick, division, subdivisionColors) {
  const key = beatLineColorKeyAt(tick, division);
  const index = BEAT_LINE_COLOR_KEYS.indexOf(key);
  const fallbackByKey = {
    1: palette.gridMajor,
    2: palette.gridSubdivisions[0] ?? palette.gridMinor,
    3: palette.gridSubdivisions[1] ?? palette.gridMinor,
    4: palette.gridSubdivisions[2] ?? palette.gridMinor,
    6: palette.gridSubdivisions[3] ?? palette.gridMinor,
    8: palette.gridSubdivisions[4] ?? palette.gridMinor,
    12: palette.gridSubdivisions[5] ?? palette.gridMinor,
    16: palette.gridSubdivisions[6] ?? palette.gridMinor,
    default: palette.gridMinor,
  };
  return subdivisionColors[index] ?? fallbackByKey[key] ?? palette.gridMinor;
}

/** Reference implementation retained for differential checks against grid tick ordering. */
function referenceVisibleGridTicks(first, last, stride, highlightedTick) {
  const ticks = new Set();
  for (let tick = first; tick <= last; tick += stride) {
    ticks.add(tick);
  }
  if (highlightedTick !== null && highlightedTick >= first && highlightedTick <= last) {
    ticks.add(highlightedTick);
  }
  return [...ticks].sort((left, right) => left - right);
}

/** Reference implementation retained for differential checks against label layout changes. */
function referenceLabelGroups(groups, height, isSelected, boundsFor) {
  const visible = Array.from(new Set(groups)).filter((group) => group !== undefined);
  const budget = Math.max(1, Math.floor(Math.max(0, height - 23) / 28));
  if (boundsFor) {
    const selected = visible.filter(isSelected);
    const ordered = [...visible].sort((left, right) => {
      const leftSelected = isSelected(left) ? 0 : 1;
      const rightSelected = isSelected(right) ? 0 : 1;
      if (leftSelected !== rightSelected) {
        return leftSelected - rightSelected;
      }
      const leftBounds = boundsFor(left);
      const rightBounds = boundsFor(right);
      return (leftBounds.top + leftBounds.bottom) / 2 - (rightBounds.top + rightBounds.bottom) / 2;
    });
    const kept = [];
    for (const group of ordered) {
      const center = (boundsFor(group).top + boundsFor(group).bottom) / 2;
      const selectedGroup = selected.includes(group);
      const crowded = kept.some((candidate) => {
        const candidateBounds = boundsFor(candidate);
        return Math.abs((candidateBounds.top + candidateBounds.bottom) / 2 - center) < 28;
      });
      if ((!crowded || selectedGroup) && kept.length < budget) {
        kept.push(group);
      }
    }
    return visible.filter((group) => kept.includes(group));
  }
  if (visible.length <= budget) {
    return visible;
  }
  const selected = visible.filter(isSelected);
  const selectedStep = Math.max(1, Math.ceil(selected.length / budget));
  const selectedVisible = new Set(
    selected.filter((_, index) => index % selectedStep === 0).slice(0, budget),
  );
  const remaining = Math.max(0, budget - selectedVisible.size);
  if (remaining === 0) {
    return visible.filter((group) => selectedVisible.has(group));
  }
  const unselected = visible.filter((group) => !selectedVisible.has(group));
  const step = Math.max(1, Math.ceil(unselected.length / remaining));
  let unselectedIndex = 0;
  return visible.filter((group) => {
    if (selectedVisible.has(group)) {
      return true;
    }
    const include = unselectedIndex % step === 0;
    unselectedIndex++;
    return include;
  });
}

test("interval queries reuse the caller-owned result buffer", () => {
  const index = new IntervalIndex(
    [
      { start: 0, end: 1 },
      { start: 4, end: 5 },
      { start: 8, end: 9 },
    ],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  const entries = [];
  const first = index.queryInto(0, 5, entries);
  assert.equal(first, entries);
  assert.deepEqual(
    first.map((entry) => entry.index),
    [0, 1],
  );
  const second = index.queryInto(8, 9, entries);
  assert.equal(second, entries);
  assert.deepEqual(
    second.map((entry) => entry.index),
    [2],
  );
});

test("interval insertion keeps source-order ties without rebuilding", () => {
  const first = { start: 2, end: 3, name: "first" };
  const second = { start: 2, end: 4, name: "second" };
  const index = new IntervalIndex(
    [first, second],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  const inserted = { start: 2, end: 5, name: "inserted" };
  assert.equal(index.replaceItems([first, inserted, second]), "incremental");
  assert.equal(index.rebuildCount, 1);
  assert.deepEqual(
    index.query(2, 2).map((entry) => entry.item.name),
    ["first", "inserted", "second"],
  );
});

test("interval deletion shifts source indexes without changing query order", () => {
  const first = { start: 0, end: 1 };
  const removed = { start: 2, end: 3 };
  const last = { start: 4, end: 5 };
  const index = new IntervalIndex(
    [first, removed, last],
    (entry) => entry.start,
    (entry) => entry.end,
  );
  assert.equal(index.replaceItems([first, last]), "incremental");
  assert.equal(index.rebuildCount, 1);
  assert.deepEqual(
    index.query(0, 5).map((entry) => entry.index),
    [0, 1],
  );
});

test("timeline note queries reuse visible-entry storage while playback moves", () => {
  const cache = new TimelineCache();
  const notes = [createNote(1, 0, 0), createNote(1, 4, 0)];
  cache.refreshNotes(0, notes);
  const first = cache.visibleNotes(0, -1, 2);
  const second = cache.visibleNotes(0, 3, 5);
  assert.equal(second, first);
  assert.deepEqual(
    second.map((entry) => entry.index),
    [1],
  );
});

test("timeline paint ordering keeps Holds below heads for out-of-order queries", () => {
  const cache = new TimelineCache();
  const notes = [
    createNote(1, 10, 0),
    createNote(2, 0, 0, 2),
    createNote(1, 5, 0),
    createNote(2, 4, 0, 6),
  ];
  cache.refreshNotes(0, notes);
  assert.deepEqual(
    cache.paintOrderedNotes(0, -1, 12).map((entry) => entry.index),
    [1, 3, 0, 2],
  );
  const orderedCache = new TimelineCache();
  const orderedNotes = [
    createNote(2, 0, 0, 2),
    createNote(1, 1, 0),
    createNote(2, 2, 0, 4),
    createNote(1, 3, 0),
  ];
  orderedCache.refreshNotes(0, orderedNotes);
  assert.deepEqual(
    orderedCache.paintOrderedNotes(0, -1, 6).map((entry) => entry.index),
    [0, 2, 1, 3],
  );
});

test("timeline note seconds are prepared once per tempo and render configuration", () => {
  const cache = new TimelineCache();
  const notes = [createNote(2, 1, 0, 3), createNote(1, 4, 2, 2)];
  const tempo = new TempoMap([{ bpm: 120, startTime: [0, 0, 1] }]);
  const prepared = cache.noteRenderDataSet(notes, tempo, 1, 16);
  assert.equal(prepared, cache.noteRenderDataSet(notes, tempo, 1, 16));
  const first = cache.noteRenderData(notes, tempo, 1, 16, 0);
  const second = cache.noteRenderData(notes, tempo, 1, 16, 0);
  assert.equal(second, first);
  assert.deepEqual(prepared[0], first);
  assert.deepEqual(prepared[1], cache.noteRenderData(notes, tempo, 1, 16, 1));
  assert.equal(first.start, 1);
  assert.equal(first.end, 3);
  assert.equal(first.startSeconds, 0.5);
  assert.equal(first.endSeconds, 1.5);
  assert.equal(first.invalid, false);
});

test("timeline event queries reuse entry storage while playback moves", () => {
  const cache = new TimelineCache();
  const chart = createChart();
  const events = [createEvent(0, 1, 0, 4), createEvent(1, 2, 8, 12)];
  const first = cache.eventEntries(chart, events, -1, 6, 16);
  const second = cache.eventEntries(chart, events, 5, 14, 16);
  assert.equal(second, first);
  assert.deepEqual(
    second.map((entry) => entry.index),
    [1],
  );
  assert.equal(second[0].start, 8);
  assert.equal(second[0].end, 12);
});

test("timeline event rectangles reuse hit-test objects across frames", () => {
  const gestures = new TimelineGestures({}, () => ({}));
  gestures.beginEventRectFrame();
  const first = gestures.recordEventRect(10, 20, 30, 40, 2, "moveXEvents");
  gestures.finishEventRectFrame();

  gestures.beginEventRectFrame();
  const second = gestures.recordEventRect(12, 24, 30, 40, 2, "moveXEvents");
  gestures.finishEventRectFrame();

  assert.strictEqual(second, first);
  assert.deepEqual(second, {
    x: 12,
    y: 24,
    width: 30,
    height: 40,
    index: 2,
    type: "moveXEvents",
    lineIndex: undefined,
  });
});

test("timeline event projection reuses frame origin and scale", () => {
  let tempoCalls = 0;
  const tempo = { seconds: (beat) => (tempoCalls++, beat * 0.5) };
  const receiver = {
    cache: { tempoSeconds: (_tempo, beat) => tempo.seconds(beat) },
    viewport: {
      tempo,
      origin: 4,
      judgementOffset: 56,
      scale: 500,
      scaleForArea: () => 600,
    },
  };
  const projector = createVerticalAtBeat(receiver, 1, 720);
  const originAndScaleCalls = tempoCalls;
  const projected = [projector(1), projector(2), projector(3)];
  const direct = [1, 2, 3].map((beat) => verticalAtBeat(receiver, beat, 1, 720));

  assert.deepEqual(projected, direct);
  assert.equal(originAndScaleCalls, 1);
});

test("timeline event curves batch their canvas stroke and clip work", () => {
  const event = { start: 0, end: 1 };
  const range = { min: 0, max: 1, entries: [] };
  const entries = [
    { event, range, startY: 120, endY: 40 },
    { event, range, startY: 260, endY: 180 },
  ];
  const context = () => ({
    saves: 0,
    strokes: 0,
    save() {
      this.saves++;
    },
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      this.strokes++;
    },
  });
  const individual = context();
  for (const entry of entries) {
    drawEventCurve(
      individual,
      entry.event,
      entry.range,
      { x: 10, y: entry.endY, width: 80, height: entry.startY - entry.endY },
      entry.startY,
      entry.endY,
    );
  }
  const batched = context();
  drawEventCurveBatch(batched, entries, { x: 10, y: 0, width: 80, height: 300 });

  assert.equal(individual.strokes, 2);
  assert.equal(individual.saves, 2);
  assert.equal(batched.strokes, 1);
  assert.equal(batched.saves, 1);
});

test("batched event curves keep the individual path geometry", () => {
  const event = { start: 0, end: 1 };
  const range = { min: 0, max: 1, entries: [] };
  const entries = [
    { event, range, startY: 120, endY: 40 },
    { event, range, startY: 260, endY: 180 },
  ];
  const context = () => ({
    path: [],
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo(x, y) {
      this.path.push(["M", x, y]);
    },
    lineTo(x, y) {
      this.path.push(["L", x, y]);
    },
    stroke() {},
  });
  const individual = context();
  for (const entry of entries) {
    drawEventCurve(
      individual,
      entry.event,
      entry.range,
      { x: 10, y: 0, width: 80, height: 300 },
      entry.startY,
      entry.endY,
    );
  }
  const batched = context();
  drawEventCurveBatch(batched, entries, { x: 10, y: 0, width: 80, height: 300 });

  assert.deepEqual(batched.path, individual.path);
});

test("single shader selection filters match the old one-item batch path", () => {
  const rectangle = { x: 10, y: 20, width: 30, height: 40 };
  const palette = { remoteEventSelectionHighlight: "#ffcc66" };
  const context = () => ({
    fills: [],
    fillStyle: "#000000",
    globalAlpha: 1,
    save() {},
    restore() {},
    fillRect(...args) {
      this.fills.push({ style: this.fillStyle, alpha: this.globalAlpha, args });
    },
  });

  const oldLocal = context();
  drawEventSelectionFilters(oldLocal, [rectangle]);
  const newLocal = context();
  drawEventSelectionFilter(newLocal, rectangle, "#00C800");
  assert.deepEqual(newLocal.fills, oldLocal.fills);

  const oldRemote = context();
  drawRemoteEventSelectionFilters(oldRemote, [rectangle], palette);
  const newRemote = context();
  drawRemoteEventSelectionFilter(newRemote, rectangle, palette);
  assert.deepEqual(newRemote.fills, oldRemote.fills);
});

test("overlap filter matches save/restore output without leaking fill style", () => {
  const rectangle = { x: 10, y: 20, width: 30, height: 40 };
  const palette = { overlayInvalidFill: "#ff000080" };
  const context = () => ({
    fills: [],
    saves: 0,
    fillStyle: "#base",
    savedFillStyles: [],
    save() {
      this.saves++;
      this.savedFillStyles.push(this.fillStyle);
    },
    restore() {
      this.fillStyle = this.savedFillStyles.pop();
    },
    fillRect(...args) {
      this.fills.push({ style: this.fillStyle, args });
    },
  });

  const old = context();
  old.save();
  old.fillStyle = palette.overlayInvalidFill;
  old.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  old.restore();

  const optimized = context();
  drawEventOverlapFilter(optimized, rectangle, palette);

  assert.deepEqual(optimized.fills, old.fills);
  assert.equal(optimized.fillStyle, old.fillStyle);
  assert.equal(optimized.saves, 0);
});

test("cached beat-line color patterns match the unoptimized reference", () => {
  for (const division of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 127, 128]) {
    const expected = referenceBeatLineColorKeys(division);
    assert.deepEqual(beatLineColorKeys(division), expected);
    for (const tick of [-division - 1, -1, 0, 1, division, division + 1]) {
      const expectedKey =
        expected[((Math.trunc(tick) % expected.length) + expected.length) % expected.length];
      assert.equal(beatLineColorKeyAt(tick, division), expectedKey);
    }
  }
});

test("grid color slot lookup matches the old per-tick fallback map", () => {
  const palette = {
    gridMajor: "major",
    gridMinor: "minor",
    gridSubdivisions: ["two", "three", "four", "six", "eight", "twelve", "sixteen"],
  };
  const fallbackColors = [palette.gridMajor, ...palette.gridSubdivisions, palette.gridMinor];
  for (const subdivisionColors of [[], ["custom-major"], [undefined, "custom-half", undefined]]) {
    for (const division of [1, 2, 4, 5, 8, 12, 16, 24, 127]) {
      for (const tick of [-division - 1, -1, 0, 1, division, division + 1]) {
        assert.equal(
          gridStrokeColor(
            palette,
            tick,
            division,
            subdivisionColors,
            fallbackColors,
            beatLineColorKeys(division),
          ),
          referenceGridStrokeColor(palette, tick, division, subdivisionColors),
        );
      }
    }
  }
});

test("visible grid ticks keep the old sorted and deduplicated sequence", () => {
  for (const [first, last, stride, highlightedTick] of [
    [0, 32, 1, null],
    [0, 32, 4, 6],
    [0, 32, 4, 8],
    [3, 47, 7, 16],
    [10, 10, 3, 10],
    [12, 8, 2, 10],
    [-4, 12, 3, -1],
  ]) {
    assert.deepEqual(
      visibleGridTicks(first, last, stride, highlightedTick),
      referenceVisibleGridTicks(first, last, stride, highlightedTick),
    );
  }
});

test("multi-line chrome keys reuse stable layout inputs and invalidate on replacement", () => {
  let typeCalls = 0;
  const receiver = {
    gestures: { extended: false },
    viewport: {
      eventTypesForLine: () => {
        typeCalls += 1;
        return ["moveXEvents", "moveYEvents"];
      },
      panelWidth: () => 800,
      multiLineViewportOffset: () => 0,
    },
    appearance: { verticalGridColor: "#123456" },
  };
  const palette = { headerSurface: "#111", foreground: "#fff", outline: "#333" };
  const chart = {};
  const targetLineIndices = [0, 1, 2];
  const session = { chart, targetLineIndices };
  const first = multiLineChromeKey(receiver, session, 1600, 900, palette);
  const second = multiLineChromeKey(receiver, session, 1600, 900, palette);

  assert.strictEqual(second, first);
  assert.equal(typeCalls, targetLineIndices.length);

  const replacement = multiLineChromeKey(
    receiver,
    { chart, targetLineIndices: [...targetLineIndices] },
    1600,
    900,
    palette,
  );
  assert.equal(replacement, first);
  assert.equal(typeCalls, targetLineIndices.length * 2);
});

test("event beat range hoisting matches the old per-channel range", () => {
  const eventTypes = ["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents"];
  const calls = [];
  const viewport = {
    eventBeatAt(vertical, type) {
      calls.push([vertical, type]);
      return vertical === 0 ? 80 : -20;
    },
  };
  const oldRanges = eventTypes.map((type) => [
    viewport.eventBeatAt(100, type),
    viewport.eventBeatAt(0, type),
  ]);
  calls.length = 0;
  const actual = eventBeatRangeForTypes(viewport, 100, eventTypes);

  assert.deepEqual(actual, oldRanges[0]);
  assert.ok(oldRanges.every((range) => range[0] === actual[0] && range[1] === actual[1]));
  assert.equal(calls.length, 2);
});

test("timeline event labels deduplicate entries and cache group geometry", () => {
  const groups = Array.from({ length: 5 }, (_, index) => ({
    entries: [],
    min: index,
    max: index + 1,
  }));
  const ranges = new Map(groups.map((group, index) => [index, group]));
  const entries = [{ index: 0 }, { index: 1 }, { index: 1 }, { index: 2 }, { index: 3 }];
  const selected = new Set([groups[1], groups[3]]);
  const isSelected = (group) => selected.has(group);
  const bounds = new Map(
    groups.map((group, index) => [group, { top: index * 32, bottom: index * 32 + 8 }]),
  );
  let boundsCalls = 0;
  const boundsFor = (group) => {
    boundsCalls++;
    return bounds.get(group);
  };

  const expected = labelGroups(
    entries.map((entry) => ranges.get(entry.index)),
    80,
    isSelected,
    boundsFor,
  );
  boundsCalls = 0;
  const actual = labelGroupsFromEntries(entries, ranges, 80, isSelected, boundsFor);

  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(boundsCalls, 4);
});

test("optimized event label selection matches the unoptimized reference", () => {
  const groups = Array.from({ length: 12 }, (_, index) => ({
    entries: [],
    min: index,
    max: index + 1,
  }));
  const ranges = new Map(groups.map((group, index) => [index, group]));
  const entries = [
    { index: 0 },
    { index: 1 },
    { index: 1 },
    { index: 2 },
    { index: 4 },
    { index: 6 },
    { index: 8 },
    { index: 99 },
    { index: 10 },
  ];
  const bounds = new Map(
    groups.map((group, index) => [group, { top: index * 17, bottom: index * 17 + 9 }]),
  );

  for (const [height, selectedIndexes] of [
    [24, []],
    [80, [1, 6]],
    [180, [0, 4, 10]],
  ]) {
    const selected = new Set(selectedIndexes.map((index) => groups[index]));
    const isSelected = (group) => selected.has(group);
    const boundsFor = (group) => bounds.get(group);
    const expected = referenceLabelGroups(
      entries.map((entry) => ranges.get(entry.index)),
      height,
      isSelected,
      boundsFor,
    );
    const actual = labelGroupsFromEntries(entries, ranges, height, isSelected, boundsFor);
    assert.deepEqual(actual, expected);
  }
});

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
