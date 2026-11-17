/**
 * Turns raw key events into a shortcut while the editor records one.
 *
 * The state is pure, so the settings component only forwards events and renders the
 * candidate. Held non-modifier keys join the candidate, which is what lets a
 * recording become `E+MOUSE2` rather than replacing `E` with the mouse button.
 */
import { recordShortcut, shortcutKey } from "../../../../core/shortcuts/keyMatching.ts";
import { canonicalText, shortcutKeys } from "../../../../core/shortcuts/keys.ts";
import type { Shortcut, ShortcutEventLike } from "../../../../core/shortcuts/types.ts";

const MODIFIER_KEYS = new Set(["CTRL", "ALT", "SHIFT", "META"]);

/** Keys currently held and the shortcut they spell, if one is complete. */
export interface ShortcutCaptureState {
  readonly pressedKeys: readonly string[];
  /** Non-modifier shortcut tokens currently held, in press order. */
  readonly heldKeys: readonly string[];
  readonly candidate: Shortcut | null;
}

/** One input event offered to the capture machine. */
export type ShortcutCaptureAction =
  | { type: "keydown"; event: ShortcutEventLike }
  | { type: "keyup"; event: ShortcutEventLike }
  | { type: "pointerdown"; event: ShortcutEventLike }
  | { type: "pointerup"; event: ShortcutEventLike }
  | { type: "wheel"; event: ShortcutEventLike }
  | { type: "cancel" };

/** The next capture state plus any shortcut ready to commit. */
export interface ShortcutCaptureTransition {
  readonly state: ShortcutCaptureState;
  readonly commit: Shortcut | null;
  readonly cancelled: boolean;
}

/** Start a capture with no held keys and no candidate. */
export function createShortcutCaptureState(): ShortcutCaptureState {
  return { pressedKeys: [], heldKeys: [], candidate: null };
}

/**
 * Tracks the physical key set separately from the recorded shortcut.
 *
 * Keyboard candidates are emitted when the last pressed key is released; a
 * mouse candidate is emitted when its button is released, even while another
 * chord key or modifier is still held, so the recorded mouse action is not lost
 * before Save. The caller can therefore decide whether a registry write
 * succeeded without making key-up ordering or focus loss part of the shortcut
 * registry contract.
 */
export function advanceShortcutCapture(
  state: ShortcutCaptureState,
  action: ShortcutCaptureAction,
): ShortcutCaptureTransition {
  if (action.type === "cancel") {
    return { state: createShortcutCaptureState(), commit: null, cancelled: true };
  }

  if (action.type === "wheel") {
    const shortcut = recordShortcut(action.event, state.heldKeys);
    return shortcut
      ? { state: createShortcutCaptureState(), commit: shortcut, cancelled: false }
      : { state, commit: null, cancelled: false };
  }

  const pressedKey = physicalKey(action.event);
  if (!pressedKey) {
    return { state, commit: null, cancelled: false };
  }
  const token = shortcutKey(action.event);
  const modifier = MODIFIER_KEYS.has(token);

  if (action.type === "keydown" || action.type === "pointerdown") {
    const pressedKeys = state.pressedKeys.includes(pressedKey)
      ? state.pressedKeys
      : [...state.pressedKeys, pressedKey];
    const heldKeys =
      modifier || state.heldKeys.includes(token) ? state.heldKeys : [...state.heldKeys, token];
    const shortcut = recordShortcut(action.event, heldKeys);
    if (!shortcut && state.pressedKeys.length === 0 && modifier) {
      return {
        state: { pressedKeys, heldKeys, candidate: { key: token, modifiers: [] } },
        commit: null,
        cancelled: false,
      };
    }
    if (!shortcut || modifier) {
      return {
        state: { pressedKeys, heldKeys, candidate: state.candidate },
        commit: null,
        cancelled: false,
      };
    }

    const candidate =
      state.candidate !== null && canonicalText(state.candidate) === canonicalText(shortcut)
        ? state.candidate
        : shortcut;
    return { state: { pressedKeys, heldKeys, candidate }, commit: null, cancelled: false };
  }

  const wasPressed = state.pressedKeys.includes(pressedKey);
  const pressedKeys = state.pressedKeys.filter((key) => key !== pressedKey);
  const heldKeys = modifier ? state.heldKeys : state.heldKeys.filter((key) => key !== token);
  if (wasPressed && state.candidate !== null) {
    // A mouse button records the whole modifier/chord binding at release, even
    // while another key is still held. Waiting for every key-up would leave the
    // mouse action only in the transient candidate, where a later input could
    // replace or clear it before the user saves.
    const releasedMouse =
      action.type === "pointerup" &&
      pressedKey.startsWith("MOUSE") &&
      shortcutUsesKey(state.candidate, pressedKey);
    if (releasedMouse || pressedKeys.length === 0) {
      return {
        state: createShortcutCaptureState(),
        commit: state.candidate,
        cancelled: false,
      };
    }
  }
  return {
    state: { pressedKeys, heldKeys, candidate: state.candidate },
    commit: null,
    cancelled: false,
  };
}

/** Whether a recorded chord uses the physical key that just came up. */
function shortcutUsesKey(shortcut: Shortcut, pressedKey: string): boolean {
  return shortcutKeys(shortcut).includes(pressedKey);
}

/** Uses KeyboardEvent.code when available so shifted punctuation has a stable key-up identity. */
function physicalKey(event: ShortcutEventLike): string {
  const code = event.code?.trim();
  return code || shortcutKey(event);
}
