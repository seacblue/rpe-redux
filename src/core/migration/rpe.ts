/**
 * Reads a native RPE installation into migration writes.
 *
 * The mapping is deliberately conservative: only settings with a clear RPE
 * counterpart are written, and only hotkeys whose command already exists in
 * this editor are rebound. Unknown RPE actions are left alone rather than
 * guessed, so a migration never changes a key into an unrelated command.
 */
import { HIT_SOUND_KINDS } from "../media/hitsounds.ts";
import { TIMELINE_GRID_COLORS, timelineGridColorKey } from "../settings/timelineGridColors.ts";
import { canonicalText, normalizeShortcutKey, parseShortcut } from "../shortcuts/keys.ts";
import type { Modifier, Shortcut } from "../shortcuts/types.ts";
import { formatHexColor, normalizeHexColor, parseHexColor } from "../utils/colors.ts";
import { isRecord } from "../utils/guards.ts";

/** One settings value to write after the catalog has declared its key. */
export interface RpeSettingWrite {
  readonly key: string;
  readonly value: string | boolean;
}

/** One existing shortcut and the bindings imported from RPE. */
export interface RpeShortcutWrite {
  readonly id: string;
  readonly bindings: readonly string[];
}

/** One RPE hotkey line, kept whether or not this editor has a matching command. */
export interface RpeHotkeyEntry {
  /** The RPE action name, as written in `Hotkey.txt`. */
  readonly action: string;
  /** The binding text, normalized when it parsed. */
  readonly binding: string;
  /** The command this binding was applied to; absent when RPE's action is unknown. */
  readonly target?: string;
  /** Why the line was not applied; absent when it was. */
  readonly reason?: "unknown-action" | "invalid-binding";
}

/** The parsed RPE hotkeys: applied bindings and every line that was not applied. */
export interface RpeHotkeyReport {
  readonly entries: readonly RpeHotkeyEntry[];
}

/** Parsed settings and hotkeys, before anything has been applied. */
export interface RpeMigrationPlan {
  readonly settings: readonly RpeSettingWrite[];
  readonly shortcuts: readonly RpeShortcutWrite[];
  readonly hotkeys: RpeHotkeyReport;
  readonly language: "en" | "zh" | null;
  readonly warnings: readonly string[];
}

/** One chart folder discovered under an RPE Resources directory. */
export interface RpeChartFolder {
  readonly path: string;
  readonly folder: string;
  readonly name: string;
  readonly group: string;
  readonly song?: string;
  readonly picture?: string;
  readonly chart?: string;
  readonly lastEdit?: string;
  readonly autosaves: number;
}

/** The native folder scan returned by the desktop host. */
export interface RpeFolderScan {
  readonly root: string;
  readonly settingsText: string | null;
  readonly hotkeysText: string | null;
  /** Editor appearance sidecar (`UI.txt`) when the installation writes one. */
  readonly uiText?: string | null;
  readonly charts: readonly RpeChartFolder[];
  readonly warnings: readonly string[];
}

/** One RPE `Hotkey.txt` line longer than this is treated as malformed. */
const MAX_HOTKEY_LINE = 512;
/** Only the head of an oversized file is read; the rest cannot be a valid map. */
const MAX_HOTKEY_TEXT = 256 * 1024;
/** One migration cannot reasonably map more actions; the report stays usable. */
const MAX_HOTKEY_ENTRIES = 2000;

/** Beat-line denominators in the order RPE's appearance file presents them. */
const RPE_BEAT_LINE_KEYS: readonly string[] = TIMELINE_GRID_COLORS.map(
  ([denominator]) => denominator,
);

/** The RPE look: whole beats red, every finer subdivision green. */
const RPE_DEFAULT_BEAT_LINE_COLORS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    RPE_BEAT_LINE_KEYS.map((denominator) => [
      denominator,
      denominator === "1" ? "#FF0000" : "#00FF00",
    ]),
  ),
);

