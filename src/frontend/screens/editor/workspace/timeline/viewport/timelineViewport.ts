/**
 * Projects timeline coordinates into the visible note/event viewport.
 *
 * It combines scale, scroll, grid, and multi-line layout inputs for canvas
 * drawing and gestures. It owns no chart mutation or DOM lookup; the timeline
 * assembly supplies the session and receives invalidation through its receiver.
 */
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type {
  TimelinePanelLayout,
  TimelineScale,
} from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import {
  noteScaleForTimelineRatio,
  TIMELINE_NOTE_REFERENCE_RATIO,
} from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import type {
  MultiLineScroll,
  MultiLineZoom,
  TimelineArea,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineAppearance } from "../drawing/timelineAppearance.ts";
import type { readEditorDisplaySettings } from "../../../../settings/editorDisplaySettings.ts";
import * as timelineGeometry from "./timelineGeometry.ts";
import type { TimelineViewportReceiver } from "./timelineViewportReceiver.ts";
import type { MultiLineScrollState } from "../multiLine/multiLineScrollBinding.ts";
import { syncMultiLineChrome as publishMultiLineChrome } from "../multiLine/multiLineChrome.ts";
import { multiLinePanelScale, multiLineScale } from "../multiLine/multiLinePresentation.ts";

type ViewportSettings = Pick<
  ReturnType<typeof readEditorDisplaySettings>["timeline"],
  | "cameraX"
  | "exclusiveRatio"
  | "gridCount"
  | "scale"
  | "division"
  | "snapX"
  | "multiLineEventWindowCount"
  | "scrollSpeed"
  | "judgementOffset"
>;

/** The authored 100% vertical timeline scale. */
export const TIMELINE_SCALE_DEFAULT = 500;
/** The smallest supported vertical timeline scale: 25% of the default. */
export const TIMELINE_SCALE_MIN = 125;
/** The largest supported vertical timeline scale: 400% of the default. */
export const TIMELINE_SCALE_MAX = 2000;

/** Clamp a timeline scale while preserving a safe value for invalid settings. */
export function clampTimelineScale(value: number, fallback = TIMELINE_SCALE_DEFAULT): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : TIMELINE_SCALE_DEFAULT;
  const candidate = Number.isFinite(value) ? value : safeFallback;
  return Math.max(TIMELINE_SCALE_MIN, Math.min(TIMELINE_SCALE_MAX, candidate));
}

/** Return the origin that places beat zero at the top of a timeline viewport. */
export function minimumTimelineBeatAtTop(
  tempo: Pick<TempoMap, "beat" | "seconds">,
  height: number,
  scale: number,
  judgementOffset: number,
  factor = 1,
): number {
  const safeScale = Number.isFinite(scale)
    ? Math.max(Number.EPSILON, scale)
    : TIMELINE_SCALE_DEFAULT;
  const span = Math.max(0, height - judgementOffset) / safeScale;
  return tempo.beat(tempo.seconds(0, factor) - span, factor);
}

/** Identifies the owner that is allowed to update the timeline origin. */
export type TimelineOriginSource =
  "playback" | "seek" | "zoom" | "session" | "overview" | "settings";

/**
 * Owns the viewport, snapping grid, and all pixel/time/line conversions.
 *
 * Geometry methods are supplied by the independently testable geometry module.
 */
