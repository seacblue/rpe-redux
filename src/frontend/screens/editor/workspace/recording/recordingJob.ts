/** Orchestrates one offline chart recording within the existing editor window. */
import { TempoMap } from "../../../../../core/global/chart/timing/tempo.ts";
import {
  beginDesktopRecording,
  recordingFormatSpec,
  type DesktopRecording,
  type RecordingFormat,
} from "../../../../../core/platform/desktop/recording.ts";
import type { EditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import {
  captureRecordingAudio,
  mixRecordingAudio,
  recordingSampleCount,
} from "./recordingAudio.ts";
import { snapshotRecordingImages } from "./recordingImages.ts";
import { recordingPcmChunks } from "./recordingPcm.ts";
import type {
  RecordingRenderer,
  RecordingAppearance,
  RecordingSurface,
} from "./recordingRenderer.ts";
import { RecordingTimeline } from "./recordingTimeline.ts";
import {
  createRecordingVideoEncoder,
  selectRecordingVideoConfig,
  type RecordingVideoEncoder,
} from "./recordingVideoEncoder.ts";

/** Output geometry, interval, format, and destination chosen in the recording modal. */
export interface RecordingJobOptions {
  path: string;
  format: RecordingFormat;
  width: number;
  height: number;
  fps: number;
  /** Song seconds advanced per output frame; the output frame rate is unchanged. */
  speed: number;
  videoBitrate: number;
  musicVolume: number;
  effectsVolume: number;
  start: number;
  end: number;
}

/** Phases reported while a recording runs. */
export type RecordingStage = "preparing" | "audio" | "frames" | "encoding";

/** Throws an abort error once the caller's signal is set. */
function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Cancelled", "AbortError");
  }
}

/**
 * Yield to the renderer without the timer clamp.
 *
 * A recording frame is already a complete unit of work, so this only gives the
 * UI a chance to paint the progress and service cancellation. `setTimeout(0)`
 * adds a several-millisecond delay per frame after the first few iterations.
 */
function yieldToRenderer(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** Capture all mutable chart and appearance state synchronously at the click. */
export function captureRecording(
  runtime: EditorRuntime,
  options: Omit<RecordingJobOptions, "path">,
  signal: AbortSignal,
) {
  const music = runtime.audio.buffer;
  if (!music) {
    throw new Error("recording_music_unavailable");
  }
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width < 2 ||
    options.height < 2 ||
    options.width > 3840 ||
    options.height > 2160 ||
    options.width % 2 !== 0 ||
    options.height % 2 !== 0 ||
    !Number.isInteger(options.videoBitrate) ||
    options.videoBitrate < 1 ||
    options.videoBitrate > 100 ||
    !Number.isFinite(options.speed) ||
    options.speed < 0.5 ||
    options.speed > 4 ||
    !Number.isFinite(options.musicVolume) ||
    options.musicVolume < 0 ||
    options.musicVolume > 2 ||
    !Number.isFinite(options.effectsVolume) ||
    options.effectsVolume < 0 ||
    options.effectsVolume > 2 ||
    options.end > music.duration
  ) {
    throw new Error("recording_invalid_options");
  }
  const chart = structuredClone(runtime.session.chart);
  const tempo = new TempoMap(chart.BPMList);
  const timeline = new RecordingTimeline({
    start: options.start,
    end: options.end,
    fps: options.fps,
    chartOffsetMs: Number(chart.META.offset ?? 0),
    speed: options.speed,
  });
  const preview = runtime.preview;
  const skin = runtime.providers.preview.skin.cloneForRecording();
  const reference: RecordingAppearance = {
    skin,
    noteSize: preview.noteSize,
    hitEffectScale: preview.hitEffectScale,
    lineScale: preview.lineScale,
    backgroundEnabled: preview.backgroundEnabled,
    backgroundAlpha: preview.backgroundAlpha,
    backgroundBrightness: preview.backgroundBrightness,
    backgroundBlur: preview.backgroundBlur,
    defaultLineColor: [...preview.defaultLineColor],
    defaultParticleColor: [...preview.defaultParticleColor],
    highlight: preview.highlight,
    showHitEffects: preview.showHitEffects,
    showGameUI: preview.showGameUI,
    gameUiCornerCompression: preview.gameUiCornerCompression,
  };
  const audioOnly = recordingFormatSpec(options.format ?? "mp4").audioOnly;
  const pending = Promise.allSettled([
    // Audio-only formats never render a frame, so their images are not decoded.
    audioOnly
      ? Promise.resolve(null)
      : snapshotRecordingImages(runtime.providers.preview.images, signal),
    captureRecordingAudio(
      timeline,
      chart,
      tempo,
      music,
      runtime.providers.preview.hitSounds,
      signal,
      options.musicVolume,
      options.effectsVolume,
    ),
  ]).then(([images, audio]) => {
    if (images.status === "rejected") {
      throw images.reason;
    }
    if (audio.status === "rejected") {
      images.value?.dispose();
      throw audio.reason;
    }
    return [images.value, audio.value] as const;
  });
  return { chart, tempo, timeline, reference, skin, music, pending };
}

