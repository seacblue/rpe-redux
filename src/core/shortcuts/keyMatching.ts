/** Reads a browser event as a key, a recorded binding, or a match against one. */
import { isApplePlatform } from "../platform/environment.ts";
import { normalizeShortcutKey } from "./keys.ts";
import type { Modifier, Shortcut, ShortcutEventLike } from "./types.ts";

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
 * Whether `event` is exactly `shortcut`.
 *
 * `MOD` matches the platform's primary modifier and nothing else, so a profile
 * moved between a Mac and a PC keeps the same intent without both modifiers
 * firing at once.
 */
export function matches(event: ShortcutEventLike, shortcut: Shortcut): boolean {
  if (event.isComposing || ["Process", "Dead", "Unidentified"].includes(event.key ?? "")) {
    return false;
  }
  const modifiers = shortcut.modifiers ?? [];
  const wantsMod = modifiers.includes("MOD");
  // `MOD` names whichever modifier the platform calls primary, so it has to be
  // resolved into an actual Ctrl/Meta requirement before comparing.
  const needsCtrl = modifiers.includes("CTRL") || (wantsMod && !isApplePlatform());
  const needsMeta = modifiers.includes("META") || (wantsMod && isApplePlatform());
  const key = normalizeShortcutKey(shortcut.key);
  if (["CTRL", "ALT", "SHIFT", "META"].includes(key) && modifiers.length === 0) {
    const eventKey = shortcutKey(event) === "CONTROL" ? "CTRL" : shortcutKey(event);
    return (
      key === eventKey &&
      !(event.ctrlKey && key !== "CTRL") &&
      !(event.metaKey && key !== "META") &&
      !(event.altKey && key !== "ALT") &&
      !(event.shiftKey && key !== "SHIFT")
    );
  }
  return (
    key === shortcutKey(event) &&
    Boolean(event.ctrlKey) === needsCtrl &&
    Boolean(event.metaKey) === needsMeta &&
    Boolean(event.altKey) === modifiers.includes("ALT") &&
    Boolean(event.shiftKey) === modifiers.includes("SHIFT")
  );
}

/**
 * Records the event the user just pressed as one shortcut.
 *
 * Modifiers are written out explicitly rather than as `MOD`: the user pressed a
 * specific key and the stored binding should say which one. `null` means the
 * event cannot become a binding — a bare modifier, an IME composition, or a key
 * this app does not name.
 */
export function recordShortcut(event: ShortcutEventLike): Shortcut | null {
  const wheel = wheelKey(event);
  if (wheel !== null) {
    return wheel ? { key: wheel, modifiers: modifiersOf(event) } : null;
  }
  if (typeof event.button === "number" && !event.key) {
    return {
      key: `MOUSE${Math.max(0, Math.min(4, event.button))}`,
      modifiers: modifiersOf(event),
    };
  }
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key ?? "")) {
    return null;
  }
  const key = shortcutKey(event);
  if (!key || ["PROCESS", "DEAD", "UNIDENTIFIED"].includes(key)) {
    return null;
  }
  return { key, modifiers: modifiersOf(event) };
}

/** Whether a key-up event released a key that `shortcut` uses. */
export function released(event: ShortcutEventLike, shortcut: Shortcut): boolean {
  const key = shortcutKey(event);
  const alias = (["CTRL", "META", "SHIFT", "ALT"] as readonly Modifier[]).includes(key as Modifier)
    ? (key as Modifier)
    : undefined;
  const modifiers = shortcut.modifiers ?? [];
  return (
    normalizeShortcutKey(shortcut.key) === key ||
    (alias !== undefined && modifiers.includes(alias)) ||
    ((alias === "CTRL" || alias === "META") && modifiers.includes("MOD"))
  );
}
