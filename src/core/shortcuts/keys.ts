/**
 * The key model: what a shortcut is, how it is written down, and whether an
 * event matches it.
 *
 * Three things this covers that a `keydown` string comparison does not:
 *
 *   1. **A shortcut is a value.** `{ key: "S", modifiers: ["CTRL"] }` is what a
 *      shortcut answers to; written text (`"CTRL+S"`) is how a profile stores it
 *      and how a person types it. `parseShortcut` and `canonicalText` are the
 *      only two places the forms meet.
 *   2. **Modifiers are named per platform.** A binding says `CTRL` and renders
 *      as `Ctrl` everywhere and as the right glyph on macOS; a binding that
 *      names `MOD` follows the platform's own primary modifier (`Meta` on macOS,
 *      `Ctrl` elsewhere), which is what makes one default table work on both.
 *   3. **Mouse buttons and the wheel are first-class keys.** `MOUSE0`…`MOUSE4`
 *      (left, middle, right, back, forward) and the four wheel directions parse,
 *      match and collide exactly like `SPACE` does, so a shortcut can be bound to
 *      the side button or a wheel direction without a second mechanism.
 *
 * Shortcut text uses the token form only (`CTRL+SHIFT+S`, `SPACE`, `MOUSE3`).
 * The parser rejects `&`-joined bindings and sided modifier names.
 */
import { isApplePlatform } from "../platform/environment.ts";
import type { Modifier, ParsedShortcut, Shortcut } from "./types.ts";

/** The five mouse buttons, in `MouseEvent.button` order, plus the wheel. */
export const MOUSE_KEYS = ["MOUSE0", "MOUSE1", "MOUSE2", "MOUSE3", "MOUSE4"] as const;
/** The four wheel directions, named for the axis delta that produced them. */
export const WHEEL_KEYS = ["WHEELUP", "WHEELDOWN", "WHEELLEFT", "WHEELRIGHT"] as const;

/** The modifier tokens, in the order a written shortcut lists them. */
const MODIFIER_ORDER: readonly Modifier[] = ["CTRL", "ALT", "SHIFT", "META", "MOD"];

const MOUSE_ALIASES: Record<string, string> = {
  MOUSE: "MOUSE0",
  MOUSELEFT: "MOUSE0",
  MOUSEPRIMARY: "MOUSE0",
  MOUSEMIDDLE: "MOUSE1",
  MOUSEWHEEL: "MOUSE1",
  MOUSERIGHT: "MOUSE2",
  MOUSESECONDARY: "MOUSE2",
  MOUSEBACK: "MOUSE3",
  MOUSEFORWARD: "MOUSE4",
  WHEELUP: "WHEELUP",
  SCROLLUP: "WHEELUP",
  WHEELDOWN: "WHEELDOWN",
  SCROLLDOWN: "WHEELDOWN",
  WHEELLEFT: "WHEELLEFT",
  SCROLLLEFT: "WHEELLEFT",
  WHEELRIGHT: "WHEELRIGHT",
  SCROLLRIGHT: "WHEELRIGHT",
};

const MODIFIER_TOKENS: Record<string, Modifier> = {
  CTRL: "CTRL",
  ALT: "ALT",
  SHIFT: "SHIFT",
  META: "META",
  MOD: "MOD",
};

/** Everything a plain key can be called, normalised to one token each. */
const KEY_ALIASES: Record<string, string> = {
  " ": "SPACE",
  CONTROL: "CTRL",
  RETURN: "ENTER",
  ESC: "ESCAPE",
  SPACEBAR: "SPACE",
  "←": "LEFTARROW",
  "→": "RIGHTARROW",
  "↑": "UPARROW",
  "↓": "DOWNARROW",
  ARROWLEFT: "LEFTARROW",
  ARROWRIGHT: "RIGHTARROW",
  ARROWUP: "UPARROW",
  ARROWDOWN: "DOWNARROW",
  PAGEUP: "PAGEUP",
  PAGEDOWN: "PAGEDOWN",
  "[": "LEFTBRACKET",
  "]": "RIGHTBRACKET",
  "-": "MINUS",
  "=": "EQUAL",
  ",": "COMMA",
  ".": "PERIOD",
  "/": "SLASH",
  "\\": "BACKSLASH",
  ";": "SEMICOLON",
  "'": "QUOTE",
  "`": "TILDE",
};

const NAMED_KEYS = new Set([
  "SPACE",
  "ENTER",
  "TAB",
  "ESCAPE",
  "DELETE",
  "BACKSPACE",
  "INSERT",
  "HOME",
  "END",
  "PAGEUP",
  "PAGEDOWN",
  "LEFTARROW",
  "RIGHTARROW",
  "UPARROW",
  "DOWNARROW",
  "LEFTBRACKET",
  "RIGHTBRACKET",
  "MINUS",
  "EQUAL",
  "COMMA",
  "PERIOD",
  "SLASH",
  "BACKSLASH",
  "SEMICOLON",
  "QUOTE",
  "TILDE",
  "CAPSLOCK",
  "NUMLOCK",
  "SCROLLLOCK",
  "PRINTSCREEN",
  "PAUSE",
  "CONTEXTMENU",
]);

