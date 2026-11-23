/** Resolves parent transforms that can be projected into noise-area tracks. */
import {
  inheritsParentRotation,
  type Chart,
  type JudgeLine,
  type JudgeLineEvent,
} from "../chart.ts";
import { SceneRuntime } from "../runtime/scene.ts";
import { EventTrack } from "../timing/events.ts";
import type { TempoMap } from "../timing/tempo.ts";
import type { Beat } from "../timing/beat.ts";
import { noiseParentIndex } from "./noiseParent.ts";

/** A parent transform split into static pose, rotation tracks and weighted translations. */
export interface StaticParentTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly rotations: readonly JudgeLineEvent[][];
  readonly translations: readonly {
    readonly events: JudgeLineEvent[];
    readonly xWeight: number;
    readonly yWeight: number;
  }[];
}

/** Resolve static rotations and separable ancestor translations, or null for a root line. */
export function staticNoiseParent(
  chart: Chart,
  line: JudgeLine,
  tempo: TempoMap,
): StaticParentTransform | null {
  const parent = noiseParentIndex(line.father);
  if (parent === -1) {
    return null;
  }
  const lines = chart.judgeLineList ?? [];
  const visited = new Set<number>();
  const ancestors: number[] = [];
  const animatedRotations: JudgeLineEvent[][] = [];
  let index = parent;
  while (index !== -1) {
    if (!Number.isInteger(index) || index < 0 || index >= lines.length || visited.has(index)) {
      throw new Error("noise line has an invalid parent chain");
    }
    visited.add(index);
    ancestors.push(index);
    const ancestor = lines[index];
    // Parent anchors only offset the parent's hidden texture; child transforms
    // compose the parent's origin, rotation and translation, which is what the
    // area tracks preserve.
    for (const layer of (ancestor.eventLayers ?? []).slice(0, 5)) {
      if (!layer) {
        continue;
      }
      if (
        [layer.moveXEvents, layer.moveYEvents, layer.rotateEvents].some((events) =>
          events?.some((event) => event.trajectory),
        )
      ) {
        throw new Error("animated noise parent");
      }
      const events = layer.rotateEvents ?? [];
      const value = events[0]?.start;
      if (
        events.some(
          (event) =>
            typeof event.start !== "number" ||
            !Number.isFinite(event.start) ||
            event.start !== value ||
            event.end !== value,
        )
      ) {
        if (
          events.some(
            (event) =>
              typeof event.start !== "number" ||
              typeof event.end !== "number" ||
              !Number.isFinite(event.start) ||
              !Number.isFinite(event.end) ||
              event.trajectory ||
              "transformStart" in event ||
              "transformEnd" in event ||
              "anchor" in event ||
              "transformStep" in event,
          )
        ) {
          throw new Error("animated noise parent requires transform composition");
        }
        animatedRotations.push(events);
      }
    }
    index = noiseParentIndex(ancestor.father);
  }
  const inheritsRotation = inheritsParentRotation(line);
  if (
    animatedRotations.length &&
    (ancestors.length !== 1 ||
      (line.eventLayers ?? [])
        .slice(0, 5)
        .some((layer) =>
          ["moveXEvents", "moveYEvents"].some((type) =>
            (layer?.[type as "moveXEvents" | "moveYEvents"] ?? []).some(
              (event) => event.start !== 0 || event.end !== 0 || event.trajectory,
            ),
          ),
        ))
  ) {
    throw new Error("animated noise parent requires transform composition");
  }
  const scene = new SceneRuntime();
  scene.compile(chart, tempo);
  const states = scene.sample(0);
  const state = states[parent];
  // Rotation inheritance subtracts each animated ancestor rotation from the pose.
  let rotation = state.rotation;
  const rotations = inheritsRotation ? animatedRotations : [];
  for (const events of rotations) {
    rotation -= Number(new EventTrack(events, tempo).value(0));
  }
  let x = state.x;
  let y = state.y;
  const translations: StaticParentTransform["translations"][number][] = [];
  for (const ancestorIndex of ancestors) {
    const ancestor = lines[ancestorIndex];
    const ancestorFather = noiseParentIndex(ancestor.father);
    const angle = ancestorFather === -1 ? 0 : (-states[ancestorFather].rotation * Math.PI) / 180;
    const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.cos(angle);
    const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.sin(angle);
    for (const layer of (ancestor.eventLayers ?? []).slice(0, 5)) {
      if (!layer) {
        continue;
      }
      for (const [type, xWeight, yWeight] of [
        ["moveXEvents", cosine, sine],
        ["moveYEvents", -sine, cosine],
      ] as const) {
        const events = layer[type] ?? [];
        if (!events.length) {
          continue;
        }
        const value = events[0].start;
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          events.every((event) => event.start === value && event.end === value)
        ) {
          continue;
        }
        if (
          events.some(
            (event) =>
              typeof event.start !== "number" ||
              typeof event.end !== "number" ||
              !Number.isFinite(event.start) ||
              !Number.isFinite(event.end) ||
              event.trajectory ||
              "transformStart" in event ||
              "transformEnd" in event ||
              "anchor" in event ||
              "transformStep" in event,
          )
        ) {
          throw new Error("animated noise parent requires transform composition");
        }
        const initial = Number(new EventTrack(events, tempo).value(0));
        x -= initial * xWeight;
        y -= initial * yWeight;
        translations.push({ events, xWeight, yWeight });
      }
    }
  }
  return { x, y, rotation, rotations, translations };
}

/** Apply a signed axis and offset without changing its timing or easing. */
export function offsetNoiseTrack(
  events: readonly JudgeLineEvent[],
  sign: number,
  offset: number,
  start: Beat,
): JudgeLineEvent[] {
  if (!events.length) {
    return [{ startTime: [...start], endTime: [...start], start: offset, end: offset }];
  }
  return events.map((event) => {
    if (typeof event.start !== "number" || typeof event.end !== "number") {
      throw new Error("non-numeric noise transform");
    }
    return { ...event, start: event.start * sign + offset, end: event.end * sign + offset };
  });
}
