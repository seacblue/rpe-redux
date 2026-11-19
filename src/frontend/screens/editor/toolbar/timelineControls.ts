/**
 * Commits toolbar and transport edits to the timeline and session.
 *
 * Division, grid count, scale, and snap changes are written once here, so the
 * fields, the transport stretch bar, the menus, and the shortcuts share one path.
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
} from "../../../../core/edit/timeline/timelineScale.ts";

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
  /** Cancel a pending wheel zoom before a stretch gesture writes the scale. */
  cancelTimelineZoom?: () => void;
}

/** Numeric viewport properties the toolbar fields can commit. */
export type NumericTimelineProperty = "division" | "gridCount" | "scale";

/** Runtime actions installed by `bindTimelineControlInputs`. */
interface TimelineControlActions {
  commitNumeric(property: NumericTimelineProperty, rawValue: string): void;
  applyScale(scale: number): void;
  commitScale(): void;
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
  const { timeline, getSession, updateCurvePanel, persistEditor, invalidate, cancelTimelineZoom } =
    options;
  const currentActions: TimelineControlActions = {
    commitNumeric(property, rawValue) {
      const field = {
        division: { minimum: 1, maximum: 100, integer: true },
        gridCount: { minimum: 1, maximum: 100, integer: false },
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
    applyScale(scale) {
      // A wheel zoom animates its own target; a slider drag owns the scale from
      // now on, so stopping the animation is part of taking over.
      cancelTimelineZoom?.();
      const next = clampTimelineScale(scale, timeline.viewport.scale);
      if (next === timeline.viewport.scale) {
        return;
      }
      timeline.viewport.scale = next;
      // The transport row keeps the live value in its own draft while the
      // pointer moves; publishing here would repaint the whole toolbar on every
      // pointer event.
      invalidate();
    },
    commitScale() {
      // The drag updated the viewport without touching preferences; one write
      // after release keeps the settings pass off every pointer move.
      editorScale.set(String(timeline.viewport.scale));
      persistEditor();
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

/**
 * Apply a live vertical scale from the transport stretch bar.
 *
 * The write repaints immediately but leaves preferences alone until the gesture
 * commits, so a drag does not re-apply every editor setting on each pointer move.
 */
export function setTimelineScale(scale: number): void {
  actions?.applyScale(scale);
}

/** Persist the scale a stretch gesture settled on. */
export function commitTimelineScale(): void {
  actions?.commitScale();
}
