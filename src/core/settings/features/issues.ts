/**
 * The Chart issues settings page: one master switch, one switch per issue kind,
 * and the two numeric thresholds.
 *
 * A kind's switch comes from `CHART_ISSUE_KIND_DEFINITIONS`, so adding a kind
 * adds its row here without editing this file. Rows carry no description: the
 * label names the kind, and the inspector's filter shows the same wording, so a
 * second sentence would only repeat it.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import type { SettingsNavigation } from "../types.ts";
import { DEFAULT_NOTE_DENSITY_OPTIONS } from "../../edit/validation/noteDensityScan.ts";
import { CHART_ISSUE_KIND_DEFINITIONS } from "../../edit/validation/chartIssueTypes.ts";

const IssuesSettingsNavigation: SettingsNavigation = {
  key: "editor.issues",
  parent: "editor",
  label: "settings.group.issues",
  icon: "shield",
  order: 60,
};

/** One row per issue kind, labelled the same way the filter labels it. */
const KIND_TOGGLES: SettingDefinition[] = CHART_ISSUE_KIND_DEFINITIONS.map((definition) => ({
  key: definition.settingKey,
  navigation: "editor.issues",
  group: "settings.group.issuesKinds",
  label: definition.label,
  control: "toggle",
  default: true,
  enabledWhen: { key: "chart-issues-enabled", equals: true },
}));

const IssuesSettingsSchema: SettingDefinition[] = [
  {
    key: "chart-issues-enabled",
    navigation: "editor.issues",
    group: "settings.group.issuesScan",
    label: "settings.field.chart-issues-enabled.label",
    control: "toggle",
    default: true,
  },
  ...KIND_TOGGLES,
  {
    key: "chart-issues-density-caution",
    navigation: "editor.issues",
    group: "settings.group.issuesDensity",
    label: "settings.field.chart-issues-density-caution.label",
    control: "number",
    default: DEFAULT_NOTE_DENSITY_OPTIONS.caution,
    min: 1,
    max: 100000,
    step: 1,
    integer: true,
    enabledWhen: { key: "chart-issues-check-density", equals: true },
  },
];

settingsRegistry.registerNavigation(IssuesSettingsNavigation);
settingsRegistry.registerSettings(IssuesSettingsSchema);
