/**
 * Owns the frozen facade for live preview object geometry.
 *
 * `snapshot()` reads the last painted preview frame once; `subscribe()` pushes
 * snapshots on a shared, throttled scheduler (30 Hz by default) without forcing
 * an extra render. Every throttle window ends with the latest frame, and all
 * returned values are deeply frozen plain data.
 */
import { getPreviewApi, onPreviewApiChange } from "../edit/preview/api.ts";
import type {
  PreviewApiHost,
  PreviewObject,
  PreviewObjectGeometry,
  PreviewSnapshot,
} from "../edit/preview/api.ts";
import {
  frozenPreviewFrameImage,
  normalizePreviewFrameRequest,
  type PreviewFrameImage,
  type PreviewFrameRequest,
} from "../edit/preview/frame.ts";
import { type ApiAvailability, type ApiResult } from "./contract.ts";
import {
  apiCallAsync,
  availabilityFor,
  errorResult,
  frozenPoint,
  frozenRect,
  unavailableResult,
} from "./support.ts";

/** Freeze one object's centre, head, tail, and corner points. */
function frozenGeometry(geometry: PreviewObjectGeometry): PreviewObjectGeometry {
  return Object.freeze({
    center: frozenPoint(geometry.center),
    head: frozenPoint(geometry.head),
    tail: frozenPoint(geometry.tail),
    corners: Object.freeze(geometry.corners.map(frozenPoint)),
  });
}

/** Freeze one preview object and both of its geometry views. */
function frozenObject(object: PreviewObject): PreviewObject {
  return Object.freeze({
    ...object,
    client: frozenGeometry(object.client),
    surface: frozenGeometry(object.surface),
  });
}

/** Freeze a snapshot's rectangles and every visible object. */
function frozenSnapshot(snapshot: PreviewSnapshot): PreviewSnapshot {
  return Object.freeze({
    ...snapshot,
    bounds: frozenRect(snapshot.bounds),
    viewport: frozenRect(snapshot.viewport),
    objects: Object.freeze(snapshot.objects.map(frozenObject)),
  });
}

/** A structured unavailable result for a call made before mount. */
function unavailable<T>(): ApiResult<T> {
  return unavailableResult<T>("No preview geometry runtime connected");
}

/** Default callbacks per second for `subscribe`. */
const DEFAULT_MAX_HZ = 30;

/** Lowest accepted `maxHz`; slower subscriptions still receive every window tail. */
const MIN_MAX_HZ = 1;

/** Highest accepted `maxHz`; the preview never repaints faster than 60 Hz. */
const MAX_MAX_HZ = 60;

/** Options for a throttled preview subscription. */
export interface PreviewSubscribeOptions {
  /**
   * Upper bound on callbacks per second. Finite values are clamped to
   * `[1, 60]`; other values use the 30 Hz default.
   */
  readonly maxHz?: number;
}

/** Injectable clock and timer surface used by the shared preview throttle. */
export interface PreviewThrottleClock {
  /** Current time in milliseconds; only differences between calls matter. */
  now(): number;
  /** Schedule one scheduler tick; the handle is opaque to the throttle. */
  setTimeout(handler: () => void, delayMs: number): unknown;
  /** Cancel a handle returned by the matching `setTimeout`. */
  clearTimeout(handle: unknown): void;
}

/** Real timers and the wall clock. */
const defaultThrottleClock: PreviewThrottleClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

let throttleClock = defaultThrottleClock;

/**
 * Replace the clock used by the shared preview throttle.
 *
 * Tests call this with a deterministic clock and restore the default with
 * `null`. Call it only while no preview subscription is active; an in-flight
 * tick keeps using the clock that scheduled it.
 */
export function setPreviewThrottleClockForTests(next: PreviewThrottleClock | null): void {
  if (throttleTimer !== null) {
    throttleClock.clearTimeout(throttleTimer);
    throttleTimer = null;
    throttleTimerDue = 0;
  }
  throttleClock = next ?? defaultThrottleClock;
}

/** One listener and the throttle window it last consumed. */
interface ThrottledSubscriber {
  readonly listener: (snapshot: PreviewSnapshot | null) => void;
  readonly intervalMs: number;
  /** Clock time of the last callback delivered to this subscriber. */
  deliveredAt: number;
  /** Latest host frame already delivered to this subscriber. */
  deliveredSequence: number;
}

