/**
 * Semantic colors shared by canvas adapters.
 *
 * The active theme package owns every value; this frontend adapter only maps
 * CSS custom properties into the small typed shape canvas code draws with.
 * There is deliberately no fallback palette: a missing token is a theme bug,
 * and the Vite bootstrap plus `resolveThemeColors` guarantee the base tokens
 * exist before the first frame.
 */
import { values } from "../../../../core/state/values.ts";
import { settingsRegistry } from "../../../../core/settings/settings.ts";
import { parseHexColor } from "../../../../core/utils/colors.ts";

export interface CanvasPalette {
  background: string;
  foreground: string;
  outline: string;
  surface: string;
  headerSurface: string;
  gridMajor: string;
  gridMinor: string;
  gridSubdivisions: readonly string[];
  playhead: string;
  topValue: string;
  bottomValue: string;
  noteTap: string;
  noteHold: string;
  noteFlick: string;
  noteDrag: string;
  noteFallback: string;
  selectionHighlight: string;
  selectionHighlightStroke: string;
  remoteSelectionHighlight: string;
  remoteEventSelectionHighlight: string;
  selectionNotesFill: string;
  selectionNotesStroke: string;
  selectionEventsFill: string;
  selectionEventsStroke: string;
  eventFill: string;
  eventStroke: string;
  eventSelectedFill: string;
  eventSelectedStroke: string;
  eventHookedFill: string;
  eventHookedStroke: string;
  eventShaderFill: string;
  eventShaderText: string;
  overlayValidFill: string;
  overlayValidStroke: string;
  overlayInvalidFill: string;
  overlayInvalidStroke: string;
  previewLine: string;
  previewLineSelected: string;
  previewSelectionFill: string;
  inspectorPath: string;
  inspectorMarker: string;
  /**
   * Emphasised line colour while the offset pick is armed.
   *
   * It reuses the focus-ring token, which every theme already defines, so the
   * highlight is unmistakable without adding a required theme token.
   */
  alignHighlight: string;
}

let cachedPalette: CanvasPalette | null = null;
let listeningForTheme = false;
let cachedSelectionColors = "";

/** User-configured selection colors, with defaults available before settings register. */
export function selectionColor(key: string, fallback: string): string {
  const value = values.byId.has(key) ? values.byId.get<unknown>(key) : undefined;
  return typeof value === "string" && parseHexColor(value) ? value : fallback;
}

/** Colours shared by timeline note marquees and editor list marquees. */
export interface TimelineNoteMarqueeColors {
  fill: string;
  stroke: string;
}

/** Reads the timeline note marquee palette for DOM and canvas selection surfaces. */
export function readTimelineNoteMarqueeColors(): TimelineNoteMarqueeColors {
  const palette = readCanvasPalette();
  return {
    fill: palette.previewSelectionFill,
    stroke: selectionColor("timeline-note-marquee-color", palette.selectionNotesStroke),
  };
}

/** The setting that overrides the theme's hooked-event colour. */
export const EVENT_HOOKED_COLOR_KEY = "event-hooked-color";

/**
 * A colour setting the user moved away from its schema default, or "" when the
 * row is untouched.
 *
 * A row's default is what its swatch starts at; a visual surface that has a
 * theme token of its own keeps the token while the row sits at that default, so
 * a light and a dark theme can each supply their own contrast.
 */
export function colorSettingOverride(key: string): string {
  const value = values.byId.has(key) ? values.byId.get<unknown>(key) : undefined;
  const fallback = settingsRegistry.definition(key)?.default;
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value) || fallback === undefined) {
    return "";
  }
  return value.toLowerCase() === String(fallback).toLowerCase() ? "" : value;
}

/** Drop the cached palette after a theme or token change. */
export function invalidateCanvasPalette(): void {
  cachedPalette = null;
}

/**
 * Read the active theme's canvas tokens, caching the result until the theme
 * changes or the cache is invalidated.
 */
