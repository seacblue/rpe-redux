/**
 * Event-bar edge drags: the head or tail that a pointer gesture trims.
 *
 * The helper resolves which event and edge a press targets and owns the drag
 * geometry and beat anchor; the canvas interaction still paints and commits
 * the gesture.
 */
import { eventKey, eventListAt } from "../../../../../../core/edit/events/eventTracks.ts";
import { captureSelection } from "../../../../../../core/edit/selection/snapshot.ts";
import { shiftSelectedEvents } from "../../../../../../core/edit/timeline/selection.ts";
import { setTimelineDragPreview } from "../../../../../../core/edit/timeline/dragPreviewState.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import {
  addBeats,
  compareBeats,
  normalizeBeat,
  type Beat,
} from "../../../../../../core/global/chart/timing/beat.ts";
import type {
  TimelineEventDrag,
  TimelineEventRect,
  TimelinePoint,
} from "../../../../../../core/edit/timeline/types.ts";
import { t } from "../../../../../../i18n/index.ts";
import type { TimelineViewport } from "../viewport/timelineViewport.ts";

/** Zero as a beat: the identity drag deltas compare against. */
const ZERO_BEAT: Beat = [0, 0, 1];

/** The timeline surface an event edge drag reads. */
interface EdgeTimeline {
  getSession(): EditorSession;
  viewport: Pick<TimelineViewport, "tempo" | "origin" | "factorForLine">;
}

/** The event track and index an edge drag targets, with the line it lives on. */
export interface EventEdgeTarget {
  type: string;
  index: number;
  lineIndex?: number;
}

/** The pointer fields one edge press reads. */
export interface EventEdgePress {
  button: number;
  pointerId: number;
  ctrlKey: boolean;
}

/** The edge a press is close enough to trim, or null for the bar body. */
export function eventEdgeAt(
  rectangle: TimelineEventRect,
  point: TimelinePoint,
): "startTime" | "endTime" | null {
  if (Math.abs(point.y - (rectangle.y + rectangle.height)) <= 8) {
    return "startTime";
  }
  if (Math.abs(point.y - rectangle.y) <= 8) {
    return "endTime";
  }
  return null;
}

/** Select one event for an edge drag without toggling Ctrl multi-selection. */
export function selectEventEdgeTarget(session: EditorSession, rectangle: TimelineEventRect): void {
  const lineIndex = rectangle.lineIndex ?? session.lineIndex;
  const key = eventKey(rectangle.type, rectangle.index);
  session.focus = "events";
  if (
    session.multiLineActive &&
    session.multiLineMode === "events" &&
    session.multiEventSelection
  ) {
    session.multiEventSelection.set(lineIndex, new Set([key]));
  }
  session.eventSelection = new Set([key]);
  session.selectionMode = "single";
}

/**
 * Build a head or tail drag for one event track entry.
 *
 * The anchor is the moved edge's own beat, so the drag delta is measured from
 * that edge. A missing event or a stale index yields null and arms nothing; the
 * target need not be under the pointer, which is what lets a Z drag start
 * anywhere once one event is selected.
 */
export function eventEdgeDragFor(
  timeline: EdgeTimeline,
  target: EventEdgeTarget,
  point: TimelinePoint,
  kind: "startTime" | "endTime",
  pointerId: number,
): TimelineEventDrag | null {
  const session = timeline.getSession();
  const lineIndex = target.lineIndex ?? session.lineIndex;
  const event = eventListAt(session, lineIndex, target.type, session.eventLayer)[target.index];
  if (!event) {
    return null;
  }
  return {
    kind,
    type: target.type,
    index: target.index,
    anchor: kind === "endTime" ? event.endTime : event.startTime,
    lineIndex,
    pointerId,
    start: point,
    current: point,
    startFactor: timeline.viewport.factorForLine(lineIndex),
    originSeconds: timeline.viewport.tempo.seconds(timeline.viewport.origin),
  };
}

/**
 * The edge drag a press starts before any sweep or selection gesture.
 *
 * A Z press owns the single selected event and may start anywhere in the
 * field; without that selection, or for Ctrl, the press must land on a bar and
 * a right press trims its tail.
 */
export function eventEdgePressDrag(
  timeline: EdgeTimeline,
  press: EventEdgePress,
  point: TimelinePoint,
  rectangle: TimelineEventRect | undefined,
  pending: boolean,
  prekey: boolean,
): TimelineEventDrag | null {
  if ((press.button !== 0 && press.button !== 2) || (!press.ctrlKey && !prekey)) {
    return null;
  }
  const session = timeline.getSession();
  const kind = press.button === 0 ? "startTime" : "endTime";
  if (prekey && !pending) {
    const entries = captureSelection(session).events;
    if (entries.length === 1) {
      const drag = eventEdgeDragFor(timeline, entries[0], point, kind, press.pointerId);
      if (drag) {
        drag.prekey = true;
        session.focus = "events";
        return drag;
      }
    }
  }
  if (press.button !== 2 || !rectangle) {
    return null;
  }
  selectEventEdgeTarget(session, rectangle);
  const drag = eventEdgeDragFor(timeline, rectangle, point, "endTime", press.pointerId);
  if (drag && prekey) {
    drag.prekey = true;
  }
  return drag;
}

/**
 * Commit an event edge drag through the selection command.
 *
 * A Z press commits even when the pointer never crossed the drag threshold;
 * every other edge gesture still needs visible travel.
 */
export function commitEventEdgeDrag(
  session: EditorSession,
  drag: TimelineEventDrag,
  delta: Beat,
): void {
  if (
    compareBeats(delta, ZERO_BEAT) === 0 ||
    (!drag.prekey && Math.abs(drag.current.y - drag.start.y) <= 5)
  ) {
    return;
  }
  shiftSelectedEvents(
    session,
    drag.kind,
    delta,
    drag.kind === "move"
      ? t("editorPanels.inspector.eventInteraction.move")
      : t("editorPanels.inspector.eventInteraction.resize"),
  );
}

/**
 * Publish the live head or tail of the event an edge drag is moving.
 *
 * The chart is unchanged until pointerup; the inspector reads this preview so
 * its start and end fields follow the pointer during the gesture.
 */
export function syncEventDragPreview(
  timeline: EdgeTimeline,
  drag: TimelineEventDrag | null,
  delta: Beat,
): boolean {
  if (
    !drag ||
    !("anchor" in drag) ||
    !drag.type ||
    drag.index === undefined ||
    (drag.kind !== "startTime" && drag.kind !== "endTime")
  ) {
    return false;
  }
  const session = timeline.getSession();
  const lineIndex = drag.lineIndex ?? session.lineIndex;
  const event = eventListAt(session, lineIndex, drag.type, session.eventLayer)[drag.index];
  if (!event) {
    return false;
  }
  const moved = addBeats(drag.kind === "startTime" ? event.startTime : event.endTime, delta);
  const startTime =
    drag.kind === "startTime" && compareBeats(moved, event.endTime) <= 0
      ? normalizeBeat(moved)
      : event.startTime;
  const endTime =
    drag.kind === "endTime" && compareBeats(moved, event.startTime) >= 0
      ? normalizeBeat(moved)
      : event.endTime;
  return setTimelineDragPreview({
    kind: "event",
    lineIndex,
    type: drag.type,
    index: drag.index,
    event: { ...event, startTime, endTime },
  });
}

/** Drop the event drag preview; true when one was visible. */
export function clearEventDragPreview(): boolean {
  return setTimelineDragPreview(null);
}
