/**
 * The note-skin settings page.
 *
 * The page owns its picker, package actions, and the workbench entry points, so
 * this feature contributes only the navigation entry under Appearance. The
 * settings window mounts the page; the active skin is written through
 * `core/media/noteSkins.ts`.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingsNavigation } from "../types.ts";

const SkinSettingsNavigation: SettingsNavigation = {
  key: "appearance.skin",
  parent: "appearance",
  label: "settings.group.noteSkin",
  icon: "image",
  order: 30,
};

settingsRegistry.registerNavigation(SkinSettingsNavigation);