/** Normalises one token a person might have written into its canonical name. */
export function normalizeShortcutKey(key: string): string {
  // A space is its own key name, and the only one that trimming would erase.
  if (key === " ") {
    return "SPACE";
  }
  const upper = key.trim().toUpperCase();
  if (MODIFIER_TOKENS[upper]) {
    return MODIFIER_TOKENS[upper];
  }
  if (MOUSE_ALIASES[upper]) {
    return MOUSE_ALIASES[upper];
  }
  return KEY_ALIASES[upper] ?? upper;
}

const isModifier = (token: string): boolean =>
  (MODIFIER_ORDER as readonly string[]).includes(token);
const isBareModifier = (token: string): boolean =>
  (["CTRL", "ALT", "SHIFT", "META"] as readonly string[]).includes(token);

const isMouse = (token: string): boolean =>
  (MOUSE_KEYS as readonly string[]).includes(token) ||
  (WHEEL_KEYS as readonly string[]).includes(token);

/** Whether the canonical token names a key this build can bind. */
export function isSupportedKey(key: string): boolean {
  return (
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    NAMED_KEYS.has(key) ||
    isMouse(key)
  );
}

/**
 * Reads written text into a shortcut.
 *
 * Case and padding do not matter, but a token has to be one this build names:
 * `"esc"` is rejected where `"ESCAPE"` is not, so a stored binding always reads
 * back exactly as it was written.
 */
export function parseShortcut(text: unknown): ParsedShortcut {
  if (typeof text !== "string") {
    return { ok: false, error: "shortcuts.error.mustBeText" };
  }
  const source = text.trim();
  if (!source || source.toUpperCase() === "NONE") {
    return { ok: false, error: "shortcuts.error.emptyBinding" };
  }
  // Reject the `&`-joined and sided-modifier forms outside the token grammar.
  if (source.includes("&") || /\b(LEFT|RIGHT)(CTRL|ALT|SHIFT|META)\b/i.test(source)) {
    return { ok: false, error: "shortcuts.error.invalidSyntax" };
  }
  const raw = source.split("+");
  if (raw.some((part) => !part.trim())) {
    return { ok: false, error: "shortcuts.error.emptyPart" };
  }
  const parts = raw.map((part) => normalizeShortcutKey(part));
  if (raw.some((part, index) => part.trim().toUpperCase() !== parts[index])) {
    return { ok: false, error: "shortcuts.error.invalidSyntax" };
  }
  if (new Set(parts).size !== parts.length) {
    return { ok: false, error: "shortcuts.error.duplicateKey" };
  }
  if (parts.length === 1 && isBareModifier(parts[0])) {
    return { ok: true, shortcut: { key: parts[0], modifiers: [] } };
  }
  const modifiers = MODIFIER_ORDER.filter((token) => parts.includes(token));
  const keys = parts.filter((part) => !isModifier(part));
  if (keys.length !== 1) {
    return { ok: false, error: "shortcuts.error.needsOneKey" };
  }
  const key = keys[0];
  if (!isSupportedKey(key)) {
    return { ok: false, error: "shortcuts.error.unsupportedKey" };
  }
  return { ok: true, shortcut: { key, modifiers } };
}

/**
 * The binding as text: modifiers in canonical order, then the key.
 *
 * This is the one written form — what a profile stores, what the settings page
 * puts in `data-binding`, and what `parseShortcut` reads back.
 */
export function canonicalText(shortcut: Shortcut): string {
  const modifiers = MODIFIER_ORDER.filter((token) => shortcut.modifiers?.includes(token));
  return [...modifiers, normalizeShortcutKey(shortcut.key)].join("+");
}

/** The display names of the keys whose token is not already readable. */
const DISPLAY: Record<string, string> = {
  CTRL: "Ctrl",
  ALT: "Alt",
  SHIFT: "Shift",
  META: "Meta",
  MOD: "Mod",
  SPACE: "Space",
  ESCAPE: "Esc",
  ENTER: "Enter",
  TAB: "Tab",
  DELETE: "Del",
  BACKSPACE: "Backspace",
  INSERT: "Ins",
  PAGEUP: "PgUp",
  PAGEDOWN: "PgDn",
  LEFTARROW: "←",
  RIGHTARROW: "→",
  UPARROW: "↑",
  DOWNARROW: "↓",
  LEFTBRACKET: "[",
  RIGHTBRACKET: "]",
  MINUS: "-",
  EQUAL: "=",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  BACKSLASH: "\\",
  SEMICOLON: ";",
  QUOTE: "'",
  TILDE: "`",
  CAPSLOCK: "Caps",
  NUMLOCK: "Num",
  SCROLLLOCK: "Scroll",
  PRINTSCREEN: "PrtSc",
  CONTEXTMENU: "Menu",
  MOUSE0: "Mouse Left",
  MOUSE1: "Mouse Middle",
  MOUSE2: "Mouse Right",
  MOUSE3: "Mouse Back",
  MOUSE4: "Mouse Forward",
  WHEELUP: "Wheel Up",
  WHEELDOWN: "Wheel Down",
  WHEELLEFT: "Wheel Left",
  WHEELRIGHT: "Wheel Right",
};

