/**
 * Builds the host-independent diagnostics snapshot exposed to extensions.
 *
 * This module reads existing public seams only: editor visibility, mounted
 * document/playback contracts, named values, and the
 * bounded local-service trace. It never reads the DOM or a renderer object.
 */
import { getDocumentApi } from "../edit/document/api.ts";
import { getPlaybackApi } from "../edit/playback/api.ts";
import type { PlaybackState } from "../edit/playback/api.ts";
import type { PlaybackMetricsReport } from "../edit/perf/playbackMetrics.ts";
import { getEditorVisibility } from "../edit/state/visibility.ts";
import { localServiceStatus, type LocalServiceStatus } from "../global/library/service.ts";
import { values } from "../state/values.ts";
import { redactDiagnosticValue, type DiagnosticsValue } from "./redaction.ts";
import {
  backendTraceSnapshot,
  type BackendTraceEntry,
  type BackendTraceSnapshot,
} from "./backendTrace.ts";

export type { DiagnosticsValue } from "./redaction.ts";

/** Whether the runtime, editor, and local service are ready to serve requests. */
export interface DiagnosticsReadiness {
  readonly runtime: "starting" | "ready" | "unavailable";
  readonly editor: {
    readonly mounted: boolean;
    readonly atHome: boolean;
    readonly hasDocument: boolean;
  };
  readonly backend: LocalServiceStatus;
}

/** Non-sensitive summary of the mounted document. */
export interface DiagnosticsDocument {
  readonly status: "empty" | "open";
  readonly format: "memory" | "json" | "pez";
  readonly dirty: boolean;
  readonly fingerprint: string | null;
}

/** Playback fields exposed to diagnostics consumers. */
export type DiagnosticsPlaybackState = Pick<
  PlaybackState,
  | "loaded"
  | "playing"
  | "pending"
  | "audioSeconds"
  | "chartSeconds"
  | "duration"
  | "rate"
  | "offsetSeconds"
  | "lineIndex"
>;

/** Playback timing report without the raw per-frame samples. */
export type DiagnosticsPlaybackMetrics = Omit<PlaybackMetricsReport, "raw">;

/** Playback availability, state, and timing metrics at capture time. */
export interface DiagnosticsPlayback {
  readonly available: boolean;
  readonly state: DiagnosticsPlaybackState | null;
  readonly metrics: DiagnosticsPlaybackMetrics | null;
}

/** Bounded local-service request trace included in the snapshot. */
export interface DiagnosticsBackend {
  readonly traceEnabled: boolean;
  readonly entries: readonly BackendTraceEntry[];
  readonly capacity: number;
}

/** Complete immutable diagnostics payload exposed through `captureDiagnosticsSnapshot`. */
export interface DiagnosticsSnapshot {
  readonly version: 1;
  readonly capturedAt: number;
  readonly readiness: DiagnosticsReadiness;
  readonly ["document"]: DiagnosticsDocument;
  readonly values: Readonly<Record<string, DiagnosticsValue>>;
  readonly playback: DiagnosticsPlayback;
  readonly backend: DiagnosticsBackend;
}

/** Read the mounted document contract, falling back to an empty document. */
function documentSnapshot(): DiagnosticsDocument {
  const state = getDocumentApi()?.state();
  return Object.freeze({
    status: state?.status ?? "empty",
    format: state?.format ?? "memory",
    dirty: state?.dirty ?? false,
    fingerprint: state?.fingerprint ?? null,
  });
}

/** Freeze the playback fields that are safe to publish. */
function playbackState(state: PlaybackState): DiagnosticsPlaybackState {
  return Object.freeze({
    loaded: state.loaded,
    playing: state.playing,
    pending: state.pending,
    audioSeconds: state.audioSeconds,
    chartSeconds: state.chartSeconds,
    duration: state.duration,
    rate: state.rate,
    offsetSeconds: state.offsetSeconds,
    lineIndex: state.lineIndex,
  });
}

/** Freeze the playback report without its raw per-frame samples. */
function playbackMetrics(report: PlaybackMetricsReport): DiagnosticsPlaybackMetrics {
  return Object.freeze({
    enabled: report.enabled,
    frames: report.frames,
    totalFrames: report.totalFrames,
    truncated: report.truncated,
    elapsedMs: report.elapsedMs,
    fps: report.fps,
    minWindowFps: report.minWindowFps,
    drawMs: Object.freeze({ ...report.drawMs }),
    intervalMs: Object.freeze({ ...report.intervalMs }),
    over60Budget: report.over60Budget,
    over144Budget: report.over144Budget,
    stalls50ms: report.stalls50ms,
    minimum60: report.minimum60,
    target144: report.target144,
  });
}

/** Capture playback state when available; reporting is best-effort and never throws. */
function playbackSnapshot(): DiagnosticsPlayback {
  const api = getPlaybackApi();
  if (!api) {
    return Object.freeze({ available: false, state: null, metrics: null });
  }
  try {
    const state = playbackState(api.state());
    let metrics: DiagnosticsPlaybackMetrics | null = null;
    try {
      metrics = playbackMetrics(api.metrics());
    } catch {
      metrics = null;
    }
    return Object.freeze({ available: true, state, metrics });
  } catch {
    return Object.freeze({ available: false, state: null, metrics: null });
  }
}

/** Derive the runtime readiness from editor visibility and local-service status. */
function readiness(): DiagnosticsReadiness {
  const visibility = getEditorVisibility();
  const mounted = Boolean(getDocumentApi() || getPlaybackApi());
  const backend = localServiceStatus();
  return Object.freeze({
    runtime: mounted ? "ready" : backend === "unavailable" ? "unavailable" : "starting",
    editor: Object.freeze({
      mounted,
      atHome: visibility.atHome,
      hasDocument: visibility.hasDocument,
    }),
    backend,
  });
}

/** Project the trace snapshot onto the public backend section. */
function backendSnapshot(trace: BackendTraceSnapshot): DiagnosticsBackend {
  return Object.freeze({
    traceEnabled: trace.enabled,
    capacity: trace.capacity,
    entries: trace.entries,
  });
}

/** Capture one immutable, redacted diagnostics value for public consumers. */
export function captureDiagnosticsSnapshot(): DiagnosticsSnapshot {
  return Object.freeze({
    version: 1,
    capturedAt: Date.now(),
    readiness: readiness(),
    ["document"]: documentSnapshot(),
    values: Object.freeze(
      redactDiagnosticValue(values.byId.snapshot(), "values") as Record<string, DiagnosticsValue>,
    ),
    playback: playbackSnapshot(),
    backend: backendSnapshot(backendTraceSnapshot()),
  });
}

export type { BackendTraceEntry, BackendTraceSnapshot } from "./backendTrace.ts";
