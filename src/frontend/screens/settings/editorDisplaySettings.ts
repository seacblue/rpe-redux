/**
 * The editor's persisted display state, and the decoders that read it.
 *
 * This module owns the persisted display values that are consumed by frontend
 * runtime adapters. Some are still runtime-only display state; settings-backed
 * values with a visible control are adapted here so existing toolbar and editor
 * owners keep one shared value handle.
 *
 * This module lives in the frontend because nothing in `core/` reads a single one
 * of its keys: the seven consumers are the settings pane and the workspace runtime
 * adapters. `core/settings/editorRuntime.ts` keeps the same kind of declaration for
 * the keys a core module *does* read, and both go through
 * `settings.ts`'s `declarePersistedValue` — one path declares a settings-section
 * value, whichever layer owns the reader. Schema-owned values are looked up after
 * the built-in feature catalog has registered them.
 *
 * It deliberately does not render the settings page, apply a value to a browser
 * object, or define a control; those are the settings pane's and the feature
 * modules' concerns. `displayValues` is the seam for the runtime owners that need
 * to write one value directly.
 */
import { HIT_SOUND_KINDS, type HitSoundKind } from "../../../core/media/hitsounds.ts";
import { defineValue, values, type ValueHandle } from "../../../core/state/values.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import {
  TIMELINE_GRID_COLORS,
  timelineGridColorKey,
} from "../../../core/settings/timelineGridColors.ts";
import { PREFERENCE_SECTIONS } from "../../../core/state/preferences.ts";
import { COVER_BACKGROUND_KEYS } from "../../../core/settings/features/coverBackground.ts";
// A contributed setting declares its own value when its feature registers it, and the
// reads below go straight to those values; importing the built-in catalog is what puts
// them there before the first read.
import "../../../core/settings/features/index.ts";

/** One value this module owns, with the default it starts at. */
interface DisplayValue<T extends string | boolean = string> extends ValueHandle<T> {
  readonly initial: T;
}

/**
 * Declare a display value that has no settings row.
 *
 * Every key declared here persists in the settings section without a
 * `SettingDefinition`: no feature contributes a control for it, so the default it
 * starts at lives here, once, and a read is a read of the value rather than a key
 * paired with a fallback at the point of use.
 */
function display(key: string, initial: string): DisplayValue;
function display(key: string, initial: boolean): DisplayValue<boolean>;
function display(
  key: string,
  initial: string | boolean,
): DisplayValue<string> | DisplayValue<boolean> {
  if (typeof initial === "boolean") {
    return {
      ...defineValue<boolean>({
        id: key,
        initial,
        persist: PREFERENCE_SECTIONS.settings,
      }),
      initial,
    };
  }
  return {
    ...defineValue<string>({ id: key, initial, persist: PREFERENCE_SECTIONS.settings }),
    initial,
  };
}

/** Adapt a schema-owned text or numeric setting to the display-value shape used here. */
function settingDisplay(key: string): DisplayValue {
  const initial = String(settingsRegistry.definition(key)?.default ?? "");
  return { ...values.getHandle<string>(key), initial };
}

/** Adapt a schema-owned toggle setting, which is a real boolean value. */
function settingFlag(key: string): DisplayValue<boolean> {
  const initial = settingsRegistry.definition(key)?.default === true;
  return { ...values.getHandle<boolean>(key), initial };
}