/** How one token reads in the interface, on this platform. */
export function formatKeyToken(token: string): string {
  if (token === "LEFTMETA" || token === "RIGHTMETA") {
    return isApplePlatform() ? "Cmd" : "Win";
  }
  if (token === "MOD") {
    return isApplePlatform() ? "Cmd" : "Ctrl";
  }
  const key = normalizeShortcutKey(token);
  return DISPLAY[key] ?? key;
}

/**
 * How a binding reads in the interface: `"Ctrl + S"`, `"Space"`.
 *
 * A shortcut holding a key this build does not name is echoed back rather than
 * swallowed: a debugger showing `CTRL+Q` where the profile holds garbage is
 * more useful than one showing nothing.
 */
export function displayText(shortcut: Shortcut): string {
  const modifiers = MODIFIER_ORDER.filter((token) => shortcut.modifiers?.includes(token));
  return [...modifiers, shortcut.key].map(formatKeyToken).join(" + ");
}

/** ARIA key names for the tokens whose spelling differs from the DOM value. */
const ARIA_KEYS: Record<string, string> = {
  CTRL: "Control",
  ALT: "Alt",
  SHIFT: "Shift",
  META: "Meta",
  MOD: "Control",
  SPACE: "Space",
  ESCAPE: "Escape",
  ENTER: "Enter",
  TAB: "Tab",
  DELETE: "Delete",
  BACKSPACE: "Backspace",
  INSERT: "Insert",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  LEFTARROW: "ArrowLeft",
  RIGHTARROW: "ArrowRight",
  UPARROW: "ArrowUp",
  DOWNARROW: "ArrowDown",
  CAPSLOCK: "CapsLock",
  NUMLOCK: "NumLock",
  SCROLLLOCK: "ScrollLock",
  PRINTSCREEN: "PrintScreen",
  PAUSE: "Pause",
  CONTEXTMENU: "ContextMenu",
  LEFTBRACKET: "[",
  RIGHTBRACKET: "]",
  MINUS: "-",
  EQUAL: "=",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  BACKSLASH: "\\",
  SEMICOLON: ";",
  QUOTE: "'",
  TILDE: "`",
};

/**
 * A binding in the `aria-keyshortcuts` grammar, or `""` when it is not a
 * keyboard key.
 *
 * The visible chips say `Ctrl + Space`; assistive technology expects
 * `Control+Space`, names arrow keys in full, and cannot express a mouse button
 * or wheel direction. Returning an empty string keeps that distinction in one
 * place instead of letting every caller approximate it.
 */
export function ariaShortcutText(shortcut: Shortcut): string {
  const key = normalizeShortcutKey(shortcut.key);
  if (isMouse(key)) {
    return "";
  }
  const ariaKey =
    ARIA_KEYS[key] ?? (/^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? key : "");
  if (!ariaKey) {
    return "";
  }
  const modifiers = shortcut.modifiers ?? [];
  const ariaModifiers: string[] = [];
  if (modifiers.includes("CTRL")) {
    ariaModifiers.push("Control");
  }
  if (modifiers.includes("ALT")) {
    ariaModifiers.push("Alt");
  }
  if (modifiers.includes("SHIFT")) {
    ariaModifiers.push("Shift");
  }
  if (modifiers.includes("META")) {
    ariaModifiers.push("Meta");
  }
  if (modifiers.includes("MOD")) {
    ariaModifiers.push(isApplePlatform() ? "Meta" : "Control");
  }
  return [...new Set([...ariaModifiers, ariaKey])].join("+");
}

/**
 * The message key of what is wrong with a binding, or `null` when it is
 * usable.
 *
 * One predicate answers both callers: the registry turns it into a
 * `BindingChange` when the settings page records a key, and `assertShortcut`
 * turns it into a thrown error when a feature declares a default.
 */
export function shortcutIssue(shortcut: Shortcut): string | null {
  const key = normalizeShortcutKey(String(shortcut.key ?? ""));
  const modifiers = shortcut.modifiers ?? [];
  if (!key || (isModifier(key) ? !isBareModifier(key) : !isSupportedKey(key))) {
    return "shortcuts.error.unsupportedKey";
  }
  if (isModifier(key) && modifiers.length > 0) {
    return "shortcuts.error.unsupportedKey";
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return "shortcuts.error.duplicateKey";
  }
  for (const modifier of modifiers) {
    if (!isModifier(modifier)) {
      return "shortcuts.error.unsupportedKey";
    }
  }
  return null;
}

/**
 * Rejects a declared shortcut the key model cannot read.
 *
 * `owner` names the shortcut, so one typo in a hundred declarations says which
 * one it was. The registry calls this during registration, so an unusable
 * default fails registration rather than becoming a key that never fires.
 */
export function assertShortcut(shortcut: Shortcut, owner: string): void {
  const issue = shortcutIssue(shortcut);
  if (issue) {
    throw new Error(
      `${owner} declares an unusable default binding: ${canonicalText(shortcut)} (${issue})`,
    );
  }
}
