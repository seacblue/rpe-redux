/**
 * Writes one event-field text run through the active timeline renderer.
 *
 * The WebGL overlay rasterizes labels into its own texture when it is active;
 * the Canvas2D context remains the fallback. Both event drawing passes and the
 * multi-line chrome share this seam so a label has one font and alignment and
 * is never horizontally scaled.
 */
import type { TimelineOverlayBatch } from "../../../canvas/timelineOverlayBatch.ts";

/**
 * Paint one text run on the canvas or queue it in the overlay batch.
 *
 * The canvas branch inherits the caller's global alpha, matching every existing
 * text pass; `alpha` therefore only reaches the overlay, whose labels carry
 * their own alpha. A null context is valid when the batch renders the run.
 */
export function drawEventText(
  context: CanvasRenderingContext2D | null,
  batch: TimelineOverlayBatch | null,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left",
  alpha = 1,
): void {
  if (batch) {
    batch.addText(text, x, y, undefined, font, color, align, alpha);
    return;
  }
  if (!context) {
    return;
  }
  const previousAlign = context.textAlign;
  context.font = font;
  context.textAlign = align;
  context.fillStyle = color;
  context.fillText(text, x, y);
  context.textAlign = previousAlign;
}
