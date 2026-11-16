/** Owns the shared completion seam for selection gestures captured above the timeline. */
import type { Timeline } from "../surface/timeline.ts";

/** Finish a captured selection gesture and release its deferred selection notification. */
export function finishCapturedSelectionGesture(
  timeline: Pick<
    Timeline,
    "rectangleSelection" | "sweepSelection" | "finishRectangle" | "gestures" | "getSession"
  >,
  event: PointerEvent,
): boolean {
  if (!timeline.rectangleSelection() && !timeline.sweepSelection()) {
    return false;
  }
  if (!timeline.finishRectangle(event)) {
    return false;
  }
  timeline.gestures.finishSelectionHistory(timeline.getSession());
  return true;
}
