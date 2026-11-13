/**
 * RPE `Settings.json` and appearance mapping into editor setting writes.
 *
 * This module owns which source fields the migration recognizes, how a plain
 * value converts, which appearance colours actually exist in the source, and
 * which fields have no destination so the import review can list them. The plan
 * assembly and hotkey reader stay in `rpe.ts`.
 */
import { HIT_SOUND_KINDS } from "../media/hitsounds.ts";
import { TIMELINE_GRID_COLORS, timelineGridColorKey } from "../settings/timelineGridColors.ts";
import { formatHexColor, normalizeHexColor, parseHexColor } from "../utils/colors.ts";
import { isRecord } from "../utils/guards.ts";

/** One settings value to write after the catalog has declared its key. */
export interface RpeSettingWrite {
  readonly key: string;
  readonly value: string | boolean;
}

/** One RPE `Settings.json` field this editor has no setting for. */
export interface RpeUnmappedField {
  /** The field name exactly as `Settings.json` spells it. */
  readonly key: string;
  /** Source value in the form the review can display next to the name. */
  readonly value: string | boolean | number;
}

const FPS_OPTIONS = [30, 60, 90, 120, 144] as const;

/** Beat-line denominators in the order RPE's appearance file presents them. */
const RPE_BEAT_LINE_KEYS: readonly string[] = TIMELINE_GRID_COLORS.map(
  ([denominator]) => denominator,
);

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

/**
 * Convert RPE's 0–255 background brightness into the editor's brightness
 * multiplier, where 1 leaves the image unchanged.
 *
 * RPE stores the background illustration's alpha-style brightness; `255` is the
 * untouched image and lower values dim it.
 */
function backgroundBrightness(value: unknown): string | undefined {
  const brightness = numberValue(value);
  return brightness === undefined ? undefined : numberText(brightness / 255, 0, 2, 2);
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

/** Build the settings writes RPE's Settings.json supports here. */
export function parseSettings(raw: Record<string, unknown>): RpeSettingWrite[] {
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
  add("background-brightness", backgroundBrightness(raw.Alpha));
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
  // Interaction and display toggles whose RPE meaning matches one editor row.
  add("event-cut-density", integerText(raw.CutRho, 1, 16));
  add("pick-preview-lines", booleanValue(raw.clickLine));
  add("key-press-label-enabled", booleanValue(raw.showHotkey));
  add("timeline-undo-jump", booleanValue(raw.UndoJump));
  add("line-numbers", booleanValue(raw.ShowLineInfo));
  add("hover-guides-enabled", booleanValue(raw.highlightNear));
  add("timeline-density-bars-enabled", booleanValue(raw.density));
  add("merge-line-numbers", booleanValue(raw.unionLine));
  // RPE 1.7 names the X/Y binding `xybind`; older builds used `CrushNice`.
  add("xy-binding", booleanValue(raw.xybind) ?? booleanValue(raw.CrushNice));
  // RPE splits hit-sound delay into Tap/Flick and Drag channels in seconds; the
  // editor stores per-kind offsets in milliseconds, so Tap and Flick share the
  // first channel and Drag takes the second.
  const tapFlickOffset = soundOffsetMillis(raw.SEOffset, 0);
  add("hitsound-offset-tap", tapFlickOffset);
  add("hitsound-offset-flick", tapFlickOffset);
  add("hitsound-offset-drag", soundOffsetMillis(raw.SEOffset, 1));
  // RPE's seven wheel increments use the same channel order as the editor's
  // event wheel steps, so the array carries over without reordering.
  add("event-wheel-increments", wheelIncrementText(raw.scrollValueIncrement));
  return writes;
}

/**
 * Convert one RPE hit-sound delay channel from seconds to the editor's
 * millisecond setting.
 */
function soundOffsetMillis(value: unknown, channel: number): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seconds = numberValue(value[channel]);
  return seconds === undefined ? undefined : integerText(seconds * 1000, -1000, 1000);
}

/**
 * Store RPE's seven per-channel wheel increments as the JSON array the event
 * wheel reads. A shorter or non-numeric list keeps the editor defaults because
 * a partial list would shift channels.
 */
function wheelIncrementText(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 7) {
    return undefined;
  }
  const steps = value.slice(0, 7).map((entry) => numberValue(entry));
  if (steps.some((step) => step === undefined)) {
    return undefined;
  }
  return JSON.stringify(steps.map((step) => Number((step as number).toFixed(4))));
}

/** RPE settings fields this parser reads, normalized for case comparison. */
const MAPPED_SETTING_FIELDS: ReadonlySet<string> = new Set(
  [
    "FpsLimit",
    "NoteSize",
    "BarWidth",
    "BarAlpha",
    "Alpha",
    "RealTimeAlpha",
    "Blur",
    "HighLight",
    "MusicVolume",
    "SEVolume",
    "SElimit",
    "SElimitNumber",
    "ScrollSpeed",
    "ScrollAcc",
    "LineScale",
    "DefaultColor",
    "otherAlpha",
    "showViewUI",
    "AutoSave",
    "AutoSaveGap",
    "AutoSaveLimit",
    "ratioWidth",
    "ratioHeight",
    "GridlineCount",
    "maxHistorySize",
    "CutRho",
    "SEOffset",
    "clickLine",
    "showHotkey",
    "UndoJump",
    "ShowLineInfo",
    "highlightNear",
    "density",
    "unionLine",
    "CrushNice",
    "xybind",
    "scrollValueIncrement",
  ].map((field) => field.toLowerCase()),
);

