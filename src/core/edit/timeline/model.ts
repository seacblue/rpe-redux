/**
 * The timeline's readers: the questions the drawing and interaction code asks
 * about the shapes `types.ts` declares.
 *
 * They live here rather than in the type file because a type file cannot hold
 * behaviour, and they live together because they are all *pure readings* — no
 * canvas, no session, no clock. `interaction.ts` owns the readers that only
 * mean something during a gesture; everything that reads a chart into the
 * timeline's view shape is here.
 */

import type {
  JudgeLineEvent,
  JudgeLineNote,
  LineEventLayer,
  LineEventValue,
} from "../../global/chart/chart.ts";
import { beatValue, isOrderedBeatRange } from "../../global/chart/timing/beat.ts";
import type { TimelineEventLayer, TimelineNote } from "./types.ts";

/** The time projection used when a timeline object has no positive duration. */
export interface TimelineRenderRange {
  start: number;
  end: number;
  invalid: boolean;
}

/**
 * Projects an event or hold into a drawable positive range.
 *
 * Positive ranges keep their exact endpoints. A zero-length or reversed range
 * starts at the stored start beat and receives one horizontal-grid division;
 * the caller can use `invalid` to apply the chart-error filter.
 */
export function timelineRenderRange(
  startTime: readonly number[],
  endTime: readonly number[],
  gridCount: number,
): TimelineRenderRange {
  return timelineRenderRangeInto(startTime, endTime, gridCount, {
    start: 0,
    end: 0,
    invalid: false,
  });
}

/** Fill a reusable render range to keep dense timeline drawing allocation-free. */
export function timelineRenderRangeInto(
  startTime: readonly number[],
  endTime: readonly number[],
  gridCount: number,
  target: TimelineRenderRange,
): TimelineRenderRange {
  const start = beatValue(startTime);
  const end = beatValue(endTime);
  target.start = start;
  target.end = end;
  target.invalid = false;
  if (end > start) {
    return target;
  }
  const divisions = Number.isFinite(gridCount) ? Math.max(1, Math.round(gridCount)) : 1;
  target.end = start + 1 / divisions;
  target.invalid = true;
  return target;
}

/** Whether an exact chart range has no forward duration. */
export function hasNonPositiveRange(
  startTime: readonly number[],
  endTime: readonly number[],
): boolean {
  return beatValue(endTime) <= beatValue(startTime);
}

/** Whether a note is allowed to reach the timeline renderer. */
export function isTimelineNoteRenderable(
  note: Pick<JudgeLineNote, "type" | "startTime" | "endTime">,
): boolean {
  return note.type === 2 || isOrderedBeatRange(note.startTime, note.endTime);
}

/** The note as the timeline draws it: the owned position lives on the view. */
/** Narrows a note to the timeline shape, which requires a finite `positionX`. */
function assertTimelineNote(note: JudgeLineNote): asserts note is TimelineNote {
  if (!Number.isFinite(note.positionX)) {
    throw new TypeError("Timeline notes require a finite positionX");
  }
}

/** Narrows every note in an array to the timeline shape. */
function assertTimelineNotes(notes: JudgeLineNote[]): asserts notes is TimelineNote[] {
  for (const note of notes) {
    assertTimelineNote(note);
  }
}

/** Returns the note as a timeline note after checking its position. */
export function checkedNote(note: JudgeLineNote): TimelineNote {
  assertTimelineNote(note);
  return note;
}

/** Returns the notes as timeline notes after checking every position. */
export function checkedNotes(notes: JudgeLineNote[]): TimelineNote[] {
  assertTimelineNotes(notes);
  return notes;
}

/** Reads a chart event layer as the timeline's view shape; null becomes empty. */
export function eventLayerOf(layer: LineEventLayer | null | undefined): TimelineEventLayer {
  return (layer ?? {}) as TimelineEventLayer;
}

/** A non-numeric event value has no height on the track; `NaN` says so. */
export function eventValueNumber(value: LineEventValue): number {
  return typeof value === "number" ? value : Number.NaN;
}

/** An instant event (`inst`) has no duration, so its track draws one edge. */
export function isHookedEvent(event: JudgeLineEvent | null | undefined): boolean {
  return event?.inst === true || Number(event?.inst) === 1;
}
