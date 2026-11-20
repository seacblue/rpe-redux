/**
 * The playback door the mounted editor connects to.
 *
 * Playback belongs to the editor: the chart, the tempo map, the audio clock and
 * the renderer all live there, so this module does not own a transport — it owns
 * the *contract* one has to satisfy and the connection to whichever editor is
 * mounted. The editor connects its implementation on mount and disconnects it on
 * teardown (`connectPlaybackApi`); every call reads the editor that is connected
 * *right now*, never one captured at import time. Between a teardown and the next
 * mount the editor is absent, and callers that require it get an error rather
 * than a stale session.
 *
 * `PlaybackApiHost` is the whole contract a host has to satisfy. It is written as
 * the capabilities the editor owns, so a host that cannot offer a canvas frame
 * report leaves `frames` out and gets an empty list rather than a fabricated one.
 *
 * The plugin-facing handle is `core/api/playback.ts`; nothing here registers
 * anything, because registration is what `core/shell/registries/` is for.
 */
import { createMemorySceneAdapter } from "../../global/chart/runtime/sceneAdapter.ts";
import { playbackSnapshot } from "../../global/chart/runtime/playbackSnapshot.ts";
import type { Chart } from "../../global/chart/chart.ts";
import type { TempoMap } from "../../global/chart/timing/tempo.ts";
import type { PlaybackMetrics } from "../perf/playbackMetrics.ts";
import { createLateBound } from "../../utils/lateBound.ts";

/** One texture the renderer has decoded, or is still waiting on. */
export interface PlaybackTextureStatus {
  name: string;
  width: number;
  height: number;
  decoded: boolean;
  pending: boolean;
  failed: boolean;
  bytes: number;
}

/** What the editor reports about the transport right now. */
export interface PlaybackState {
  loaded: boolean;
  playing: boolean;
  pending: boolean;
  /** The audio clock, which is the one the transport runs on. */
  audioSeconds: number;
  /** The same position expressed in chart time. */
  chartSeconds: number;
  duration: number;
  rate: number;
  offsetSeconds: number;
  lineIndex: number;
  /** Device latency terms behind the visual clock, when the host reports them. */
  latency?: {
    readonly baseLatency: number;
    readonly outputLatency: number;
    readonly drainedSeconds: number | null;
    readonly rate: number;
    readonly usingStretcher: boolean;
    readonly playing: boolean;
  };
}

/** One judge line as the last rendered frame drew it. */
export interface PlaybackFrameLine {
  lineIndex: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  texture: string;
}

/** One note as the last rendered frame drew it. */
export interface PlaybackFrameNote {
  lineIndex: number;
  noteIndex?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
}

/** The last rendered frame, for a host that can hand one out. */
export interface PlaybackFrame {
  canvas: string;
  seconds: number;
  width: number;
  height: number;
  scale: number;
  lines: PlaybackFrameLine[];
  notes: PlaybackFrameNote[];
}

/** Which clock `seek` reads its argument in. */
export type PlaybackClock = "chart" | "audio";

export interface PlaybackSeekOptions {
  /**
   * The clock `seconds` is in. Defaults to `"chart"`: a caller that knows a chart
   * time should not have to add the audio offset itself.
   */
  clock?: PlaybackClock;
  /** Pause on arrival. Defaults to `true`; pass `false` to seek while playing. */
  pause?: boolean;
}

/** What `connectPlaybackApi` requires of the editor. */
export interface PlaybackApiHost {
  chart(): Chart;
  tempo(): TempoMap;
  state(): PlaybackState;
  play(): Promise<void>;
  pause(): void;
  seek(audioSeconds: number, pause: boolean): void;
  setRate(rate: number): void;
  render(seconds: number): void;
  textures(): PlaybackTextureStatus[];
  /** Left out by a host whose canvas has no frame report. */
  frames?(): PlaybackFrame[];
  metrics: PlaybackMetrics;
}

