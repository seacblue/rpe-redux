/** Browser-only storage page under General, where web users manage OPFS data. */
import { settingsRegistry } from "../settings.ts";
import type { SettingsNavigation } from "../types.ts";

const WebStorageNavigation: SettingsNavigation = {
  key: "web.storage",
  parent: "general",
  label: "settings.group.webStorage",
  icon: "save",
  order: 25,
  hosts: ["web"],
};

settingsRegistry.registerNavigation(WebStorageNavigation);
