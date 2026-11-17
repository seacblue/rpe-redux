/**
 * Editing settings that do not belong to a single settings page: beat-line
 * appearance, note highlighting and event rendering thresholds.
 *
 * Rows point at the page that owns their intent: chart appearance under
 * Appearance, interaction under Editor.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import { values } from "../../state/values.ts";
import "../editorRuntime.ts";
import {
  EVENT_OUTER_STEP_SETTINGS,
  EVENT_STEP_SETTINGS,
  NOTE_POSITION_X_OUTER_STEP_SETTING,
  NOTE_POSITION_X_STEP_SETTING,
  STEPPER_DEFAULTS,
} from "../stepperSettings.ts";

const EVENT_STEPPER_LABELS = [
  [
    "moveXEvents",
    "settings.field.event-move-x-step.label",
    "settings.field.event-move-x-step.description",
  ],
  [
    "moveYEvents",
    "settings.field.event-move-y-step.label",
    "settings.field.event-move-y-step.description",
  ],
  [
    "rotateEvents",
    "settings.field.event-rotate-step.label",
    "settings.field.event-rotate-step.description",
  ],
  [
    "alphaEvents",
    "settings.field.event-alpha-step.label",
    "settings.field.event-alpha-step.description",
  ],
  [
    "speedEvents",
    "settings.field.event-speed-step.label",
    "settings.field.event-speed-step.description",
  ],
  [
    "scaleXEvents",
    "settings.field.event-scale-x-step.label",
    "settings.field.event-scale-x-step.description",
  ],
  [
    "scaleYEvents",
    "settings.field.event-scale-y-step.label",
    "settings.field.event-scale-y-step.description",
  ],
] as const;

const eventStepperSettings = EVENT_STEPPER_LABELS.flatMap(([eventType, label, description]) => {
  const key = EVENT_STEP_SETTINGS[eventType];
  const outerKey = EVENT_OUTER_STEP_SETTINGS[eventType];
  const base = {
    navigation: "editor.events" as const,
    group: "settings.group.stepper" as const,
    control: "number" as const,
    min: 0.01,
    max: 1000,
    step: 0.01,
  };
  return [
    {
      ...base,
      key,
      label: label as SettingDefinition["label"],
      description: description as SettingDefinition["description"],
      default: STEPPER_DEFAULTS[key],
    },
    {
      ...base,
      key: outerKey,
      label: label.replace(".label", ".outer.label") as SettingDefinition["label"],
      description: description.replace(
        ".description",
        ".outer.description",
      ) as SettingDefinition["description"],
      default: STEPPER_DEFAULTS[outerKey],
    },
  ];
});

const EditingSettingsSchema: SettingDefinition[] = [
  {
    key: NOTE_POSITION_X_STEP_SETTING,
    navigation: "editor.events",
    group: "settings.group.stepper",
    label: "settings.field.note-position-x-step.label",
    description: "settings.field.note-position-x-step.description",
    control: "number",
    default: STEPPER_DEFAULTS[NOTE_POSITION_X_STEP_SETTING],
    min: 0.01,
    max: 1000,
    step: 0.01,
  },
  {
    key: NOTE_POSITION_X_OUTER_STEP_SETTING,
    navigation: "editor.events",
    group: "settings.group.stepper",
    label: "settings.field.note-position-x-outer-step.label",
    description: "settings.field.note-position-x-outer-step.description",
    control: "number",
    default: STEPPER_DEFAULTS[NOTE_POSITION_X_OUTER_STEP_SETTING],
    min: 0.01,
    max: 1000,
    step: 0.01,
  },
  ...(eventStepperSettings as SettingDefinition[]),
  {
    key: "bar-width",
    navigation: "editor.beat-lines",
    group: "settings.group.timelineBeatLines",
    label: "settings.field.bar-width.label",
    control: "range",
    default: 3,
    min: 0.5,
    max: 10,
    step: 0.1,
  },
  {
    key: "bar-alpha",
    navigation: "editor.beat-lines",
    group: "settings.group.timelineBeatLines",
    label: "settings.field.bar-alpha.label",
    control: "range",
    default: 1,
    min: 0.1,
    max: 2,
    step: 0.05,
  },
  {
    key: "timeline-playhead-height",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.timeline-playhead-height.label",
    control: "range",
    default: 42,
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: "timeline-playhead-width",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.timeline-playhead-width.label",
    control: "range",
    default: 3,
    min: 0.5,
    max: 6,
    step: 0.1,
  },
  {
    key: "timeline-playhead-color",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.timeline-playhead-color.label",
    control: "color",
    default: "#FF3B6B",
  },
  {
    key: "highlight-notes",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.highlight-notes.label",
    description: "settings.field.highlight-notes.description",
    control: "toggle",
    default: true,
  },
  {
    key: "event-cut-density",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-cut-density.label",
    description: "settings.field.event-cut-density.description",
    control: "number",
    default: 2,
    min: 1,
    max: 16,
    step: 1,
    integer: true,
  },
  {
    key: "xy-binding",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.xy-binding.label",
    description: "settings.field.xy-binding.description",
    control: "toggle",
    default: false,
  },
  {
    key: "event-value-threshold",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-value-threshold.label",
    description: "settings.field.event-value-threshold.description",
    control: "range",
    default: 30,
    min: 10,
    max: 180,
    step: 1,
  },
  {
    key: "event-curve-threshold",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-curve-threshold.label",
    description: "settings.field.event-curve-threshold.description",
    control: "range",
    default: 24,
    min: 8,
    max: 180,
    step: 1,
    enabledWhen: { key: "event-curves-enabled", equals: true },
  },
  {
    key: "event-curves-enabled",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-curves-enabled.label",
    description: "settings.field.event-curves-enabled.description",
    control: "toggle",
    default: true,
  },
  {
    key: "event-opacity",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-opacity.label",
    control: "range",
    default: 0.6,
    min: 0.05,
    max: 1,
    step: 0.05,
    percentage: true,
  },
  {
    key: "event-bar-width",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.event-bar-width.label",
    control: "range",
    default: 0.82,
    min: 0.35,
    max: 1,
    step: 0.01,
  },
];
settingsRegistry.registerSettings(EditingSettingsSchema);

/** Adopt the old imported event-wheel array into the named settings once. */
const legacyEventSteps = values.getHandle<string>("event-wheel-increments");
const legacyValues = (() => {
  try {
    const parsed: unknown = JSON.parse(legacyEventSteps.get() || "");
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
})();
const legacyEventTypes = Object.keys(EVENT_STEP_SETTINGS) as Array<
  keyof typeof EVENT_STEP_SETTINGS
>;
for (const [index, eventType] of legacyEventTypes.entries()) {
  const key = EVENT_STEP_SETTINGS[eventType];
  const legacy = legacyValues[index];
  if (Number.isFinite(legacy)) {
    const setting = values.getHandle<string>(key);
    if (setting.get() === String(STEPPER_DEFAULTS[key])) {
      setting.set(String(legacy));
    }
  }
}
if (legacyValues.length > 0) {
  legacyEventSteps.set("");
}
