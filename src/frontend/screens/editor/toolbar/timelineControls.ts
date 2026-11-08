/**
 * Commits toolbar edits to the timeline and session.
 *
 * Division, grid count, and scale changes are written once here, so the fields, the
 * menus, and the shortcuts share one path.
 */
import type { EditorSession } from "../../../../core/edit/session/session.ts";
import type { Timeline } from "../workspace/timeline/surface/timeline.ts";
import {
  editorDivision,
  editorGridCount,
  editorScale,
  editorSnapX,
} from "../../../../core/edit/state/publishedValues.ts";
import {
  clampTimelineScale,
  TIMELINE_SCALE_MAX,
  TIMELINE_SCALE_MIN,
} from "../workspace/timeline/viewport/timelineViewport.ts";

interface TimelineControlBindingOptions {
  timeline: Timeline;
  /**
   * A getter, not the session itself, so a newly opened chart's session receives
   * the committed division.
   */
  getSession(): EditorSession;
  updateCurvePanel: () => void;
  persistEditor: () => void;
  invalidate: () => void;
}

/** Numeric viewport properties the toolbar fields can commit. */
export type NumericTimelineProperty = "division" | "gridCount" | "scale";

/** Runtime actions installed by `bindTimelineControlInputs`. */
interface TimelineControlActions {
  commitNumeric(property: NumericTimelineProperty, rawValue: string): void;
  updateScale(rawValue: string): void;
  toggleSnap(enabled: boolean): void;
}

/** The value a committed number writes back, so the field shows what the document took. */
const controlValue = (property: NumericTimelineProperty) =>
  property === "division"
    ? editorDivision
    : property === "gridCount"
      ? editorGridCount
      : editorScale;

let actions: TimelineControlActions | null = null;

/** Install runtime actions consumed by the toolbar's field entries. */
export function bindTimelineControlInputs(options: TimelineControlBindingOptions): () => void {
  const { timeline, getSession, updateCurvePanel, persistEditor, invalidate } = options;
  const currentActions: TimelineControlActions = {
    commitNumeric(property, rawValue) {
      const field = {
        division: { minimum: 1, maximum: 100, integer: true },
        gridCount: { minimum: 1, maximum: 100, integer: true },
        scale: { minimum: TIMELINE_SCALE_MIN, maximum: TIMELINE_SCALE_MAX, integer: false },
      }[property];
      const value = Number(rawValue);
      if (Number.isFinite(value)) {
        timeline.viewport[property] = Math.max(
          field.minimum,
          Math.min(field.maximum, field.integer ? Math.round(value) : value),
        );
      }
      controlValue(property).set(String(timeline.viewport[property]));
      getSession().division = timeline.viewport.division;
      updateCurvePanel();
      persistEditor();
      invalidate();
    },
    updateScale(rawValue) {
      timeline.viewport.scale = clampTimelineScale(Number(rawValue), timeline.viewport.scale);
      editorScale.set(String(timeline.viewport.scale));
      persistEditor();
      invalidate();
    },
    toggleSnap(enabled) {
      timeline.viewport.snapX = enabled;
      editorSnapX.set(enabled);
      persistEditor();
      invalidate();
    },
  };
  actions = currentActions;
  return () => {
    if (actions === currentActions) {
      actions = null;
    }
  };
}

/** Commit one numeric toolbar field through the bound runtime actions. */
export function commitTimelineNumeric(property: NumericTimelineProperty, rawValue: string): void {
  actions?.commitNumeric(property, rawValue);
}
