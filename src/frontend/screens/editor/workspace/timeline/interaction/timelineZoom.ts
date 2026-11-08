/**
 * Smooth Alt+wheel vertical zoom for the timeline.
 *
 * Wheel events update a target scale; a short eased animation moves the viewport
 * toward it while keeping the current playhead beat on the bottom red line
 * fixed. A new wheel during the animation accumulates on the previous target,
 * so consecutive notches feel continuous. Playback owns the viewport origin
 * while audio runs, so the zoom animation never competes with the playhead's
 * frame update.
 */
import type { TimelineViewport } from "../viewport/timelineViewport.ts";
import { clampTimelineScale } from "../viewport/timelineViewport.ts";
const ZOOM_DURATION_MS = 140;
const ZOOM_FACTOR_LIMIT = 300;
const ZOOM_SENSITIVITY = 0.0015;

/** A wheel delta as a multiplicative scale, bounded for coalesced events. */
export function timelineZoomFactor(deltaY: number): number {
  const bounded = Math.max(-ZOOM_FACTOR_LIMIT, Math.min(ZOOM_FACTOR_LIMIT, deltaY));
  return Math.exp(-bounded * ZOOM_SENSITIVITY);
}

/** Eases the viewport scale toward a wheel target while pinning the playhead beat. */
export class TimelineZoomAnimator {
  private frame = 0;
  private startedAt = 0;
  private fromScale = 0;
  private toScale = 0;
  private anchorSeconds = 0;
  private anchorFactor = 1;
  private readonly viewport: TimelineViewport;
  private readonly invalidate: () => void;
  private readonly settled: () => void;
  private readonly isPlaying: () => boolean;

  /** Bind the animator to its viewport, redraw callbacks, and playback owner. */
  constructor(
    viewport: TimelineViewport,
    invalidate: () => void,
    settled: () => void,
    isPlaying: () => boolean = () => false,
  ) {
    this.viewport = viewport;
    this.invalidate = invalidate;
    this.settled = settled;
    this.isPlaying = isPlaying;
  }

  /** True while an animation frame is scheduled. */
  get active(): boolean {
    return this.frame !== 0;
  }

  /** Start or retarget a zoom around the current playhead on the bottom red line. */
  request(factor: number): boolean {
    if (!Number.isFinite(factor) || factor <= 0) {
      return false;
    }
    const current = clampTimelineScale(this.viewport.scale);
    this.viewport.scale = current;
    const target = clampTimelineScale((this.active ? this.toScale : current) * factor);
    if (target === current && !this.active) {
      return false;
    }
    if (!this.active) {
      this.anchorFactor = this.viewport.factor;
      this.anchorSeconds = this.viewport.tempo.seconds(this.viewport.origin, this.anchorFactor);
    }
    this.fromScale = current;
    this.toScale = target;
    this.startedAt = performance.now();
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(this.tick);
    }
    return true;
  }

  /** Stop the running animation without settling the viewport. */
  cancel(): void {
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** Advance one animation frame and settle when the duration elapses. */
  private readonly tick = (now: number): void => {
    this.frame = 0;
    const progress = Math.min(1, (now - this.startedAt) / ZOOM_DURATION_MS);
    // A cubic ease-out settles quickly but never snaps on the first frame.
    const eased = 1 - Math.pow(1 - progress, 3);
    const scale = this.fromScale + (this.toScale - this.fromScale) * eased;
    this.viewport.scale = scale;
    if (!this.isPlaying()) {
      const origin = this.viewport.tempo.beat(this.anchorSeconds, this.anchorFactor);
      this.viewport.setOrigin(origin, "zoom");
    }
    this.invalidate();
    if (progress < 1) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    this.settled();
  };
}
