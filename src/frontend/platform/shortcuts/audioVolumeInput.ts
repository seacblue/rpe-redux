/**
 * Routes global audio bindings before editor-local wheel and keyboard actions.
 * This mirrors osu!lazer's global input layer while retaining Redux's live
 * shortcut registry and its text-entry/modal guards.
 */
import { matches } from "../../../core/shortcuts/keyMatching.ts";
import { matchTimelineWheel } from "../../../core/edit/shortcuts/timelineWheel.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import type { ShortcutEventLike } from "../../../core/shortcuts/types.ts";
import { readShortcutContext } from "./shortcutContext.ts";
import { AUDIO_VOLUME_SHORTCUT_IDS } from "./audioVolumeShortcuts.ts";

const AUDIO_ACTIONS = [
  AUDIO_VOLUME_SHORTCUT_IDS.increase,
  AUDIO_VOLUME_SHORTCUT_IDS.decrease,
  AUDIO_VOLUME_SHORTCUT_IDS.previous,
  AUDIO_VOLUME_SHORTCUT_IDS.next,
  AUDIO_VOLUME_SHORTCUT_IDS.mute,
] as const;

/** Returns the global audio action matching the current event, if any. */
function actionFor(event: ShortcutEventLike): string | null {
  for (const id of AUDIO_ACTIONS) {
    if (shortcutRegistry.bindingsOf(id).some((binding) => matches(event, binding))) {
      return id;
    }
  }
  return null;
}

/** Runs one registered audio action through its direct runner. */
function run(action: string, event: Event): void {
  shortcutRegistry.definition(action)?.run?.({ event });
}

/** Returns whether the timeline has a local binding that owns this wheel event. */
function timelineOwnsWheel(event: WheelEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  return (
    Boolean(target?.closest("canvas[class*='timeline-']")) && matchTimelineWheel(event) !== null
  );
}

/** Whether the event is allowed to reach an application instrument action. */
function allowed(event: Event): boolean {
  const context = readShortcutContext(event.target);
  return !context.capturing && context.modal !== "urgent" && context.surface === null;
}

/** Installs and returns the global audio keyboard/wheel dispatcher. */
export function installAudioVolumeInput(): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (!allowed(event)) {
      return;
    }
    const action = actionFor(event);
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    run(action, event);
  };
  const wheel = (event: WheelEvent): void => {
    if (
      !allowed(event) ||
      (event.target instanceof Element && event.target.closest(".redux-audio-volume-overlay")) ||
      timelineOwnsWheel(event)
    ) {
      return;
    }
    const action = actionFor(event);
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    run(action, event);
  };
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("wheel", wheel, { capture: true, passive: false });
  return () => {
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("wheel", wheel, true);
  };
}
