/**
 * Turns raw key events into a shortcut while the editor records one.
 *
 * The state is pure, so the settings component only forwards events and renders the
 * candidate. Held non-modifier keys join the candidate, which is what lets a
 * recording become `E+MOUSE2` rather than replacing `E` with the mouse button.
 * Wheel directions stay latched after their event because a wheel has no
 * release event of its own.
 */
import { recordShortcut, shortcutKey } from "../../../../core/shortcuts/keyMatching.ts";
import { canonicalText, isPointerKey, shortcutKeys } from "../../../../core/shortcuts/keys.ts";
import type { Modifier, Shortcut, ShortcutEventLike } from "../../../../core/shortcuts/types.ts";

const MODIFIER_KEYS = new Set(["CTRL", "ALT", "SHIFT", "META"]);

/** Keys currently held and the shortcut they spell, if one is complete. */
export interface ShortcutCaptureState {
  readonly pressedKeys: readonly string[];
  /** Non-modifier shortcut tokens currently held, in press order. */
  readonly heldKeys: readonly string[];
  /** Modifier tokens currently held, in press order. */
  readonly heldModifiers: readonly Modifier[];
  readonly candidate: Shortcut | null;
  /** All currently pressed keys, including modifiers, for the capture preview. */
  readonly preview: Shortcut | null;
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
  return { pressedKeys: [], heldKeys: [], heldModifiers: [], candidate: null, preview: null };
}

/** Whether a keyboard event starts a new non-modifier candidate for the UI. */
export function isNewNonModifierKeydown(
  state: ShortcutCaptureState,
  event: ShortcutEventLike,
): boolean {
  const token = shortcutKey(event);
  return (
    !event.repeat && !MODIFIER_KEYS.has(token) && !state.pressedKeys.includes(physicalKey(event))
  );
}

/**
 * Tracks the physical key set separately from the recorded shortcut.
 *
 * Keyboard candidates are emitted when the last pressed key is released; a
 * mouse candidate is emitted when its button is released, even while another
 * chord key or modifier is still held, so the recorded mouse action is not lost
 * before Save. A wheel candidate remains in the returned state after it is
 * emitted because the browser has no wheel-up event; zero-delta wheel events
 * and later modifier releases must not erase it before Save. The caller can
 * therefore decide whether a registry write succeeded without making key-up
 * ordering or focus loss part of the shortcut registry contract.
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
      ? {
          // A wheel is a complete input, but it has no matching release event.
          // Keep the candidate latched so an idle/zero-delta event or a later
          // modifier release cannot make the preview disappear before Save.
          state: { ...state, candidate: shortcut, preview: shortcut },
          commit: shortcut,
          cancelled: false,
        }
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
    const heldModifiers = modifier
      ? state.heldModifiers.includes(token as Modifier)
        ? state.heldModifiers
        : [...state.heldModifiers, token as Modifier]
      : state.heldModifiers;
    const shortcut = recordShortcut(action.event, heldKeys);
    const preview = modifier
      ? previewAfterModifierChange(state.preview, heldKeys, heldModifiers)
      : capturePreview(action.event, heldKeys, heldModifiers);
    const candidate =
      modifier && hasNonModifierKey(preview)
        ? state.candidate && hasPointerKey(state.candidate)
          ? state.candidate
          : preview
        : state.candidate;
    if (!shortcut && state.pressedKeys.length === 0 && modifier && state.candidate === null) {
      return {
        state: {
          pressedKeys,
          heldKeys,
          heldModifiers,
          candidate: { key: token, modifiers: [] },
          preview,
        },
        commit: null,
        cancelled: false,
      };
    }
    if (!shortcut || modifier) {
      return {
        state: { pressedKeys, heldKeys, heldModifiers, candidate, preview },
        commit: null,
        cancelled: false,
      };
    }

    const completedCandidate =
      state.candidate !== null && canonicalText(state.candidate) === canonicalText(shortcut)
        ? state.candidate
        : shortcut;
    return {
      state: { pressedKeys, heldKeys, heldModifiers, candidate: completedCandidate, preview },
      commit: null,
      cancelled: false,
    };
  }

  const wasPressed = state.pressedKeys.includes(pressedKey);
  const pressedKeys = state.pressedKeys.filter((key) => key !== pressedKey);
  const heldKeys = modifier ? state.heldKeys : state.heldKeys.filter((key) => key !== token);
  const heldModifiers = modifier
    ? state.heldModifiers.filter((key) => key !== token)
    : state.heldModifiers;
  // Key-up only releases physical state. The preview is refreshed by a new
  // keydown, never by a release, so a chord keeps the modifier that was part
  // of the captured candidate until the candidate is committed.
  const preview =
    state.preview ??
    state.candidate ??
    previewFromHeldKeys(nonModifierKeys(heldKeys), heldModifiers);
  const candidate = state.candidate;
  if (wasPressed && candidate !== null) {
    // A mouse button records the whole modifier/chord binding at release, even
    // while another chord key or modifier is still held, so the recorded
    // mouse action is not lost before Save. Modifier changes update the
    // candidate first, so releasing Ctrl from Ctrl+A records plain A.
    const releasedMouse =
      action.type === "pointerup" &&
      pressedKey.startsWith("MOUSE") &&
      shortcutUsesKey(candidate, pressedKey);
    if (releasedMouse || pressedKeys.length === 0) {
      return {
        state: createShortcutCaptureState(),
        commit: candidate,
        cancelled: false,
      };
    }
  }
  return {
    state: {
      pressedKeys,
      heldKeys,
      heldModifiers,
      candidate,
      // Releasing either kind of key keeps the latched candidate. A new
      // keydown is the only transition that recomputes the displayed chord.
      preview,
    },
    commit: null,
    cancelled: false,
  };
}

/** Build the visible preview from the keys currently held by the user. */
function capturePreview(
  event: ShortcutEventLike,
  heldKeys: readonly string[],
  heldModifiers: readonly Modifier[],
): Shortcut | null {
  const shortcut = recordShortcut(event, heldKeys);
  if (shortcut) {
    return heldModifiers.length > 0 ? { ...shortcut, modifiers: heldModifiers } : shortcut;
  }
  return previewFromHeldKeys([], heldModifiers);
}

