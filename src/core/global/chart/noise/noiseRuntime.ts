/**
 * Samples noise-area lifetimes and anchored transforms in chart coordinates.
 * Matrices compose per event track so a sampled frame needs no chart mutation.
 */
import { EventTrack, type TempoSource, type TimedEvent } from "../timing/events.ts";
import {
  blockAreaBounds,
  type BlockArea,
  type BlockAreaBounds,
  type BlockAreaEvent,
  type BlockAreaPoint,
} from "./blockArea.ts";

/** A 2D affine matrix ordered as `[a, b, c, d, tx, ty]`. */
type Matrix = [number, number, number, number, number, number];
/** Reusable result for one transform-track lookup. */
interface TrackSample {
  value: number;
  event?: BlockAreaEvent;
}
/** Transform channels sampled with anchored, relative matrices. */
type TransformTrack = "scaleXEvents" | "scaleYEvents" | "rotateEvents";
/** The identity matrix. */
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
/** Transform a point by `m`. */
const apply = (m: Matrix, p: BlockAreaPoint): BlockAreaPoint => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
/** Compose `a` after `b`. */
function compose(a: Matrix, b: Matrix): Matrix {
  const origin = apply(a, { x: b[4], y: b[5] });
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    origin.x,
    origin.y,
  ];
}
/** Matrix for a track value relative to its event start, anchored in chart space. */
function relative(
  type: TransformTrack,
  start: number,
  value: number,
  anchor: BlockAreaPoint,
  rotationAspect: number,
): Matrix {
  if (type === "rotateEvents") {
    const angle = ((value - start) * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    return [
      c,
      -s / rotationAspect,
      s * rotationAspect,
      c,
      anchor.x * (1 - c) - anchor.y * s * rotationAspect,
      anchor.y * (1 - c) + (anchor.x * s) / rotationAspect,
    ];
  }
  const ratio = start === 0 ? 1 : value / start;
  const scale = Number.isFinite(ratio) ? ratio : 1;
  return type === "scaleXEvents"
    ? [scale, 0, 0, 1, anchor.x * (1 - scale), 0]
    : [1, 0, 0, scale, 0, anchor.y * (1 - scale)];
}

/** An area sampled at music time, including its ready flash and four corners. */
export interface NoiseAreaSample {
  state: "hidden" | "disabled" | "ready" | "active";
  activation: number;
  points: BlockAreaPoint[];
  invert: boolean;
}

/** Create an independent sample target for callers that need retained output. */
function createNoiseAreaSample(invert: boolean): NoiseAreaSample {
  return {
    state: "hidden",
    activation: 0,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    invert,
  };
}

/** Compile event tracks once per area and tempo; sample repeatedly during playback. */
export class NoiseAreaRuntime {
  private readonly tracks: Record<
    "moveXEvents" | "moveYEvents" | TransformTrack,
    EventTrack<BlockAreaEvent>
  >;
  private readonly center: BlockAreaPoint;
  private readonly bounds: BlockAreaBounds;
  private readonly entries: Record<keyof NoiseAreaRuntime["tracks"], TimedEvent<BlockAreaEvent>[]>;
  private readonly prefixes = new Map<BlockAreaEvent, Matrix>();
  private readonly intervals: { start: number; end: number; ready: number }[];
  private readonly appear: number;
  private readonly disappear: number;
  private readonly area: BlockArea;
  private readonly rotationAspect: number;
  private readonly sampleBuffer = createNoiseAreaSample(false);
  private readonly trackSamples: Record<keyof NoiseAreaRuntime["tracks"], TrackSample> = {
    moveXEvents: { value: 0 },
    moveYEvents: { value: 0 },
    rotateEvents: { value: 0 },
    scaleXEvents: { value: 0 },
    scaleYEvents: { value: 0 },
  };
  /** Compile intervals and transform tracks once; `rotationAspect` scales screen-space rotation. */
  constructor(
    area: BlockArea,
    tempo: TempoSource,
    /** Ratio of the viewport's vertical and horizontal chart-unit scales. */
    rotationAspect = 1,
  ) {
    this.area = area;
    this.rotationAspect = rotationAspect;
    this.bounds = blockAreaBounds(area);
    this.center = { x: this.bounds.centerX, y: this.bounds.centerY };
    this.appear = tempo.seconds(area.appearTime);
    this.disappear = tempo.seconds(area.disappearTime);
    const intervals = (area.activeIntervals ?? [])
      .flatMap((i) => {
        const originalStart = tempo.seconds(i.startTime);
        const originalEnd = tempo.seconds(i.endTime);
        const start = Math.max(this.appear, originalStart);
        const end = Math.min(this.disappear, originalEnd);
        if (end < start || (end === start && originalStart !== originalEnd)) {
          return [];
        }
        // `readyFlash` is a boolean or a lead time in seconds; default to half a second.
        const ready =
          typeof i.readyFlash === "boolean"
            ? i.readyFlash
              ? 0.5
              : 0
            : Number.isFinite(i.readyFlash)
              ? Math.round(Math.max(0, i.readyFlash as number) * 1000) / 1000
              : 0.5;
        return [{ start, end, ready }];
      })
      .sort((a, b) => a.start - b.start);
    this.intervals = [];
    for (const interval of intervals) {
      const previous = this.intervals.at(-1);
      if (previous?.start === interval.start) {
        previous.end = Math.max(previous.end, interval.end);
        previous.ready = Math.max(previous.ready, interval.ready);
      } else {
        this.intervals.push(interval);
      }
    }
    this.tracks = {
      moveXEvents: new EventTrack(area.moveXEvents, tempo),
      moveYEvents: new EventTrack(area.moveYEvents, tempo),
      rotateEvents: new EventTrack(area.rotateEvents, tempo),
      scaleXEvents: new EventTrack(area.scaleXEvents, tempo),
      scaleYEvents: new EventTrack(area.scaleYEvents, tempo),
    };
    this.entries = {
      moveXEvents: this.tracks.moveXEvents.events,
      moveYEvents: this.tracks.moveYEvents.events,
      rotateEvents: this.tracks.rotateEvents.events,
      scaleXEvents: this.tracks.scaleXEvents.events,
      scaleYEvents: this.tracks.scaleYEvents.events,
    };
    for (const type of ["scaleXEvents", "scaleYEvents", "rotateEvents"] as const) {
      let matrix = identity();
      let previous: BlockAreaEvent | undefined;
      for (const { event } of this.entries[type]) {
        if (previous) {
          const endpoint = previous.transformEnd ?? Number(previous.end),
            anchor = previous.anchor ?? this.center;
          matrix = compose(
            relative(
              type,
              previous.transformStart ?? Number(previous.start),
              endpoint,
              anchor,
              this.rotationAspect,
            ),
            matrix,
          );
          matrix = compose(
            relative(
              type,
              endpoint,
              event.transformStart ?? Number(event.start),
              anchor,
              this.rotationAspect,
            ),
            matrix,
          );
        }
        this.prefixes.set(event, matrix);
        previous = event;
      }
    }
  }
  /** Sample one track at `seconds`, returning `fallback` before its first event. */
  private track(
    type: keyof NoiseAreaRuntime["tracks"],
    seconds: number,
    fallback: number,
    target: TrackSample,
  ): TrackSample {
    const track = this.tracks[type];
    const entries = this.entries[type];
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle].start <= seconds + 1e-9) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const selected: TimedEvent<BlockAreaEvent> | undefined = entries[low - 1];
    target.value = selected ? Number(track.sample(selected, seconds)) : fallback;
    target.event = selected?.event;
    return target;
  }
  /** Sample lifetime boundaries, activation and transforms without mutating chart data. */
  sample(seconds: number): NoiseAreaSample {
    return this.sampleInto(seconds, createNoiseAreaSample(this.area.isInvert === true));
  }

  /** Sample into reusable storage for frame renderers that consume the result immediately. */
  sampleInto(seconds: number, target = this.sampleBuffer): NoiseAreaSample {
    let state: NoiseAreaSample["state"] = "disabled";
    let activation = 0;
    if (seconds + 1e-9 < this.appear || seconds + 1e-9 >= this.disappear) {
      state = "hidden";
    } else {
      const now = seconds + 1e-9;
      let active: (typeof this.intervals)[number] | undefined;
      for (let index = this.intervals.length - 1; index >= 0; index--) {
        const interval = this.intervals[index];
        if (interval.start <= now && interval.end > interval.start) {
          active = interval;
          break;
        }
      }
      let next: (typeof this.intervals)[number] | undefined;
      for (const interval of this.intervals) {
        if (interval.start > now) {
          next = interval;
          break;
        }
      }
      if (active && seconds + 1e-9 < active.end) {
        state = "active";
        activation = 1;
      } else if (next && next.ready > 0 && seconds + 1e-9 >= next.start - next.ready) {
        state = "ready";
        const phase = Math.max(0, Math.min(1, (seconds - next.start + next.ready) / next.ready));
        activation = (1 + Math.cos(phase * Math.PI * 6)) / 2;
      }
    }
    const x = this.track("moveXEvents", seconds, this.center.x, this.trackSamples.moveXEvents),
      y = this.track("moveYEvents", seconds, this.center.y, this.trackSamples.moveYEvents);
    const sx = this.track("scaleXEvents", seconds, 1, this.trackSamples.scaleXEvents),
      sy = this.track("scaleYEvents", seconds, 1, this.trackSamples.scaleYEvents),
      rot = this.track("rotateEvents", seconds, 0, this.trackSamples.rotateEvents);
    const accumulate = (
      type: TransformTrack,
      point: BlockAreaPoint,
      current: { value: number; event?: BlockAreaEvent },
    ): BlockAreaPoint => {
      if (!current.event) {
        return point;
      }
      const event = current.event;
      return apply(
        relative(
          type,
          event.transformStart ?? Number(event.start),
          current.value,
          event.anchor ?? this.center,
          this.rotationAspect,
        ),
        apply(this.prefixes.get(event) ?? identity(), point),
      );
    };
    const center = accumulate(
      "rotateEvents",
      accumulate("scaleYEvents", accumulate("scaleXEvents", this.center, sx), sy),
      rot,
    );
    const angle = (rot.value * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const points = target.points;
    for (let index = 0; index < this.bounds.corners.length; index++) {
      const p = this.bounds.corners[index];
      const dx = sx.value * (p.x - this.center.x),
        dy = sy.value * (p.y - this.center.y);
      const point = points[index] ?? (points[index] = { x: 0, y: 0 });
      point.x = center.x + c * dx + s * dy * this.rotationAspect + x.value - this.center.x;
      point.y = center.y - (s * dx) / this.rotationAspect + c * dy + y.value - this.center.y;
    }
    points.length = this.bounds.corners.length;
    target.state = state;
    target.activation = activation;
    target.invert = this.area.isInvert === true;
    return target;
  }
}
