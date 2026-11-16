/**
 * Persisted step values shared by numeric editor controls.
 *
 * The keys are intentionally data-only so the design system can accept values
 * and callbacks without importing chart or editor types.
 */
export const NOTE_POSITION_X_STEP_SETTING = "note-position-x-step";
export const NOTE_POSITION_X_OUTER_STEP_SETTING = "note-position-x-outer-step";

export const EVENT_STEP_SETTINGS = {
  moveXEvents: "event-move-x-step",
  moveYEvents: "event-move-y-step",
  rotateEvents: "event-rotate-step",
  alphaEvents: "event-alpha-step",
  speedEvents: "event-speed-step",
  scaleXEvents: "event-scale-x-step",
  scaleYEvents: "event-scale-y-step",
} as const;

export const EVENT_OUTER_STEP_SETTINGS = {
  moveXEvents: "event-move-x-outer-step",
  moveYEvents: "event-move-y-outer-step",
  rotateEvents: "event-rotate-outer-step",
  alphaEvents: "event-alpha-outer-step",
  speedEvents: "event-speed-outer-step",
  scaleXEvents: "event-scale-x-outer-step",
  scaleYEvents: "event-scale-y-outer-step",
} as const;

export type SteppableEventType = keyof typeof EVENT_STEP_SETTINGS;

/** The setting key for one event track, or undefined for a non-numeric track. */
export function eventStepSettingKey(eventType: string): string | undefined {
  return EVENT_STEP_SETTINGS[eventType as SteppableEventType];
}

/** The persisted outer-button step for one event track, or undefined when absent. */
export function eventOuterStepSettingKey(eventType: string): string | undefined {
  return EVENT_OUTER_STEP_SETTINGS[eventType as SteppableEventType];
}

/** Defaults used both by settings registration and editor fallback paths. */
export const STEPPER_DEFAULTS = {
  [NOTE_POSITION_X_STEP_SETTING]: 5,
  [NOTE_POSITION_X_OUTER_STEP_SETTING]: 100,
  "event-move-x-step": 5,
  "event-move-y-step": 5,
  "event-rotate-step": 1,
  "event-alpha-step": 10,
  "event-speed-step": 0.1,
  "event-scale-x-step": 0.1,
  "event-scale-y-step": 0.1,
  "event-move-x-outer-step": 100,
  "event-move-y-outer-step": 100,
  "event-rotate-outer-step": 10,
  "event-alpha-outer-step": 60,
  "event-speed-outer-step": 1,
  "event-scale-x-outer-step": 1,
  "event-scale-y-outer-step": 1,
} as const;
