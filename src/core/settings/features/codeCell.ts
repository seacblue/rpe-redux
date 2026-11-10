/**
 * Registers the local Code Cell page under General: the code-cell toggle and
 * the loopback endpoints an external AI can use.
 *
 * Code Cells are the only AI entry point and expose one explicit HTTP contract.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition, SettingsNavigation } from "../types.ts";

const navigation: SettingsNavigation = {
  key: "general.codeCell",
  parent: "general",
  label: "settings.group.localAi",
  icon: "external",
  order: 30,
  hosts: ["desktop"],
};

const fields: SettingDefinition[] = [
  {
    key: "code-execution-enabled",
    navigation: "general.codeCell",
    group: "",
    label: "settings.field.code-execution-enabled.label",
    description: "settings.field.code-execution-enabled.description",
    control: "toggle",
    default: false,
    hosts: ["desktop"],
    // The source changes every run, so consent is bound to this profile and the
    // sandbox rather than to a package fingerprint.
    confirm: {
      title: "settings.codeCell.enableWarning.title",
      description: "settings.codeCell.enableWarning.description",
      label: "settings.codeCell.enableWarning.confirm",
      cancelLabel: "common.action.cancel",
    },
  },
  {
    key: "code-cell-access",
    navigation: "general.codeCell",
    group: "",
    label: "settings.field.code-cell-access.label",
    control: "custom",
    fullWidth: true,
    hosts: ["desktop"],
    enabledWhen: { key: "code-execution-enabled", equals: true },
  },
];

settingsRegistry.registerNavigation(navigation);
settingsRegistry.registerSettings(fields);
