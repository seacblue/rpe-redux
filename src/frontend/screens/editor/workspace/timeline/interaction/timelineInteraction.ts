/**
 * Handles timeline gestures that change navigation or in-progress placement.
 *
 * The receiver owns session and redraw callbacks; these functions translate
 * pointer/wheel state into receiver operations. Hit testing, drawing, and
 * selection policy remain in their respective timeline modules.
 */
import { dragScrollDelta } from "../../../../../../core/edit/timeline/dragPreview.ts";
import type { TimelineGestureReceiver } from "../drawing/timelineReceiver.ts";

/** Cancel pending placement and redraw. */
export function cancelPlacement(this: TimelineGestureReceiver): void {
  this.gestures.cancelPlacement();
  this.changed();
}

/** Advance a live time drag when the pointer rests near the viewport edge. */
export function autoScroll(this: TimelineGestureReceiver, elapsed: number): void {
  const drag = this.gestures.drag ?? this.gestures.eventInteraction.drag;
  if (!drag || !["move", "startTime", "endTime"].includes(drag.kind)) {
    return;
  }
  const height = this.viewport.viewHeight();
  // T/U can temporarily hide both authoring canvases while the pointer drag
  // remains active. There is no meaningful edge to scroll in that layout.
  if (!Number.isFinite(height) || height <= 0) {
    return;
  }
  const delta = dragScrollDelta(drag.current.y, height, this.viewport.scale, elapsed);
  if (!delta) {
    return;
  }
  drag.scrolled = true;
  drag.scrollSeconds = (drag.scrollSeconds ?? 0) + delta;
  this.gestures.onDragScroll?.(delta);
  this.changed();
}
