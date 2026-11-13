/**
 * Differential contracts for the renderer's fast paths.
 *
 * The frame budget work replaced allocating helpers with scratch-buffer and
 * cached variants. Each fast path exists only to avoid per-frame allocation, so
 * the contract that matters is that it produces exactly the same output as the
 * straightforward implementation it replaced. These tests keep the fast paths
 * honest without pinning their internal storage strategy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createEvent, createNote } from "../../../core/global/chart/chart.ts";
import { NoiseAreaRuntime } from "../../../core/global/chart/noise/noiseRuntime.ts";
import {
  sampleNoiseLinePreview,
  sampleNoiseLinePreviewInto,
} from "../../../core/global/chart/noise/noiseLinePreview.ts";
import { trajectoryEventValue } from "../../../core/global/chart/trajectory/curveTrajectory.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";
import { eventKey } from "../../../core/edit/events/eventTracks.ts";
import {
  visibleGridTicks,
  visibleGridTicksInto,
} from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";
import { TimelineLabelCuller } from "../../../frontend/screens/editor/workspace/timeline/drawing/labelCulling.ts";
import { TimelineCache } from "../../../frontend/screens/editor/workspace/timeline/drawing/timelineCache.ts";
import {
  createEventLabelScratch,
  labelGroupsFromEntries,
} from "../../../frontend/screens/editor/workspace/timeline/events/eventLabelLayout.ts";
import { drawNote } from "../../../frontend/screens/editor/workspace/timeline/notes/noteDrawing.ts";
import { selectedEventIndexesForType } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";
import { trajectoryPlotSamplesFor } from "../../../frontend/screens/editor/workspace/timeline/events/eventOverlayDrawing.ts";
import {
  noiseMaskBitsForEntry,
  noiseThemeEntryBelongsToPass,
  partitionNoiseMaskEntries,
} from "../../../frontend/screens/editor/workspace/preview/render/noiseGeometry.ts";
import { gridStrokeColor } from "../../../frontend/screens/editor/workspace/timeline/drawing/gridDrawing.ts";
import {
  BEAT_LINE_COLOR_KEYS,
  beatLineColorKeyAt,
  beatLineColorKeys,
} from "../../../frontend/screens/editor/canvas/beatLineColors.ts";
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
import { eventBeatRangeForTypes } from "../../../frontend/screens/editor/workspace/timeline/events/eventDrawing.ts";
import { labelGroups } from "../../../frontend/screens/editor/workspace/timeline/events/eventLabelLayout.ts";

test("the grid tick fast path keeps the allocating sequence", () => {
  const target = [999];
  const expected = visibleGridTicks(0, 40, 5, 17);
  const result = visibleGridTicksInto(0, 40, 5, 17, target);

  assert.deepEqual(result, expected);
  visibleGridTicksInto(3, 29, 4, null, target);
  assert.deepEqual(target, visibleGridTicks(3, 29, 4, null));
});

/** Reference label selection used by the fast-path comparison. */
function referenceLabelGroups(groups, height, isSelected, boundsFor) {
  const visible = Array.from(new Set(groups)).filter((group) => group !== undefined);
  const budget = Math.max(1, Math.floor(Math.max(0, height - 23) / 28));
  const selected = visible.filter(isSelected);
  const ordered = [...visible].sort((left, right) => {
    const selectedOrder = (isSelected(left) ? 0 : 1) - (isSelected(right) ? 0 : 1);
    if (selectedOrder !== 0) {
      return selectedOrder;
    }
    const leftBounds = boundsFor(left);
    const rightBounds = boundsFor(right);
    return (leftBounds.top + leftBounds.bottom) / 2 - (rightBounds.top + rightBounds.bottom) / 2;
  });
  const kept = [];
  for (const group of ordered) {
    const bounds = boundsFor(group);
    const center = (bounds.top + bounds.bottom) / 2;
    const crowded = kept.some((candidate) => {
      const candidateBounds = boundsFor(candidate);
      return Math.abs((candidateBounds.top + candidateBounds.bottom) / 2 - center) < 28;
    });
    if ((!crowded || selected.includes(group)) && kept.length < budget) {
      kept.push(group);
    }
  }
  return visible.filter((group) => kept.includes(group));
}

