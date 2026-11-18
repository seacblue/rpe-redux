/**
 * Timeline seam and pointer routing for the batch control balls.
 *
 * The balls float above their field, so the browser sends their pointer input
 * to the ball instead of the canvas. These helpers keep the timeline cursor
 * current under a ball and hand a placement-ending click back to the field that
 * owns it.
 */
import type { TimelineArea, TimelinePoint } from "../../../../../../core/edit/timeline/types.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";

/** The timeline surface the batch control balls read and drive. */
export type BatchTimeline = Pick<
  Timeline,
  "notesCanvas" | "eventsCanvas" | "cancelPlacement" | "changed" | "setPreview" | "down"
> & {
  viewport: Pick<
    Timeline["viewport"],
    | "panelWidth"
    | "panelIndex"
    | "panelStride"
    | "multiLineViewportOffset"
    | "point"
    | "tempo"
    | "origin"
    | "judgementOffset"
    | "scale"
    | "scaleForArea"
    | "notePositionAt"
    | "division"
    | "factorForLine"
    | "noteInset"
    | "snapX"
    | "gridCount"
    | "lineIndexAt"
  >;
  gestures: Pick<
    Timeline["gestures"],
    | "cursor"
    | "eventCursor"
    | "cursorLineIndex"
    | "hoverArea"
    | "clipboardPointer"
    | "scaleAxis"
    | "scaleAxisLine"
    | "preview"
    | "pendingHold"
    | "eventInteraction"
  >;
};

/** Whether a Hold or event is armed and waiting for its completing click. */
export function batchPlacementPending(timeline: BatchTimeline): boolean {
  return Boolean(timeline.gestures.pendingHold || timeline.gestures.eventInteraction.pending);
}

/**
 * Track the live pointer on the timeline that a control ball floats over.
 *
 * Keyboard placement reads the timeline cursor, so letting a ball freeze that
 * cursor would place the next note or event at a stale row.
 */
export function forwardBallPointer(timeline: BatchTimeline, event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const group = event.target.closest(".batch-controls");
  if (!(group instanceof HTMLElement)) {
    return;
  }
  const area = group.dataset.area;
  if (area !== "notes" && area !== "events") {
    return;
  }
  const canvas = area === "notes" ? timeline.notesCanvas : timeline.eventsCanvas;
  const pointer: TimelinePoint = timeline.viewport.point(event, canvas);
  timeline.gestures.clipboardPointer = pointer;
  timeline.gestures.hoverArea = area;
  if (area === "notes") {
    timeline.gestures.cursor = pointer;
    timeline.gestures.cursorLineIndex = timeline.viewport.lineIndexAt(
      pointer.x,
      canvas.clientWidth,
      "notes",
    );
  } else {
    timeline.gestures.eventCursor = pointer;
  }
  timeline.changed();
}

/**
 * Route a press that lands on a ball to the pending placement when one exists.
 *
 * Returns true when the press belonged to the field; the caller must then skip
 * the batch-drag path for that pointer sequence.
 */
export function routePendingPlacement(
  timeline: BatchTimeline,
  area: TimelineArea,
  event: PointerEvent,
): boolean {
  if (!batchPlacementPending(timeline)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  if (area === "events") {
    timeline.gestures.eventInteraction.down(event);
  } else {
    timeline.down(event);
  }
  return true;
}
