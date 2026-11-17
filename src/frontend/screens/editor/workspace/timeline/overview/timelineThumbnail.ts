/**
 * Publishes the hover preview of one chart moment: delays the reveal, throttles
 * refreshes, and hands the scene plus resources to the React preview host.
 *
 * It owns hover timing and snapshot state, not chart rendering or the floating box.
 */
import { createValue, type ValueCell } from "../../../../../../core/state/values.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";
import type { RpeSkin } from "../../../canvas/skin.ts";

/**
 * What the preview hangs off: the pointer's height, and the strip edge it was
 * hovering. The preview is placed against that edge on the side facing the
 * middle of the workspace, so it never jumps under the cursor.
 */
export interface TimelineThumbnailAnchor {
  /** Pointer height; the preview is centred on it. */
  y: number;
  /** The strip's inner edge: its right side for the left strip, its left for the right. */
  edge: number;
  side: "left" | "right";
}

export interface TimelineThumbnailRequest {
  scene: {
    chart: Chart;
    tempo: TempoSource;
    seconds: number;
    lineIndex: number;
    /** Document content revision, so paged facade edits repaint the preview. */
    documentRevision: number;
  };
  anchor: TimelineThumbnailAnchor;
}

export interface TimelineThumbnailResources {
  images: ProjectImages;
  skin: RpeSkin;
  colors(): {
    defaultLineColor: readonly number[];
    defaultParticleColor: readonly number[];
    selectedLineColor: readonly number[];
  };
}

export interface TimelineThumbnailSnapshot extends TimelineThumbnailRequest {
  resources: TimelineThumbnailResources;
}

export interface TimelineThumbnailState {
  readonly snapshot: ValueCell<TimelineThumbnailSnapshot | null>;
  /**
   * The live anchor. It updates on every hover sample so the box tracks the
   * pointer immediately, while `snapshot` keeps the throttled scene redraw.
   */
  readonly anchor: ValueCell<TimelineThumbnailAnchor | null>;
}

/** Creates the preview snapshot and live anchor cells. */
export function createTimelineThumbnailState(): TimelineThumbnailState {
  return Object.freeze({
    snapshot: createValue<TimelineThumbnailSnapshot | null>({ initial: null }),
    anchor: createValue<TimelineThumbnailAnchor | null>({ initial: null }),
  });
}

/**
 * How long the pointer must rest on a strip before the preview appears.
 *
 * The preview is a small render of the whole chart, so it must not flash up
 * while the pointer merely crosses a strip on its way somewhere else.
 */
const HOVER_DELAY_MS = 260;

/** The shortest gap between two redraws once the preview is up. */
const REFRESH_INTERVAL_MS = 120;

/** Publishes the hover preview of one chart moment. */
export class TimelineThumbnail {
  private snapshot: TimelineThumbnailSnapshot | null = null;
  /** The newest hover sample, whether or not it has been drawn yet. */
  private hovered: TimelineThumbnailRequest | null = null;
  private lastRender = 0;
  private delay: ReturnType<typeof setTimeout> | undefined;
  private refresh: ReturnType<typeof setTimeout> | undefined;
  private readonly resources: TimelineThumbnailResources;
  private readonly state: TimelineThumbnailState;

  /** Bind the preview to its shared resources and published state. */
  constructor(resources: TimelineThumbnailResources, state: TimelineThumbnailState) {
    this.resources = resources;
    this.state = state;
  }

  /** Request a preview, delaying the first reveal and throttling refreshes. */
  show(request: TimelineThumbnailRequest, now = performance.now()): void {
    this.hovered = request;
    this.state.anchor.set(request.anchor);
    if (!this.snapshot) {
      // Held, not merely crossed: the delay runs once per hover session, so a
      // pointer that keeps moving along the strip still reveals the preview.
      this.delay ??= setTimeout(() => this.reveal(), HOVER_DELAY_MS);
      return;
    }
    if (now - this.lastRender >= REFRESH_INTERVAL_MS) {
      this.render(now);
      return;
    }
    this.refresh ??= setTimeout(
      () => this.render(performance.now()),
      REFRESH_INTERVAL_MS - (now - this.lastRender),
    );
  }

  /** Cancel pending timers and clear the preview. */
  hide(): void {
    clearTimeout(this.delay);
    clearTimeout(this.refresh);
    this.delay = undefined;
    this.refresh = undefined;
    this.hovered = null;
    this.state.anchor.set(null);
    if (!this.snapshot) {
      return;
    }
    this.snapshot = null;
    this.state.snapshot.set(null);
  }

  /** Release hover state and timers. */
  dispose(): void {
    this.hide();
  }

  /** Reveal the pending preview after the hover delay. */
  private reveal(): void {
    this.delay = undefined;
    this.render(performance.now());
  }

  /** Publish the newest hover sample with its resources. */
  private render(now: number): void {
    this.refresh = undefined;
    const request = this.hovered;
    if (!request) {
      return;
    }
    this.lastRender = now;
    this.snapshot = { ...request, resources: this.resources };
    this.state.snapshot.set(this.snapshot);
  }
}