test("event-label selection matches the reference across ordered and unordered groups", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const scratch = createEventLabelScratch();
  for (let iteration = 0; iteration < 120; iteration++) {
    const count = 1 + Math.floor(random() * 96);
    const groups = Array.from({ length: count }, (_, index) => ({
      entries: [{ index }],
      min: index,
      max: index + 1,
      center: Math.floor(random() * 240),
    }));
    const order = Array.from({ length: count * 2 }, (_, index) => ({
      index: index % count,
    }));
    if (iteration % 3 === 1) {
      order.reverse();
    } else if (iteration % 3 === 2) {
      order.sort((left, right) => (left.index % 7) - (right.index % 7));
    }
    const ranges = new Map(groups.map((group, index) => [index, group]));
    const selected = new Set(groups.filter(() => random() < 0.2));
    const isSelected = (group) => selected.has(group);
    const boundsFor = (group) => ({ top: group.center, bottom: group.center + 8 });
    for (const height of [0, 24, 80, 180, 720]) {
      const expected = referenceLabelGroups(
        order.map((entry) => ranges.get(entry.index)),
        height,
        isSelected,
        boundsFor,
      );
      const actual = labelGroupsFromEntries(order, ranges, height, isSelected, boundsFor, scratch);
      assert.deepEqual(actual, expected, `iteration=${iteration}, height=${height}`);
    }
  }
});

test("label culling starts every pass without the previous frame's hits", () => {
  const culler = new TimelineLabelCuller();
  assert.equal(culler.tryPlace({ x: 10, y: 10 }), true);
  assert.equal(culler.tryPlace({ x: 12, y: 12 }), false);
  culler.clear();
  assert.equal(culler.tryPlace({ x: 12, y: 12 }), true);
  assert.equal(culler.tryPlace({ x: 14, y: 14 }), false);
});

/** Create a deterministic trajectory event for render-path comparisons. */
function createTrajectoryEvent() {
  const event = createEvent(0, 0, 0, 4);
  event.trajectory = {
    version: 1,
    segments: 8,
    options: {
      mode: "parametric",
      xExpression: "200 * cos(2 * pi * t)",
      yExpression: "120 * sin(2 * pi * t)",
      parameterStart: "0",
      parameterEnd: "1",
    },
  };
  return event;
}

test("cached trajectory samples match the per-frame evaluator", () => {
  const event = createTrajectoryEvent();
  for (const axis of ["x", "y"]) {
    const expected = Array.from({ length: 65 }, (_, index) =>
      trajectoryEventValue(event, index / 64, axis),
    );
    const actual = trajectoryPlotSamplesFor(event, axis);

    assert.deepEqual([...actual.values], expected);
    assert.equal(actual.minimum, Math.min(...expected));
    assert.equal(actual.maximum, Math.max(...expected));
  }
});

test("decoded event selection indexes match canonical event-key membership", () => {
  const selection = new Set([
    eventKey("moveXEvents", 0),
    eventKey("moveXEvents", 12),
    eventKey("moveYEvents", 3),
    "moveXEvents:01",
    "moveXEvents:-1",
    "moveXEvents:12.0",
    "moveXEvents:other",
  ]);
  const actual = selectedEventIndexesForType(selection, "moveXEvents");
  const expected = [0, 12].filter((index) => selection.has(eventKey("moveXEvents", index)));

  assert.deepEqual(
    [...actual].sort((left, right) => left - right),
    expected,
  );
  assert.deepEqual([...selectedEventIndexesForType(selection, "moveYEvents")], [3]);
  assert.equal(selectedEventIndexesForType(new Set(), "moveXEvents").size, 0);
});

test("note drawing keeps the palette colours for every note type", () => {
  const palette = {
    noteTap: "tap",
    noteHold: "hold",
    noteFlick: "flick",
    noteDrag: "drag",
    noteFallback: "fallback",
    selectionHighlightStroke: "selected",
    remoteSelectionHighlight: "remote",
  };
  const receiver = {
    appearance: { noteOpacity: 1, skin: undefined },
    cache: { palette: () => palette },
    noteBatch: { addHead: () => true },
    noteSolidBatch: { addHead() {} },
  };
  const draw = (type) => {
    const context = { globalAlpha: 1, fillStyle: "" };
    drawNote.call(receiver, context, {
      palette,
      note: createNote(type, 0, 0),
      horizontal: 10,
      vertical: 20,
      endVertical: 20,
      noteWidth: 40,
      height: 100,
    });
    return context.fillStyle;
  };

  assert.equal(draw(1), "tap");
  assert.equal(draw(3), "flick");
  assert.equal(draw(4), "drag");
});

