/**
 * Paints event overlap and selection tints beneath the event bars and value
 * labels.
 *
 * Every helper owns one renderer contract: the Canvas2D passes fill rectangles
 * with the current global alpha, and the overlay pass queues the same
 * rectangles into the WebGL batch with an explicit alpha.
 */
import { selectionColor, type CanvasPalette } from "../../../canvas/palette.ts";
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;

/** Fill opacity that keeps the event bar and its labels readable below the tint. */
const SELECTED_EVENT_FILL_ALPHA = 0.35;

/** Remote selections sit below the local tint so both stay readable when nested. */
const REMOTE_EVENT_FILL_ALPHA = 0.38;

/** Fill one rectangle with the caller's fill style and global alpha. */
function fillSelectionRectangle(
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
): void {
  context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
}

/** Paints a stable per-event overlap tint below the event value labels. */
export function drawEventOverlapFilter(
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
  palette: CanvasPalette,
): void {
  const previousFillStyle = context.fillStyle;
  context.fillStyle = palette.overlayInvalidFill;
  fillSelectionRectangle(context, rectangle);
  context.fillStyle = previousFillStyle;
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
    fillSelectionRectangle(context, rectangle);
  }
  context.restore();
}

/** Paint one local selection without allocating a one-element rectangle list. */
export function drawEventSelectionFilter(
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
  color = selectionColor("selected-event-color", "#00C800"),
): void {
  context.save();
  context.fillStyle = color;
  context.globalAlpha *= SELECTED_EVENT_FILL_ALPHA;
  fillSelectionRectangle(context, rectangle);
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
  context.globalAlpha *= REMOTE_EVENT_FILL_ALPHA;
  for (const rectangle of rectangles) {
    fillSelectionRectangle(context, rectangle);
  }
  context.restore();
}

/** Paint one remote selection without allocating a one-element rectangle list. */
export function drawRemoteEventSelectionFilter(
  context: CanvasRenderingContext2D,
  rectangle: EventBarRectangle,
  palette: CanvasPalette,
): void {
  context.save();
  context.fillStyle = palette.remoteEventSelectionHighlight;
  context.globalAlpha *= REMOTE_EVENT_FILL_ALPHA;
  fillSelectionRectangle(context, rectangle);
  context.restore();
}

/**
 * Paint one channel's local and remote event selections.
 *
 * The canvas branch inherits the pass's `context.globalAlpha`; the overlay
 * branch receives the same value as `opacity` because GPU rectangles carry
 * their own alpha.
 */
export function drawEventSelectionOverlay(
  context: CanvasRenderingContext2D,
  batch: TimelineOverlayBatch | null,
  palette: CanvasPalette,
  selected: readonly EventBarRectangle[],
  remoteSelected: readonly EventBarRectangle[],
  opacity = 1,
  selectedColor = selectionColor("selected-event-color", "#00C800"),
): void {
  if (batch) {
    for (const rectangle of selected) {
      batch.addRect(
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
        selectedColor,
        opacity * SELECTED_EVENT_FILL_ALPHA,
      );
    }
    for (const rectangle of remoteSelected) {
      batch.addRect(
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
        palette.remoteEventSelectionHighlight,
        opacity * REMOTE_EVENT_FILL_ALPHA,
      );
    }
    return;
  }
  drawEventSelectionFilters(context, selected);
  drawRemoteEventSelectionFilters(context, remoteSelected, palette);
}
