/** Differential contracts for the preview NoiseField CPU grouping fast path. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  noiseMaskBitsForEntry,
  noiseThemeEntryBelongsToPass,
  partitionNoiseMaskEntries,
} from "../../../frontend/screens/editor/workspace/preview/render/noiseGeometry.ts";
import { NoiseAreaRuntime } from "../../../core/global/chart/noise/noiseRuntime.ts";
import {
  sampleNoiseLinePreview,
  sampleNoiseLinePreviewInto,
} from "../../../core/global/chart/noise/noiseLinePreview.ts";
import { TempoMap } from "../../../core/global/chart/timing/tempo.ts";

const beat = (value) => [value, 0, 1];

test("noise mask bit partition matches the old six-pass predicates", () => {
  const entries = [
    { state: "active", invert: false },
    { state: "active", invert: true },
    { state: "disabled", invert: false },
    { state: "disabled", invert: true },
    { state: "ready", invert: false },
    { state: "ready", invert: true },
    { state: "hidden", invert: false },
  ];
  const expected = Array.from({ length: 6 }, (_, bit) =>
    entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (entry.state === "hidden") {
          return false;
        }
        const group = Math.floor(bit / 2);
        const inverted = bit % 2 === 1;
        return (
          entry.invert === inverted &&
          (group === 0
            ? entry.state === "active"
            : group === 1
              ? entry.state !== "active"
              : entry.state === "ready")
        );
      })
      .map(({ index }) => index),
  );
  const actual = Array.from({ length: 6 }, () => []);
  entries.forEach((entry, index) => {
    const bits = noiseMaskBitsForEntry(entry);
    for (let bit = 0; bit < 6; bit++) {
      if (bits & (1 << bit)) {
        actual[bit].push(index);
      }
    }
  });
  assert.deepEqual(actual, expected);
});

test("stable theme passes keep the old inactive-then-active draw order", () => {
  const entries = ["active", "hidden", "ready", "disabled", "active", "ready"];
  const expected = entries
    .map((state, index) => ({ state, index }))
    .filter(({ state }) => state !== "hidden")
    .toSorted((left, right) => Number(left.state === "active") - Number(right.state === "active"))
    .map(({ index }) => index);
  const actual = [false, true].flatMap((active) =>
    entries.flatMap((state, index) => (noiseThemeEntryBelongsToPass(state, active) ? [index] : [])),
  );
  assert.deepEqual(actual, expected);
});

test("noise area fallback partitions entries once without changing draw order", () => {
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
  const reused = groups[0];
  partitionNoiseMaskEntries([{ state: "active" }], groups);
  assert.strictEqual(groups[0], reused);
  assert.deepEqual(
    groups.map((group) => group.map((entry) => entry.state)),
    [[], ["active"]],
  );
});

test("noise area sampling reuses frame storage without changing geometry", () => {
  const area = {
    bottomLeft: { x: -0.5, y: -0.25 },
    topRight: { x: 0.5, y: 0.25 },
    appearTime: beat(0),
    disappearTime: beat(10),
    activeIntervals: [{ startTime: beat(2), endTime: beat(4), readyFlash: 0.5 }],
    isInvert: true,
    moveXEvents: [],
    moveYEvents: [],
    rotateEvents: [],
    scaleXEvents: [],
    scaleYEvents: [],
  };
  const tempo = new TempoMap([{ bpm: 120, startTime: beat(0) }]);
  const runtime = new NoiseAreaRuntime(area, tempo);
  const fresh = runtime.sample(2.5);
  const reusable = runtime.sampleInto(2.5);
  assert.deepEqual(reusable, fresh);
  assert.strictEqual(runtime.sampleInto(2.5), runtime.sampleInto(3));

  const state = { x: 100, y: 50, rotation: 15, scaleX: 1, scaleY: 1 };
  const reference = sampleNoiseLinePreview(area, fresh, state, 40, 20, 1.2);
  const optimized = sampleNoiseLinePreviewInto(area, reusable, state, 40, 20, 1.2, reusable);
  assert.deepEqual(optimized, reference);
});