/**
 * Fields the import review leaves out entirely.
 *
 * RPE chat and account data is not an editor setting, and the tips toggle has no
 * counterpart worth surfacing; showing them would only add rows nobody can act on.
 */
const IGNORED_SETTING_FIELDS: ReadonlySet<string> = new Set(
  ["userName", "enableChat", "chatColor", "chatTime", "TipsOn"].map((field) => field.toLowerCase()),
);

/**
 * Every `Settings.json` field without a mapping, in source order.
 *
 * The review lists these rows so a field is never dropped without the user
 * seeing that the file carried it.
 */
export function unmappedSettings(raw: Record<string, unknown>): RpeUnmappedField[] {
  const fields: RpeUnmappedField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const normalized = key.toLowerCase();
    // Appearance aliases are imported by `appearanceWrites`; they are handled
    // even though no single editor setting key names them.
    const alias = configKey(key);
    if (
      normalized === "language" ||
      MAPPED_SETTING_FIELDS.has(normalized) ||
      IGNORED_SETTING_FIELDS.has(normalized) ||
      PLAYHEAD_COLOR_ALIASES.has(alias) ||
      isBeatLineColorKey(alias)
    ) {
      continue;
    }
    const text = settingValueText(value);
    if (text !== undefined) {
      fields.push(Object.freeze({ key, value: text }));
    }
  }
  return fields;
}

/** Render a scalar, array, or nested source value for the review row. */
function settingValueText(value: unknown): string | boolean | number | undefined {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (Array.isArray(value)) {
    const scalars = value.every(
      (entry) => typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry)),
    );
    return scalars ? value.map((entry) => String(entry)).join(", ") : JSON.stringify(value);
  }
  return isRecord(value) ? JSON.stringify(value) : undefined;
}

/**
 * Build the colour writes the source files actually carry.
 *
 * RPE installations without colour entries keep the editor's current palette:
 * writing RPE's defaults would overwrite a user's custom grid and playhead
 * colours even though `Settings.json` never named them. `division_color.txt`
 * wins over the older `UI.txt` and `Settings.json` aliases because it is the
 * dedicated file RPE writes for subdivision colours.
 */
export function appearanceWrites(
  settingsRaw: Record<string, unknown>,
  uiText: string | null | undefined,
  divisionColorText?: string | null,
): RpeSettingWrite[] {
  const fromSettings = readColorEntries(
    collectColorEntries(settingsRaw, { beat: [], playhead: [] }),
  );
  const fromUi = readColorEntries(parseColorText(uiText));
  const fromDivision = readDivisionColors(divisionColorText);
  const colors = { ...fromSettings.beat, ...fromUi.beat, ...fromDivision.colors };
  const writes: RpeSettingWrite[] = [];
  for (const [denominator] of TIMELINE_GRID_COLORS) {
    const color = colors[denominator];
    if (color) {
      writes.push(Object.freeze({ key: timelineGridColorKey(denominator), value: color }));
    }
  }
  const playhead = fromUi.playhead ?? fromSettings.playhead;
  if (playhead) {
    writes.push(Object.freeze({ key: "timeline-playhead-color", value: playhead }));
  }
  return writes;
}

/** One parsed division colour file: supported denominators and unsupported rows. */
export interface RpeDivisionColorScan {
  /** Colours keyed by an editor beat-line denominator. */
  readonly colors: Readonly<Record<string, string>>;
  /** Divisions this editor has no beat-line colour for, in source order. */
  readonly unmapped: readonly RpeUnmappedField[];
}

/**
 * Read RPE's dedicated `division_color.txt` subdivision palette.
 *
 * Each active line is `<division>: R, G, B[, A]`, where `division` is the
 * denominator RPE shows in the timeline and A is a 0–1 transparency multiplier.
 * Divisions the editor's fixed beat-line table covers become colour writes; the
 * rest stay visible as unmapped rows so the review never drops them.
 */
export function readDivisionColors(text: string | null | undefined): RpeDivisionColorScan {
  const colors: Record<string, string> = {};
  const unsupported = new Map<string, string>();
  if (!text?.trim()) {
    return { colors: Object.freeze(colors), unmapped: Object.freeze([]) };
  }
  const supported = new Set<string>(TIMELINE_GRID_COLORS.map(([denominator]) => denominator));
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    // RPE allows `//` descriptions after the value; `#` starts a comment line.
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const match = /^(\d+)\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9]*\.?[0-9]+))?$/u.exec(
      line,
    );
    if (!match) {
      continue;
    }
    const channels = [match[2], match[3], match[4]].map(Number);
    const alpha = match[5] === undefined ? 1 : Number(match[5]);
    if (
      channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255) ||
      !Number.isFinite(alpha) ||
      alpha < 0 ||
      alpha > 1
    ) {
      continue;
    }
    const color = rgbHex(channels, alpha);
    const division = match[1];
    if (supported.has(division)) {
      colors[division] = color;
    } else {
      unsupported.set(`division-color-${division}`, color);
    }
  }
  return {
    colors: Object.freeze(colors),
    unmapped: Object.freeze([...unsupported].map(([key, value]) => Object.freeze({ key, value }))),
  };
}
