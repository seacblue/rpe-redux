/**
 * Paints event overlap and selection tints beneath the event bars and value
 * labels.
 *
 * Both helpers are pure canvas passes: rectangles and palette arrive from the
 * event drawing module.
 */
import { selectionColor, type CanvasPalette } from "../../../canvas/palette.ts";
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

/** Fill opacity that keeps the event bar and its labels readable below the tint. */
const SELECTED_EVENT_FILL_ALPHA = 0.35;

/** Paints a stable per-event overlap tint below the event value labels. */
export function drawEventOverlapFilter(
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
  palette: CanvasPalette,
): void {
  context.save();
  context.fillStyle = palette.overlayInvalidFill;
  context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.restore();
}

/**
 * Paint the local event selection with the configured selected-event colour.
 *
 * The event field has no skin recolouring pass, so the colour becomes a
 * translucent rectangle over each selected bar instead. Fill opacity stays
 * fixed so the bar and its value labels remain readable.
 */
export function drawEventSelectionFilters(
  context: CanvasRenderingContext2D,
  rectangles: readonly EventBarRectangle[],
): void {
  context.save();
  context.fillStyle = selectionColor("selected-event-color", "#00C800");
  context.globalAlpha *= SELECTED_EVENT_FILL_ALPHA;
  for (const rectangle of rectangles) {
    context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }
  context.restore();
}

/**
 * Paint another member's event selection with the configured collaboration ink.
 *
 * The rectangle follows the event bar exactly like the local selection filter,
 * but uses the collaboration event colour and a lower alpha so the two
 * selections remain distinguishable when they overlap.
 */
export function drawRemoteEventSelectionFilters(
  context: CanvasRenderingContext2D,
  rectangles: readonly EventBarRectangle[],
  palette: CanvasPalette,
): void {
  if (!rectangles.length) {
    return;
  }
  context.save();
  context.fillStyle = palette.remoteEventSelectionHighlight;
  context.globalAlpha *= 0.38;
  for (const rectangle of rectangles) {
    context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  }
  context.restore();
}