/** Every persisted editor display value, declared once at its owning seam. */
export const displayValues = {
  /** Preview camera offset along X, in chart units; dragged in the preview area. */
  cameraX: display("preview-camera-x", "0"),
  /** Preview zoom divisor: 1 shows the whole line, higher values zoom in. */
  viewDivisor: display("preview-view-divisor", "1"),
  /** Whether the preview overlays the game UI (score, combo, judgement). */
  showGameUI: settingFlag("preview-show-game-ui"),
  /** Whether long bottom-corner GameUI labels are compressed to their available slot. */
  gameUiCornerCompression: settingFlag("preview-game-ui-corner-compression"),
  /** Preview aspect ratio numerator; see `ratioHeight`. */
  ratioWidth: display("preview-ratio-width", "4"),
  /** Preview aspect ratio denominator; the pair is read as `width:height`. */
  ratioHeight: display("preview-ratio-height", "3"),
  /** Whether the preview draws notes. This remains toolbar-owned, not a settings row. */
  showNotes: display("preview-show-notes", true),
  /** Whether the preview draws events. This remains toolbar-owned, not a settings row. */
  showEvents: display("preview-show-events", true),
  /** Whether the preview area is shown at all. This remains toolbar-owned, not a settings row. */
  previewEnabled: display("preview-enabled", true),
  /** How many edits the undo history keeps before dropping the oldest. */
  historyLimit: display("history-limit", "150"),
  /** Whether wheel scrolling accelerates over a held gesture. */
  scrollAcceleration: settingFlag("scroll-acceleration"),
  /** Note texture size in preview pixels; 175 is the authored size. */
  noteSize: settingDisplay("note-size"),
  /** Note texture size in the timeline's note area; 175 is the authored size. */
  timelineNoteSize: settingDisplay("timeline-note-size"),
  /** Number of event windows visible across the multi-line timeline. */
  multiLineEventWindowCount: settingDisplay("multi-line-event-window-count"),
  /** Whether multi-line note editing uses one shared note field. */
  multiLineMergeNotes: settingFlag("multi-line-merge-notes"),
  /** Whether merged multi-line notes show their owning judge-line number below. */
  multiLineNoteLineNumbers: settingFlag("multi-line-note-line-numbers"),
  /** Selectable interior lines for note X coordinates. */
  gridCount: display("timeline-grid-count", "11"),
  /** Timeline zoom, in pixels per second at the current division. */
  scale: display("timeline-scale", "500"),
  /** Beats per bar; the timeline grid and snapping follow it. */
  division: display("timeline-division", "4"),
  /** Distance from the bottom edge to the playhead line during playback. */
  playheadHeight: settingDisplay("timeline-playhead-height"),
  /** Event label size kept as runtime state without a settings row. */
  eventValueFontSize: display("event-value-size", "14"),
  /** Whether dragging a note snaps its X to the grid. */
  snapX: display("timeline-snap-x", true),
  /** Preview background opacity, 0..1; the declared default is 80/255. */
  backgroundAlpha: display("background-alpha", String(80 / 255)),
  /** Preview and timeline content cadence; ordinary overlays remain at 60 Hz. */
  renderFps: settingDisplay("render-fps"),
} as const;

/** A persisted value, decoded; a stored blank falls back to the declared default. */
const numberOf = (value: DisplayValue): number =>
  value.get().trim() === "" ? Number(value.initial) : Number(value.get());
/** Read a boolean display value. */
const flagOf = (value: DisplayValue<boolean>): boolean => value.get();

/** Render cadence clamped to 1-144 Hz; invalid or missing values use 144. */
export function readEditorRefreshRate(): number {
  const requested = numberOf(displayValues.renderFps);
  return Number.isFinite(requested) && requested > 0 ? Math.min(144, Math.max(1, requested)) : 144;
}

/** The committed value for a contributed key. */
const stored = (key: string): string | undefined => values.byId.get<string | undefined>(key);
/** The registered schema default for a key, rendered as text. */
const schemaDefault = (key: string): string | undefined => {
  const value = settingsRegistry.definition(key)?.default;
  return value === undefined ? undefined : String(value);
};
/** A contributed number, falling back to the schema default and then zero. */
const contributedNumber = (key: string): number => {
  const raw = stored(key);
  const fallback = schemaDefault(key);
  const text = raw === undefined || raw.trim() === "" ? fallback : raw;
  return text === undefined ? 0 : Number(text);
};
/** A contributed toggle, falling back to the schema default. */
const contributedFlag = (key: string): boolean => {
  const raw = values.byId.get<unknown>(key);
  if (typeof raw === "boolean") {
    return raw;
  }
  return settingsRegistry.definition(key)?.default === true;
};
/** A contributed string, falling back to the schema default and then empty text. */
const contributedString = (key: string): string => stored(key) ?? schemaDefault(key) ?? "";

/** Map a stored pitch value to the playback policy it selects. */
function pitchStrategy(raw: string): "preserve" | "resample" {
  return raw === "false" || raw === "resample" ? "resample" : "preserve";
}

