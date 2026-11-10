/**
 * Automatic snapshot controls under General. The values live in the durable
 * settings section; the Go service and browser Worker read them after every
 * preference save and start or stop their timer accordingly.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition, SettingsNavigation } from "../types.ts";

const LibraryBackupNavigation: SettingsNavigation = {
  key: "general.libraryBackup",
  parent: "general",
  label: "settings.group.libraryBackup",
  icon: "save",
  order: 25,
};

const LibraryBackupSettings: SettingDefinition[] = [
  {
    key: "library-backup-auto",
    navigation: "general.libraryBackup",
    group: "",
    label: "settings.field.library-backup-auto.label",
    description: "settings.field.library-backup-auto.description",
    control: "toggle",
    default: true,
  },
  {
    key: "library-backup-interval-seconds",
    navigation: "general.libraryBackup",
    group: "",
    label: "settings.field.library-backup-interval-seconds.label",
    description: "settings.field.library-backup-interval-seconds.description",
    control: "number",
    default: 120,
    min: 30,
    max: 3600,
    step: 1,
    integer: true,
    enabledWhen: { key: "library-backup-auto", equals: true },
  },
];

settingsRegistry.registerNavigation(LibraryBackupNavigation);
settingsRegistry.registerSettings(LibraryBackupSettings);
