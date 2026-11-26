/**
 * The optional editing capabilities page.
 *
 * The core chart model keeps every RPE field so existing projects remain
 * lossless. These switches only decide which entry points the editor shows for
 * new work; data already present in a chart stays visible and editable.
 *
 * Rows are grouped by the object they belong to, not by where the control lives:
 * note properties, event properties, then judge-line properties. Line groups are
 * part of the standard line model and have no switch of their own.
 */
import { declarePersistedValue, settingsRegistry } from "../settings.ts";
import { values } from "../../state/values.ts";
import { workspaceShaderPasses } from "../../global/chart/shader/workspacePasses.ts";
import type { SettingDefinition, SettingsNavigation } from "../types.ts";
import {
  EDITING_FEATURE_AI_KEYS,
  EDITING_FEATURE_KEYS,
  EDITING_FEATURES,
} from "../editingFeatureKeys.ts";
import { installEditingAiAccess } from "../editingAiAccess.ts";

const EditingFeaturesNavigation: SettingsNavigation = {
  key: "editor.features",
  parent: "editor",
  label: "settings.group.advancedEditing",
  icon: "sliders",
  order: 60,
};

/** Persisted choice for preserving or lowering workspace shader layers. */
export const WORKSPACE_SHADER_EXPORT_MODE_KEY = "workspace-shader-export-mode";

const EditingFeaturesSchema: SettingDefinition[] = [
  {
    key: WORKSPACE_SHADER_EXPORT_MODE_KEY,
    navigation: "editor.features",
    group: "settings.group.editingShaderFeatures",
    label: "settings.field.workspace-shader-export-mode.label",
    description: "settings.field.workspace-shader-export-mode.description",
    control: "select",
    default: "layered",
    options: [
      {
        value: "layered",
        label: "settings.option.workspace-shader-export-mode.layered",
      },
      {
        value: "standalone",
        label: "settings.option.workspace-shader-export-mode.standalone",
      },
    ],
  },
  {
    key: EDITING_FEATURE_KEYS.noteSpeed,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-speed-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteYOffset,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-y-offset-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteVisibleTime,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-visible-time-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.fakeNotes,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-fake-notes-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteSize,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-size-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteAlpha,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-alpha-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteColor,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-color-enabled.label",
    description: "settings.field.editing-note-color-enabled.description",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.noteHitSound,
    navigation: "editor.features",
    group: "settings.group.editingNoteFeatures",
    label: "settings.field.editing-note-hitsound-enabled.label",
    description: "settings.field.editing-note-hitsound-enabled.description",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.eventLayers,
    navigation: "editor.features",
    group: "settings.group.editingEventFeatures",
    label: "settings.field.editing-event-layers-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.extendedEvents,
    navigation: "editor.features",
    group: "settings.group.editingEventFeatures",
    label: "settings.field.editing-extended-events-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.linkgroup,
    navigation: "editor.features",
    group: "settings.group.editingEventFeatures",
    label: "settings.field.editing-linkgroup-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.easingRange,
    navigation: "editor.features",
    group: "settings.group.editingEventFeatures",
    label: "settings.field.editing-easing-range-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.bezier,
    navigation: "editor.features",
    group: "settings.group.editingEventFeatures",
    label: "settings.field.editing-bezier-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.lineExtended,
    navigation: "editor.features",
    group: "settings.group.editingLineFeatures",
    label: "settings.field.editing-line-extended-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.parentLines,
    navigation: "editor.features",
    group: "settings.group.editingLineFeatures",
    label: "settings.field.editing-parent-lines-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.lineBpmFactor,
    navigation: "editor.features",
    group: "settings.group.editingLineFeatures",
    label: "settings.field.editing-line-bpmfactor-enabled.label",
    control: "toggle",
    default: true,
  },
  {
    key: EDITING_FEATURE_KEYS.lineAnchor,
    navigation: "editor.features",
    group: "settings.group.editingLineFeatures",
    label: "settings.field.editing-line-anchor-enabled.label",
    control: "toggle",
    default: true,
  },
];

settingsRegistry.registerNavigation(EditingFeaturesNavigation);
settingsRegistry.registerSettings(EditingFeaturesSchema);

// Keep the chart export seam independent from the settings UI: the registry
// receives the current value once at startup and whenever the user changes it.
const syncWorkspaceShaderExportMode = (): void => {
  const mode = values.byId.get<string>(WORKSPACE_SHADER_EXPORT_MODE_KEY);
  workspaceShaderPasses.setExportMode(mode === "standalone" ? "standalone" : "layered");
};
syncWorkspaceShaderExportMode();
values.byId.subscribe(WORKSPACE_SHADER_EXPORT_MODE_KEY, syncWorkspaceShaderExportMode);

// The AI switch is drawn by the human row, so its value is declared without a
// definition. An undefined initial value keeps the stored preference absent
// until the first code-cell enable seeds it from the human switch.
for (const feature of EDITING_FEATURES) {
  declarePersistedValue(EDITING_FEATURE_AI_KEYS[feature], undefined, (value) => {
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`AI editing permission must be true or false: ${feature}`);
    }
  });
}
installEditingAiAccess();