const throttledSubscribers = new Set<ThrottledSubscriber>();
let throttleHost: PreviewApiHost | null = null;
let detachThrottleHost: (() => void) | null = null;
let detachHostChange: (() => void) | null = null;
let latestFrame: PreviewSnapshot | null = null;
let frameSequence = 0;
let throttleTimer: unknown = null;
let throttleTimerDue = 0;

/** Convert a requested rate into a throttle interval, clamping invalid values. */
function intervalFor(options: PreviewSubscribeOptions | undefined): number {
  const requested = options?.maxHz;
  const hz =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(MAX_MAX_HZ, Math.max(MIN_MAX_HZ, requested))
      : DEFAULT_MAX_HZ;
  return 1000 / hz;
}

/** Deliver one already-frozen value, isolating consumer failures. */
function deliverThrottled(subscriber: ThrottledSubscriber, value: PreviewSnapshot | null): void {
  try {
    subscriber.listener(value);
  } catch (error) {
    // A consumer failure must not interrupt the preview or other observers.
    console.error("Preview subscription listener failed", error);
  }
}

/** Cancel the shared scheduler's pending tick, if any. */
function cancelThrottleTimer(): void {
  if (throttleTimer === null) {
    return;
  }
  throttleClock.clearTimeout(throttleTimer);
  throttleTimer = null;
  throttleTimerDue = 0;
}

/** Feed every host frame into the shared scheduler. */
function handleThrottleFrame(snapshot: PreviewSnapshot | null): void {
  latestFrame = snapshot;
  frameSequence += 1;
  scheduleThrottle();
}

/** Rebind when the preview runtime connects, disconnects, or is replaced. */
function refreshThrottleHost(): void {
  const next = getPreviewApi();
  if (next === throttleHost) {
    return;
  }
  cancelThrottleTimer();
  detachThrottleHost?.();
  detachThrottleHost = null;
  throttleHost = next;
  latestFrame = null;
  // A new host invalidates pending frames from the previous one.
  frameSequence += 1;
  if (!next) {
    return;
  }
  let deliveredOnAttach = false;
  detachThrottleHost = next.subscribe((snapshot) => {
    deliveredOnAttach = true;
    handleThrottleFrame(snapshot);
  });
  if (deliveredOnAttach) {
    // The host pushed its first frame while attaching; the shared scheduler
    // already owns the delivery. Only reset each window start.
    const now = throttleClock.now();
    for (const subscriber of [...throttledSubscribers]) {
      if (throttledSubscribers.has(subscriber)) {
        subscriber.deliveredAt = now;
      }
    }
    return;
  }
  const initial = next.snapshot();
  const value = initial ? frozenSnapshot(initial) : null;
  const now = throttleClock.now();
  for (const subscriber of [...throttledSubscribers]) {
    if (!throttledSubscribers.has(subscriber)) {
      continue;
    }
    subscriber.deliveredAt = now;
    subscriber.deliveredSequence = frameSequence;
    if (value) {
      deliverThrottled(subscriber, value);
    }
  }
}

/**
 * Arm one timer for the earliest subscriber that still owes a callback.
 *
 * All subscribers share this timer; a faster subscriber can pull an earlier
 * due time forward, while a pending earlier tick is never pushed back.
 */
function scheduleThrottle(): void {
  if (throttledSubscribers.size === 0) {
    cancelThrottleTimer();
    return;
  }
  const now = throttleClock.now();
  let due: number | null = null;
  for (const subscriber of throttledSubscribers) {
    if (subscriber.deliveredSequence === frameSequence) {
      continue;
    }
    const candidate = subscriber.deliveredAt + subscriber.intervalMs;
    if (due === null || candidate < due) {
      due = candidate;
    }
  }
  if (due === null) {
    cancelThrottleTimer();
    return;
  }
  if (throttleTimer !== null) {
    if (due >= throttleTimerDue) {
      return;
    }
    cancelThrottleTimer();
  }
  throttleTimerDue = due;
  throttleTimer = throttleClock.setTimeout(runThrottleTick, Math.max(0, due - now));
}

