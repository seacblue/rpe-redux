/**
 * Pure drag-preview geometry for timeline notes and events.
 *
 * The functions read drag state and the tempo grid only, so the same numbers
 * can be drawn, read back, or committed without a canvas or chart mutation.
 */

import {
  addBeats,
  compareBeats,
  normalizeBeat,
  subtractBeats,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { snapTime, verticalGrid, type TempoGrid } from "../../global/chart/editing/editGrid.ts";
import { checkedNotes } from "./model.ts";
import type { EditorSession } from "../session/session.ts";
import type { TimelineDrag, TimelineEventDrag, TimelineNote } from "./types.ts";

/** Zero as a beat: the identity `subtractBeats`/`addBeats` compare against. */
const ZERO_BEAT: Beat = [0, 0, 1];

/** Geometry and snap settings for one note drag preview. */
export interface NoteMotionContext {
  readonly tempo: TempoGrid;
  readonly origin: number;
  readonly scale: number;
  readonly division: number;
  readonly panelWidth: number;
  readonly inset: number;
  readonly gridCount: number;
  readonly snapX: boolean;
  /** The visible panel's factor; merged multi-line notes share the active line. */
  readonly factor: number;
}

/** The anchor index only `MoveDrag` carries; the other drag kinds have no such field. */
export function dragAnchor(drag: TimelineDrag | null): number | undefined {
  return drag && "anchor" in drag ? drag.anchor : undefined;
}

/** Compute a drag preview without reading a canvas or mutating the chart. */
export function moveTimelineNote(
  note: TimelineNote,
  drag: TimelineDrag | null,
  session: Pick<EditorSession, "chart" | "lineIndex">,
  context: NoteMotionContext,
): TimelineNote {
  if (!drag || !["move", "startTime", "endTime"].includes(drag.kind) || !("anchor" in drag)) {
    return note;
  }
  if (
    Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) <= 4 &&
    !drag.scrolled
  ) {
    return note;
  }
  const lineIndex =
    typeof drag.lineIndex === "number" && Number.isInteger(drag.lineIndex)
      ? drag.lineIndex
      : session.lineIndex;
  const line = session.chart.judgeLineList?.[lineIndex];
  const anchor = checkedNotes(line?.notes ?? [])[drag.anchor];
  if (!anchor || !Number.isFinite(anchor.positionX)) {
    return note;
  }
  const { tempo, origin, division, scale } = context;
  const factor = context.factor;
  const key = drag.kind === "endTime" ? "endTime" : "startTime";
  const scroll =
    tempo.seconds(origin, factor) - (drag.originSeconds ?? tempo.seconds(origin, factor));
  const seconds =
    tempo.seconds(anchor[key], factor) + (drag.start.y - drag.current.y) / scale + scroll;
  // Snap once, then move the triple exactly: the delta is a rational difference
  // of two beats, not a float that gets re-rounded on the way into the chart.
  const deltaBeat = subtractBeats(snapTime(seconds, division, tempo, factor), anchor[key]);
  if (drag.kind !== "move") {
    if (note.type !== 2) {
      return note;
    }
    const moved = addBeats(note[key], deltaBeat);
    // An end cannot pass its start, a start cannot pass its end, and neither
    // may leave the chart before beat zero.
    const bounded =
      drag.kind === "endTime"
        ? compareBeats(moved, note.startTime) < 0
          ? normalizeBeat(note.startTime)
          : moved
        : compareBeats(moved, ZERO_BEAT) < 0
          ? ZERO_BEAT
          : compareBeats(moved, note.endTime) > 0
            ? normalizeBeat(note.endTime)
            : moved;
    return { ...note, [key]: bounded };
  }
  const rawDeltaX =
    ((drag.current.x - drag.start.x) / Math.max(1, context.panelWidth - context.inset * 2)) * 1350;
  const spacing = verticalGrid(context.gridCount).spacing;
  // X snapping is a relative movement grid. Keeping the original offset means
  // a dragged note does not jump onto a lane just because snapping is enabled.
  const deltaX =
    context.snapX && Number.isFinite(spacing) && spacing > 0
      ? Math.round(rawDeltaX / spacing) * spacing
      : rawDeltaX;
  // A note may be dragged up to beat zero, and no further.
  const mostNegative = subtractBeats(ZERO_BEAT, note.startTime);
  const boundedBeat = compareBeats(deltaBeat, mostNegative) < 0 ? mostNegative : deltaBeat;
  return {
    ...note,
    positionX: Math.max(-675, Math.min(675, note.positionX + deltaX)),
    startTime: addBeats(note.startTime, boundedBeat),
    endTime: addBeats(note.endTime, boundedBeat),
  };
}

/** How many beats an event drag has moved, snapped to the division grid. */
export function eventDragDelta(
  drag: TimelineEventDrag | null,
  context: Pick<NoteMotionContext, "tempo" | "origin" | "scale" | "division">,
  factor: number,
): Beat {
  if (!drag || !("anchor" in drag) || !drag.anchor) {
    return ZERO_BEAT;
  }
  const { tempo, origin, scale, division } = context;
  const scroll =
    tempo.seconds(origin, factor) - (drag.originSeconds ?? tempo.seconds(origin, factor));
  const seconds =
    tempo.seconds(drag.anchor, factor) + (drag.start.y - drag.current.y) / scale + scroll;
  return subtractBeats(snapTime(seconds, division, tempo, factor), drag.anchor);
}

/** How far a drag that has left the panel should scroll it, per elapsed fraction. */
export function dragScrollDelta(y: number, height: number, scale: number, elapsed: number): number {
  const overflow = y < 0 ? -y : y > height ? height - y : 0;
  return !overflow
    ? 0
    : ((Math.sign(overflow) * Math.min(900, 120 + Math.abs(overflow) * 4)) / scale) *
        Math.min(0.05, elapsed);
}