/** RPE's current-time line is a muted red; migration turns it grey. */
const RPE_DEFAULT_PLAYHEAD_COLOR = "#808080";

/** Config keys that may carry a beat-line colour list in `UI.txt`/`Settings.json`. */
const BEAT_LINE_COLOR_ALIASES = new Set([
  "beatlinecolor",
  "beatlinecolors",
  "beatlinescolor",
  "beatlinescolors",
  "gridlinecolor",
  "gridlinecolors",
  "gridcolor",
  "gridcolors",
  "subdivisioncolor",
  "subdivisioncolors",
  "timinglinecolor",
  "timinglinecolors",
  "rhythmlinecolor",
  "rhythmlinecolors",
]);

/** Config keys that may carry the current-time line colour. */
const PLAYHEAD_COLOR_ALIASES = new Set([
  "playhead",
  "playheadcolor",
  "playheadcolour",
  "redline",
  "redlinecolor",
  "timelinecursorcolor",
  "cursorcolor",
]);

/** RPE hotkey actions whose meaning has a direct command in this editor. */
const HOTKEY_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  AddTap: "note.place.tap",
  AddDrag: "note.place.drag",
  AddFlick: "note.place.flick",
  AddHold: "note.place.hold",
  AddEvent: "event.place",
  Delete: "edit.delete",
  Copy: "edit.copy",
  Shear: "edit.cut",
  Paste: "edit.paste",
  KeepTimePaste: "edit.paste.keepTime",
  SelectAll: "edit.selectAll",
  Undo: "edit.undo",
  Redo: "edit.redo",
  Save: "document.save",
  Pause: "playback.pause",
  LastBeat: "playback.step.previous",
  NextBeat: "playback.step.next",
  ResetCamera: "view.resetCamera",
  ShowLineInfo: "view.showLineInfo",
  SwitchMulti: "workspace.multiLine.toggle",
  SwitchMultiMode: "workspace.multiLine.switchMode",
  CurveBegin: "event.trajectory.capture.begin",
  CurveEnd: "event.trajectory.capture.end",
  SwitchUI: "view.toggleGameUi",
});

/** RPE's sided modifier names, mapped to this editor's portable tokens. */
const MODIFIERS: Readonly<Record<string, Modifier>> = Object.freeze({
  CTRL: "CTRL",
  LEFTCTRL: "CTRL",
  RIGHTCTRL: "CTRL",
  ALT: "ALT",
  LEFTALT: "ALT",
  RIGHTALT: "ALT",
  SHIFT: "SHIFT",
  LEFTSHIFT: "SHIFT",
  RIGHTSHIFT: "SHIFT",
  META: "META",
  SUPER: "META",
  LEFTSUPER: "META",
  RIGHTSUPER: "META",
});

const FPS_OPTIONS = [30, 60, 90, 120, 144] as const;

/** A finite numeric setting from an RPE JSON value. */
function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** An RPE boolean setting. */
function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Clamp a numeric setting and render it in the form the settings control stores. */
function numberText(
  value: unknown,
  minimum: number,
  maximum: number,
  digits = 4,
): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) {
    return undefined;
  }
  const clamped = Math.min(maximum, Math.max(minimum, parsed));
  return String(Number(clamped.toFixed(digits)));
}

/** Clamp a whole-number setting. */
function integerText(value: unknown, minimum: number, maximum: number): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) {
    return undefined;
  }
  return String(Math.min(maximum, Math.max(minimum, Math.round(parsed))));
}

