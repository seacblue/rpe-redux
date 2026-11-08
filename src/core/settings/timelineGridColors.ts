/**
 * The timeline subdivision colour table.
 *
 * The settings schema, the runtime decoder, and the beat-line preview all read
 * the same denominators and defaults. The table lives in core because the schema
 * owns the persisted keys; the preview imports it from there.
 */
export const TIMELINE_GRID_COLORS = [
  ["1", "#ffffff", "settings.field.timeline-grid-color-1.label"],
  ["2", "#ed1121", "settings.field.timeline-grid-color-2.label"],
  ["3", "#8866ee", "settings.field.timeline-grid-color-3.label"],
  ["4", "#66ccff", "settings.field.timeline-grid-color-4.label"],
  ["6", "#eeaa00", "settings.field.timeline-grid-color-6.label"],
  ["8", "#ffcc22", "settings.field.timeline-grid-color-8.label"],
  ["12", "#cc6600", "settings.field.timeline-grid-color-12.label"],
  ["16", "#6644cc", "settings.field.timeline-grid-color-16.label"],
  ["default", "#6aa7ff", "settings.field.timeline-grid-color-default.label"],
] as const;

/** Denominators with a dedicated grid colour, plus the fallback entry. */
export type TimelineGridDenominator = (typeof TIMELINE_GRID_COLORS)[number][0];

/** Preference key holding the colour for one subdivision denominator. */
export function timelineGridColorKey(denominator: TimelineGridDenominator): string {
  return `timeline-grid-color-${denominator}`;
}

/** The shared vertical timeline-line colours used by notes and events. */
export const TIMELINE_VERTICAL_GRID_COLORS = [
  [
    "normal",
    "#61640E",
    "settings.field.timeline-vertical-grid-color.label",
    "settings.field.timeline-vertical-grid-color.description",
  ],
  [
    "center",
    "#9DA00B",
    "settings.field.timeline-vertical-grid-center-color.label",
    "settings.field.timeline-vertical-grid-center-color.description",
  ],
] as const;

/** The vertical timeline-line roles with user-configurable colours. */
export type TimelineVerticalGridColorRole = (typeof TIMELINE_VERTICAL_GRID_COLORS)[number][0];

/** Preference key holding one shared vertical timeline-line colour. */
export function timelineVerticalGridColorKey(role: TimelineVerticalGridColorRole): string {
  return `timeline-vertical-grid-color-${role}`;
}

/** The shared overlay colour for the highlighted horizontal and vertical grid lines. */
export const TIMELINE_GRID_HIGHLIGHT_COLOR = [
  "#FFFFFF80",
  "settings.field.timeline-grid-highlight-color.label",
  "settings.field.timeline-grid-highlight-color.description",
] as const;

/** Preference key holding the colour painted over highlighted grid lines. */
export function timelineGridHighlightColorKey(): string {
  return "timeline-grid-highlight-color";
}
