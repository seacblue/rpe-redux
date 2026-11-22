/** Owns shader variable tracks: how raw chart values normalise, and how a beat samples them. */
import { beatValue } from "../timing/beat.ts";
import { easing, bezier } from "../../../utils/easing.ts";
import { isRecord } from "../../../utils/guards.ts";
import { clamp01 } from "../../../utils/numbers.ts";
import { upperBound } from "../../../utils/search.ts";

/** A variable-track segment shaped like `JudgeLineEvent`, with opaque uniform values. */
export interface ShaderVarEvent {
  startTime: number[];
  endTime: number[];
  start: unknown;
  end: unknown;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: number | boolean;
  bezierPoints?: number[];
  [extra: string]: unknown;
}

/** Segments of one shader variable track, in beat order. */
export type ShaderVarTrack = ShaderVarEvent[];

/** Shader variable tracks keyed by uniform name. */
export type ShaderVars = Record<string, ShaderVarTrack>;

/** The speed table used by shader sampling; a missing `beat` falls back to seconds. */
export interface ShaderTempo {
  seconds(beat: number | readonly number[], factor?: number): number;
  beat?(seconds: number, factor?: number): number;
}

/**
 * Read an event endpoint as a beat number.
 *
 * Beat tuples are converted exactly; a numeric endpoint is passed through, and
 * a missing or unusable value falls back to `fallback`.
 */
export function beatNumber(value: unknown, fallback: unknown = 0): number {
  if (Array.isArray(value)) {
    try {
      return beatValue(value);
    } catch {
      return Number(fallback);
    }
  }
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
}

/** Deep-copy array values so sampled output never aliases chart data. */
function cloneValue(value: unknown): unknown {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

/** Interpolate numbers and component-wise arrays; non-numeric values switch at the end. */
function interpolate(start: unknown, end: unknown, amount: number): unknown {
  if (Array.isArray(start) && Array.isArray(end)) {
    return start.map(
      (value, index) => Number(value) + (Number(end[index] ?? value) - Number(value)) * amount,
    );
  }
  if (typeof start === "number" && typeof end === "number") {
    return start + (end - start) * amount;
  }
  return amount >= 1 ? cloneValue(end) : cloneValue(start);
}

/**
 * Sample a variable track at `seconds`.
 *
 * Returns a cloned `fallback` when the track is empty, `undefined` before the
 * first event, and the interpolated endpoint value while an event is active.
 */
export function sampleValue(
  events: readonly ShaderVarEvent[] | undefined,
  seconds: number,
  tempo: ShaderTempo | null,
  fallback: unknown,
): unknown {
  if (!events?.length) {
    return cloneValue(fallback);
  }
  const beat = tempo?.beat?.(seconds) ?? seconds;
  const low = upperBound(events, beat, (event) => beatNumber(event.startTime, event.start ?? 0));
  if (!low) {
    return undefined;
  }
  const selected = events[low - 1];
  const startBeat = beatNumber(selected.startTime, selected.start ?? 0);
  const endBeat = beatNumber(selected.endTime, selected.end ?? startBeat);
  const startSeconds = tempo?.seconds(startBeat) ?? startBeat;
  const endSeconds = tempo?.seconds(endBeat) ?? endBeat;
  const progress =
    endSeconds <= startSeconds
      ? seconds >= endSeconds
        ? 1
        : 0
      : clamp01((seconds - startSeconds) / (endSeconds - startSeconds));
  const amount = selected.bezier
    ? bezier(progress, selected.bezierPoints ?? [])
    : easing(
        progress,
        selected.easingType ?? 1,
        selected.easingLeft ?? 0,
        selected.easingRight ?? 1,
      );
  return interpolate(selected.start, selected.end, amount);
}

/** Track predicate: an array whose first item carries `start` or `startTime`. */
const isVarTrack = (value: unknown): value is ShaderVarTrack => {
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== "object") {
    return false;
  }
  // A track is detected by its first segment; chart validation does not inspect
  // `vars`, so a null first segment is outside the supported shape.
  const first = value[0] as object;
  return "start" in first || "startTime" in first;
};

/**
 * Normalise an unvalidated `vars` bag into sorted tracks.
 *
 * Each scalar or non-track value becomes one constant track spanning the chart.
 */
export function normalizeVars(vars: unknown): ShaderVars {
  if (!isRecord(vars) && !Array.isArray(vars)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(vars).map(([name, value]): [string, ShaderVarTrack] => [
      name,
      isVarTrack(value)
        ? [...value].sort(
            (left, right) =>
              beatNumber(left.startTime, left.start ?? 0) -
              beatNumber(right.startTime, right.start ?? 0),
          )
        : [
            {
              startTime: [0, 0, 1],
              endTime: [999999, 0, 1],
              start: value,
              end: value,
              easingType: 1,
            },
          ],
    ]),
  );
}
