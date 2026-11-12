/**
 * Registers the global audio controls that drive the shared mix controller.
 * The input adapter matches the live bindings; this module only owns the
 * user-facing declarations and their direct runners.
 */
import { audioMixer } from "../../../core/media/audioMixer.ts";
import { SHORTCUT_CATEGORIES } from "../../../core/shortcuts/categories.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import type { ShortcutDefinition } from "../../../core/shortcuts/types.ts";

/** Stable ids for the osu!lazer-style audio controls. */
export const AUDIO_VOLUME_SHORTCUT_IDS = Object.freeze({
  increase: "audio.volume.increase",
  decrease: "audio.volume.decrease",
  previous: "audio.volume.previous",
  next: "audio.volume.next",
});

const category = shortcutRegistry.hasCategory(SHORTCUT_CATEGORIES.audioVolume.id)
  ? undefined
  : shortcutRegistry.registerCategory(SHORTCUT_CATEGORIES.audioVolume);

const definitions: readonly ShortcutDefinition[] = [
  {
    id: AUDIO_VOLUME_SHORTCUT_IDS.increase,
    category: SHORTCUT_CATEGORIES.audioVolume.id,
    title: "shortcuts.audio.volumeUp",
    defaults: [{ key: "UPARROW", modifiers: ["ALT"] }],
    scope: "instrument",
    run: () => audioMixer.adjustSelected(1),
  },
  {
    id: AUDIO_VOLUME_SHORTCUT_IDS.decrease,
    category: SHORTCUT_CATEGORIES.audioVolume.id,
    title: "shortcuts.audio.volumeDown",
    defaults: [{ key: "DOWNARROW", modifiers: ["ALT"] }],
    scope: "instrument",
    run: () => audioMixer.adjustSelected(-1),
  },
  {
    id: AUDIO_VOLUME_SHORTCUT_IDS.previous,
    category: SHORTCUT_CATEGORIES.audioVolume.id,
    title: "shortcuts.audio.previousMeter",
    defaults: [{ key: "LEFTARROW", modifiers: ["ALT"] }],
    scope: "instrument",
    run: () => audioMixer.select(-1),
  },
  {
    id: AUDIO_VOLUME_SHORTCUT_IDS.next,
    category: SHORTCUT_CATEGORIES.audioVolume.id,
    title: "shortcuts.audio.nextMeter",
    defaults: [{ key: "RIGHTARROW", modifiers: ["ALT"] }],
    scope: "instrument",
    run: () => audioMixer.select(1),
  },
];

const disposers = definitions.map((definition) => shortcutRegistry.registerShortcut(definition));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const dispose of disposers) {
      dispose();
    }
    category?.dispose();
  });
}
