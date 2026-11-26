/** Collects a modifier-held token sequence without assigning meaning to tokens. */
import { shortcutKey } from "./keyMatching.ts";
import type { ShortcutEventLike } from "./types.ts";

/** Modifier keys that can prefix a token sequence. */
export type PrefixSequenceModifier = "CTRL" | "ALT" | "SHIFT" | "META";

/** Input accepted by the pure prefix-sequence state machine. */
export type PrefixSequenceAction =
  | { type: "keydown"; event: ShortcutEventLike }
  | { type: "keyup"; event: ShortcutEventLike }
  | { type: "cancel" };

/** State held between a modifier press, token entry, and modifier release. */
export interface PrefixSequenceState {
  readonly active: boolean;
  readonly tokens: readonly string[];
  readonly overflow: boolean;
}

/** Converts an event into a token, or rejects it for this sequence. */
export type PrefixSequenceTokenReader = (event: ShortcutEventLike) => string | null;

/** Result emitted when the configured modifier is released. */
export type PrefixSequenceSubmission =
  { kind: "empty" } | { kind: "tokens"; tokens: readonly string[] } | { kind: "invalid" };

/** Next state plus whether the DOM event belongs to the sequence. */
export interface PrefixSequenceTransition {
  readonly state: PrefixSequenceState;
  readonly handled: boolean;
  readonly submission: PrefixSequenceSubmission | null;
}

/** Maximum number of tokens a held prefix may collect. */
export const MAX_PREFIX_SEQUENCE_TOKENS = 6;

/** Create an idle prefix-sequence state. */
export function createPrefixSequenceState(): PrefixSequenceState {
  return { active: false, tokens: [], overflow: false };
}

/** Advance a prefix sequence while leaving token interpretation to the caller. */
export function advancePrefixSequence(
  state: PrefixSequenceState,
  action: PrefixSequenceAction,
  prefix: PrefixSequenceModifier,
  tokenOf: PrefixSequenceTokenReader = shortcutKey,
  maxTokens = MAX_PREFIX_SEQUENCE_TOKENS,
): PrefixSequenceTransition {
  if (action.type === "cancel") {
    return idle(true);
  }

  if (action.event.isComposing) {
    return state.active ? idle(false) : unchanged(state);
  }

  if (action.type === "keydown") {
    return advanceKeyDown(state, action.event, prefix, tokenOf, maxTokens);
  }
  if (!state.active || shortcutKey(action.event) !== prefix) {
    return unchanged(state);
  }
  return {
    state: createPrefixSequenceState(),
    handled: false,
    submission: state.overflow
      ? { kind: "invalid" }
      : state.tokens.length
        ? { kind: "tokens", tokens: state.tokens }
        : { kind: "empty" },
  };
}

/** Handle a key-down while preserving ordinary shortcuts' first refusal. */
function advanceKeyDown(
  state: PrefixSequenceState,
  event: ShortcutEventLike,
  prefix: PrefixSequenceModifier,
  tokenOf: PrefixSequenceTokenReader,
  maxTokens: number,
): PrefixSequenceTransition {
  const key = shortcutKey(event);
  const token = tokenOf(event);
  if (!state.active) {
    if (event.repeat || key !== prefix || hasOtherModifier(event, prefix)) {
      return unchanged(state);
    }
    return {
      state: { active: true, tokens: [], overflow: false },
      handled: false,
      submission: null,
    };
  }
  if (event.repeat && token !== null && prefixHeld(event, prefix)) {
    return { state, handled: true, submission: null };
  }
  if (
    token !== null &&
    key !== prefix &&
    prefixHeld(event, prefix) &&
    !hasOtherModifier(event, prefix)
  ) {
    return {
      state: {
        active: true,
        tokens: state.tokens.length < maxTokens ? [...state.tokens, token] : state.tokens,
        overflow: state.overflow || state.tokens.length >= maxTokens,
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
function prefixHeld(event: ShortcutEventLike, prefix: PrefixSequenceModifier): boolean {
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

/** Reject tokens modified by a second modifier so regular chords stay intact. */
function hasOtherModifier(event: ShortcutEventLike, prefix: PrefixSequenceModifier): boolean {
  return (
    (prefix !== "CTRL" && event.ctrlKey === true) ||
    (prefix !== "ALT" && event.altKey === true) ||
    (prefix !== "SHIFT" && event.shiftKey === true) ||
    (prefix !== "META" && event.metaKey === true)
  );
}

/** Return an idle transition, optionally marking the event as consumed. */
function idle(handled: boolean): PrefixSequenceTransition {
  return { state: createPrefixSequenceState(), handled, submission: null };
}

/** Return a transition that leaves the state untouched. */
function unchanged(state: PrefixSequenceState): PrefixSequenceTransition {
  return { state, handled: false, submission: null };
}
