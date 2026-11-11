/**
 * Draws the dashed preview path and real-skin note previews for a pending
 * note-curve gesture.
 *
 * The ghost comes from the gesture state and projection from the viewport; the
 * active note skin supplies the Hold bodies and heads, while a missing skin
 * falls back to the shared translucent geometry. Curve commit rules remain in
 * core.
 */
import { beatValue, isOrderedBeatRange } from "../../../../../../core/global/chart/timing/beat.ts";
import { noteColor, readCanvasPalette } from "../../../canvas/palette.ts";
import type { TimelineCurveGhostReceiver } from "../drawing/timelineReceiver.ts";
import type { TimelineNote } from "../../../../../../core/edit/timeline/types.ts";

/** Draw the dashed path and skin note previews for a pending note curve. */
export function drawCurveGhost(
  this: TimelineCurveGhostReceiver,
  context: CanvasRenderingContext2D,
): void {
  const ghost = (() => {
    try {
      return this.gestures.curveGhost?.() ?? [];
    } catch {
      return [];
    }
  })();
  const renderableGhost = ghost.filter((note) => isOrderedBeatRange(note.startTime, note.endTime));
  if (!renderableGhost.length) {
    return;
  }

  const palette = this.cache.palette() ?? readCanvasPalette();
  const skin = this.appearance.skin;
  const fallbackFill = noteColor(palette, renderableGhost[0].type);
  context.save();
  context.globalAlpha = 0.5;
  context.strokeStyle = palette.bottomValue;
  context.fillStyle = fallbackFill;
  context.lineWidth = 2.5;

  // Draw real skin notes first; the dashed path stays on top of their bodies.
  for (const note of renderableGhost) {
    if (note.existing) {
      continue;
    }
    const horizontal = this.viewport.noteHorizontal(note.positionX);
    const width = this.viewport.noteWidth(note);
    const renderedHorizontal = this.viewport.clampNoteHorizontal(horizontal, width);
    if (renderedHorizontal == null) {
      continue;
    }
    const startVertical = this.viewport.vertical(beatValue(note.startTime));
    let drawn = false;
    if (skin) {
      try {
        drawn =
          note.type === 2
            ? skin.hold(
                context,
                renderedHorizontal,
                startVertical,
                this.viewport.vertical(beatValue(note.endTime)),
                width,
                false,
                true,
              )
            : skin.head(context, note.type, renderedHorizontal, startVertical, width, false);
      } catch {
        drawn = false;
      }
    }
    if (!drawn) {
      drawFallbackGhost(context, note, renderedHorizontal, width, startVertical, this);
    }
  }

  context.globalAlpha = 0.5;
  context.setLineDash([6, 3]);
  context.beginPath();
  renderableGhost.forEach((note, index) => {
    const horizontal = this.viewport.noteHorizontal(note.positionX);
    const vertical = this.viewport.vertical(beatValue(note.startTime));
    if (index === 0) {
      context.moveTo(horizontal, vertical);
    } else {
      context.lineTo(horizontal, vertical);
    }
  });
  context.stroke();
  context.restore();
}

/** Transparent geometry for a chart or skin with no drawable note texture. */
function drawFallbackGhost(
  context: CanvasRenderingContext2D,
  note: TimelineNote,
  horizontal: number,
  width: number,
  startVertical: number,
  receiver: TimelineCurveGhostReceiver,
): void {
  if (note.type === 2) {
    const endVertical = receiver.viewport.vertical(beatValue(note.endTime));
    const top = Math.min(startVertical, endVertical);
    const height = Math.abs(endVertical - startVertical);
    context.globalAlpha = 0.24;
    if (height > 0) {
      context.fillRect(horizontal - width / 2, top, width, height);
    }
    context.globalAlpha = 0.5;
    // The real Hold skin puts the head at the start anchor.
    context.fillRect(horizontal - width / 2, startVertical - 3, width, 6);
    context.strokeRect(horizontal - width / 2 - 2, startVertical - 5, width + 4, 10);
    return;
  }
  context.fillRect(horizontal - width / 2, startVertical - 5, width, 10);
  context.strokeRect(horizontal - width / 2 - 2, startVertical - 7, width + 4, 14);
}
