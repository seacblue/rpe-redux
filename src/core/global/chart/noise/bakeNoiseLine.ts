/** Bakes world-space noise-line motion into standard area event tracks. */
import type { Chart, JudgeLine, JudgeLineEvent } from "../chart.ts";
import { SceneRuntime } from "../runtime/scene.ts";
import { fromNumber, type Beat } from "../timing/beat.ts";
import type { TempoMap } from "../timing/tempo.ts";
import type { BlockArea } from "./blockArea.ts";
import { noiseLineSizeAt } from "./noiseLineSize.ts";
import { noiseParentIndex } from "./noiseParent.ts";

const MAX_SECONDS_PER_SEGMENT = 0.125;
const MAX_SEGMENTS = 100000;
const POSITION_TOLERANCE = 0.02;
const ROTATION_TOLERANCE = 0.002;

type Position = readonly [number, number, number, number, number];
const TOLERANCES = [
  POSITION_TOLERANCE,
  POSITION_TOLERANCE,
  ROTATION_TOLERANCE,
  0.00002,
  0.00002,
] as const;
/** A baked sample: its beat, resolved seconds and five transform values. */
interface Point {
  beat: Beat;
  seconds: number;
  value: Position;
}

/** Sample a noise line's world transform into portable linear area events. */
export function bakeNoiseLine(
  chart: Chart,
  index: number,
  tempo: TempoMap,
  template: BlockArea,
): BlockArea {
  const lines = chart.judgeLineList ?? [];
  const visited = new Set<number>();
  const startSeconds = tempo.seconds(template.appearTime);
  const endSeconds = tempo.seconds(template.disappearTime);
  const boundaries = new Set<number>([startSeconds]);
  let current = index;
  while (current !== -1) {
    if (
      !Number.isInteger(current) ||
      current < 0 ||
      current >= lines.length ||
      visited.has(current)
    ) {
      throw new Error("noise line has an invalid parent chain");
    }
    visited.add(current);
    const line: JudgeLine = lines[current];
    for (const layer of (line.eventLayers ?? []).slice(0, 5)) {
      if (!layer) {
        continue;
      }
      for (const events of [layer.moveXEvents, layer.moveYEvents, layer.rotateEvents]) {
        for (const event of events ?? []) {
          for (const beat of [event.startTime, event.endTime]) {
            const seconds = tempo.seconds(beat);
            if (seconds > startSeconds && seconds < endSeconds) {
              boundaries.add(seconds);
            }
          }
        }
      }
    }
    if (current === index) {
      for (const events of [line.extended?.scaleXEvents, line.extended?.scaleYEvents]) {
        for (const event of events ?? []) {
          for (const beat of [event.startTime, event.endTime]) {
            const seconds = tempo.seconds(beat);
            if (seconds > startSeconds && seconds < endSeconds) {
              boundaries.add(seconds);
            }
          }
        }
      }
    }
    current = noiseParentIndex(line.father);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  // Sample the scene at one time, returning the beat that time maps back to.
  const point = (seconds: number, bias = 0): Point => {
    const beat = fromNumber(tempo.beat(seconds), 10000000);
    const actual = tempo.seconds(beat);
    const state = scene.sample(seconds + bias)[index];
    const runtime = scene.lines[index];
    const value = [
      state.x,
      state.y,
      state.rotation,
      // A noise line's scale tracks are its size tracks. Before the first size
      // event the area is hidden, matching the direct projection's zero span.
      noiseLineSizeAt(runtime.extended.scaleXEvents, state.scaleX, seconds),
      noiseLineSizeAt(runtime.extended.scaleYEvents, state.scaleY, seconds),
    ] as const;
    if (!value.every(Number.isFinite)) {
      throw new Error("noise motion produced a non-finite value");
    }
    return { beat, seconds: actual, value };
  };
  const tracks: [
    JudgeLineEvent[],
    JudgeLineEvent[],
    JudgeLineEvent[],
    JudgeLineEvent[],
    JudgeLineEvent[],
  ] = [[], [], [], [], []];
  // Write one linear segment across all five transform tracks.
  const append = (a: Point, b: Point): void => {
    if (b.seconds <= a.seconds) {
      throw new Error("noise export time resolution exceeded");
    }
    if (tracks[0].length >= MAX_SEGMENTS) {
      throw new Error("noise export requires too many events");
    }
    for (let axis = 0; axis < 5; axis++) {
      tracks[axis].push({
        startTime: [...a.beat],
        endTime: [...b.beat],
        start: a.value[axis],
        end: b.value[axis],
        easingType: 1,
      });
    }
  };
  // Refine a segment by bisection until it is linear within the per-axis tolerance.
  const split = (a: Point, b: Point, depth: number): void => {
    const span = b.seconds - a.seconds;
    let acceptable = span <= MAX_SECONDS_PER_SEGMENT;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const sample = point(a.seconds + span * fraction);
      const actualFraction = (sample.seconds - a.seconds) / span;
      for (let axis = 0; axis < 5; axis++) {
        const expected = a.value[axis] + (b.value[axis] - a.value[axis]) * actualFraction;
        if (Math.abs(sample.value[axis] - expected) > TOLERANCES[axis]) {
          acceptable = false;
        }
      }
    }
    if (acceptable) {
      append(a, b);
      return;
    }
    if (depth >= 24) {
      throw new Error("noise export tolerance cannot be met");
    }
    const middle = point((a.seconds + b.seconds) / 2);
    if (middle.seconds <= a.seconds || middle.seconds >= b.seconds) {
      throw new Error("noise export time resolution exceeded");
    }
    split(a, middle, depth + 1);
    split(middle, b, depth + 1);
  };
  for (let i = 0; i + 1 < times.length; i++) {
    const epsilon = Math.min(1e-7, (times[i + 1] - times[i]) / 100000);
    split(point(times[i], epsilon), point(times[i + 1], -epsilon), 0);
  }
  // Events can jump at the last boundary; a final fixed event records the
  // right-hand value.
  const tail = point(times[times.length - 1], 1e-7);
  for (let axis = 0; axis < 5; axis++) {
    tracks[axis].push({
      startTime: [...tail.beat],
      endTime: [...tail.beat],
      start: tail.value[axis],
      end: tail.value[axis],
    });
  }
  return {
    ...template,
    moveXEvents: tracks[0],
    moveYEvents: tracks[1],
    rotateEvents: tracks[2],
    scaleXEvents: tracks[3],
    scaleYEvents: tracks[4],
  };
}