export function readCanvasPalette(): CanvasPalette {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    throw new Error("Canvas palette requires the active document theme");
  }
  if (!listeningForTheme && typeof window !== "undefined") {
    listeningForTheme = true;
    window.addEventListener("redux-theme", invalidateCanvasPalette, { passive: true });
  }
  const selectedColor = selectionColor("selected-note-color", "#00C800");
  const remoteNoteColor = selectionColor("collaboration-selected-note-color", "#FFCC66");
  const remoteEventColor = selectionColor("collaboration-selected-event-color", "#FFCC66");
  // An untouched hooked-colour row leaves the theme in charge, so a light theme
  // keeps its own darker cyan; a changed row wins over the token.
  const hookedOverride = colorSettingOverride(EVENT_HOOKED_COLOR_KEY);
  const selectionColors = `${selectedColor}|${remoteNoteColor}|${remoteEventColor}|${hookedOverride}`;
  if (cachedPalette && cachedSelectionColors === selectionColors) {
    return cachedPalette;
  }
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => {
    const value = style.getPropertyValue(name).trim();
    if (!value) {
      throw new Error(`Theme is missing canvas token ${name}`);
    }
    return value;
  };
  const hookedFill = hookedOverride || read("--canvas-event-hooked-fill");
  const subdivisionDenominators = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  const palette: CanvasPalette = {
    background: read("--canvas-background"),
    foreground: read("--foreground"),
    outline: read("--outline"),
    surface: read("--surface-raised"),
    headerSurface: read("--panel-header"),
    gridMajor: read("--grid-major"),
    gridMinor: read("--grid-minor"),
    gridSubdivisions: subdivisionDenominators.map((denominator) =>
      read(`--grid-subdivision-${denominator}`),
    ),
    playhead: read("--playhead"),
    topValue: read("--playing-indicator"),
    bottomValue: read("--accent"),
    noteTap: read("--canvas-note-tap"),
    noteHold: read("--canvas-note-hold"),
    noteFlick: read("--canvas-note-flick"),
    noteDrag: read("--canvas-note-drag"),
    noteFallback: read("--canvas-note-fallback"),
    selectionHighlight: read("--canvas-selection-highlight"),
    selectionHighlightStroke: selectedColor,
    remoteSelectionHighlight: remoteNoteColor,
    remoteEventSelectionHighlight: remoteEventColor,
    selectionNotesFill: read("--canvas-selection-notes-fill"),
    selectionNotesStroke: read("--canvas-selection-notes-stroke"),
    selectionEventsFill: read("--canvas-selection-events-fill"),
    selectionEventsStroke: read("--canvas-selection-events-stroke"),
    eventFill: read("--canvas-event-fill"),
    eventStroke: read("--canvas-event-stroke"),
    eventSelectedFill: read("--canvas-event-selected-fill"),
    eventSelectedStroke: read("--canvas-event-selected-stroke"),
    eventHookedFill: hookedFill,
    eventHookedStroke: read("--canvas-event-hooked-stroke"),
    eventShaderFill: read("--canvas-event-shader-fill"),
    eventShaderText: read("--canvas-event-shader-text"),
    overlayValidFill: read("--canvas-overlay-valid-fill"),
    overlayValidStroke: read("--canvas-overlay-valid-stroke"),
    overlayInvalidFill: read("--canvas-overlay-invalid-fill"),
    overlayInvalidStroke: read("--canvas-overlay-invalid-stroke"),
    previewLine: read("--canvas-preview-line"),
    previewLineSelected: read("--canvas-preview-line-selected"),
    previewSelectionFill: read("--canvas-preview-selection-fill"),
    inspectorPath: read("--canvas-inspector-path"),
    inspectorMarker: read("--canvas-inspector-marker"),
    alignHighlight: read("--focus-ring"),
  };
  cachedPalette = palette;
  cachedSelectionColors = selectionColors;
  return palette;
}

/** An opaque RGB triple in the 0-255 form canvas tints consume. */
export type CanvasRgb = [number, number, number];

/** RGB channels plus the alpha strength used by selected-note recolouring. */
export type CanvasRgba = [number, number, number, number];