export class TimelineViewport {
  private originValue = 0;
  private playbackOwnsOrigin = false;
  scale = TIMELINE_SCALE_DEFAULT;
  division = 4;
  snapX = true;
  gridCount = 11;
  originalPanelWidth = 0;
  exclusiveRatio = 0.75;
  multiLineEventWindowCount = 3;
  multiLineZoom: MultiLineZoom = { notes: 1, events: 1 };
  multiLineScroll: number | MultiLineScroll = { notes: 0, events: 0 };
  scrollSpeed = 1;
  judgementOffset = 56;
  cameraX?: number;
  columnGap?: number;
  /** The editor runtime's canonical tempo map. */
  readonly getTempo: () => TempoMap;
  readonly multiLineScrollState: MultiLineScrollState;
  readonly notesCanvas: HTMLCanvasElement;
  readonly eventsCanvas: HTMLCanvasElement;
  readonly getSession: () => EditorSession;
  private readonly types: (lineIndex?: number) => string[];
  private readonly appearance: TimelineAppearance;
  /** Bind the viewport to its canvases, session, tempo, and scroll state. */
  constructor(
    notesCanvas: HTMLCanvasElement,
    eventsCanvas: HTMLCanvasElement,
    getSession: () => EditorSession,
    getTempo: () => TempoMap,
    types: (lineIndex?: number) => string[],
    appearance: TimelineAppearance,
    multiLineScrollState: MultiLineScrollState,
  ) {
    this.notesCanvas = notesCanvas;
    this.eventsCanvas = eventsCanvas;
    this.getSession = getSession;
    this.getTempo = getTempo;
    this.types = types;
    this.appearance = appearance;
    this.multiLineScrollState = multiLineScrollState;
  }
  /** Current tempo map used for all beat and second conversions. */
  get tempo(): TempoMap {
    return this.getTempo();
  }
  /** Current timeline origin in beats. */
  get origin(): number {
    return this.originValue;
  }
  /**
   * Publish whether playback owns the origin.
   *
   * The lock includes the playback start transition so a pending audio start
   * cannot be interleaved with a zoom or session publication.
   */
  setPlaybackActive(active: boolean): void {
    this.playbackOwnsOrigin = active;
  }
  /** Write the origin only when the named owner is allowed to do so. */
  setOrigin(value: number, source: TimelineOriginSource): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }
    if (this.playbackOwnsOrigin && source !== "playback" && source !== "settings") {
      return false;
    }
    this.originValue = value;
    return true;
  }
  /** Track types for the active line. */
  get eventTypes(): string[] {
    return this.types();
  }
  /** Track types for one line. */
  eventTypesForLine(lineIndex: number): string[] {
    return this.types(lineIndex);
  }
  /** Base note scale from appearance settings. */
  get noteScale(): number {
    return this.appearance.noteScale;
  }
  /** Configured event bar width ratio. */
  get eventBarWidth(): number | undefined {
    return this.appearance.eventBarWidth;
  }
  /** Return the timeline to beat zero. */
  reset(): void {
    this.originValue = 0;
    this.playbackOwnsOrigin = false;
  }

  /** Drop geometry that belongs to the previous timeline presentation mode. */
  resetModeState(): void {
    this.originalPanelWidth = 0;
    this.columnGap = undefined;
    this.multiLineScroll = { notes: 0, events: 0 };
    this.multiLineScrollState.snapshot.set({ visible: false, max: "0", value: "0" });
  }

  /** Set and clamp the horizontal zoom for one area. */
  setMultiLineZoom(area: TimelineArea, zoom: number): void {
    this.multiLineZoom[area] = Math.max(0.35, Math.min(6, Number(zoom) || 1));
  }
  /** Current horizontal zoom for one area. */
  getMultiLineZoom(area: TimelineArea): number {
    return this.multiLineZoom[area];
  }
  /** Vertical scale for one area; horizontal panel count never changes it. */
  scaleForArea(area: TimelineArea): number {
    const session = this.getSession();
    const active =
      area === "notes" ? session.notesMode !== "single" : session.eventsMode === "multi";
    return multiLineScale(this.scale, this.getMultiLineZoom(area), active);
  }
  /** Copy display settings into this viewport. */
  apply(config: ViewportSettings): void {
    const {
      cameraX,
      exclusiveRatio,
      gridCount,
      scale,
      division,
      snapX,
      multiLineEventWindowCount,
      scrollSpeed,
      judgementOffset,
    } = config;
    Object.assign(this, {
      cameraX,
      exclusiveRatio,
      gridCount,
      scale: clampTimelineScale(scale),
      division,
      snapX,
      multiLineEventWindowCount,
      scrollSpeed,
      judgementOffset,
    });
  }
  /**
   * The single horizontal layout for one multi-line area.
   *
   * Window width, gap, stride, visible range, viewport offset, hit testing, and
   * panning all read this object so they stay in lockstep. Note mode without
   * merging shares the persisted window count with the event field; merged note
   * mode reports a single panel.
   */
  panelLayout(area: TimelineArea): TimelinePanelLayout {
    const session = this.getSession();
    const count = this.panelCount(area);
    const configuredWindowCount = Math.max(
      1,
      Math.floor(Number(this.multiLineEventWindowCount) || 1),
    );
    return {
      active: session.multiLineActive,
      count,
      configuredWidth: 0,
      visibleCount: Math.max(1, Math.min(count, configuredWindowCount)),
      // Event windows separate at one eighth of a window; note panels keep
      // their narrower surface gap. Both values still come from this layout.
      gapRatio: area === "events" ? 1 / 8 : 0.04,
      gapMinimum: area === "events" ? 0 : 12,
    };
  }

  /** Scale inputs for one line factor. */
  scaleConfig(factor = this.factor): TimelineScale {
    return {
      origin: this.origin,
      factor,
      scale: this.scale,
      judgementOffset: this.judgementOffset,
    };
  }

  /** Beat multiplier of the active line. */
  get factor(): number {
    return this.getSession().line?.bpmfactor ?? 1;
  }

  /** Height of the canvas that currently paints the active area. */
  viewHeight(): number {
    const session = this.getSession();
    if (session.multiLineActive && session.multiLineMode === "events") {
      return this.eventsCanvas.clientHeight;
    }
    // In the solo event layout the note canvas is `display:none`, so its
    // `clientHeight` is zero. Falling back to the event canvas keeps the beat
    // range identical to the canvas being painted; otherwise the top half of
    // the event field is clipped away by a zero-height projection.
    return this.notesCanvas.clientHeight > 0
      ? this.notesCanvas.clientHeight
      : this.eventsCanvas.clientHeight;
  }

  /** Earliest chart time that keeps beat zero inside every visible timeline. */
  minimumScrollSeconds(): number {
    const session = this.getSession();
    const areas = session.multiLineActive
      ? [session.multiLineMode]
      : (["notes", "events"] as const);
    let minimum = -Infinity;
    for (const area of areas) {
      const canvas = area === "notes" ? this.notesCanvas : this.eventsCanvas;
      if (canvas.clientHeight <= 0 || canvas.clientWidth <= 0) {
        continue;
      }
      let lines = session.multiLineActive ? session.targetLineIndices : [session.lineIndex];
      if (session.multiLineActive && this.panelCount(area) > 1) {
        const [first, last] = this.visiblePanelRange(canvas.clientWidth, area);
        lines = lines.slice(first, last + 1);
      }
      for (const lineIndex of lines) {
        const factor = this.factorForLine(lineIndex);
        const beat = minimumTimelineBeatAtTop(
          this.tempo,
          canvas.clientHeight,
          this.scaleForArea(area),
          this.judgementOffset,
          factor,
        );
        minimum = Math.max(minimum, this.tempo.seconds(beat, this.factor));
      }
    }
    return minimum === -Infinity ? 0 : minimum;
  }

  /** Note scale adapted to the timeline width, with 50% as the authored reference. */
  get renderNoteScale(): number {
    const session = this.getSession();
    const eventsVisible = this.eventsCanvas.clientWidth > 0;
    const timelineRatio = eventsVisible
      ? TIMELINE_NOTE_REFERENCE_RATIO
      : session.multiLineActive && session.multiLineMode === "notes" && !session.multiLineMerge
        ? 1
        : this.exclusiveRatio;
    const panelScale =
      session.notesMode === "multi"
        ? multiLinePanelScale(
            this.panelWidth(this.notesCanvas.clientWidth, "notes"),
            this.notesCanvas.clientWidth,
            true,
          )
        : 1;
    return noteScaleForTimelineRatio(this.noteScale, timelineRatio) * panelScale;
  }

  /**
   * True when notes or events alone own the canvas.
   *
   * The exclusive width setting applies only to that presentation.
   */
  isExclusive(): boolean {
    const notesVisible = this.notesCanvas.clientWidth > 0;
    const eventsVisible = this.eventsCanvas.clientWidth > 0;
    return !(notesVisible && eventsVisible);
  }

  /** Publish the scroll range for one area at the given canvas width. */
  syncMultiLineChrome(area: TimelineArea, width: number): void {
    publishMultiLineChrome(this, area, width);
  }
}

/** Geometry methods remain part of the public viewport surface. */
export interface TimelineViewport extends TimelineViewportReceiver {}

Object.assign(TimelineViewport.prototype, timelineGeometry);