/** Rebuild a preview when a modifier changes, retaining the last non-modifier set when needed. */
function previewAfterModifierChange(
  previous: Shortcut | null,
  heldKeys: readonly string[],
  heldModifiers: readonly Modifier[],
): Shortcut | null {
  const current = nonModifierKeys(heldKeys);
  const keys = current.length > 0 ? current : nonModifierKeys(previous);
  return previewFromHeldKeys(keys, heldModifiers);
}

/** Return the non-modifier tokens in their physical press order. */
function nonModifierKeys(keys: readonly string[] | Shortcut | null): string[] {
  if (keys === null) {
    return [];
  }
  const tokens = "key" in keys ? [keys.key, ...(keys.keys ?? [])] : keys;
  return tokens.filter((key) => !MODIFIER_KEYS.has(key));
}

/** Whether a preview contains a bindable non-modifier key. */
function hasNonModifierKey(shortcut: Shortcut | null): shortcut is Shortcut {
  return nonModifierKeys(shortcut).length > 0;
}

/** Whether a shortcut contains a mouse button or wheel direction. */
function hasPointerKey(shortcut: Shortcut): boolean {
  return shortcutKeys(shortcut).some((key) => isPointerKey(key));
}

/** Represent non-modifier keys and currently held modifiers as a display value. */
function previewFromHeldKeys(
  heldKeys: readonly string[],
  heldModifiers: readonly Modifier[],
): Shortcut | null {
  const keys = heldKeys.length > 0 ? heldKeys : heldModifiers;
  if (keys.length === 0) {
    return null;
  }
  const [key, ...additionalKeys] = keys;
  return additionalKeys.length > 0
    ? { key, keys: additionalKeys, modifiers: heldKeys.length > 0 ? heldModifiers : [] }
    : { key, modifiers: heldKeys.length > 0 ? heldModifiers : [] };
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
