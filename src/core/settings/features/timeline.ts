/**
 * The Editor settings category: timeline layout and wheel, pointer aids, event
 * rendering, and beat-line appearance.
 *
 * The category is the task-oriented home for interaction while editing. Visual
 * defaults for judge lines and notes live under Appearance so they remain
 * global to the chart renderer.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import type { SettingsNavigation } from "../types.ts";
import {
  TIMELINE_GRID_COLORS,
  TIMELINE_GRID_HIGHLIGHT_COLOR,
  TIMELINE_VERTICAL_GRID_COLORS,
  timelineGridColorKey,
  timelineGridHighlightColorKey,
  timelineVerticalGridColorKey,
} from "../timelineGridColors.ts";
import { DEFAULT_NOTE_OVERLAP_THRESHOLD } from "../../edit/timeline/noteOverlap.ts";

const EditorSettingsNavigation: SettingsNavigation = {
  key: "editor",
  label: "settings.category.editor.label",
  icon: "pencil",
  order: 30,
};

const EditorSettingsSubPages: SettingsNavigation[] = [
  {
    key: "editor.timeline",
    parent: "editor",
    label: "settings.group.timeline",
    icon: "clock",
    order: 10,
  },
  {
    key: "editor.pointer",
    parent: "editor",
    label: "settings.group.pointer",
    icon: "select",
    order: 20,
  },
  {
    key: "editor.events",
    parent: "editor",
    label: "settings.group.events",
    icon: "bezier",
    order: 30,
  },
  {
    key: "editor.beat-lines",
    parent: "editor",
    label: "settings.group.beatLines",
    icon: "grid",
    order: 40,
  },
];

const TIMELINE_SUBDIVISION_COLORS: SettingDefinition[] = TIMELINE_GRID_COLORS.map(
  ([denominator, defaultColor, label]) => ({
    key: timelineGridColorKey(denominator),
    navigation: "editor.beat-lines",
    group: "settings.group.beatLines",
    label: label as SettingDefinition["label"],
    control: "color",
    default: defaultColor,
  }),
);

const TIMELINE_VERTICAL_COLORS: SettingDefinition[] = TIMELINE_VERTICAL_GRID_COLORS.map(
  ([role, defaultColor, label, description]) => ({
    key: timelineVerticalGridColorKey(role),
    navigation: "editor.beat-lines",
    group: "settings.group.beatLines",
    label: label as SettingDefinition["label"],
    description: description as SettingDefinition["description"],
    control: "color",
    default: defaultColor,
  }),
);

const TimelineSettingsSchema: SettingDefinition[] = [
  {
    key: "timeline-exclusive-width",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.timeline-exclusive-width.label",
    control: "range",
    default: 75,
    min: 0,
    max: 100,
    step: 1,
  },
  {
    key: "multi-edit-history-limit",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.multi-edit-history-limit.label",
    description: "settings.field.multi-edit-history-limit.description",
    control: "number",
    default: 100,
    min: 10,
    max: 100,
    step: 10,
  },
  {
    key: "multi-line-merge-notes",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.multi-line-merge-notes.label",
    description: "settings.field.multi-line-merge-notes.description",
    control: "toggle",
    default: true,
  },
  {
    key: "multi-line-note-line-numbers",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.multi-line-note-line-numbers.label",
    control: "toggle",
    default: true,
    enabledWhen: { key: "multi-line-merge-notes", equals: true },
  },
  {
    key: "timeline-undo-jump",
    navigation: "editor.timeline",
    group: "settings.group.timelineLayout",
    label: "settings.field.timeline-undo-jump.label",
    description: "settings.field.timeline-undo-jump.description",
    control: "toggle",
    default: false,
  },
  {
    key: "scroll-speed",
    navigation: "editor.timeline",
    group: "settings.group.wheel",
    label: "settings.field.scroll-speed.label",
    control: "range",
    default: 5,
    min: 0.1,
    max: 100,
    step: 0.1,
  },
  {
    key: "scroll-acceleration",
    navigation: "editor.timeline",
    group: "settings.group.wheel",
    label: "settings.field.scroll-acceleration.label",
    description: "settings.field.scroll-acceleration.description",
    control: "toggle",
    default: false,
  },
  {
    key: "key-press-label-enabled",
    navigation: "editor.pointer",
    group: "settings.group.pointer",
    label: "settings.field.key-press-label-enabled.label",
    control: "toggle",
    default: false,
  },
  {
    key: "mouse-trail-enabled",
    navigation: "editor.pointer",
    group: "settings.group.pointer",
    label: "settings.field.mouse-trail-enabled.label",
    control: "toggle",
    default: false,
  },
  {
    key: "hover-guides-enabled",
    navigation: "editor.pointer",
    group: "settings.group.pointer",
    label: "settings.field.hover-guides-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: "timeline-density-bars-enabled",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-density-bars-enabled.label",
    description: "settings.field.timeline-density-bars-enabled.description",
    control: "toggle",
    default: true,
  },
  {
    key: "timeline-overview-strip-width",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-overview-strip-width.label",
    description: "settings.field.timeline-overview-strip-width.description",
    control: "range",
    default: 24,
    min: 8,
    max: 48,
    step: 1,
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "timeline-hover-preview-enabled",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-hover-preview-enabled.label",
    control: "toggle",
    default: false,
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "timeline-clipboard-range-bars-enabled",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-clipboard-range-bars-enabled.label",
    control: "toggle",
    default: true,
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "timeline-clipboard-range-color",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-clipboard-range-color.label",
    control: "color",
    default: "#00C800",
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "timeline-paste-range-color",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-paste-range-color.label",
    control: "color",
    default: "#FFCC66",
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "timeline-range-bar-opacity",
    navigation: "editor.timeline",
    group: "settings.group.overview",
    label: "settings.field.timeline-range-bar-opacity.label",
    description: "settings.field.timeline-range-bar-opacity.description",
    control: "range",
    default: 0.18,
    min: 0.02,
    max: 0.8,
    step: 0.01,
    percentage: true,
    enabledWhen: { key: "timeline-density-bars-enabled", equals: true },
  },
  {
    key: "note-overlap-threshold",
    navigation: "editor.timeline",
    group: "settings.group.noteOverlap",
    label: "settings.field.note-overlap-threshold.label",
    description: "settings.field.note-overlap-threshold.description",
    control: "number",
    default: DEFAULT_NOTE_OVERLAP_THRESHOLD,
    min: 0,
    max: 1350,
    step: 1,
  },
  {
    key: "multi-line-event-window-count",
    navigation: "editor.events",
    group: "settings.group.timelineEvents",
    label: "settings.field.multi-line-event-window-count.label",
    control: "number",
    default: 3,
    min: 1,
    max: 100,
    step: 1,
    integer: true,
  },
  ...TIMELINE_SUBDIVISION_COLORS,
  ...TIMELINE_VERTICAL_COLORS,
  {
    key: timelineGridHighlightColorKey(),
    navigation: "editor.beat-lines",
    group: "settings.group.beatLines",
    label: TIMELINE_GRID_HIGHLIGHT_COLOR[1],
    description: TIMELINE_GRID_HIGHLIGHT_COLOR[2],
    control: "color",
    default: TIMELINE_GRID_HIGHLIGHT_COLOR[0],
  },
];
settingsRegistry.registerNavigations([EditorSettingsNavigation, ...EditorSettingsSubPages]);
settingsRegistry.registerSettings(TimelineSettingsSchema);