/** Builds the playback facade over one host; disposal blocks later calls. */
export function createPlaybackApi(host: PlaybackApiHost) {
  const scene = createMemorySceneAdapter();
  let disposed = false;
  /** Throws once the facade has been disposed. */
  const check = () => {
    if (disposed) {
      throw new Error("Playback API disposed");
    }
  };
  /** Requires a live facade with a loaded chart. */
  const requireChart = () => {
    check();
    if (!host.state().loaded) {
      throw new Error("No chart loaded");
    }
  };
  /** Reads the host's current playback state. */
  const frameState = (): PlaybackState => host.state();
  const api = {
    version: 1,
    state() {
      check();
      return frameState();
    },
    async play(): Promise<PlaybackState> {
      requireChart();
      await host.play();
      return frameState();
    },
    pause(): PlaybackState {
      check();
      host.pause();
      return frameState();
    },
    /** `pause` is the transport's stop: the position is kept, the clock halts. */
    stop(): PlaybackState {
      check();
      host.pause();
      return frameState();
    },
    async replay(): Promise<PlaybackState> {
      requireChart();
      host.seek(frameState().offsetSeconds, true);
      await host.play();
      return frameState();
    },
    seek(seconds: number, options: PlaybackSeekOptions = {}): PlaybackState {
      requireChart();
      if (!Number.isFinite(seconds)) {
        throw new RangeError("seconds must be finite");
      }
      host.seek(
        seconds + (options.clock === "audio" ? 0 : frameState().offsetSeconds),
        options.pause ?? true,
      );
      return frameState();
    },
    seekBeat(beat: number, options: PlaybackSeekOptions = {}): PlaybackState {
      requireChart();
      if (!Number.isFinite(beat)) {
        throw new RangeError("beat must be finite");
      }
      return api.seek(
        host
          .tempo()
          .seconds(beat, host.chart().judgeLineList?.[frameState().lineIndex]?.bpmfactor ?? 1),
        options,
      );
    },
    setRate(rate: number): PlaybackState {
      requireChart();
      if (!Number.isFinite(rate) || rate <= 0 || rate > 16) {
        throw new RangeError("rate must be in (0, 16]");
      }
      host.setRate(rate);
      return frameState();
    },
    /** The judge lines as the runtime evaluates them at `seconds`, without drawing. */
    inspect(seconds = frameState().chartSeconds) {
      requireChart();
      return playbackSnapshot(scene, host.chart(), host.tempo(), seconds);
    },
    renderAt(seconds: number) {
      requireChart();
      if (!Number.isFinite(seconds)) {
        throw new RangeError("seconds must be finite");
      }
      host.render(seconds);
      return api.inspect(seconds);
    },
    textures(): PlaybackTextureStatus[] {
      requireChart();
      return host.textures();
    },
    frames(): PlaybackFrame[] {
      requireChart();
      return host.frames?.() ?? [];
    },
    startMeasurement(): void {
      requireChart();
      host.metrics.start();
    },
    stopMeasurement(): ReturnType<PlaybackMetrics["stop"]> {
      check();
      return host.metrics.stop();
    },
    metrics(): ReturnType<PlaybackMetrics["report"]> {
      check();
      return host.metrics.report();
    },
    resetDiagnostics(): void {
      check();
      host.metrics.stop();
      scene.clear();
    },
    dispose(): void {
      disposed = true;
      host.metrics.stop();
      scene.clear();
    },
  };
  return api;
}
export type PlaybackApi = ReturnType<typeof createPlaybackApi>;

const playbackApiBinding = createLateBound<PlaybackApi>();

/**
 * Hand the mounted editor's playback implementation to the API.
 *
 * The returned function disconnects it, and only if that editor is still the
 * connected one: a late teardown of an earlier editor cannot blank a newer one.
 */
export function connectPlaybackApi(host: PlaybackApiHost): () => void {
  const api = createPlaybackApi(host);
  const disconnect = playbackApiBinding.bind(api);
  return () => {
    disconnect();
    api.dispose();
  };
}

/** The connected editor's API; throws when no editor is mounted. */
export function requirePlaybackApi(): PlaybackApi {
  const api = playbackApiBinding.value();
  if (!api) {
    throw new Error("No editor playback runtime connected");
  }
  return api;
}

/** Read the mounted playback capability without turning absence into an exception. */
export function getPlaybackApi(): PlaybackApi | null {
  return playbackApiBinding.value();
}
