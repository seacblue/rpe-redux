/** Paints the transient marquee without touching timeline object rendering. */

export type MarqueeArea = "notes" | "events";

export interface MarqueePalette {
  readonly selectionNotesFill: string;
  readonly selectionNotesStroke: string;
  readonly selectionEventsFill: string;
  readonly selectionEventsStroke: string;
}

export interface MarqueePoint {
  readonly x: number;
  readonly y: number;
}

export interface MarqueeOrigin {
  readonly left: number;
  readonly top: number;
}

const MARQUEE_DASH = [6, 4];

/** Paint one marquee rectangle in overlay-local coordinates. */
export function drawMarqueeRectangle(
  context: CanvasRenderingContext2D,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  start: MarqueePoint,
  current: MarqueePoint,
  area: MarqueeArea,
  palette: MarqueePalette,
  preview = false,
): void {
  let x = origin.left - overlay.left + start.x;
  let y = origin.top - overlay.top + start.y;
  let width = current.x - start.x;
  let height = current.y - start.y;
  if (preview) {
    x += Math.min(0, width);
    y += Math.min(0, height);
    width = Math.abs(width);
    height = Math.abs(height);
  }
  context.save();
  context.fillStyle = area === "notes" ? palette.selectionNotesFill : palette.selectionEventsFill;
  context.strokeStyle =
    area === "notes" ? palette.selectionNotesStroke : palette.selectionEventsStroke;
  context.fillRect(x, y, width, height);
  context.setLineDash(MARQUEE_DASH);
  context.lineWidth = preview ? 1 : 1.5;
  context.strokeRect(x + (preview ? 0.5 : 0), y + (preview ? 0.5 : 0), width, height);
  context.restore();
}

/** Paint one freehand sweep path in overlay-local coordinates. */
export function drawSelectionSweep(
  context: CanvasRenderingContext2D,
  origin: MarqueeOrigin,
  overlay: MarqueeOrigin,
  points: readonly MarqueePoint[],
  area: MarqueeArea,
  palette: MarqueePalette,
  strokeColor?: string,
): void {
  if (points.length < 2) {
    return;
  }
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const x = origin.left - overlay.left + point.x;
    const y = origin.top - overlay.top + point.y;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle =
    strokeColor ??
    (area === "notes" ? palette.selectionNotesStroke : palette.selectionEventsStroke);
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.stroke();
  context.restore();
}
