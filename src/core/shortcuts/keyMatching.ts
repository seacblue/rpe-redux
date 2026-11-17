/** Reads a browser event as a key, a recorded binding, or a match against one. */
import { isApplePlatform } from "../platform/environment.ts";
import { normalizeShortcutKey, shortcutKeys } from "./keys.ts";
import type { Modifier, Shortcut, ShortcutEventLike } from "./types.ts";

/** Modifier tokens never join a held-key chord as ordinary keys. */
const BARE_MODIFIERS = new Set(["CTRL", "ALT", "SHIFT", "META"]);

/** Map a wheel event to a directional key, or null when it has no wheel delta. */
function wheelKey(event: ShortcutEventLike): string | null {
  if (typeof event.deltaY !== "number" && typeof event.deltaX !== "number") {
    return null;
  }
  const deltaY = event.deltaY ?? 0;
  const deltaX = event.deltaX ?? 0;
  if (deltaY !== 0) {
    return deltaY < 0 ? "WHEELUP" : "WHEELDOWN";
  }
  if (deltaX !== 0) {
    return deltaX < 0 ? "WHEELLEFT" : "WHEELRIGHT";
  }
  return "";
}

/** Collect the modifiers held during the event in canonical token order. */
function modifiersOf(event: ShortcutEventLike): Modifier[] {
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) {
    modifiers.push("CTRL");
  }
  if (event.altKey) {
    modifiers.push("ALT");
  }
  if (event.shiftKey) {
    modifiers.push("SHIFT");
  }
  if (event.metaKey) {
    modifiers.push("META");
  }
  return modifiers;
}

/** The key a `keydown`/`mousedown`/`wheel` event actually pressed. */
export function shortcutKey(event: ShortcutEventLike): string {
  const wheel = wheelKey(event);
  if (wheel !== null) {
    return wheel;
  }
  if (typeof event.button === "number" && !event.key) {
    return `MOUSE${Math.max(0, Math.min(4, event.button))}`;
  }
  let key = String(event.key ?? "").toUpperCase();
  if (event.shiftKey) {
    const shiftNames: Record<string, string> = {
      Minus: "MINUS",
      Equal: "EQUAL",
      Comma: "COMMA",
      Period: "PERIOD",
      Slash: "SLASH",
      Backslash: "BACKSLASH",
      Semicolon: "SEMICOLON",
      Quote: "QUOTE",
      Backquote: "TILDE",
      BracketLeft: "LEFTBRACKET",
      BracketRight: "RIGHTBRACKET",
    };
    const base = shiftNames[event.code ?? ""];
    if (base) {
      key = base;
    } else if (/^Digit[0-9]$/.test(event.code ?? "")) {
      key = String(event.code).slice(-1);
    }
  }
  if (event.isComposing || ["PROCESS", "UNIDENTIFIED", "DEAD", ""].includes(key)) {
    const code = String(event.code ?? "").toUpperCase();
    key = /^(KEY[A-Z]|DIGIT[0-9])$/.test(code) ? code.replace(/^(KEY|DIGIT)/, "") : code;
    if (key === "BRACKETLEFT") {
      key = "LEFTBRACKET";
    }
    if (key === "BRACKETRIGHT") {
      key = "RIGHTBRACKET";
    }
  }
  if (["CONTROL", "META", "ALT", "SHIFT"].includes(key)) {
    return normalizeShortcutKey(key);
  }
  return normalizeShortcutKey(key);
}

/**
 * Whether `event` is `shortcut`.
 *
 * `MOD` matches the platform's primary modifier and nothing else, so a profile
 * moved between a Mac and a PC keeps the same intent without both modifiers
 * firing at once.
 *
 * A binding with several non-modifier keys matches when the event's key is one
 * of them and `heldKeys` covers the rest. Extra held keys are ignored: a plain
 * `E` binding keeps working while a mouse button is down, and a more specific
 * `E+MOUSE2` binding wins the dispatch tie when both can run.
 */
