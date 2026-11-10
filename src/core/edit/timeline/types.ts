/**
 * The timeline's view types: points, notes, event lanes, drag state and cached
 * line indexes.
 *
 * These are the shapes the drawing and interaction modules exchange; chart
 * types are reused where they already fit, and `positionX` is required on a
 * timeline note because the renderer cannot draw one without it.
 */
import type { IntervalIndex, IntervalEntry } from "../../utils/intervalIndex.ts";
import type { JudgeLineEvent, JudgeLineNote, LineEventLayer } from "../../global/chart/chart.ts";
import type { Beat } from "../../global/chart/timing/beat.ts";

export type TimelineArea = "notes" | "events";

export interface TimelinePoint {
  x: number;
  y: number;
}

export type TimelineNote = JudgeLineNote & {
  positionX: number;
  tint?: number[];
  /** The chart already holds this curve anchor; the ghost must not draw it twice. */
  existing?: boolean;
};

/** The note anchor `timeline.curvePick` hands back to the curve editor. */
export interface CurveAnchor {
  startTime: Beat;
  positionX: number;
  type: number;
}

export type TimelineEventLayer = LineEventLayer & Record<string, JudgeLineEvent[] | undefined>;

export interface TimelineEventRect {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  type: string;
  lineIndex?: number;
}

export type TimelineNoteEntry = IntervalEntry<TimelineNote> & { lineIndex: number };

export interface NoteIndex {
  notes: TimelineNote[];
  index: IntervalIndex<TimelineNote>;
}

export interface PendingHold {
  beat: number;
  positionX: number;
  lineIndex: number;
}

export interface MultiLineScroll {
  notes: number;
  events: number;
}

export interface MultiLineZoom {
  notes: number;
  events: number;
}

interface DragCommon {
  pointerId?: number;
  start: TimelinePoint;
  current: TimelinePoint;
  scrolled?: boolean;
  finished?: boolean;
  currentWorldX?: number;
  startWorldX?: number;
  startSeconds?: number;
  currentSeconds?: number;
  lastSelectionKey?: string;
  startFactor?: number;
  lineIndex?: number;
}

export interface MoveDrag extends DragCommon {
  kind: "move" | "startTime" | "endTime";
  anchor: number;
  originSeconds?: number;
}

export interface PanDrag extends DragCommon {
  kind: "multi-pan";
}

export interface RectangleDrag extends DragCommon {
  kind: "rectangle";
  area?: TimelineArea;
  append?: boolean;
  remove?: boolean;
  /** History signature when the gesture began; a change resets a stale baseline. */
  historyKey?: string;
  /** Selection that existed when a Shift/Ctrl marquee began. */
  baselineNotes?: ReadonlyMap<number, ReadonlySet<number>>;
  /** Event selection that existed when a Shift/Ctrl marquee began. */
  baselineEvents?: ReadonlyMap<number, ReadonlySet<string>>;
}

/** A pointer path that adds to or removes from one timeline area. */
export interface SweepDrag extends DragCommon {
  kind: "sweep";
  area: TimelineArea;
  /** Pointer button that started the sweep; 2 is the context-menu gesture. */
  button?: number;
  remove?: boolean;
  /** Whether the path crossed the click tolerance. */
  sweepMoved?: boolean;
  /** The last point already applied to the selection model. */
  lastSweepPoint?: TimelinePoint;
  /** The last world-space X already applied to the selection model. */
  lastSweepWorldX?: number;
  /** Screen-space samples used to paint the transient path. */
  sweepPoints?: TimelinePoint[];
}

export type TimelineDrag = MoveDrag | PanDrag | RectangleDrag | SweepDrag;

export interface EventMoveDrag extends DragCommon {
  kind: "move" | "startTime" | "endTime";
  type?: string;
  anchor?: number[];
  originSeconds?: number;
}

/**
 * The event lanes carry the same drag kinds as the note lanes, except for the
 * move anchor: a selected event anchors on a beat tuple (`number[]`) while a
 * note anchors on a position index (`number`), so only that one variant is
 * declared twice. Everything else is the same shape and the same name.
 */
export type TimelineEventDrag = EventMoveDrag | PanDrag | RectangleDrag | SweepDrag;
