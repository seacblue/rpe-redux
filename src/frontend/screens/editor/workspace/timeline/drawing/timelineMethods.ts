/**
 * Installs the satellite drawing, hit-testing, selection, and gesture functions on
 * the `Timeline` prototype as one method table.
 *
 * Implementations stay in their feature modules; this file only assembles the
 * runtime surface.
 */
import {
  rectangleSelection,
  sweepSelection,
  rectangleStart,
  rectangleTimes,
  refreshRectangleSelection,
  updateRectangle,
  updateSweep,
  finishRectangle,
} from "../selection/rectangleSelection.ts";
import { cancelPlacement, autoScroll } from "../interaction/timelineInteraction.ts";
import { movedNote, move, down, up } from "../notes/noteInteraction.ts";
import { refreshIndex, visible, hit } from "../notes/noteHitTest.ts";
import { addAtCursor } from "../notes/noteInsertion.ts";
import {
  grid,
  gridForLine,
  drawMultiLineGrid,
  drawMultiLineBeatLabels,
  drawMultiLinePanelLabels,
} from "./gridDrawing.ts";
import { draw, drawMultiLineNotes, drawPlayhead } from "../notes/noteDrawing.ts";
import { drawCurveGhost } from "../notes/curveGhostDrawing.ts";
import { drawEvents, drawMultiLineEvents } from "../events/eventDrawing.ts";
import { drawShaderEvents } from "../events/eventOverlayDrawing.ts";

/** The satellite implementations installed on `Timeline.prototype`. */
export const timelineMethods = {
  rectangleSelection,
  sweepSelection,
  rectangleStart,
  rectangleTimes,
  refreshRectangleSelection,
  updateRectangle,
  updateSweep,
  finishRectangle,
  cancelPlacement,
  movedNote,
  autoScroll,
  refreshIndex,
  visible,
  hit,
  move,
  down,
  up,
  addAtCursor,
  grid,
  gridForLine,
  drawMultiLineGrid,
  drawMultiLineBeatLabels,
  drawMultiLinePanelLabels,
  draw,
  drawPlayhead,
  drawMultiLineNotes,
  drawMultiLineEvents,
  drawCurveGhost,
  drawEvents,
  drawShaderEvents,
} as const;

export type TimelineMethodSurface = {
  [K in keyof typeof timelineMethods]: OmitThisParameter<(typeof timelineMethods)[K]>;
};
