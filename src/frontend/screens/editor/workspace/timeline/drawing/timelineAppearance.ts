/**
 * Holds the timeline's draw-time appearance settings: note scale and opacity, bar
 * and event styling, curve thresholds, subdivision colors, and the skin.
 *
 * It is refreshed from editor display settings and owns no cursor, viewport, or
 * document state.
 */
import type { RpeSkin } from "../../../canvas/skin.ts";
import type { readEditorDisplaySettings } from "../../../../settings/editorDisplaySettings.ts";
import { DEFAULT_NOTE_OVERLAP_THRESHOLD } from "../../../../../../core/edit/timeline/noteOverlap.ts";

type AppearanceSettings = Pick<
  ReturnType<typeof readEditorDisplaySettings>["timeline"],
  | "noteScale"
  | "noteOpacity"
  | "multiLineNonCurrentOpacity"
  | "multiLineNoteLineNumbers"
  | "overlapThreshold"
  | "hoverGuidesEnabled"
  | "barWidth"
  | "barAlpha"
  | "playheadWidth"
  | "playheadColor"
  | "eventOpacity"
  | "eventBarWidth"
  | "eventValueFontSize"
  | "eventValueThreshold"
  | "eventCurveThreshold"
  | "eventCurvesEnabled"
  | "subdivisionColors"
  | "verticalGridColor"
  | "verticalGridHighlightColor"
  | "verticalGridCenterColor"
>;

/** Drawing preferences only; no cursor, viewport or document caches. */
export class TimelineAppearance {
  noteScale = 1;
  noteOpacity?: number;
  multiLineNonCurrentOpacity?: number;
  multiLineNoteLineNumbers = true;
  overlapThreshold = DEFAULT_NOTE_OVERLAP_THRESHOLD;
  hoverGuidesEnabled = true;
  skin: RpeSkin | null = null;
  barWidth?: number;
  barAlpha?: number;
  playheadWidth?: number;
  playheadColor?: string;
  eventOpacity?: number;
  eventBarWidth?: number;
  eventValueFontSize?: number;
  eventValueThreshold?: number;
  eventCurveThreshold?: number;
  eventCurvesEnabled?: boolean;
  subdivisionColors: readonly string[] = [];
  verticalGridColor = "#61640E";
  verticalGridHighlightColor = "#80810B";
  verticalGridCenterColor = "#9DA00B";

  /** Copy the current timeline display settings into this instance. */
  apply(config: AppearanceSettings): void {
    this.noteScale = config.noteScale;
    this.noteOpacity = config.noteOpacity;
    this.multiLineNonCurrentOpacity = config.multiLineNonCurrentOpacity;
    this.multiLineNoteLineNumbers = config.multiLineNoteLineNumbers;
    this.overlapThreshold = config.overlapThreshold;
    this.hoverGuidesEnabled = config.hoverGuidesEnabled;
    this.barWidth = config.barWidth;
    this.barAlpha = config.barAlpha;
    this.playheadWidth = config.playheadWidth;
    this.playheadColor = config.playheadColor;
    this.eventOpacity = config.eventOpacity;
    this.eventBarWidth = config.eventBarWidth;
    this.eventValueFontSize = config.eventValueFontSize;
    this.eventValueThreshold = config.eventValueThreshold;
    this.eventCurveThreshold = config.eventCurveThreshold;
    this.eventCurvesEnabled = config.eventCurvesEnabled;
    this.subdivisionColors = config.subdivisionColors;
    this.verticalGridColor = config.verticalGridColor;
    this.verticalGridHighlightColor = config.verticalGridHighlightColor;
    this.verticalGridCenterColor = config.verticalGridCenterColor;
  }
}