export function matches(
  event: ShortcutEventLike,
  shortcut: Shortcut,
  heldKeys: Iterable<string> = [],
): boolean {
  if (event.isComposing || ["Process", "Dead", "Unidentified"].includes(event.key ?? "")) {
    return false;
  }
  const modifiers = shortcut.modifiers ?? [];
  const wantsMod = modifiers.includes("MOD");
  // `MOD` names whichever modifier the platform calls primary, so it has to be
  // resolved into an actual Ctrl/Meta requirement before comparing.
  const needsCtrl = modifiers.includes("CTRL") || (wantsMod && !isApplePlatform());
  const needsMeta = modifiers.includes("META") || (wantsMod && isApplePlatform());
  const keys = shortcutKeys(shortcut);
  const eventKey = shortcutKey(event);
  if (keys.length === 1 && BARE_MODIFIERS.has(keys[0]) && modifiers.length === 0) {
    const modifierKey = eventKey === "CONTROL" ? "CTRL" : eventKey;
    return (
      keys[0] === modifierKey &&
      !(event.ctrlKey && modifierKey !== "CTRL") &&
      !(event.metaKey && modifierKey !== "META") &&
      !(event.altKey && modifierKey !== "ALT") &&
      !(event.shiftKey && modifierKey !== "SHIFT")
    );
  }
  if (!keys.includes(eventKey)) {
    return false;
  }
  const active = new Set<string>();
  for (const held of heldKeys) {
    active.add(normalizeShortcutKey(held));
  }
  active.add(eventKey);
  if (!keys.every((key) => active.has(key))) {
    return false;
  }
  return (
    Boolean(event.ctrlKey) === needsCtrl &&
    Boolean(event.metaKey) === needsMeta &&
    Boolean(event.altKey) === modifiers.includes("ALT") &&
    Boolean(event.shiftKey) === modifiers.includes("SHIFT")
  );
}

/**
 * Whether `event` is the fixed system cancel key.
 *
 * Escape is an interaction key rather than a rebindable command: it must keep
 * working in every editor context and is therefore never registered in the
 * shortcut table.
 */
export function isSystemCancelKey(event: ShortcutEventLike): boolean {
  return matches(event, { key: "ESCAPE" });
}

/**
 * Records the event the user just pressed as one shortcut.
 *
 * Modifiers are written out explicitly rather than as `MOD`: the user pressed a
 * specific key and the stored binding should say which one. `null` means the
 * event cannot become a binding — a bare modifier, an IME composition, or a key
 * this app does not name.
 */
export function recordShortcut(
  event: ShortcutEventLike,
  heldKeys: readonly string[] = [],
): Shortcut | null {
  const wheel = wheelKey(event);
  if (wheel !== null) {
    return wheel ? withHeldKeys(wheel, event, heldKeys) : null;
  }
  if (typeof event.button === "number" && !event.key) {
    return withHeldKeys(`MOUSE${Math.max(0, Math.min(4, event.button))}`, event, heldKeys);
  }
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key ?? "")) {
    return null;
  }
  const key = shortcutKey(event);
  if (!key || ["PROCESS", "DEAD", "UNIDENTIFIED"].includes(key) || BARE_MODIFIERS.has(key)) {
    return null;
  }
  return withHeldKeys(key, event, heldKeys);
}

/**
 * Build a binding from the triggering key and every other key held with it.
 *
 * Modifiers stay in their own list, and the triggering key is never repeated in
 * `keys`. The result omits `keys` when the chord has only one key so a plain
 * binding still compares and serializes exactly as before.
 */
function withHeldKeys(
  key: string,
  event: ShortcutEventLike,
  heldKeys: readonly string[],
): Shortcut {
  const others = new Set<string>();
  for (const held of heldKeys) {
    const token = normalizeShortcutKey(held);
    if (token !== key && !BARE_MODIFIERS.has(token)) {
      others.add(token);
    }
  }
  const shortcut: Shortcut = { key, modifiers: modifiersOf(event) };
  if (others.size > 0) {
    shortcut.keys = [...others];
  }
  return shortcut;
}

/** Whether a key-up event released a key that `shortcut` uses. */
export function released(event: ShortcutEventLike, shortcut: Shortcut): boolean {
  const key = shortcutKey(event);
  if (shortcutKeys(shortcut).includes(key)) {
    return true;
  }
  const alias = (["CTRL", "META", "SHIFT", "ALT"] as readonly Modifier[]).includes(key as Modifier)
    ? (key as Modifier)
    : undefined;
  const modifiers = shortcut.modifiers ?? [];
  return (
    (alias !== undefined && modifiers.includes(alias)) ||
    ((alias === "CTRL" || alias === "META") && modifiers.includes("MOD"))
  );
}