/** Parse a `#rrggbb` colour into 0-255 channels, or null when malformed. */
const colorChannels = (raw: string): number[] | null => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(raw);
  return match ? match.slice(1).map((channel) => Number.parseInt(channel, 16)) : null;
};
/** Read a contributed colour as RGB channels, defaulting to the preview yellow. */
const contributedColor = (key: string): number[] => {
  const raw = stored(key) ?? schemaDefault(key) ?? "";
  return colorChannels(raw) ?? [237, 236, 176];
};
/** Read a contributed colour as an upper-case hex string, or black when missing. */
const contributedHex = (key: string): string => {
  const value = stored(key) ?? schemaDefault(key) ?? "";
  return /^#[\da-f]{6}$/iu.test(value) ? value.toUpperCase() : "#000000";
};

/** Decode the camera, zoom, GameUI, and aspect-ratio values shared by preview and timeline. */
function readEditorViewSettings() {
  return {
    cameraX: Number(displayValues.cameraX.get()),
    viewDivisor: Number(displayValues.viewDivisor.get()),
    showGameUI: flagOf(displayValues.showGameUI),
    ratio: `${displayValues.ratioWidth.get()}:${displayValues.ratioHeight.get()}`,
  };
}

/** Decode persisted settings into sectioned data for browser runtime adapters. */
export function readEditorDisplaySettings() {
  const noteSize = numberOf(displayValues.noteSize);
  const timelineNoteSize = numberOf(displayValues.timelineNoteSize);
  const multiLineEventWindowCount = Math.max(
    1,
    Math.floor(numberOf(displayValues.multiLineEventWindowCount) || 3),
  );
  const highlight = contributedFlag("highlight-notes");
  const view = readEditorViewSettings();
  const sounds = Object.fromEntries(
    HIT_SOUND_KINDS.map((kind) => [kind, contributedNumber(`hitsound-${kind}`)]),
  ) as Record<HitSoundKind, number>;
  return {
    refreshRate: readEditorRefreshRate(),
    volume: contributedNumber("volume"),
    pitchStrategy: pitchStrategy(contributedString("preserve-pitch")),
    sounds,
    analysis: {
      // These three are contributed schema rows in the audio category; they are
      // declared (and persisted) by their registration, so the runtime reads the
      // same values the settings page renders.
      enabled: contributedFlag("audio-analysis-enabled"),
      alpha: contributedNumber("audio-analysis-alpha"),
      width: contributedNumber("audio-analysis-width"),
      curve: contributedNumber("audio-analysis-curve"),
    },
    view,
    preview: {
      visible: flagOf(displayValues.previewEnabled),
      viewDivisor: view.viewDivisor,
      showGameUI: view.showGameUI,
      gameUiCornerCompression: flagOf(displayValues.gameUiCornerCompression),
      opacity: contributedNumber("realtime-alpha"),
      noteSize,
      hitEffectScale: contributedNumber("hit-effect-size") / 100,
      noteOpacity: contributedNumber("preview-non-current-opacity") / 255,
      backgroundEnabled: contributedFlag(COVER_BACKGROUND_KEYS.editorPreviewEnabled),
      backgroundBlur: contributedNumber("background-blur"),
      backgroundBrightness: contributedNumber("background-brightness"),
      defaultLineColor: contributedColor("default-line-color"),
      defaultParticleColor: contributedColor("default-particle-color"),
      selectedLineColor: contributedColor("current-line-color"),
      showHitEffects: contributedFlag("particle-effects-enabled"),
      lineScale: contributedNumber("default-line-thickness"),
      backgroundAlpha: numberOf(displayValues.backgroundAlpha),
      lineNumbers: contributedFlag("line-numbers"),
      lineArrows: contributedFlag("line-arrows"),
      mergeLineNumbers: contributedFlag("merge-line-numbers"),
      pickPreviewLines: contributedFlag("pick-preview-lines"),
      highlight,
    },
    timeline: {
      cameraX: view.cameraX,
      noteScale: timelineNoteSize / 175,
      // Timeline note size is authored for a field occupying half the workspace.
      exclusiveRatio: Math.max(0, Math.min(1, contributedNumber("timeline-exclusive-width") / 100)),
      noteOpacity: contributedNumber("note-opacity"),
      multiLineNonCurrentOpacity: contributedNumber("preview-non-current-opacity") / 255,
      overlapThreshold: contributedNumber("note-overlap-threshold"),
      gridCount: numberOf(displayValues.gridCount),
      scale: numberOf(displayValues.scale),
      division: numberOf(displayValues.division),
      snapX: flagOf(displayValues.snapX),
      multiLineEventWindowCount,
      multiLineMergeNotes: displayValues.multiLineMergeNotes.get(),
      multiLineNoteLineNumbers: displayValues.multiLineNoteLineNumbers.get(),
      scrollSpeed: contributedNumber("scroll-speed") / 5,
      keyPressLabelEnabled: contributedFlag("key-press-label-enabled"),
      mouseTrailEnabled: contributedFlag("mouse-trail-enabled"),
      hoverGuidesEnabled: contributedFlag("hover-guides-enabled"),
      densityBarsEnabled: contributedFlag("timeline-density-bars-enabled"),
      hoverPreviewEnabled: contributedFlag("timeline-hover-preview-enabled"),
      barWidth: contributedNumber("bar-width"),
      barAlpha: contributedNumber("bar-alpha"),
      playheadWidth: contributedNumber("timeline-playhead-width"),
      playheadColor: contributedHex("timeline-playhead-color"),
      judgementOffset: numberOf(displayValues.playheadHeight),
      eventValueFontSize: numberOf(displayValues.eventValueFontSize),
      eventValueThreshold: contributedNumber("event-value-threshold"),
      eventCurveThreshold: contributedNumber("event-curve-threshold"),
      eventCurvesEnabled: contributedFlag("event-curves-enabled"),
      eventOpacity: contributedNumber("event-opacity"),
      eventBarWidth: contributedNumber("event-bar-width"),
      subdivisionColors: TIMELINE_GRID_COLORS.map(([denominator]) =>
        contributedHex(timelineGridColorKey(denominator)),
      ),
    },
    historyLimit: numberOf(displayValues.historyLimit),
    cutDensity: contributedNumber("event-cut-density"),
  };
}