type RecordingSnapshot = ReturnType<typeof captureRecording>;

/** Encode the captured state without consulting the live editor. */
export async function runRecording(
  snapshot: RecordingSnapshot,
  surface: RecordingSurface,
  options: RecordingJobOptions,
  signal: AbortSignal,
  progress: (stage: RecordingStage, fraction: number | null) => void,
  partialReady: (path: string) => void,
): Promise<void> {
  const { chart, tempo, timeline, reference, music } = snapshot;
  let native: DesktopRecording | null = null;
  let renderer: RecordingRenderer | null = null;
  let encoder: RecordingVideoEncoder | null = null;
  let images: Awaited<ReturnType<typeof snapshotRecordingImages>> | null = null;
  let pendingWrite: Promise<void> | null = null;
  const cancel = () => {
    if (native) {
      void native.cancel().catch(() => {});
    }
  };
  signal.addEventListener("abort", cancel);
  try {
    progress("preparing", 0);
    const audioOnly = recordingFormatSpec(options.format).audioOnly;
    const videoConfig = audioOnly
      ? null
      : await selectRecordingVideoConfig({
          width: options.width,
          height: options.height,
          fps: options.fps,
          bitrateMbps: options.videoBitrate,
          bitrateMode: "variable",
        });
    checkCancelled(signal);
    const captured = await snapshot.pending;
    images = captured[0];
    checkCancelled(signal);
    native = await beginDesktopRecording({
      path: options.path,
      videoInput: videoConfig ? "h264" : "png",
      format: options.format,
      fps: options.fps,
      frameCount: timeline.frameCount,
      speed: options.speed,
      audioSampleCount: recordingSampleCount(timeline),
      videoBitrate: options.videoBitrate,
    });
    checkCancelled(signal);
    if (!audioOnly) {
      if (!images) {
        throw new Error("recording_invalid_options");
      }
      const recordingImages = images;
      const { RecordingRenderer } = await import("./recordingRenderer.ts");
      renderer = new RecordingRenderer({
        surface,
        chart,
        tempo,
        images: recordingImages.images,
        reference,
        width: options.width,
        height: options.height,
        duration: music.duration,
      });
      await renderer.prepare(signal);
      if (videoConfig) {
        encoder = createRecordingVideoEncoder(videoConfig, options.fps, (chunk) =>
          native!.writeFrame(chunk),
        );
      }
    }
    progress("audio", 0);
    let bytes = 0;
    const totalBytes = recordingSampleCount(timeline) * 8;
    for await (const audio of mixRecordingAudio(timeline, captured[1], signal)) {
      for (const chunk of recordingPcmChunks(audio)) {
        checkCancelled(signal);
        await native.writeAudio(chunk);
        bytes += chunk.length;
        progress("audio", bytes / totalBytes);
      }
    }
    checkCancelled(signal);
    await native.start();
    partialReady(native.partialPath);
    if (!audioOnly) {
      if (!images || !renderer) {
        throw new Error("recording_invalid_options");
      }
      const recordingImages = images;
      const recordingRenderer = renderer;
      let reportedFrames = 0;
      const reportFrame = (index: number) => {
        const fraction = (index + 1) / timeline.frameCount;
        if (fraction === 1 || fraction - reportedFrames >= 0.005) {
          reportedFrames = fraction;
          progress("frames", fraction);
        }
      };
      if (encoder) {
        for (let index = 0; index < timeline.frameCount; index++) {
          checkCancelled(signal);
          await yieldToRenderer();
          const time = timeline.frame(index);
          await recordingImages.sample(time.songSeconds, signal);
          checkCancelled(signal);
          await encoder.encode(recordingRenderer.render(time.chartSeconds), index);
          reportFrame(index);
        }
        await encoder.finish();
        encoder = null;
      } else {
        for (let index = 0; index < timeline.frameCount; index++) {
          checkCancelled(signal);
          await yieldToRenderer();
          const time = timeline.frame(index);
          await recordingImages.sample(time.songSeconds, signal);
          checkCancelled(signal);
          const frame = await recordingRenderer.frame(time.chartSeconds);
          checkCancelled(signal);
          // The encoder already has the previous frame while this one renders;
          // only the write itself has to stay ordered on the native stream.
          await pendingWrite;
          pendingWrite = native.writeFrame(frame);
          reportFrame(index);
        }
        await pendingWrite;
      }
    }
    checkCancelled(signal);
    progress("encoding", null);
    await native.finish();
    native = null;
  } finally {
    signal.removeEventListener("abort", cancel);
    await native?.cancel().catch(() => {});
    await pendingWrite?.catch(() => {});
    encoder?.dispose();
    renderer?.dispose();
    images?.dispose();
    snapshot.skin.dispose();
  }
}
