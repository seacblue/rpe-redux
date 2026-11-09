/**
 * Wheel input bindings shared by the timeline, the shortcut editor, and the
 * canvas dispatcher.
 *
 * Line stepping, time seeking (by the grid and by a whole beat), and timeline
 * zoom are ordinary rebindable shortcuts. The wheel router asks this module
 * which action the current event answers to, while the canvas dispatcher leaves
 * those wheel actions to the timeline so its smooth seeking and trackpad
 * accumulation stay intact.
 */
import { matches } from "../../shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../shortcuts/registry.ts";
import type { ShortcutEventLike } from "../../shortcuts/types.ts";

/** The editor shortcuts that shape vertical wheel input. */
export const TIMELINE_WHEEL_SHORTCUT_IDS = Object.freeze({
  linePrevious: "navigation.line.previous",
  lineNext: "navigation.line.next",
  timePrevious: "navigation.time.previous",
  timeNext: "navigation.time.next",
  fastPrevious: "navigation.time.fastPrevious",
  fastNext: "navigation.time.fastNext",
  zoomOut: "navigation.timeline.zoom.out",
  zoomIn: "navigation.timeline.zoom.in",
});

const WHEEL_SHORTCUT_IDS = new Set<string>(Object.values(TIMELINE_WHEEL_SHORTCUT_IDS));

/** How far one wheel action moves the playhead. */
export type TimelineSeekStep = "grid" | "beat";

/** What one wheel event should do in the editor's timeline. */
export type TimelineWheelAction =
  | { kind: "line"; direction: -1 | 1 }
  | { kind: "seek"; direction: -1 | 1; step: TimelineSeekStep }
  | { kind: "zoom"; direction: -1 | 1 };

/** Whether a shortcut id is routed by the timeline instead of the canvas matcher. */
export function isTimelineWheelShortcut(id: string): boolean {
  return WHEEL_SHORTCUT_IDS.has(id);
}

/**
 * Match one wheel event against the live bindings of the wheel actions.
 *
 * Every modifier is part of the binding, so Shift+wheel is a separate fast-seek
 * action rather than an implicit step-size modifier. A profile that rebinds any
 * of these actions keeps the same direction mapping.
 */
export function matchTimelineWheel(event: ShortcutEventLike): TimelineWheelAction | null {
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious)) {
    return { kind: "line", direction: -1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.lineNext)) {
    return { kind: "line", direction: 1 };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.fastPrevious)) {
    return { kind: "seek", direction: -1, step: "beat" };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.fastNext)) {
    return { kind: "seek", direction: 1, step: "beat" };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.timePrevious)) {
    return { kind: "seek", direction: -1, step: "grid" };
  }
  if (bound(event, TIMELINE_WHEEL_SHORTCUT_IDS.timeNext)) {
    return { kind: "seek", direction: 1, step: "grid" };
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
  return shortcutRegistry.bindingsOf(id).some((binding) => matches(event, binding));
}
