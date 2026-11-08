/**
 * Wheel input bindings shared by the timeline, the shortcut editor, and the
 * canvas dispatcher.
 *
 * Line stepping, time seeking, and timeline zoom are ordinary rebindable
 * shortcuts. The wheel router asks this module which action the current event
 * answers to, while the canvas dispatcher leaves those wheel actions to the
 * timeline so its smooth seeking and trackpad accumulation stay intact.
 */
import { matches } from "../../shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../shortcuts/registry.ts";
import type { ShortcutEventLike } from "../../shortcuts/types.ts";

/** The six editor shortcuts that shape vertical wheel input. */
export const TIMELINE_WHEEL_SHORTCUT_IDS = Object.freeze({
  linePrevious: "navigation.line.previous",
  lineNext: "navigation.line.next",
  timePrevious: "navigation.time.previous",
  timeNext: "navigation.time.next",
  zoomOut: "navigation.timeline.zoom.out",
  zoomIn: "navigation.timeline.zoom.in",
});

const WHEEL_SHORTCUT_IDS = new Set<string>(Object.values(TIMELINE_WHEEL_SHORTCUT_IDS));

/** What one wheel event should do in the editor's timeline. */
export type TimelineWheelAction =
  | { kind: "line"; direction: -1 | 1 }
  | { kind: "seek"; direction: -1 | 1 }
  | { kind: "zoom"; direction: -1 | 1 };

/** Whether a shortcut id is routed by the timeline instead of the canvas matcher. */
export function isTimelineWheelShortcut(id: string): boolean {
  return WHEEL_SHORTCUT_IDS.has(id);
}

/**
 * Match one wheel event against the live bindings of the six wheel actions.
 *
 * Shift is treated as a step-size modifier when the exact binding does not name
 * it, so Shift+wheel keeps the whole-beat seek while preserving a user binding
 * that deliberately includes Shift.
 */
export function matchTimelineWheel(event: ShortcutEventLike): TimelineWheelAction | null {
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious)) {
    return { kind: "line", direction: -1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.lineNext)) {
    return { kind: "line", direction: 1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.timePrevious)) {
    return { kind: "seek", direction: -1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.timeNext)) {
    return { kind: "seek", direction: 1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.zoomOut)) {
    return { kind: "zoom", direction: -1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.zoomIn)) {
    return { kind: "zoom", direction: 1 };
  }
  return null;
}

/** Whether the live bindings of one action answer to this event. */
function bound(event: ShortcutEventLike, id: string): boolean {
  const bindings = shortcutRegistry.bindingsOf(id);
  if (bindings.some((binding) => matches(event, binding))) {
    return true;
  }
  if (!event.shiftKey) {
    return false;
  }
  // Shift changes the seek distance, not the direction. Matching the unshifted
  // event keeps the default wheel bindings usable with the whole-beat modifier.
  const unshifted: ShortcutEventLike = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: false,
    altKey: event.altKey,
    isComposing: event.isComposing,
    button: event.button,
    deltaY: event.deltaY,
    deltaX: event.deltaX,
  };
  return bindings.some((binding) => matches(unshifted, binding));
}
