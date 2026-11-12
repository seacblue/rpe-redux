/**
 * Paints a miniature chart preview into a line-switcher card canvas from a sampled
 * line overview.
 *
 * It is a pure canvas helper; the sampling window and time range are prepared by the
 * line overview index.
 */
import { noteColor, readCanvasPalette } from "../../../canvas/palette.ts";
import { noteAlpha } from "../../../../../../core/global/chart/optionalFeatures.ts";
import type { LineThumbnailSnapshot } from "./lineSwitcherTypes.ts";

/** Paint one line's notes and events into a switcher card canvas. */
export function drawLineThumbnail(
  canvas: HTMLCanvasElement,
  { sample, seconds, start, end }: LineThumbnailSnapshot,
): void {
  const context = canvas.getContext("2d");
  if (!context || !sample) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  const palette = readCanvasPalette();
  const vertical = (time: number) =>
    height - 5 - ((time - start) / Math.max(0.01, end - start)) * (height - 10);
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.surface;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = palette.outline;
  context.lineWidth = 1;
  for (const position of [10, 82, 154, 162]) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, height);
    context.stroke();
  }
  for (const entry of sample.events.slice(0, 1500)) {
    context.fillStyle = entry.channel === 5 ? palette.eventShaderFill : palette.eventFill;
    context.fillRect(
      166 + entry.channel * 12,
      vertical(entry.end),
      10,
      Math.max(2, vertical(entry.start) - vertical(entry.end)),
    );
  }
  const notes = sample.notes.slice(0, 1500);
  for (const hold of [true, false]) {
    for (const entry of notes) {
      const note = entry.item;
      if ((note.type === 2) !== hold) {
        continue;
      }
      const horizontal = 10 + (((note.positionX ?? 0) + 675) / 1350) * 144;
      if (horizontal < 0 || horizontal > 160) {
        continue;
      }
      context.fillStyle = noteColor(palette, note.type);
      context.globalAlpha = 0.9 * noteAlpha(note);
      if (hold) {
        context.fillRect(
          horizontal - 4,
          vertical(entry.end),
          8,
          Math.max(2, vertical(entry.start) - vertical(entry.end)),
        );
      }
      context.fillRect(horizontal - 7, vertical(entry.start) - 1, 14, 3);
    }
  }
  context.globalAlpha = 1;
  context.fillStyle = palette.bottomValue;
  context.fillRect(0, vertical(seconds), width, 1);
}
