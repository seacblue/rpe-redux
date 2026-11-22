/**
 * General and Appearance settings: application-wide behaviour, visual identity,
 * and the chart render surface shared by preview and timeline.
 *
 * General answers "how does the application behave?", Appearance answers "what
 * does the work look like?". Editor-only interaction stays in `timeline.ts`.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import { values } from "../../state/values.ts";
import {
  PHIRA_NOTE_SCALE_DEFAULT,
  PHIRA_NOTE_SCALE_MAX,
  PHIRA_NOTE_SCALE_MIN,
} from "../../media/noteSkin.ts";
import type { SettingsNavigation } from "../types.ts";
import { COVER_BACKGROUND_KEYS } from "./coverBackground.ts";

const GeneralSettingsNavigation: SettingsNavigation = {
  key: "general",
  label: "settings.category.general.label",
  icon: "settings",
  order: 10,
};

const GeneralInterfaceNavigation: SettingsNavigation = {
  key: "general.interface",
  parent: "general",
  label: "settings.group.interface",
  icon: "settings",
  order: 10,
};

const AppearanceSettingsNavigation: SettingsNavigation = {
  key: "appearance",
  label: "settings.category.appearance.label",
  icon: "palette",
  order: 20,
};

const AppearanceDisplayNavigation: SettingsNavigation = {
  key: "appearance.display",
  parent: "appearance",
  label: "settings.group.display",
  icon: "preview",
  order: 20,
};

const AppearanceLinesNavigation: SettingsNavigation = {
  key: "appearance.lines",
  parent: "appearance",
  label: "settings.group.judgeLines",
  icon: "layers",
  order: 40,
};

const AppearanceNotesNavigation: SettingsNavigation = {
  key: "appearance.notes",
  parent: "appearance",
  label: "settings.group.notes",
  icon: "select",
  order: 50,
};

const AppearanceSettingsSchema: SettingDefinition[] = [
  {
    key: "timeline-event-marquee-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.timeline-event-marquee-color.label",
    control: "color",
    default: "#00C800",
  },
  {
    key: "timeline-note-marquee-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.timeline-note-marquee-color.label",
    control: "color",
    default: "#00C800",
  },
  {
    key: "timeline-sweep-add-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.timeline-sweep-add-color.label",
    description: "settings.field.timeline-sweep-add-color.description",
    control: "color",
    default: "#33FF33",
  },
  {
    key: "timeline-sweep-remove-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.timeline-sweep-remove-color.label",
    description: "settings.field.timeline-sweep-remove-color.description",
    control: "color",
    default: "#FFFFFF",
  },
  {
    key: "selected-note-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.selected-note-color.label",
    control: "color",
    default: "#00C800",
  },
  {
    key: "selected-event-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.selected-event-color.label",
    control: "color",
    default: "#00C800",
  },
  {
    key: "collaboration-selected-note-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.collaboration-selected-note-color.label",
    control: "color",
    default: "#FFCC66",
  },
  {
    key: "collaboration-selected-event-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.collaboration-selected-event-color.label",
    control: "color",
    default: "#FFCC66",
  },
  {
    key: "realtime-alpha",
    navigation: "appearance.display",
    group: "settings.group.background",
    label: "settings.field.realtime-alpha.label",
    control: "range",
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "background-blur",
    navigation: "appearance.display",
    group: "settings.group.background",
    label: "settings.field.editor-preview-background-blur.label",
    control: "range",
    default: 10.5,
    min: 0,
    max: 30,
    step: 0.5,
    enabledWhen: { key: COVER_BACKGROUND_KEYS.editorPreviewEnabled, equals: true },
  },
  {
    key: "background-brightness",
    navigation: "appearance.display",
    group: "settings.group.background",
    label: "settings.field.editor-preview-background-brightness.label",
    control: "range",
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    enabledWhen: { key: COVER_BACKGROUND_KEYS.editorPreviewEnabled, equals: true },
  },
  {
    key: "custom-background",
    navigation: "appearance.display",
    group: "settings.group.background",
    label: "settings.field.custom-background.label",
    control: "file",
    default: "",
    accept: "image/*",
    storage: "application-data",
    hosts: ["desktop"],
  },
  {
    key: "default-line-thickness",
    navigation: "appearance.lines",
    group: "settings.group.judgeLines",
    label: "settings.field.default-line-thickness.label",
    control: "number",
    default: 1,
    min: 0.1,
    max: 10,
    step: 0.1,
  },
  {
    key: "default-line-color",
    navigation: "appearance.lines",
    group: "settings.group.judgeLines",
    label: "settings.field.default-line-color.label",
    control: "color",
    default: "#EDECB0",
  },
  {
    key: "current-line-color",
    navigation: "appearance.lines",
    group: "settings.group.judgeLines",
    label: "settings.field.current-line-color.label",
    control: "color",
    default: "#00C800",
  },
  {
    key: "multi-select-line-color",
    navigation: "appearance.lines",
    group: "settings.group.judgeLines",
    label: "settings.field.multi-select-line-color.label",
    description: "settings.field.multi-select-line-color.description",
    control: "color",
    default: "#7DC87D",
    // The current line keeps the current-line colour; this paints the other
    // selected lines when the selection contains more than one line.
  },
  {
    key: "default-particle-color",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.default-particle-color.label",
    control: "color",
    default: "#EDECB0",
    enabledWhen: { key: "particle-effects-enabled", equals: true },
  },
  {
    key: "particle-effects-enabled",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.particle-effects-enabled.label",
    description: "settings.field.particle-effects-enabled.description",
    control: "toggle",
    default: true,
  },
  {
    key: "procedural-particle-effects-enabled",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.procedural-particle-effects-enabled.label",
    description: "settings.field.procedural-particle-effects-enabled.description",
    control: "toggle",
    default: true,
    enabledWhen: { key: "particle-effects-enabled", equals: true },
  },
  {
    key: "note-size",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.note-size.label",
    control: "number",
    default: PHIRA_NOTE_SCALE_DEFAULT,
    min: PHIRA_NOTE_SCALE_MIN,
    max: PHIRA_NOTE_SCALE_MAX,
    step: 0.005,
  },
  {
    key: "timeline-note-size",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.timeline-note-size.label",
    control: "number",
    default: 175,
    min: 40,
    max: 400,
    step: 1,
  },
  {
    key: "hit-effect-size",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.hit-effect-size.label",
    control: "number",
    default: 100,
    min: 10,
    max: 300,
    step: 5,
    enabledWhen: { key: "particle-effects-enabled", equals: true },
  },
  {
    key: "note-opacity",
    navigation: "appearance.notes",
    group: "settings.group.notes",
    label: "settings.field.note-opacity.label",
    control: "range",
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    percentage: true,
  },
];
settingsRegistry.registerNavigations([
  GeneralSettingsNavigation,
  GeneralInterfaceNavigation,
  AppearanceSettingsNavigation,
  AppearanceDisplayNavigation,
  AppearanceLinesNavigation,
  AppearanceNotesNavigation,
]);
settingsRegistry.registerSettings(AppearanceSettingsSchema);

// The preview note size used to be a Recorder pixel width in the 1200-wide
// authoring box. Phira expresses it as a scale around 1, so convert a stored
// pixel value once; 175 was the previous default and maps to 1.
const noteSize = values.getHandle<string>("note-size");
const storedNoteSize = Number(noteSize.get());
if (Number.isFinite(storedNoteSize) && storedNoteSize > PHIRA_NOTE_SCALE_MAX) {
  const scale = Math.min(
    PHIRA_NOTE_SCALE_MAX,
    Math.max(PHIRA_NOTE_SCALE_MIN, storedNoteSize / 175),
  );
  noteSize.set(String(Number(scale.toFixed(3))));
}
