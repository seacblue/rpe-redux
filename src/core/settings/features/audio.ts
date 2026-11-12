/**
 * The audio settings category: music volume, per-hitsound levels and offsets,
 * waveform analysis, and speed/pitch policy.
 *
 * Every row answers the same question — what will the user hear? — so the root
 * is one scrolling page with two section headings. Rows are registered under the
 * keys the runtime reads, so the page and the audio owners share one definition.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import type { SettingsNavigation } from "../types.ts";
import { HIT_SOUND_KINDS } from "../../media/hitsounds.ts";

const AudioSettingsNavigation: SettingsNavigation = {
  key: "playback",
  label: "settings.category.audio.label",
  icon: "volume",
  order: 40,
};

const AUDIO_ANALYSIS_ENABLED = {
  key: "audio-analysis-enabled",
  equals: true,
} as const;

const AudioSettingsSchema: SettingDefinition[] = [
  {
    key: "volume",
    navigation: "playback",
    group: "settings.group.volume",
    label: "settings.field.volume.label",
    control: "range",
    default: 0.75,
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "background-volume",
    navigation: "playback",
    group: "settings.group.volume",
    label: "settings.field.background-volume.label",
    description: "settings.field.background-volume.description",
    control: "range",
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.01,
    percentage: true,
  },
  ...HIT_SOUND_KINDS.map((sound) => ({
    key: `hitsound-${sound}`,
    navigation: "playback",
    group: "settings.group.volume" as const,
    label: `settings.hitsound.slot.${sound}` as SettingDefinition["label"],
    control: "range" as const,
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.01,
  })),
  ...HIT_SOUND_KINDS.map((sound) => ({
    key: `hitsound-offset-${sound}`,
    navigation: "playback",
    group: "settings.group.volume" as const,
    label: `settings.hitsound.offset.${sound}` as SettingDefinition["label"],
    control: "number" as const,
    default: 0,
    min: -1000,
    max: 1000,
    step: 1,
  })),
  {
    key: "audio-analysis-enabled",
    navigation: "playback",
    group: "settings.group.audioPlayback",
    label: "settings.field.audio-analysis-enabled.label",
    control: "toggle",
    default: false,
  },
  {
    key: "audio-analysis-alpha",
    navigation: "playback",
    group: "settings.group.audioPlayback",
    label: "settings.field.audio-analysis-alpha.label",
    control: "range",
    default: 0.5,
    min: 0.02,
    max: 1,
    step: 0.01,
    percentage: true,
    enabledWhen: AUDIO_ANALYSIS_ENABLED,
  },
  {
    key: "audio-analysis-width",
    navigation: "playback",
    group: "settings.group.audioPlayback",
    label: "settings.field.audio-analysis-width.label",
    control: "range",
    default: 0.62,
    min: 0.2,
    max: 1,
    step: 0.01,
    percentage: true,
    enabledWhen: AUDIO_ANALYSIS_ENABLED,
  },
  {
    key: "audio-analysis-curve",
    navigation: "playback",
    group: "settings.group.audioPlayback",
    label: "settings.field.audio-analysis-curve.label",
    control: "range",
    default: 1,
    min: 0.2,
    max: 2,
    step: 0.1,
    enabledWhen: AUDIO_ANALYSIS_ENABLED,
  },
  {
    key: "preserve-pitch",
    navigation: "playback",
    group: "settings.group.audioPlayback",
    label: "settings.field.preserve-pitch.label",
    control: "toggle",
    default: true,
  },
  {
    key: "timing-detection-on-new-chart",
    navigation: "playback",
    group: "settings.group.timingDetection",
    label: "settings.field.timing-detection-on-new-chart.label",
    control: "select",
    default: "ask",
    options: [
      {
        value: "ask",
        label: "settings.option.timing-detection-on-new-chart.ask",
      },
      {
        value: "always",
        label: "settings.option.timing-detection-on-new-chart.always",
      },
      {
        value: "never",
        label: "settings.option.timing-detection-on-new-chart.never",
      },
    ],
  },
];
settingsRegistry.registerNavigation(AudioSettingsNavigation);
settingsRegistry.registerSettings(AudioSettingsSchema);
