/**
 * Paints and reuses the static vertical lane layer below timeline notes.
 *
 * The layer is independent from beat time. Its key covers layout, camera,
 * target lines, hover state, and colours, so cache hits cannot retain stale
 * geometry or stale hover highlighting.
 */
import { sourceOverColor } from "../../../../../../core/utils/colors.ts";
import { verticalGrid } from "../../../../../../core/global/chart/editing/editGrid.ts";
import type { TimelineNoteDrawingReceiver } from "../drawing/timelineReceiver.ts";
import { nearestPixelGuidePosition, strokeVerticalGuide } from "../drawing/timelineHoverGuides.ts";

/** Paint the cached note lanes into the timeline's backdrop. */
export function drawNoteLanes(
  receiver: TimelineNoteDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const key = noteLaneLayerKey(receiver, width, height);
  const layer = receiver.cache.canvasLayer(
    receiver.notesBackdrop,
    key,
    width,
    height,
    "note-lanes",
  );
  if (layer) {
    if (layer.repaint) {
      drawNoteLanesInto(receiver, layer.context, width, height);
    }
    context.drawImage(layer.canvas, 0, 0, width, height);
    return;
  }
  drawNoteLanesInto(receiver, context, width, height);
}

/** Return every geometry and appearance input used by the cached lane layer. */
function noteLaneLayerKey(
  receiver: TimelineNoteDrawingReceiver,
  width: number,
  height: number,
): string {
  const grid = verticalGrid(receiver.viewport.gridCount);
  const panelWidth = receiver.viewport.panelWidth(width, "notes");
  const inset = receiver.viewport.noteInset(panelWidth);
  const panelCount = receiver.viewport.panelCount("notes");
  const panelStride = receiver.viewport.panelStride(width, "notes");
  const panelOffset = receiver.viewport.multiLineViewportOffset(width, "notes");
  const [firstPanel, lastPanel] = receiver.viewport.visiblePanelRange(width, "notes");
  const targetLines = receiver.getSession().targetLineIndices;
  const cameraX = receiver.viewport.cameraX ?? 0;
  const pointer =
    receiver.gestures.hoverArea === "notes" && receiver.gestures.cursor
      ? `${receiver.gestures.cursor.x},${receiver.gestures.cursor.y}`
      : "";
  return [
    width,
    height,
    receiver.viewport.gridCount,
    grid.first,
    grid.spacing,
    grid.lineCount,
    panelWidth,
    inset,
    panelCount,
    panelStride,
    panelOffset,
    firstPanel,
    lastPanel,
    cameraX,
    targetLines.join(","),
    pointer,
    receiver.appearance.hoverGuidesEnabled,
    receiver.appearance.nearbyGuidesOnly,
    receiver.appearance.verticalGridColor,
    receiver.appearance.verticalGridCenterColor,
    receiver.appearance.gridHighlightColor,
  ].join("|");
}

/** Paint the lane layer into either the live or an offscreen context. */
function drawNoteLanesInto(
  receiver: TimelineNoteDrawingReceiver,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const grid = verticalGrid(receiver.viewport.gridCount);
  // Keep the lane grid tied to the actual panel geometry, so it fills the
  // visible width after a resize and in panels narrower than the canvas.
  const panelWidth = receiver.viewport.panelWidth(width, "notes");
  const inset = receiver.viewport.noteInset(panelWidth);
  const contentWidth = Math.max(1, panelWidth - inset * 2);
  const panelCount = receiver.viewport.panelCount("notes");
  const panelStride = receiver.viewport.panelStride(width, "notes");
  const panelOffset = receiver.viewport.multiLineViewportOffset(width, "notes");
  const targetLines = receiver.getSession().targetLineIndices;
  const mergedNotes = receiver.getSession().notesMode === "multi_merged";
  const [firstPanel, lastPanel] = receiver.viewport.visiblePanelRange(width, "notes");
  const cameraX = receiver.viewport.cameraX ?? 0;
  const hover =
    (receiver.appearance.hoverGuidesEnabled !== false ||
      receiver.appearance.nearbyGuidesOnly !== false) &&
    receiver.gestures.hoverArea === "notes" &&
    receiver.gestures.cursor
      ? (() => {
          const lineIndex = receiver.viewport.lineIndexAt(
            receiver.gestures.cursor.x,
            width,
            "notes",
          );
          return { lineIndex, pointer: receiver.gestures.cursor };
        })()
      : null;
  const chartLeft = cameraX - 675;
  const chartRight = cameraX + 675;
  const firstGrid = Math.max(0, Math.ceil(chartLeft / grid.spacing - grid.first));
  const lastGrid = Math.min(grid.lineCount - 1, Math.floor(chartRight / grid.spacing - grid.first));
  for (let panel = firstPanel; panel <= Math.min(lastPanel, panelCount - 1); panel++) {
    const lineIndex = targetLines[panel];
    if (lineIndex === undefined) {
      continue;
    }
    const horizontalForLane = (lane: number): number => {
      const local = inset + ((lane - cameraX + 675) / 1350) * contentWidth;
      return panel * panelStride - panelOffset + Math.max(0, Math.min(panelWidth, local));
    };
    const guidePositions: number[] = [];
    for (let index = firstGrid; index <= lastGrid; index++) {
      guidePositions.push(horizontalForLane((index + grid.first) * grid.spacing));
    }
    const panelPointer =
      mergedNotes || hover?.lineIndex === lineIndex ? (hover?.pointer ?? null) : null;
    const hoveredPosition =
      panelPointer !== null ? nearestPixelGuidePosition(guidePositions, panelPointer.x) : null;
    for (let index = firstGrid; index <= lastGrid; index++) {
      const lane = (index + grid.first) * grid.spacing;
      const center = Math.abs(lane - cameraX) < 1e-7;
      const baseColor = center
        ? receiver.appearance.verticalGridCenterColor
        : receiver.appearance.verticalGridColor;
      context.lineWidth = center ? 2 : 1;
      const horizontal = horizontalForLane(lane);
      const highlighted = hoveredPosition !== null && Math.abs(horizontal - hoveredPosition) < 1e-7;
      context.strokeStyle =
        highlighted && receiver.appearance.hoverGuidesEnabled !== false
          ? sourceOverColor(baseColor, receiver.appearance.gridHighlightColor)
          : baseColor;
      strokeVerticalGuide(
        context,
        horizontal,
        height,
        panelPointer,
        receiver.appearance.nearbyGuidesOnly === true,
      );
    }
  }
  context.lineWidth = 1;
}