/** Convert a theme hex colour to the channels a canvas tint multiplies with. */
export function rgbChannels(value: string): CanvasRgb | null {
  const parsed = parseHexColor(value);
  if (!parsed) {
    return null;
  }
  return [parsed.red, parsed.green, parsed.blue];
}

/** Fallback selected-note colour with full recolouring strength. */
const DEFAULT_SELECTION_RGBA: CanvasRgba = [0, 200, 0, 1];
/** Fallback collaboration colour with full recolouring strength. */
const DEFAULT_REMOTE_SELECTION_RGBA: CanvasRgba = [255, 204, 102, 1];
const DEFAULT_SELECTION_RGB: CanvasRgb = [0, 200, 0];
const DEFAULT_REMOTE_SELECTION_RGB: CanvasRgb = [255, 204, 102];

/** Resolve the selected-note colour and alpha-based recolouring strength. */
export function selectionHighlightColor(
  palette: Pick<CanvasPalette, "selectionHighlightStroke">,
): CanvasRgba {
  const parsed = parseHexColor(palette.selectionHighlightStroke);
  return parsed ? [parsed.red, parsed.green, parsed.blue, parsed.alpha] : DEFAULT_SELECTION_RGBA;
}

/**
 * Cache the parsed selection colours per palette object.
 *
 * The palette instance is stable until the theme changes, so a paint pass can
 * resolve each colour once instead of running a hex parse per selected note.
 */
interface ParsedColorCacheEntry {
  source: string;
  channels: CanvasRgb;
}

const parsedColorCaches = new WeakMap<object, Map<string, ParsedColorCacheEntry>>();

/** Cached hex parse for one palette field; the palette object keys the cache. */
export function cachedRgb(
  palette: object,
  key: string,
  value: string,
  fallback: CanvasRgb,
): number[] {
  let cache = parsedColorCaches.get(palette);
  if (!cache) {
    cache = new Map();
    parsedColorCaches.set(palette, cache);
  }
  const cached = cache.get(key);
  if (cached && cached.source === value) {
    return cached.channels;
  }
  const channels = rgbChannels(value) ?? fallback;
  cache.set(key, { source: value, channels });
  return channels;
}

/** Cached colour used to render a selected note. */
export function cachedSelectionHighlightColor(
  palette: Pick<CanvasPalette, "selectionHighlightStroke">,
): number[] {
  const channels = cachedRgb(
    palette,
    "selectionHighlightStroke",
    palette.selectionHighlightStroke,
    DEFAULT_SELECTION_RGB,
  );
  return [...channels, parseHexColor(palette.selectionHighlightStroke)?.alpha ?? 1];
}

/** Cached colour used to render another member's selected note. */
export function cachedRemoteSelectionHighlightColor(
  palette: Pick<CanvasPalette, "remoteSelectionHighlight">,
): number[] {
  const channels = cachedRgb(
    palette,
    "remoteSelectionHighlight",
    palette.remoteSelectionHighlight,
    DEFAULT_REMOTE_SELECTION_RGB,
  );
  return [...channels, parseHexColor(palette.remoteSelectionHighlight)?.alpha ?? 1];
}

/** Resolve the configured collaboration colour and recolouring strength. */
export function remoteSelectionHighlightColor(
  palette: Pick<CanvasPalette, "remoteSelectionHighlight">,
): CanvasRgba {
  const parsed = parseHexColor(palette.remoteSelectionHighlight);
  return parsed
    ? [parsed.red, parsed.green, parsed.blue, parsed.alpha]
    : DEFAULT_REMOTE_SELECTION_RGBA;
}

/** The theme colour for a note type; unknown types use the fallback. */
export function noteColor(palette: CanvasPalette, type: number): string {
  switch (type) {
    case 1:
      return palette.noteTap;
    case 2:
      return palette.noteHold;
    case 3:
      return palette.noteFlick;
    case 4:
      return palette.noteDrag;
    default:
      return palette.noteFallback;
  }
}