/** Deliver the latest frame to every subscriber whose window has elapsed. */
function runThrottleTick(): void {
  throttleTimer = null;
  throttleTimerDue = 0;
  const now = throttleClock.now();
  let frozen: PreviewSnapshot | null = null;
  let frozenReady = false;
  for (const subscriber of [...throttledSubscribers]) {
    if (!throttledSubscribers.has(subscriber)) {
      continue;
    }
    if (subscriber.deliveredSequence === frameSequence) {
      continue;
    }
    if (now < subscriber.deliveredAt + subscriber.intervalMs) {
      continue;
    }
    if (!frozenReady) {
      frozen = latestFrame ? frozenSnapshot(latestFrame) : null;
      frozenReady = true;
    }
    subscriber.deliveredAt = now;
    subscriber.deliveredSequence = frameSequence;
    deliverThrottled(subscriber, frozen);
  }
  scheduleThrottle();
}

/** Live preview geometry exposed to plugins. */
export const preview = Object.freeze({
  /** Report whether a preview geometry runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getPreviewApi(), "No preview geometry runtime connected");
  },

  /** Read the objects visible in the most recently painted preview frame. */
  snapshot(): ApiResult<PreviewSnapshot> {
    const api = getPreviewApi();
    if (!api) {
      return unavailable();
    }
    try {
      const snapshot = api.snapshot();
      return snapshot
        ? { ok: true, value: frozenSnapshot(snapshot) }
        : unavailableResult("The preview has no visible frame");
    } catch (error) {
      return errorResult(error);
    }
  },

  /**
   * Render one chart frame into an encoded image.
   *
   * Select the frame with exactly one of `seconds` (tempo-map seconds) or
   * `beat` (a number or reduced triple). The renderer samples an offscreen
   * preview and never changes the live preview or playback position. The
   * result carries a data URL and the resolved time, beat, and chart revision.
   */
  async frame(request: PreviewFrameRequest): Promise<ApiResult<PreviewFrameImage>> {
    const api = getPreviewApi();
    if (!api) {
      return unavailable();
    }
    let spec;
    try {
      spec = normalizePreviewFrameRequest(request);
    } catch (error) {
      return errorResult(error);
    }
    const result = await apiCallAsync(() => api.frame(spec));
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: frozenPreviewFrameImage(result.value) };
  },

  /**
   * Listen for painted preview frames at a throttled rate.
   *
   * The listener receives null when the document is cleared or the preview is
   * hidden. The current snapshot is delivered synchronously when available;
   * later frames arrive at most `maxHz` times per second (30 by default), and
   * the last frame of every window is never dropped. One shared scheduler
   * serves every subscriber. Return the disposer to stop observing.
   */
  subscribe(
    listener: (snapshot: PreviewSnapshot | null) => void,
    options: PreviewSubscribeOptions = {},
  ): () => void {
    if (typeof listener !== "function") {
      return () => {};
    }
    if (throttledSubscribers.size === 0) {
      detachHostChange = onPreviewApiChange(refreshThrottleHost);
      refreshThrottleHost();
    }
    const subscriber: ThrottledSubscriber = {
      listener,
      intervalMs: intervalFor(options),
      deliveredAt: throttleClock.now(),
      deliveredSequence: frameSequence,
    };
    throttledSubscribers.add(subscriber);
    const initial = throttleHost?.snapshot() ?? null;
    if (initial) {
      deliverThrottled(subscriber, frozenSnapshot(initial));
    }
    return () => {
      if (!throttledSubscribers.delete(subscriber)) {
        return;
      }
      if (throttledSubscribers.size > 0) {
        return;
      }
      cancelThrottleTimer();
      detachThrottleHost?.();
      detachThrottleHost = null;
      detachHostChange?.();
      detachHostChange = null;
      throttleHost = null;
      latestFrame = null;
      frameSequence = 0;
    };
  },
});

export type {
  PreviewObject,
  PreviewObjectGeometry,
  PreviewObjectKind,
  PreviewPoint,
  PreviewRect,
  PreviewSnapshot,
} from "../edit/preview/api.ts";
export type {
  PreviewFrameFormat,
  PreviewFrameImage,
  PreviewFrameRequest,
  PreviewFrameSpec,
} from "../edit/preview/frame.ts";
