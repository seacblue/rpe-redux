/**
 * General → Interface rows.
 *
 * The interface theme and the playback frame-rate cap shape the application
 * rather than the chart, so they belong beside language on General → Interface.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";

const InterfaceSettings: SettingDefinition[] = [
  {
    key: "appearance-skin",
    navigation: "general.interface",
    group: "settings.group.interface",
    label: "settings.field.appearance-skin.label",
    control: "custom",
    default: "dark",
  },
  {
    key: "render-fps",
    navigation: "general.interface",
    group: "settings.group.interface",
    label: "settings.field.render-fps.label",
    control: "select",
    default: "144",
    options: [
      { value: "30", label: "settings.option.render-fps.30" },
      { value: "60", label: "settings.option.render-fps.60" },
      { value: "90", label: "settings.option.render-fps.90" },
      { value: "120", label: "settings.option.render-fps.120" },
      { value: "144", label: "settings.option.render-fps.144" },
    ],
  },
  {
    key: "window-display-mode",
    navigation: "general.interface",
    group: "settings.group.interface",
    label: "settings.field.window-display-mode.label",
    control: "select",
    default: "windowed",
    options: [
      { value: "windowed", label: "settings.option.window-display-mode.windowed" },
      { value: "fullscreen", label: "settings.option.window-display-mode.fullscreen" },
      { value: "exclusive", label: "settings.option.window-display-mode.exclusive" },
    ],
  },
  {
    key: "window-resolution",
    navigation: "general.interface",
    group: "settings.group.interface",
    label: "settings.field.window-resolution.label",
    control: "select",
    default: "auto",
    options: [
      { value: "auto", label: "settings.option.window-resolution.auto" },
      { value: "1280x720", label: "settings.option.window-resolution.1280x720" },
      { value: "1600x900", label: "settings.option.window-resolution.1600x900" },
      { value: "1920x1080", label: "settings.option.window-resolution.1920x1080" },
      { value: "2560x1440", label: "settings.option.window-resolution.2560x1440" },
      { value: "3840x2160", label: "settings.option.window-resolution.3840x2160" },
    ],
  },
];

settingsRegistry.registerSettings(InterfaceSettings);
