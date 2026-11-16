/** Draws edge-only cues for note bodies that are fully outside a timeline viewport. */
import type { CanvasPalette } from "../../../canvas/palette.ts";
import type { TimelineNoteDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { offscreenCueAlpha, offscreenCueDistance, offscreenCueSides } from "./noteOffscreenCue.ts";

/** Projection data needed to place a note cue on the vertical time axis. */
export interface NoteCueProjection {
  /** Factor used to prepare the note's cached timing data. */
  readonly factor: number;
  /** Project chart seconds into the note timeline. */
  readonly project: (seconds: number) => number;
}

/** Paint edge-only cues when a scaled note is fully outside its panel viewport. */
export function drawNoteTimelineCues(
  receiver: TimelineNoteDrawingReceiver,
  context: CanvasRenderingContext2D,
  palette: CanvasPalette,
  width: number,
  height: number,
  projectionFor: (
    receiver: Pick<TimelineNoteDrawingReceiver, "cache" | "viewport">,
    lineIndex: number,
    height: number,
  ) => NoteCueProjection,
): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  const session = receiver.getSession();
  const multiplePanels = session.multiLineActive && receiver.viewport.panelCount("notes") > 1;
  const lineIndices = session.multiLineActive
    ? session.targetLineIndices.length > 0
      ? session.targetLineIndices
      : [session.lineIndex]
    : [session.lineIndex];
  const panelWidth = receiver.viewport.panelWidth(width, "notes");
  const panelStride = receiver.viewport.panelStride(width, "notes");
  const panelOffset = receiver.viewport.multiLineViewportOffset(width, "notes");
  const [firstPanel, lastPanel] = multiplePanels
    ? receiver.viewport.visiblePanelRange(width, "notes")
    : [0, 0];
  const startPanel = multiplePanels ? firstPanel : 0;
  const endPanel = multiplePanels ? Math.min(lastPanel, lineIndices.length - 1) : 0;
  const cueHalfHeight = Math.min(28, Math.max(18, height / 24));
  const cueColor = palette.foreground;
  context.save();
  context.fillStyle = cueColor;
  context.shadowColor = cueColor;
  context.shadowBlur = 12;
  const cueWidth = Math.min(24, Math.max(12, width / 40));
  for (let panel = startPanel; panel <= endPanel; panel++) {
    const panelLeft = multiplePanels ? panel * panelStride - panelOffset : 0;
    const panelRight = panelLeft + (multiplePanels ? panelWidth : width);
    const panelLines = multiplePanels ? [lineIndices[panel] ?? session.lineIndex] : lineIndices;
    for (const lineIndex of panelLines) {
      const [bottomBeat, topBeat] = receiver.viewport.noteBeatRangeForLine(
        lineIndex,
        height,
        "notes",
      );
      const line = session.chart.judgeLineList?.[lineIndex];
      receiver.cache.refreshNotes(lineIndex, line?.notes ?? []);
      const noteIndex = receiver.cache.noteIndex(lineIndex);
      if (!noteIndex) {
        continue;
      }
      const projection = projectionFor(receiver, lineIndex, height);
      const panelProjection = receiver.viewport.notePanelProjectionForLine(width, lineIndex);
      const cachedNoteData = receiver.cache.noteRenderDataSet(
        noteIndex.notes,
        receiver.viewport.tempo,
        projection.factor,
        receiver.viewport.gridCount,
      );
      for (let index = 0; index < noteIndex.notes.length; index++) {
        const note = noteIndex.notes[index];
        const prepared = cachedNoteData[index];
        if (!prepared || Math.max(prepared.start, prepared.end) < bottomBeat) {
          continue;
        }
        if (Math.min(prepared.start, prepared.end) > topBeat) {
          continue;
        }
        const horizontal = panelProjection.horizontal(note.positionX);
        const noteWidth = receiver.viewport.noteWidth(note);
        const sides = offscreenCueSides(horizontal, noteWidth, panelLeft, panelRight);
        if (!sides.length) {
          continue;
        }
        const vertical = projection.project(prepared.startSeconds);
        const top = Math.max(0, Math.min(height - 1, vertical - cueHalfHeight));
        const cueHeight = Math.min(height - top, cueHalfHeight * 2);
        const viewportWidth = Math.max(1, panelRight - panelLeft);
        for (const side of sides) {
          const distance = offscreenCueDistance(horizontal, noteWidth, panelLeft, panelRight, side);
          if (distance === null) {
            continue;
          }
          context.globalAlpha = offscreenCueAlpha(distance, viewportWidth);
          const edgeLeft = side === "left" ? panelLeft : panelRight - cueWidth;
          const visibleLeft = Math.max(0, edgeLeft);
          const visibleRight = Math.min(width, edgeLeft + cueWidth);
          if (visibleRight <= visibleLeft) {
            continue;
          }
          const gradient = context.createLinearGradient(edgeLeft, 0, edgeLeft + cueWidth, 0);
          if (side === "left") {
            gradient.addColorStop(0, cueColor);
            gradient.addColorStop(1, "transparent");
          } else {
            gradient.addColorStop(0, "transparent");
            gradient.addColorStop(1, cueColor);
          }
          context.fillStyle = gradient;
          context.fillRect(visibleLeft, top, visibleRight - visibleLeft, cueHeight);
        }
      }
    }
  }
  context.restore();
}