/** Runtime values the editor writes back when a session closes. */
export interface EditorSettingsPersistenceSource {
  timeline: {
    gridCount: number;
    scale: number;
    division: number;
    snapX: boolean;
    cameraX?: number;
  };
  realtimePreview: {
    viewDivisor?: number;
    showGameUI?: boolean;
    opacity: number;
  };
  audio: { volume: number };
  hitSounds: { soundVolumes: Record<HitSoundKind, number> };
}

/**
 * Write runtime editor values into the value store, touching only keys whose
 * stored value differs.
 */
export function persistEditorSettings({
  timeline,
  realtimePreview,
  audio,
  hitSounds,
}: EditorSettingsPersistenceSource): void {
  const next: Record<string, string | boolean> = {
    "timeline-grid-count": String(timeline.gridCount),
    "timeline-scale": String(timeline.scale),
    "timeline-division": String(timeline.division),
    "timeline-snap-x": timeline.snapX,
    "preview-camera-x": String(timeline.cameraX),
    "preview-view-divisor": String(realtimePreview.viewDivisor),
    "preview-show-game-ui": realtimePreview.showGameUI ?? displayValues.showGameUI.get(),
    "preview-ratio-width": String(displayValues.ratioWidth.get()),
    "preview-ratio-height": String(displayValues.ratioHeight.get()),
    "realtime-alpha": String(realtimePreview.opacity),
    volume: String(audio.volume),
    "hitsound-tap": String(hitSounds.soundVolumes.tap),
    "hitsound-drag": String(hitSounds.soundVolumes.drag),
    "hitsound-flick": String(hitSounds.soundVolumes.flick),
    "hitsound-custom": String(hitSounds.soundVolumes.custom),
  };
  for (const [key, value] of Object.entries(next)) {
    if (values.byId.get<unknown>(key) !== value) {
      values.byId.set(key, value);
    }
  }
}

/** Subscribe `apply` to every registered setting key; returns the disposer. */
export function bindEditorSettings(apply: () => void): () => void {
  // A contribution declares its value as it registers, so every definition's key is
  // there to subscribe to.
  const disposers = settingsRegistry
    .definitions()
    .map(({ key }) => values.byId.subscribe(key, apply));
  return () => disposers.forEach((dispose) => dispose());
}
