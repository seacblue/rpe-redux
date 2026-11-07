/** Models a generic modifier-held digit sequence for shortcut dispatch. */
import { shortcutKey } from "./keyMatching.ts";
import type { ShortcutEventLike } from "./types.ts";

/** Modifier keys that can prefix a digit sequence. */
export type PrefixDigitModifier = "CTRL" | "ALT" | "SHIFT" | "META";

/** Input accepted by the pure prefix-digit state machine. */
export type PrefixDigitSequenceAction =
  | { type: "keydown"; event: ShortcutEventLike }
  | { type: "keyup"; event: ShortcutEventLike }
  | { type: "cancel" };

/** State held between a modifier press, digit entry, and modifier release. */
export interface PrefixDigitSequenceState {
  readonly active: boolean;
  readonly digits: string;
  readonly overflow: boolean;
}

/** Result emitted when the configured modifier is released. */
export type PrefixDigitSequenceSubmission =
  { kind: "empty" } | { kind: "number"; value: number } | { kind: "invalid" };

/** Next state plus whether the DOM event belongs to the sequence. */
export interface PrefixDigitSequenceTransition {
  readonly state: PrefixDigitSequenceState;
  readonly handled: boolean;
  readonly submission: PrefixDigitSequenceSubmission | null;
}

const MAX_DIGITS = 6;

/** Create an idle prefix-digit state. */
export function createPrefixDigitSequenceState(): PrefixDigitSequenceState {
  return { active: false, digits: "", overflow: false };
}

/** Advance the generic prefix-digit state machine without browser globals. */
export function advancePrefixDigitSequence(
  state: PrefixDigitSequenceState,
  action: PrefixDigitSequenceAction,
  prefix: PrefixDigitModifier,
): PrefixDigitSequenceTransition {
  if (action.type === "cancel") {
    return idle(true);
  }

  if (action.event.isComposing) {
    return state.active ? idle(false) : unchanged(state);
  }

  if (action.type === "keydown") {
    return advanceKeyDown(state, action.event, prefix);
  }
  if (!state.active || shortcutKey(action.event) !== prefix) {
    return unchanged(state);
  }
  return {
    state: createPrefixDigitSequenceState(),
    handled: false,
    submission: state.overflow
      ? { kind: "invalid" }
      : state.digits
        ? { kind: "number", value: Number(state.digits) }
        : { kind: "empty" },
  };
}

/** Handle a key-down while preserving ordinary shortcuts' first refusal. */
function advanceKeyDown(
  state: PrefixDigitSequenceState,
  event: ShortcutEventLike,
  prefix: PrefixDigitModifier,
): PrefixDigitSequenceTransition {
  const key = shortcutKey(event);
  if (!state.active) {
    if (event.repeat || key !== prefix || hasOtherModifier(event, prefix)) {
      return unchanged(state);
    }
    return {
      state: { active: true, digits: "", overflow: false },
      handled: false,
      submission: null,
    };
  }
  if (event.repeat && isDigit(key) && prefixHeld(event, prefix)) {
    return { state, handled: true, submission: null };
  }
  if (isDigit(key) && prefixHeld(event, prefix) && !hasOtherModifier(event, prefix)) {
    return {
      state: {
        active: true,
        digits: state.digits.length < MAX_DIGITS ? `${state.digits}${key}` : state.digits,
        overflow: state.overflow || state.digits.length >= MAX_DIGITS,
      },
      handled: true,
      submission: null,
    };
  }
  if (key === prefix) {
    return unchanged(state);
  }
  return idle(false);
}

/** Return whether an event is holding the configured modifier. */
function prefixHeld(event: ShortcutEventLike, prefix: PrefixDigitModifier): boolean {
  switch (prefix) {
    case "CTRL":
      return event.ctrlKey === true;
    case "ALT":
      return event.altKey === true;
    case "SHIFT":
      return event.shiftKey === true;
    case "META":
      return event.metaKey === true;
  }
}

/** Reject digits modified by a second modifier so regular chords stay intact. */
function hasOtherModifier(event: ShortcutEventLike, prefix: PrefixDigitModifier): boolean {
  return (
    (prefix !== "CTRL" && event.ctrlKey === true) ||
    (prefix !== "ALT" && event.altKey === true) ||
    (prefix !== "SHIFT" && event.shiftKey === true) ||
    (prefix !== "META" && event.metaKey === true)
  );
}

/** Whether a normalized browser key is one ASCII digit. */
function isDigit(key: string): boolean {
  return /^[0-9]$/.test(key);
}

/** Return an idle transition, optionally marking the event as consumed. */
function idle(handled: boolean): PrefixDigitSequenceTransition {
  return { state: createPrefixDigitSequenceState(), handled, submission: null };
}

/** Return a transition that leaves the state untouched. */
function unchanged(state: PrefixDigitSequenceState): PrefixDigitSequenceTransition {
  return { state, handled: false, submission: null };
}
