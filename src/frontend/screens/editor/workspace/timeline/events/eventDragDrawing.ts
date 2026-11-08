/** Paints the event field's rectangle and time-drag previews. */
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import {
  eventKey,
  eventList,
  eventListAt,
} from "../../../../../../core/edit/events/eventTracks.ts";
import type { TimelineEventDrawingReceiver } from "../drawing/timelineReceiver.ts";
import type { readCanvasPalette } from "../../../canvas/palette.ts";

/** Draw the marquee or dashed bar preview for the active event drag. */
export function drawEventDragOverlay(
  receiver: TimelineEventDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ReturnType<typeof readCanvasPalette>,
): void {
  const drag = receiver.gestures.eventInteraction.drag;
  const session = receiver.getSession();
  if (drag && drag.kind !== "rectangle") {
    const deltaBeat = receiver.gestures.eventInteraction.delta();
    context.strokeStyle = palette.foreground;
    for (const rectangle of receiver.gestures.eventRects) {
      const rectLine = rectangle.lineIndex ?? session.lineIndex;
      const lineSelection =
        session.multiLineActive && session.multiLineMode === "events"
          ? (session.multiEventSelection?.get(rectLine) ?? new Set())
          : session.eventSelection;
      if (!lineSelection.has(eventKey(rectangle.type, rectangle.index))) {
        continue;
      }
      const event =
        session.multiLineActive && session.multiLineMode === "events"
          ? eventListAt(session, rectLine, rectangle.type)[rectangle.index]
          : eventList(session, rectangle.type)[rectangle.index];
      if (!event) {
        continue;
      }
      const vertical =
        session.multiLineActive && session.multiLineMode === "events"
          ? (beat: number) => receiver.viewport.verticalForLine(beat, rectLine, height)
          : (beat: number) => receiver.viewport.eventVertical(beat, rectangle.type);
      const top = vertical(beatValue(event.endTime) + (drag.kind === "startTime" ? 0 : deltaBeat));
      const bottom = vertical(
        beatValue(event.startTime) + (drag.kind === "endTime" ? 0 : deltaBeat),
      );
      context.strokeRect(rectangle.x, top, rectangle.width, bottom - top);
    }
  }
}
