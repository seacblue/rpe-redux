/** Draws the ghost of a batch edit's after-state onto the timeline canvas. */
import type { MultiEditResult } from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import { beatValue, isOrderedBeatRange } from "../../../../../core/global/chart/timing/beat.ts";
import { easing, bezier } from "../../../../../core/utils/easing.ts";

/** Draws one event's extent and eased value curve as a ghost. */
export function drawEventGhost(
  context: CanvasRenderingContext2D,
  event: MultiEditResult["changes"][number]["after"],
  horizontal: number,
  width: number,
  vertical: (beat: number) => number,
  range: [number, number] = [
    Math.min(Number(event.start), Number(event.end)),
    Math.max(Number(event.start), Number(event.end)),
  ],
): void {
  if (!isOrderedBeatRange(event.startTime, event.endTime)) {
    return;
  }
  const start = beatValue(event.startTime);
  const end = beatValue(event.endTime);
  const top = vertical(end);
  const bottom = vertical(start);
  context.strokeRect(horizontal, top, width, Math.max(2, bottom - top));
  if (typeof event.start !== "number" || typeof event.end !== "number") {
    return;
  }
  context.beginPath();
  for (let step = 0; step <= 30; step++) {
    const progress = step / 30;
    const amount = event.bezier
      ? bezier(progress, event.bezierPoints ?? [])
      : easing(progress, event.easingType ?? 1, event.easingLeft ?? 0, event.easingRight ?? 1);
    const value = event.start + (event.end - event.start) * amount;
    const position =
      horizontal +
      5 +
      (range[0] === range[1] ? 0.5 : (value - range[0]) / (range[1] - range[0])) * (width - 10);
    if (!step) {
      context.moveTo(position, vertical(start));
    } else {
      context.lineTo(position, vertical(start + (end - start) * progress));
    }
  }
  context.stroke();
}