/** Format three channels and an optional alpha as the settings colour spelling. */
function rgbHex(channels: readonly number[], alpha = 1): string {
  const base = `#${channels
    .slice(0, 3)
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
  return formatHexColor(base, alpha);
}

/** Convert an RPE RGB array, hex string, or CSS-style rgb text to a settings colour. */
function colourValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    const parsedHex = parseHexColor(text);
    if (parsedHex) {
      return formatHexColor(normalizeHexColor(text), parsedHex.alpha);
    }
    const rgba =
      /^rgba\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[,/]\s*(\d+(?:\.\d+)?)\s*\)$/i.exec(
        text,
      );
    if (rgba) {
      return rgbHex(rgba.slice(1, 4).map(Number), Number(rgba[4]));
    }
    const css =
      /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i.exec(text);
    if (css) {
      return rgbHex(css.slice(1).map(Number));
    }
    const channels = text
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (channels.length >= 3 && channels.every(Number.isFinite)) {
      return rgbHex(channels, channels[3] ?? 1);
    }
    return undefined;
  }
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }
  const channels = value.slice(0, 3).map((channel) => numberValue(channel));
  if (channels.some((channel) => channel === undefined)) {
    return undefined;
  }
  return rgbHex(channels as number[], numberValue(value[3]) ?? 1);
}

/** Normalize a configuration key so `GridLineColor` and `grid-line-color` compare equal. */
function configKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The denominator a colour key addresses, or null for a generic list. */
function beatLineKeyFromName(value: string): string | null {
  const fraction = /(?:^|\D)1\s*\/\s*(\d+)\s*$/.exec(value.toLowerCase());
  if (fraction) {
    const denominator = fraction[1];
    return RPE_BEAT_LINE_KEYS.includes(denominator) ? denominator : null;
  }
  const normalized = configKey(value);
  const tail = normalized.replace(
    /^(beatlinecolors|beatlinecolor|gridlinecolors|gridlinecolor|gridcolors|gridcolor|subdivisioncolors|subdivisioncolor|timinglinecolors|timinglinecolor|rhythmlinecolors|rhythmlinecolor)/,
    "",
  );
  const aliases: Readonly<Record<string, string>> = {
    "1": "1",
    whole: "1",
    "3": "3",
    "4": "4",
    quarter: "4",
    "6": "6",
    "8": "8",
    eighth: "8",
    "12": "12",
    "16": "16",
    "116": "16",
    sixteenth: "16",
    default: "default",
    other: "default",
  };
  return aliases[tail] ?? aliases[normalized] ?? null;
}

/** One candidate colour entry found in a settings or UI file. */
interface RpeColorEntry {
  readonly key: string;
  readonly value: unknown;
}

/** Candidate entries collected from a nested settings object. */
interface RpeColorEntries {
  readonly beat: RpeColorEntry[];
  readonly playhead: unknown[];
}

/** True when a key names one beat-line colour list. */
function isBeatLineColorKey(normalized: string): boolean {
  return (
    BEAT_LINE_COLOR_ALIASES.has(normalized) ||
    /^(beatlinecolor|beatlinecolors|gridlinecolor|gridlinecolors|gridcolor|gridcolors|subdivisioncolor|subdivisioncolors|timinglinecolor|timinglinecolors|rhythmlinecolor|rhythmlinecolors)(\d+|default|other)$/.test(
      normalized,
    )
  );
}

/** Collect colour entries recursively without treating unrelated nested colours as beat lines. */
function collectColorEntries(value: unknown, out: RpeColorEntries, depth = 0): RpeColorEntries {
  if (depth > 8) {
    return out;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectColorEntries(child, out, depth + 1);
    }
    return out;
  }
  if (!isRecord(value)) {
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = configKey(key);
    if (PLAYHEAD_COLOR_ALIASES.has(normalized)) {
      out.playhead.push(child);
      continue;
    }
    if (isBeatLineColorKey(normalized)) {
      out.beat.push({ key, value: child });
      continue;
    }
    collectColorEntries(child, out, depth + 1);
  }
  return out;
}

/** Pull the first usable colour out of a scalar, object, or colour list. */
function colorFromUnknown(value: unknown): string | undefined {
  const direct = colourValue(value);
  if (direct) {
    return direct;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const color = colorFromUnknown(child);
      if (color) {
        return color;
      }
    }
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const color = colorFromUnknown(child);
      if (color) {
        return color;
      }
    }
  }
  return undefined;
}

/** A list of colours from an array or a single scalar. */
function colourList(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.every((channel) => typeof channel === "number")) {
      const color = colourValue(value);
      return color ? [color] : null;
    }
    const colors = value.map((child) => colourValue(child));
    return colors.some(Boolean) ? (colors.filter(Boolean) as string[]) : null;
  }
  const color = colourValue(value);
  return color ? [color] : null;
}

/** Apply one beat-line entry, including an object keyed by denominator. */
function applyBeatColorEntry(colors: Record<string, string>, entry: RpeColorEntry): void {
  const key = beatLineKeyFromName(entry.key);
  if (key) {
    const color = colorFromUnknown(entry.value);
    if (color) {
      colors[key] = color;
    }
    return;
  }
  if (isRecord(entry.value)) {
    let matched = false;
    for (const [childKey, child] of Object.entries(entry.value)) {
      const childDenominator = beatLineKeyFromName(childKey);
      if (!childDenominator) {
        continue;
      }
      const color = colorFromUnknown(child);
      if (color) {
        colors[childDenominator] = color;
        matched = true;
      }
    }
    if (matched) {
      return;
    }
  }
  const list = colourList(entry.value);
  if (!list?.length) {
    return;
  }
  if (list.length === 1) {
    for (const denominator of RPE_BEAT_LINE_KEYS) {
      colors[denominator] = list[0];
    }
    return;
  }
  list.forEach((color, index) => {
    const denominator = RPE_BEAT_LINE_KEYS[index];
    if (denominator) {
      colors[denominator] = color;
    }
  });
}

/** Resolve the colour map and playhead from one settings object or line-based UI file. */
function readColorEntries(entries: RpeColorEntries): {
  beat: Record<string, string>;
  playhead: string | undefined;
} {
  const beat: Record<string, string> = {};
  for (const entry of entries.beat) {
    applyBeatColorEntry(beat, entry);
  }
  let playhead: string | undefined;
  for (const value of entries.playhead) {
    playhead = colorFromUnknown(value) ?? playhead;
  }
  return { beat, playhead };
}

/** Extract colour tokens from a line-based UI.txt value. */
function colorTokens(text: string): string[] {
  const matches = text.match(/#[\da-f]{3,8}|rgba?\([^)]*\)|\d+\s*[, ]\s*\d+\s*[, ]\s*\d+/gi);
  return matches?.map((value) => value.trim()) ?? [];
}

/** Read a line-based UI.txt or Settings.txt design file. */
function parseColorText(text: string | null | undefined): RpeColorEntries {
  const entries: RpeColorEntries = { beat: [], playhead: [] };
  if (!text?.trim()) {
    return entries;
  }
  const source = text.replace(/^\uFEFF/, "");
  try {
    const parsed: unknown = JSON.parse(source);
    collectColorEntries(parsed, entries);
    return entries;
  } catch {
    // RPE's older UI.txt is line-based; fall through to key/value parsing.
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith(";")) {
      continue;
    }
    const match = /^([^:=]+?)\s*[:=]\s*(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, rawKey, rawValue] = match;
    const normalized = configKey(rawKey);
    const tokens = colorTokens(rawValue);
    if (PLAYHEAD_COLOR_ALIASES.has(normalized)) {
      entries.playhead.push(tokens.length ? tokens : rawValue);
      continue;
    }
    if (isBeatLineColorKey(normalized)) {
      entries.beat.push({
        key: rawKey,
        value: tokens.length ? tokens : rawValue,
      });
    }
  }
  return entries;
}

/** Build the colour writes that make a migrated chart feel like RPE. */
function appearanceWrites(
  settingsRaw: Record<string, unknown>,
  uiText: string | null | undefined,
): RpeSettingWrite[] {
  const fromSettings = readColorEntries(
    collectColorEntries(settingsRaw, { beat: [], playhead: [] }),
  );
  const fromUi = readColorEntries(parseColorText(uiText));
  const colors = { ...RPE_DEFAULT_BEAT_LINE_COLORS, ...fromSettings.beat, ...fromUi.beat };
  const playhead = fromUi.playhead ?? fromSettings.playhead ?? RPE_DEFAULT_PLAYHEAD_COLOR;
  return [
    ...TIMELINE_GRID_COLORS.map(([denominator]) => ({
      key: timelineGridColorKey(denominator),
      value: colors[denominator] ?? RPE_DEFAULT_BEAT_LINE_COLORS[denominator],
    })),
    { key: "timeline-playhead-color", value: playhead },
  ];
}

/** Pick the nearest frame-rate option a user can actually select. */
function nearestFps(value: unknown): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return String(
    FPS_OPTIONS.reduce((best, option) =>
      Math.abs(option - parsed) < Math.abs(best - parsed) ? option : best,
    ),
  );
}

/** True for an object accepted by the RPE settings reader. */
function settingsObject(text: string | null | undefined): Record<string, unknown> {
  if (!text?.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Parse one RPE binding such as `LEFTCTRL&LEFTSHIFT&V` into this editor's text. */
function parseBinding(text: string): string | null {
  const tokens = text
    .split("&")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  const modifiers: Modifier[] = [];
  let key: string | null = null;
  for (const token of tokens) {
    const modifier = MODIFIERS[token.toUpperCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
      }
      continue;
    }
    if (key !== null) {
      return null;
    }
    key = normalizeShortcutKey(token);
  }
  if (!key) {
    return null;
  }
  const shortcut: Shortcut = modifiers.length ? { key, modifiers } : { key };
  const canonical = canonicalText(shortcut);
  return parseShortcut(canonical).ok ? canonical : null;
}

/**
 * Read RPE `Hotkey.txt` into one entry per line.
 *
 * The report keeps unknown actions and unparseable bindings: a user migrating a
 * familiar keymap needs to know which keys RPE had that this editor does not,
 * not just a count of the ones that worked. Overlong lines are skipped so a
 * corrupted file cannot flood the shortcut page or the stored report.
 */
export function readRpeHotkeys(text: string | null | undefined): RpeHotkeyReport {
  const entries: RpeHotkeyEntry[] = [];
  const source = (text ?? "").replace(/^\uFEFF/, "");
  const bounded = source.length > MAX_HOTKEY_TEXT ? source.slice(0, MAX_HOTKEY_TEXT) : source;
  for (const rawLine of bounded.split(/\r?\n/)) {
    if (entries.length >= MAX_HOTKEY_ENTRIES) {
      break;
    }
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.length > MAX_HOTKEY_LINE) {
      continue;
    }
    const separator = line.search(/\s/);
    if (separator <= 0) {
      continue;
    }
    const action = line.slice(0, separator);
    const rawBinding = line.slice(separator + 1).trim();
    const target = HOTKEY_TARGETS[action];
    if (!target) {
      entries.push(
        Object.freeze({ action, binding: rawBinding, reason: "unknown-action" as const }),
      );
      continue;
    }
    const binding = parseBinding(rawBinding);
    if (!binding) {
      entries.push(
        Object.freeze({ action, binding: rawBinding, reason: "invalid-binding" as const }),
      );
      continue;
    }
    entries.push(Object.freeze({ action, binding, target }));
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

/**
 * Read RPE `Hotkey.txt` into writes for shortcuts that exist here.
 *
 * Multiple RPE actions may intentionally map to the same current command; the
 * unique binding list is preserved. Unknown actions are ignored here and
 * reported by `readRpeHotkeys`.
 */
export function parseRpeHotkeys(text: string | null | undefined): RpeShortcutWrite[] {
  const bindings = new Map<string, Set<string>>();
  for (const entry of readRpeHotkeys(text).entries) {
    if (!entry.target) {
      continue;
    }
    let list = bindings.get(entry.target);
    if (!list) {
      list = new Set();
      bindings.set(entry.target, list);
    }
    list.add(entry.binding);
  }
  return [...bindings].map(([id, values]) => Object.freeze({ id, bindings: [...values] }));
}

/** Build the settings writes RPE's Settings.json supports here. */
function parseSettings(raw: Record<string, unknown>): RpeSettingWrite[] {
  const writes: RpeSettingWrite[] = [];
  /** Add a value only when the source field exists and maps cleanly. */
  const add = (key: string, value: string | boolean | undefined): void => {
    if (value !== undefined) {
      writes.push(Object.freeze({ key, value }));
    }
  };

  add("render-fps", nearestFps(raw.FpsLimit));
  const noteSize = numberText(raw.NoteSize, 40, 400, 2);
  add("note-size", noteSize);
  add("timeline-note-size", noteSize);
  add("bar-width", numberText(raw.BarWidth, 0.5, 10));
  add("bar-alpha", numberText(raw.BarAlpha, 0.1, 2));
  add("realtime-alpha", numberText(raw.RealTimeAlpha, 0, 1));
  const blur = booleanValue(raw.Blur);
  add("background-blur", blur === undefined ? undefined : blur ? "10.5" : "0");
  add("highlight-notes", booleanValue(raw.HighLight));
  add("volume", numberText(raw.MusicVolume, 0, 1));
  const hitVolume = numberText(raw.SEVolume, 0, 1);
  for (const kind of HIT_SOUND_KINDS) {
    add(`hitsound-${kind}`, hitVolume);
  }
  add("hitsound-limit-enabled", booleanValue(raw.SElimit));
  add("hitsound-limit", integerText(raw.SElimitNumber, 1, 100));
  add("scroll-speed", numberText(raw.ScrollSpeed, 0.1, 100));
  add("scroll-acceleration", booleanValue(raw.ScrollAcc));
  add("default-line-thickness", numberText(raw.LineScale, 0.1, 10));
  add("default-line-color", colourValue(raw.DefaultColor));
  add("preview-non-current-opacity", integerText(raw.otherAlpha, 0, 255));
  add("preview-show-game-ui", booleanValue(raw.showViewUI));
  add("autosave-enabled", booleanValue(raw.AutoSave));
  add("autosave-seconds", integerText(raw.AutoSaveGap, 1, 3600));
  add("autosave-limit", integerText(raw.AutoSaveLimit, 1, 100));
  add("preview-ratio-width", integerText(raw.ratioWidth, 1, 100));
  add("preview-ratio-height", integerText(raw.ratioHeight, 1, 100));
  add("timeline-grid-count", integerText(raw.GridlineCount, 1, 64));
  add("history-limit", integerText(raw.maxHistorySize, 1, 100000));
  return writes;
}

/** Read RPE's language file name into the editor's language code. */
function languageValue(value: unknown): "en" | "zh" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  return null;
}

/**
 * Convert the two RPE sidecars into a migration plan.
 *
 * The plan is pure: applying it is a separate step because settings and
 * shortcuts are registered by the mounted editor.
 */
export function createRpeMigrationPlan(
  settingsText: string | null | undefined,
  hotkeysText: string | null | undefined,
  uiText?: string | null,
): RpeMigrationPlan {
  const raw = settingsObject(settingsText);
  return Object.freeze({
    settings: Object.freeze([...parseSettings(raw), ...appearanceWrites(raw, uiText)]),
    shortcuts: Object.freeze(parseRpeHotkeys(hotkeysText)),
    hotkeys: readRpeHotkeys(hotkeysText),
    language: languageValue(raw.Language),
    warnings: Object.freeze([]),
  });
}
