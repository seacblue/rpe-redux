/** The current editor state that can make a complete frame stale. */
import { FrameCadence } from "./frameCadence.ts";

/** Everything one scheduling decision is based on. */
export interface RenderRequest {
  readonly now: number;
  readonly seconds: number;
  readonly playing: boolean;
  readonly previewVisible: boolean;
  readonly previewHighDensity: boolean;
  readonly contentRefreshRate: number;
  /** A live preview marquee needs geometry from every workspace frame. */
  readonly previewMarqueeActive?: boolean;
  /** Skip optional hit effects after repeated over-budget frames. */
  readonly reducedQuality?: boolean;
  readonly force?: boolean;
  readonly timelineRevision: number;
  readonly viewportOrigin: number;
  /** Identity of the chart actually sampled by the preview surface. */
  readonly previewChart: unknown;
  /** Revision of external preview resources and explicit frame invalidations. */
  readonly previewRevision: number;
  readonly previewSession: unknown;
  readonly previewSelection: unknown;
  /**
   * Whether an authoring region shares the stage with the preview.
   *
   * The preview's underlay opacity depends on it, so a change in editor-region
   * visibility must repaint the preview even when the chart and time are unchanged.
   */
  readonly authoringRegionVisible: boolean;
}

/** Work selected by the scheduler; the caller does not decide the ordering. */
export interface RenderWork {
  readonly timeline: boolean;
  readonly playhead: boolean;
  readonly preview: boolean;
  /** Explicit invalidation needs an immediate preview, even for dense charts. */
  readonly previewInvalidated: boolean;
  readonly maxHitEffects: number;
  /** GPU-only note backing-store scale; logical note geometry is unchanged. */
  readonly notePixelRatioScale: number;
}

/** Outcome of one scheduling call. */
export interface RenderOutcome {
  readonly status: "committed" | "reused" | "hidden" | "failed";
  readonly work: RenderWork;
  readonly frameId: number;
  readonly renderMs: number;
  readonly renderedSeconds: number | null;
  readonly staleMs: number | null;
}

/** Per-layer paint times reported by the adapter. */
export interface RenderTiming {
  readonly timelineMs?: number;
  readonly previewMs?: number;
}

/** Paints the work the scheduler selects. */
export interface RenderAdapter {
  /** Paints one complete transaction synchronously. Throwing aborts the commit. */
  paint(request: RenderRequest, work: RenderWork): void | RenderTiming;
}

interface CommittedState {
  timelineRevision: number;
  viewportOrigin: number;
  timelinePreviewSession: unknown;
  previewChart: unknown;
  previewRevision: number;
  previewSession: unknown;
  previewSelection: unknown;
  authoringRegionVisible: boolean;
  seconds: number;
  playheadSeconds: number;
  playheadOrigin: number;
  preview: boolean;
}

/**
 * Owns cross-surface render policy while keeping Canvas/WebGL details behind an
 * adapter. A successful `paint` is the only point at which a revision becomes
 * committed. This prevents a failed or stale transaction from suppressing the
 * next retry.
 */
export class EditorRenderScheduler {
  private readonly contentCadence = new FrameCadence();
  private committed: CommittedState = {
    timelineRevision: -1,
    viewportOrigin: Number.NaN,
    timelinePreviewSession: undefined,
    previewChart: undefined,
    previewRevision: -1,
    previewSession: undefined,
    previewSelection: undefined,
    authoringRegionVisible: false,
    seconds: Number.NaN,
    playheadSeconds: Number.NaN,
    playheadOrigin: Number.NaN,
    preview: false,
  };
  private frameId = 0;
  private forcedTimeline = false;
  private forcedPreview = false;

