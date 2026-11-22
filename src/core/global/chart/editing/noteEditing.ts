/**
 * Note-level helpers for the chart editor: visibility windows and wheel steps.
 *
 * `visibleBeats` and `visibleSeconds` convert a note's `visibleTime` between beats
 * and seconds through a tempo grid, so both the timeline and the preview agree.
 */
import { beatValue, type Beat } from "../timing/beat.ts";
import type { TempoGrid } from "./editGrid.ts";

/**
 * The fields the visibility helpers read off a note.
 *
 * `startTime` is a `Beat`, not a `number[]`: a note's position is the reduced
 * rational triple the format stores verbatim, and `beatValue` is the only way to
 * the number. A plain array would accept a value the chart cannot represent.
 */
export interface VisibleNote {
  startTime: Beat;
  visibleTime?: number;
  [extra: string]: unknown;
}

/** The note's visible window measured in beats before its hit time. */
export function visibleBeats(note: VisibleNote, tempo: TempoGrid): number {
  const start = beatValue(note.startTime);
  return start - tempo.beat(tempo.seconds(start) - (note.visibleTime ?? 999999));
}

/** Converts a beat window before the note's hit time into chart seconds. */
export function visibleSeconds(note: VisibleNote, beats: number, tempo: TempoGrid): number {
  const start = beatValue(note.startTime);
  return tempo.seconds(start) - tempo.seconds(start - Math.max(0, beats));
}

/** Wheel notch sizes for the inspector's event controls, per event track. */
export const EVENT_WHEEL_STEPS: Record<string, number> = {
  moveXEvents: 5,
  moveYEvents: 5,
  rotateEvents: 0.5,
  alphaEvents: 5,
  speedEvents: 0.1,
  scaleXEvents: 0.1,
  scaleYEvents: 0.1,
};
