/** Owns the geometry snapshot that keeps a note drag stable across relayouts. */
import type {
  TimelineDrag,
  TimelineDragGeometry,
  TimelinePoint,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineNoteInteractionReceiver } from "../drawing/timelineReceiver.ts";

/** Capture the note viewport geometry that a pointer drag must keep using. */
export function captureNoteDragGeometry(
  receiver: TimelineNoteInteractionReceiver,
): TimelineDragGeometry {
  const rectangle = receiver.notesCanvas.getBoundingClientRect();
  const width = receiver.notesCanvas.clientWidth;
  return {
    left: rectangle.left,
    top: rectangle.top,
    width,
    panelWidth: receiver.viewport.panelWidth(width, "notes"),
    scale: receiver.viewport.scaleForArea("notes"),
    viewHeight: receiver.viewport.viewHeight(),
  };
}

/** Return the width retained by a drag, or the live canvas width for a hover. */
export function noteDragWidth(drag: TimelineDrag | null, fallback: number): number {
  return drag?.geometry?.width ?? fallback;
}

/** Project a pointer through the drag's retained canvas origin when one exists. */
export function noteDragPoint(
  receiver: TimelineNoteInteractionReceiver,
  event: PointerEvent,
  drag: TimelineDrag | null,
): TimelinePoint {
  return receiver.viewport.point(event, receiver.notesCanvas, drag?.geometry);
}

/** Convert the current pointer row using the drag's retained vertical geometry. */
export function noteDragSeconds(
  receiver: TimelineNoteInteractionReceiver,
  drag: TimelineDrag,
): number {
  const originSeconds =
    "originSeconds" in drag && drag.originSeconds !== undefined
      ? drag.originSeconds
      : receiver.viewport.tempo.seconds(receiver.viewport.origin);
  return (
    originSeconds +
    ((drag.geometry?.viewHeight ?? receiver.viewport.viewHeight()) -
      receiver.viewport.judgementOffset -
      drag.current.y) /
      (drag.geometry?.scale ?? receiver.viewport.scaleForArea("notes")) +
    (drag.scrollSeconds ?? 0)
  );
}
