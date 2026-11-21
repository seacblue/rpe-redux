/**
 * Owns the playback handle a plugin sees.
 *
 * Playback belongs to the mounted editor, so every method reads the editor
 * connected at call time. Between one editor's teardown and the next mount,
 * calls return an unavailable result. The implementation and host contract are
 * `core/edit/playback/api.ts`.
 *
 * Playback is a property of the open document, not of the plugin host.
 *
 * Minimal usage (after an editor has mounted):
 * ```js
 * redux.playback.seekBeat(12);
 * redux.playback.setRate(1.25);
 * redux.playback.play();
 * console.log(redux.playback.state().value.chartSeconds);
 * ```
 */
import { getPlaybackApi, type PlaybackApi } from "../edit/playback/api.ts";
import { apiCall, apiCallAsync, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";

/** Run one synchronous playback call against the mounted editor. */
function withPlayback<T>(run: (api: PlaybackApi) => T): ApiResult<T> {
  const api = getPlaybackApi();
  return api
    ? apiCall(() => run(api))
    : unavailableResult<T>("No editor playback runtime connected");
}

/** Run one asynchronous playback call against the mounted editor. */
async function withPlaybackAsync<T>(run: (api: PlaybackApi) => Promise<T>): Promise<ApiResult<T>> {
  const api = getPlaybackApi();
  return api
    ? apiCallAsync(() => run(api))
    : unavailableResult<T>("No editor playback runtime connected");
}

/** One throttled playback clock sample delivered to a subscriber. */
export interface PlaybackTick {
  readonly chartSeconds: number;
  readonly beat: number;
  readonly playing: boolean;
  readonly rate: number;
  readonly lineIndex: number;
}

/** Default callbacks per second for `subscribe`. */
const DEFAULT_TICK_HZ = 30;
const MIN_TICK_HZ = 1;
const MAX_TICK_HZ = 60;

const MAX_SUBSCRIPTIONS = 64;
const MAX_OWNER_SUBSCRIPTIONS = 8;

interface PlaybackSubscription {
  readonly owner: string;
  readonly listener: (tick: PlaybackTick) => void;
  readonly intervalMs: number;
  nextAt: number;
}

const subscriptions = new Map<number, PlaybackSubscription>();
let nextSubscriptionId = 1;
let timer: ReturnType<typeof setInterval> | null = null;

/** Normalize a requested tick rate into a bounded interval. */
function tickInterval(options: { maxHz?: number } | undefined): number {
  const requested = options?.maxHz;
  const hz =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(MAX_TICK_HZ, Math.max(MIN_TICK_HZ, requested))
      : DEFAULT_TICK_HZ;
  return 1000 / hz;
}

/** Build one tick from the current host state. */
function currentTick(state: ReturnType<PlaybackApi["state"]>): PlaybackTick {
  return Object.freeze({
    chartSeconds: state.chartSeconds,
    beat: state.beat ?? 0,
    playing: state.playing,
    rate: state.rate,
    lineIndex: state.lineIndex,
  });
}

/** Deliver one shared clock sample to every subscription whose interval elapsed. */
function tickSubscriptions(now = performance.now()): void {
  const visibility = (
    globalThis as unknown as Record<string, { visibilityState?: string } | undefined>
  )["document"];
  if (visibility?.visibilityState === "hidden") {
    return;
  }
  const api = getPlaybackApi();
  if (!api) {
    return;
  }
  let state: ReturnType<PlaybackApi["state"]> | null = null;
  for (const subscription of subscriptions.values()) {
    if (now < subscription.nextAt) {
      continue;
    }
    subscription.nextAt = now + subscription.intervalMs;
    state ??= api.state();
    try {
      subscription.listener(currentTick(state));
    } catch (error) {
      console.error("Playback subscription listener failed", error);
    }
  }
}

/** Start or stop the one shared timer with the subscription set. */
function syncTimer(): void {
  if (subscriptions.size === 0) {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    return;
  }
  timer ??= setInterval(() => tickSubscriptions(), 1000 / MAX_TICK_HZ);
}

/** Count active subscriptions for one owner. */
function ownerSubscriptionCount(owner: string): number {
  let count = 0;
  for (const subscription of subscriptions.values()) {
    if (subscription.owner === owner) {
      count += 1;
    }
  }
  return count;
}

/** Subscribe one owner to the shared playback clock. */
export function subscribePlaybackForOwner(
  owner: string,
  listener: (tick: PlaybackTick) => void,
  options: { maxHz?: number } = {},
): () => void {
  if (typeof listener !== "function") {
    return () => {};
  }
  const api = getPlaybackApi();
  if (!api) {
    return () => {};
  }
  if (
    subscriptions.size >= MAX_SUBSCRIPTIONS ||
    ownerSubscriptionCount(owner) >= MAX_OWNER_SUBSCRIPTIONS
  ) {
    return () => {};
  }
  const id = nextSubscriptionId++;
  const intervalMs = tickInterval(options);
  subscriptions.set(id, {
    owner,
    listener,
    intervalMs,
    nextAt: performance.now() + intervalMs,
  });
  syncTimer();
  listener(currentTick(api.state()));
  return () => {
    subscriptions.delete(id);
    syncTimer();
  };
}

/** Drop every playback subscription for one owner, or all when omitted. */
export function clearPlaybackSubscriptions(owner?: string): void {
  if (owner === undefined) {
    subscriptions.clear();
    syncTimer();
    return;
  }
  for (const [id, subscription] of subscriptions) {
    if (subscription.owner === owner) {
      subscriptions.delete(id);
    }
  }
  syncTimer();
}

/** Transport, rendering, and diagnostics actions exposed to plugins. */
export const playback = Object.freeze({
  /** Report whether a playback runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getPlaybackApi(), "No editor playback runtime connected");
  },
  /** The current transport state. */
  state: (): ApiResult<ReturnType<PlaybackApi["state"]>> => withPlayback((api) => api.state()),
  /**
   * Observe the transport clock at a bounded rate.
   *
   * The first tick is delivered synchronously when a playback runtime is
   * connected; later ticks are coalesced by `maxHz` (default 30, clamp 1-60).
   * The returned disposer stops the timer. A disconnected host returns a no-op
   * disposer, matching the other subscription handles.
   */
  subscribe(listener: (tick: PlaybackTick) => void, options: { maxHz?: number } = {}): () => void {
    return subscribePlaybackForOwner("host", listener, options);
  },
  /** Start playback; requires a loaded chart. */
  play: (): Promise<ApiResult<Awaited<ReturnType<PlaybackApi["play"]>>>> =>
    withPlaybackAsync((api) => api.play()),
  /** Halt the clock and keep the current position. */
  pause: (): ApiResult<ReturnType<PlaybackApi["pause"]>> => withPlayback((api) => api.pause()),
  /** Halt the clock and keep the current position. */
  stop: (): ApiResult<ReturnType<PlaybackApi["stop"]>> => withPlayback((api) => api.stop()),
  /** Seek to the current offset and play from there. */
  replay: (): Promise<ApiResult<Awaited<ReturnType<PlaybackApi["replay"]>>>> =>
    withPlaybackAsync((api) => api.replay()),
  /** Seek to a time in chart or audio seconds; pauses on arrival by default. */
  seek: (...args: Parameters<PlaybackApi["seek"]>): ApiResult<ReturnType<PlaybackApi["seek"]>> =>
    withPlayback((api) => api.seek(...args)),
  /** Seek to a chart beat on the active line. */
  seekBeat: (
    ...args: Parameters<PlaybackApi["seekBeat"]>
  ): ApiResult<ReturnType<PlaybackApi["seekBeat"]>> => withPlayback((api) => api.seekBeat(...args)),
  /** Set the playback rate; the accepted range is (0, 16]. */
  setRate: (rate: number): ApiResult<ReturnType<PlaybackApi["setRate"]>> =>
    withPlayback((api) => api.setRate(rate)),
  /** Evaluate judge lines at a time without drawing. */
  inspect: (
    ...args: Parameters<PlaybackApi["inspect"]>
  ): ApiResult<ReturnType<PlaybackApi["inspect"]>> => withPlayback((api) => api.inspect(...args)),
  /** Render at a time and return the evaluated frame snapshot. */
  renderAt: (seconds: number): ApiResult<ReturnType<PlaybackApi["renderAt"]>> =>
    withPlayback((api) => api.renderAt(seconds)),
  /** Decoded, pending, and failed textures in the renderer. */
  textures: (): ApiResult<ReturnType<PlaybackApi["textures"]>> =>
    withPlayback((api) => api.textures()),
  /** The last rendered frames; empty when the host reports none. */
  frames: (): ApiResult<ReturnType<PlaybackApi["frames"]>> => withPlayback((api) => api.frames()),
  /** Start capturing playback metrics; requires a loaded chart. */
  startMeasurement: (): ApiResult<ReturnType<PlaybackApi["startMeasurement"]>> =>
    withPlayback((api) => api.startMeasurement()),
  /** Stop capturing metrics and return the report. */
  stopMeasurement: (): ApiResult<ReturnType<PlaybackApi["stopMeasurement"]>> =>
    withPlayback((api) => api.stopMeasurement()),
  /** The current metrics report. */
  metrics: (): ApiResult<ReturnType<PlaybackApi["metrics"]>> =>
    withPlayback((api) => api.metrics()),
  /** Stop metrics and clear the scene adapter. */
  resetDiagnostics: (): ApiResult<ReturnType<PlaybackApi["resetDiagnostics"]>> =>
    withPlayback((api) => api.resetDiagnostics()),
});

export type PlaybackHandle = typeof playback;

export type {
  PlaybackClock,
  PlaybackFrame,
  PlaybackFrameLine,
  PlaybackFrameNote,
  PlaybackSeekOptions,
  PlaybackState,
  PlaybackTextureStatus,
} from "../edit/playback/api.ts";