test("timeline render layers repaint only when their key changes", () => {
  const previousDocument = globalThis.document;
  const contexts = [];
  globalThis.document = {
    createElement(type) {
      assert.equal(type, "canvas");
      const context = { setTransform() {}, clearRect() {} };
      contexts.push(context);
      return {
        width: 0,
        height: 0,
        getContext() {
          return context;
        },
      };
    },
  };
  try {
    const cache = new TimelineCache();
    const owner = {};
    const first = cache.canvasLayer(owner, "stable", 320, 180, "lanes");
    const second = cache.canvasLayer(owner, "stable", 320, 180, "lanes");
    const otherSlot = cache.canvasLayer(owner, "stable", 320, 180, "labels");
    const changed = cache.canvasLayer(owner, "changed", 320, 180, "lanes");

    assert.equal(first.repaint, true);
    assert.equal(second.repaint, false);
    assert.equal(otherSlot.repaint, true);
    assert.equal(changed.repaint, true);
    assert.equal(contexts.length, 2);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});

test("noise mask bit partition matches the six render passes", () => {
  const entries = [
    { state: "active", invert: false },
    { state: "active", invert: true },
    { state: "disabled", invert: false },
    { state: "disabled", invert: true },
    { state: "ready", invert: false },
    { state: "ready", invert: true },
    { state: "hidden", invert: false },
  ];
  const actual = Array.from({ length: 6 }, () => []);
  entries.forEach((entry, index) => {
    const bits = noiseMaskBitsForEntry(entry);
    for (let bit = 0; bit < 6; bit++) {
      if (bits & (1 << bit)) {
        actual[bit].push(index);
      }
    }
  });
  assert.deepEqual(actual, [[0], [1], [2, 4], [3, 5], [4], [5]]);
});

test("stable noise theme passes keep the inactive-then-active order", () => {
  const entries = ["active", "hidden", "ready", "disabled", "active", "ready"];
  const expected = [2, 3, 5, 0, 4];
  const actual = [false, true].flatMap((active) =>
    entries.flatMap((state, index) => (noiseThemeEntryBelongsToPass(state, active) ? [index] : [])),
  );
  assert.deepEqual(actual, expected);
});

const NOISE_BEAT = (value) => [value, 0, 1];
const NOISE_AREA = {
  bottomLeft: { x: -0.5, y: -0.25 },
  topRight: { x: 0.5, y: 0.25 },
  appearTime: NOISE_BEAT(0),
  disappearTime: NOISE_BEAT(10),
  activeIntervals: [{ startTime: NOISE_BEAT(2), endTime: NOISE_BEAT(4), readyFlash: 0.5 }],
  isInvert: true,
  moveXEvents: [],
  moveYEvents: [],
  rotateEvents: [],
  scaleXEvents: [],
  scaleYEvents: [],
};

test("noise area sampling matches the allocating sampler", () => {
  const tempo = new TempoMap([{ bpm: 120, startTime: NOISE_BEAT(0) }]);
  const runtime = new NoiseAreaRuntime(NOISE_AREA, tempo);
  const fresh = runtime.sample(2.5);
  const reusable = runtime.sampleInto(2.5);
  assert.deepEqual(reusable, fresh);

  const state = { x: 100, y: 50, rotation: 15, scaleX: 1, scaleY: 1 };
  const reference = sampleNoiseLinePreview(NOISE_AREA, fresh, state, 40, 20, 1.2);
  const optimized = sampleNoiseLinePreviewInto(NOISE_AREA, reusable, state, 40, 20, 1.2, reusable);
  assert.deepEqual(optimized, reference);
});

test("noise area fallback partition keeps the draw order", () => {
  const entries = [
    { state: "active" },
    { state: "hidden" },
    { state: "ready" },
    { state: "active" },
    { state: "disabled" },
  ];
  const groups = [[], []];
  partitionNoiseMaskEntries(entries, groups);
  assert.deepEqual(
    groups.map((group) => group.map((entry) => entry.state)),
    [
      ["hidden", "ready", "disabled"],
      ["active", "active"],
    ],
  );
});

/** Reference tick sequence: every stride step plus the highlighted tick, sorted. */
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

test("visible grid ticks keep the sorted, deduplicated reference sequence", () => {
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

/** Reference beat-line role pattern built by the denominator overlay rule. */
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

/** Reference grid stroke colour resolved through the fallback map. */
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

test("cached beat-line colour patterns match the reference", () => {
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

test("grid colour slot lookup matches the per-tick fallback map", () => {
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

test("single shader selection filters match the one-item batch path", () => {
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

test("overlap filter matches an explicit save/restore without leaking fill style", () => {
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

test("event beat range hoisting matches the per-channel range", () => {
  const eventTypes = ["moveXEvents", "moveYEvents", "rotateEvents", "alphaEvents"];
  const viewport = {
    eventBeatAt(vertical, type) {
      return { vertical, type };
    },
  };
  const expected = [
    viewport.eventBeatAt(100, "moveXEvents"),
    viewport.eventBeatAt(0, "moveXEvents"),
  ];
  const actual = eventBeatRangeForTypes(viewport, 100, eventTypes);

  assert.deepEqual(actual, expected);
});

test("event label groups deduplicate their source entries", () => {
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
  const boundsFor = (group) => bounds.get(group);

  const expected = labelGroups(
    entries.map((entry) => ranges.get(entry.index)),
    80,
    isSelected,
    boundsFor,
  );
  const actual = labelGroupsFromEntries(entries, ranges, 80, isSelected, boundsFor);

  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
});
