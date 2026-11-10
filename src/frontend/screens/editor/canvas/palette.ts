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
}

let cachedPalette: CanvasPalette | null = null;
let listeningForTheme = false;
let cachedSelectionColors = "";

/** User-configured selection colors, with defaults available before settings register. */
export function selectionColor(key: string, fallback: string): string {
  const value = values.byId.has(key) ? values.byId.get<unknown>(key) : undefined;
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
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
  const selectionColors = `${selectedColor}|${remoteNoteColor}|${remoteEventColor}`;
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
    eventHookedFill: read("--canvas-event-hooked-fill"),
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
  };
  cachedPalette = palette;
  cachedSelectionColors = selectionColors;
  return palette;
}

/** An opaque RGB triple in the 0-255 form canvas tints consume. */
export type CanvasRgb = [number, number, number];

/** Convert a theme hex colour to the channels a canvas tint multiplies with. */
export function rgbChannels(value: string): CanvasRgb | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const hex =
    match[1].length === 3 ? [...match[1]].map((channel) => channel + channel).join("") : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** Resolve the opaque RGB colour used to render a selected note. */
export function selectionHighlightColor(
  palette: Pick<CanvasPalette, "selectionHighlightStroke">,
): CanvasRgb {
  return rgbChannels(palette.selectionHighlightStroke) ?? [0, 200, 0];
}

/** Resolve the configured colour used to render another member's note selection. */
export function remoteSelectionHighlightColor(
  palette: Pick<CanvasPalette, "remoteSelectionHighlight">,
): CanvasRgb {
  return rgbChannels(palette.remoteSelectionHighlight) ?? [255, 204, 102];
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
