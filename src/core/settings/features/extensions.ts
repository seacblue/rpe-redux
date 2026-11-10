/** Extension settings feature: navigation and toggles for sandboxed Extension loading. */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition, SettingsNavigation } from "../types.ts";

/**
 * The sandboxed-Extension manager is its own surface. Its single schema row is
 * the page-level sandbox notice; the rest of the page renders the runtime's
 * extension list.
 */
const ExtensionsSettingsNavigation: SettingsNavigation = {
  key: "extensions",
  label: "settings.category.extensions.label",
  icon: "extension",
  order: 60,
  hosts: ["desktop"],
};

const ExtensionsSettingsSchema: SettingDefinition[] = [
  {
    key: "extensions-disclaimer-accepted",
    navigation: "extensions",
    group: "settings.extensions.disclaimer",
    label: "settings.extensions.disclaimer.label",
    description: "settings.extensions.disclaimer.description",
    control: "toggle",
    default: false,
    hosts: ["desktop"],
  },
];

settingsRegistry.registerNavigation(ExtensionsSettingsNavigation);
settingsRegistry.registerSettings(ExtensionsSettingsSchema);
