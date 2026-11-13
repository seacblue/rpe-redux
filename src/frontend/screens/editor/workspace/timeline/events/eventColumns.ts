/**
 * Resolves which event columns the multi-line event field paints.
 *
 * The five ordinary tracks keep independent display switches while multi-line
 * event editing is active. Global XY binding couples the X and Y permissions:
 * both columns still paint, but one XY switch controls them and their effective
 * visibility is the OR. Storage types, hit-test rectangles, and selection keys
 * stay real track names, so chart serialization is never involved.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { globalXYBindingEnabled } from "../../../../../../core/edit/events/eventTracks.ts";
import { noiseLineSettings } from "../../../../../../core/global/chart/noise/noiseLine.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { eventTypesForLine } from "../drawing/tracks.ts";

/** The five ordinary tracks controlled by the multi-line event switches. */
export interface EventTypeVisibility {
  readonly x: boolean;
  readonly y: boolean;
  readonly rotate: boolean;
  readonly alpha: boolean;
  readonly speed: boolean;
}

/** Current checkbox state for the five ordinary event tracks. */
export function readEventTypeVisibility(): EventTypeVisibility {
  return {
    x: displayValues.multiLineEventShowX.get(),
    y: displayValues.multiLineEventShowY.get(),
    rotate: displayValues.multiLineEventShowRotate.get(),
    alpha: displayValues.multiLineEventShowAlpha.get(),
    speed: displayValues.multiLineEventShowSpeed.get(),
  };
}

/** Return the display-switch bitmask used by multi-line event columns. */
export function eventColumnVisibilityKey(): number {
  const visibility = readEventTypeVisibility();
  return (
    (visibility.x ? 1 : 0) |
    (visibility.y ? 2 : 0) |
    (visibility.rotate ? 4 : 0) |
    (visibility.alpha ? 8 : 0) |
    (visibility.speed ? 16 : 0) |
    (globalXYBindingEnabled() ? 32 : 0)
  );
}

/**
 * Apply global XY binding to the raw checkbox state.
 *
 * Binding treats the two axes as one permission: either switch keeps both axes
 * on, so the persisted raw pair can remain independent while the visible state
 * is the OR until the binding transition distributes it back to both switches.
 */
export function effectiveEventTypeVisibility(
  visibility: EventTypeVisibility,
  xyBinding: boolean,
): EventTypeVisibility {
  if (!xyBinding) {
    return visibility;
  }
  const axis = visibility.x || visibility.y;
  return { ...visibility, x: axis, y: axis };
}

/** Whether the multi-line event field is the active surface. */
function multiLineEventsActive(session: Pick<EditorSession, "multiLineActive" | "multiLineMode">) {
  return session.multiLineActive && session.multiLineMode === "events";
}

/** Whether the ordinary five-track switches govern this line's field. */
function switchesApplyToLine(
  session: Pick<EditorSession, "chart" | "multiLineActive" | "multiLineMode">,
  lineIndex: number,
  extended: boolean,
): boolean {
  if (!multiLineEventsActive(session) || extended) {
    return false;
  }
  return !noiseLineSettings(session.chart.judgeLineList?.[lineIndex]);
}

/** Real track keys that the user may select on one line. */
export function visibleEventTypesForLine(
  session: Pick<EditorSession, "chart" | "multiLineActive" | "multiLineMode">,
  lineIndex: number,
  extended: boolean,
): string[] {
  const types = eventTypesForLine(session.chart.judgeLineList?.[lineIndex], extended);
  if (!switchesApplyToLine(session, lineIndex, extended)) {
    return types;
  }
  const visibility = effectiveEventTypeVisibility(
    readEventTypeVisibility(),
    globalXYBindingEnabled(),
  );
  return types.filter((type) => visibilityForTrack(type, visibility));
}

/**
 * Display columns for one line.
 *
 * Outside multi-line event editing, on extended tracks, and on noise lines the
 * raw track list is returned unchanged. Otherwise the checked tracks survive.
 * XY binding keeps the X and Y columns side by side and gives them one shared
 * permission; it never collapses them into a synthetic column.
 */
export function eventColumnsForLine(
  session: Pick<EditorSession, "chart" | "multiLineActive" | "multiLineMode">,
  lineIndex: number,
  extended: boolean,
): string[] {
  const types = eventTypesForLine(session.chart.judgeLineList?.[lineIndex], extended);
  if (!switchesApplyToLine(session, lineIndex, extended)) {
    return types;
  }
  const visibility = effectiveEventTypeVisibility(
    readEventTypeVisibility(),
    globalXYBindingEnabled(),
  );
  const columns: string[] = [];
  if (visibility.x) {
    columns.push("moveXEvents");
  }
  if (visibility.y) {
    columns.push("moveYEvents");
  }
  if (visibility.rotate) {
    columns.push("rotateEvents");
  }
  if (visibility.alpha) {
    columns.push("alphaEvents");
  }
  if (visibility.speed) {
    columns.push("speedEvents");
  }
  return columns;
}

/** Display column that paints one real storage track, or -1 when hidden. */
export function eventColumnForTrack(columns: readonly string[], type: string): number {
  return columns.indexOf(type);
}

/** Localized header for one display column. */
export function eventColumnLabel(
  column: string,
  rawTypes: readonly string[],
  labels: readonly string[],
): string {
  const index = rawTypes.indexOf(column);
  return index >= 0 ? (labels[index] ?? column) : column;
}

/** Visibility for one ordinary track; unknown tracks always stay visible. */
function visibilityForTrack(type: string, visibility: EventTypeVisibility): boolean {
  if (type === "moveXEvents") {
    return visibility.x;
  }
  if (type === "moveYEvents") {
    return visibility.y;
  }
  if (type === "rotateEvents") {
    return visibility.rotate;
  }
  if (type === "alphaEvents") {
    return visibility.alpha;
  }
  if (type === "speedEvents") {
    return visibility.speed;
  }
  return true;
}
