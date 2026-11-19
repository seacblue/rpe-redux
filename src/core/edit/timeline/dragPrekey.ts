/**
 * RPE's drag prekey: holding Z turns a pointer drag on a Hold or an event bar
 * into a head/tail edge edit instead of a move or a selection.
 *
 * The keyboard dispatcher owns the held-key set; timeline interaction reads it
 * at pointer-down so the modifier is sampled once per gesture.
 */
import { heldShortcutKeys } from "../../shortcuts/inputKeys.ts";
import { normalizeShortcutKey } from "../../shortcuts/keys.ts";

/** Plain Z movement actions that wait for key-up so they can yield to a drag. */
export const Z_DEFERRED_MOVE_ACTIONS = new Set(["selection.nudge.left", "playback.step.previous"]);

/** Whether a plain Z movement must be deferred until key-up. */
export function deferPlainZMovement(
  action: string,
  event: {
    readonly key: string;
    readonly ctrlKey?: boolean;
    readonly altKey?: boolean;
    readonly shiftKey?: boolean;
    readonly metaKey?: boolean;
  },
): boolean {
  return (
    Z_DEFERRED_MOVE_ACTIONS.has(action) &&
    normalizeShortcutKey(event.key) === "Z" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey
  );
}

/** Whether the drag prekey is held for the pointer gesture starting now. */
export function dragPrekeyHeld(): boolean {
  return heldShortcutKeys().has("Z");
}