  /** Decides and paints one frame, then commits the revisions it actually painted. */
  tick(request: RenderRequest, adapter: RenderAdapter): RenderOutcome {
    if (!request.previewVisible) {
      this.committed.preview = false;
    }
    if (request.force) {
      this.forcedTimeline = true;
      const timelineOnlyInvalidation =
        request.timelineRevision !== this.committed.timelineRevision &&
        request.previewChart === this.committed.previewChart &&
        request.previewRevision === this.committed.previewRevision &&
        request.previewSession === this.committed.previewSession &&
        request.previewSelection === this.committed.previewSelection &&
        request.authoringRegionVisible === this.committed.authoringRegionVisible &&
        request.seconds === this.committed.seconds;
      if (request.previewVisible && !timelineOnlyInvalidation) {
        this.forcedPreview = true;
      }
    }
    const work = this.workFor(request);
    if (!request.previewVisible && !work.timeline && !work.playhead) {
      return {
        status: "hidden",
        work,
        frameId: this.frameId,
        renderMs: 0,
        renderedSeconds: this.committed.preview ? this.committed.seconds : null,
        staleMs: this.staleMs(request),
      };
    }

    const started = performance.now();
    try {
      adapter.paint(request, work);
    } catch {
      return {
        status: "failed",
        work,
        frameId: this.frameId,
        renderMs: performance.now() - started,
        renderedSeconds: this.committed.preview ? this.committed.seconds : null,
        staleMs: this.staleMs(request),
      };
    }

    if (work.timeline) {
      this.committed.timelineRevision = request.timelineRevision;
      this.committed.viewportOrigin = request.viewportOrigin;
      this.committed.timelinePreviewSession = request.previewSession;
      this.forcedTimeline = false;
    }
    if (work.playhead) {
      this.committed.playheadSeconds = request.seconds;
      this.committed.playheadOrigin = request.viewportOrigin;
    }
    if (work.preview) {
      this.committed.previewChart = request.previewChart;
      this.committed.previewRevision = request.previewRevision;
      this.committed.previewSession = request.previewSession;
      this.committed.previewSelection = request.previewSelection;
      this.committed.authoringRegionVisible = request.authoringRegionVisible;
      this.committed.seconds = request.seconds;
      this.committed.preview = request.previewVisible;
      this.forcedPreview = false;
    }
    this.frameId += 1;
    const renderMs = performance.now() - started;
    return {
      status: work.timeline || work.preview ? "committed" : "reused",
      work,
      frameId: this.frameId,
      renderMs,
      renderedSeconds: this.committed.preview ? this.committed.seconds : null,
      staleMs: this.staleMs(request),
    };
  }

  /** Forgets every committed revision after a failed paint. */
  reset(): void {
    this.committed = {
      timelineRevision: -1,
      viewportOrigin: Number.NaN,
      timelinePreviewSession: undefined,
      previewChart: undefined,
      previewRevision: -1,
      previewSession: undefined,
      previewSelection: undefined,
      authoringRegionVisible: false,
      seconds: Number.NaN,
      playheadSeconds: Number.NaN,
      playheadOrigin: Number.NaN,
      preview: false,
    };
    this.frameId = 0;
    this.forcedTimeline = false;
    this.forcedPreview = false;
    this.contentCadence.reset();
  }

  /** Selects the layers stale relative to the last committed frame. */
  private workFor(request: RenderRequest): RenderWork {
    const previewInvalidated = request.previewRevision !== this.committed.previewRevision;
    const timelinePending =
      this.forcedTimeline ||
      request.timelineRevision !== this.committed.timelineRevision ||
      (request.playing && request.viewportOrigin !== this.committed.viewportOrigin) ||
      request.previewSession !== this.committed.timelinePreviewSession;
    const previewPending =
      request.previewVisible &&
      (request.playing ||
        this.forcedPreview ||
        !this.committed.preview ||
        request.seconds !== this.committed.seconds ||
        request.previewChart !== this.committed.previewChart ||
        previewInvalidated ||
        request.previewSession !== this.committed.previewSession ||
        request.previewSelection !== this.committed.previewSelection ||
        request.authoringRegionVisible !== this.committed.authoringRegionVisible);
    // The playhead canvases are independent layers. They only need a repaint
    // when the frame that owns them changed or the playhead actually moved.
    // Playback alone is not a reason: a stalled clock or a repeated timestamp
    // must not clear and redraw the same line.
    const playheadPending =
      timelinePending ||
      !Number.isFinite(this.committed.playheadSeconds) ||
      request.seconds !== this.committed.playheadSeconds ||
      request.viewportOrigin !== this.committed.playheadOrigin;

    const cadenceDue =
      !request.playing || this.contentCadence.allow(request.now, request.contentRefreshRate);
    const contentDue = cadenceDue || previewInvalidated || request.previewMarqueeActive === true;

    return {
      // Timeline is the editing surface and must stay at RAF rate. Content
      // cadence applies only to the optional preview layer; a user-configured
      // lower preview rate must never make the timeline feel throttled.
      timeline: timelinePending,
      playhead: playheadPending,
      preview: previewPending && contentDue,
      previewInvalidated,
      // Hit-test geometry is demand-driven. `getCollisionGeometry()` requests
      // one complete pass when a pointer actually needs it and reuses the cached
      // revision afterwards; normal paint frames never allocate it.
      // Hit effects are cosmetic. In a dense chart they can outnumber notes
      // by several times and turn one synchronous frame into a long task.
      // Keep the note/hold geometry complete and bound only this optional pass.
      maxHitEffects: request.reducedQuality
        ? 0
        : request.previewHighDensity
          ? 64
          : Number.POSITIVE_INFINITY,
      notePixelRatioScale: request.reducedQuality ? 0.8 : 1,
    };
  }

  /** Milliseconds between the requested and last painted preview time, if known. */
  private staleMs(request: RenderRequest): number | null {
    if (!this.committed.preview || !Number.isFinite(this.committed.seconds)) {
      return null;
    }
    return Math.max(0, (request.seconds - this.committed.seconds) * 1000);
  }
}
