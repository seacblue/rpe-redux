/**
 * Update preference rows inside the Help page.
 *
 * Repository and signing key are compiled from `core/platform/desktop/updateConfig.ts`.
 * The check action lives beside these rows in `help/UpdateVerifyControl.tsx`;
 * the survey is an `open-url` action row so it needs no component, and the docs
 * row uses `help/DocsOpenControl.tsx` because it opens a loopback URL the
 * HTTPS-only action contract intentionally refuses.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import { DEFAULT_UPDATE_DOWNLOAD_POLICY, UPDATE_SETTING_KEYS } from "../updateKeys.ts";
import { HELP_SURVEY_URL } from "../../platform/desktop/helpLinks.ts";

// An empty group keeps the rows in the page body without drawing a second
// heading; `SettingsWindow` then shows the Help page title above them.
const UpdatesSettingsSchema: SettingDefinition[] = [
  {
    key: UPDATE_SETTING_KEYS.autoCheck,
    navigation: "help",
    group: "",
    label: "settings.updates.autoCheck.label",
    description: "settings.updates.autoCheck.description",
    control: "toggle",
    default: false,
  },
  {
    key: UPDATE_SETTING_KEYS.downloadPolicy,
    navigation: "help",
    group: "",
    label: "settings.updates.downloadPolicy.label",
    description: "settings.updates.downloadPolicy.description",
    control: "select",
    default: DEFAULT_UPDATE_DOWNLOAD_POLICY,
    options: [
      { value: "all", label: "settings.updates.downloadPolicy.all" },
      { value: "wifi", label: "settings.updates.downloadPolicy.wifi" },
      { value: "never", label: "settings.updates.downloadPolicy.never" },
    ],
  },
  {
    key: UPDATE_SETTING_KEYS.prereleases,
    navigation: "help",
    group: "",
    label: "settings.updates.prereleases.label",
    control: "toggle",
    default: false,
    enabledWhen: { key: UPDATE_SETTING_KEYS.autoCheck, equals: true },
  },
  {
    key: "update-verify",
    navigation: "help",
    group: "",
    label: "settings.updates.verify.label",
    control: "custom",
  },
  {
    key: "help-survey",
    navigation: "help",
    group: "",
    label: "settings.field.survey.label",
    control: "action",
    // The row already shows its label; repeating it in a hover tip is noise.
    tooltip: false,
    action: { kind: "open-url", url: HELP_SURVEY_URL, icon: "forward" },
  },
  {
    key: "help-docs",
    navigation: "help",
    group: "",
    label: "settings.field.docs.label",
    control: "custom",
  },
];

settingsRegistry.registerSettings(UpdatesSettingsSchema);
