/**
 * Loading, decoding and playing one piece of music, plus the analyser data the
 * editor draws.
 *
 * The domain here is timing: a load is revocable (a later `load` cancels an
 * earlier one), a play attempt is tied to the revision it started in, and the
 * decoded buffer is what the waveform and the hit sounds read. The host parts —
 * the media element, blob URLs — come from `core/platform/browser/mediaHost.ts`,
 * so this file names no browser constructor itself.
 */
import { clamp01 } from "../utils/numbers.ts";
import { t } from "../../i18n/index.ts";
import { mediaType } from "./mime.ts";
import { TimeStretchStretcher } from "./timeStretch.ts";
import { rampGain } from "./gainRamp.ts";
import { toArrayBuffer, toBlobPart } from "../utils/bytes.ts";
import {
  createAudioElement,
  hasAudioElement,
  objectUrlFor,
  releaseObjectUrl,
} from "../platform/browser/mediaHost.ts";

/** Everything `load`/`decodeForAnalysis` accept as an audio source. */
export type AudioSource = string | ArrayBuffer | ArrayBufferView;

/** A media element seek/play attempt that can be cancelled by a later revision. */
interface MediaStart {
  media: HTMLAudioElement;
  revision: number;
  cancel?: (() => void) | null;
}

/**
 * How the transport handles pitch while the rate changes.
 *
 * A decoded buffer uses the worklet whenever pitch should be preserved. The
 * worklet copies the samples directly at 1× and stretches them at other rates,
 * so a rate change keeps the same clock and crossfade path.
 * `resample` instead lets pitch follow speed through the buffer source. The media
 * element is the fallback for formats the decoder cannot handle, where `auto`
 * uses the platform time-stretcher only when the WebView exposes the pitch flag.
 */
export type AudioPitchStrategy = "auto" | "preserve" | "resample";

/** A view over the same bytes, whatever form the caller passed them in. */
function asBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

/** Write the standard pitch flag and its vendor-prefixed aliases. */
function writePreservesPitch(media: HTMLAudioElement, value: boolean): void {
  media.preservesPitch = value;
  const legacy = media as HTMLAudioElement & {
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  legacy.webkitPreservesPitch = value;
  legacy.mozPreservesPitch = value;
}

/** Whether the media element exposes a pitch-preservation flag at all. */
function supportsPitchPreservation(media: HTMLAudioElement): boolean {
  return "preservesPitch" in media || "webkitPreservesPitch" in media;
}

/**
 * Decoded audio plus the transport clock for one song.
 *
 * Loads are revisioned so a later load or clear cancels an earlier one. A decoded
 * buffer owns playback at any rate, using the worklet or a buffer source. The
 * media element is the fallback for formats the decoder cannot handle.
 */
export class AudioTransport {
  contextFactory: () => AudioContext;
  context: AudioContext | null;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  playing: boolean;
  position: number;
  rate: number;
  volume: number;
  anchor: number;
  loadRevision: number;
  playRevision: number;
  preservePitch: boolean;
  pitchStrategy: AudioPitchStrategy;
  media: HTMLAudioElement | null;
  mediaStart: MediaStart | null;
  gain: GainNode | null;
  backgroundGain: GainNode | null;
  private backgroundVolume = 1;
  mediaSource: MediaElementAudioSourceNode | null;
  mediaUrl: string | null;
  private ownsMediaUrl = false;
  cancelLoad: (() => void) | null;
  lastError: unknown;
  /** Reports a worklet failure once so the UI can explain the resample fallback. */
  onError?: (error: unknown) => void;
  private stretcher: TimeStretchStretcher | null;
  private stretcherFailureReported: boolean;
  /** The source whose decoded samples are in `buffer`, for analysis reuse. */
  private loadedSource: AudioSource | null;

  /** Create an idle transport; the context factory is called on first use. */
  constructor(contextFactory: () => AudioContext = () => new AudioContext()) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.position = 0;
    this.rate = 1;
    this.volume = 0.75;
    this.anchor = 0;
    this.loadRevision = 0;
    this.playRevision = 0;
    this.preservePitch = true;
    this.pitchStrategy = "auto";
    this.media = null;
    this.mediaStart = null;
    this.gain = null;
    this.backgroundGain = null;
    this.mediaSource = null;
    this.mediaUrl = null;
    this.cancelLoad = null;
    this.lastError = null;
    this.stretcher = null;
    this.stretcherFailureReported = false;
    this.loadedSource = null;
  }

  /** Stop playback, release media and assets, and close the audio context. */
  dispose(): Promise<void> | undefined {
    this.clear();
    this.gain?.disconnect();
    this.backgroundGain?.disconnect();
    this.mediaSource?.disconnect();
    this.mediaSource = null;
    this.media = null;
    const context = this.context;
    this.context = null;
    this.gain = null;
    this.backgroundGain = null;
    return context?.close?.();
  }
  /** Decode a source for analysis, reusing the loaded buffer when it matches. */
  async decodeForAnalysis(bytes: AudioSource): Promise<AudioBuffer | null> {
    const revision = this.loadRevision;
    // The editor analyses the song it just loaded. Returning that buffer avoids
    // a second full decode and a second copy of the song in memory.
    if (this.buffer && this.loadedSource === bytes) {
      return this.buffer;
    }
    const buffer = await this.ensureContext().decodeAudioData(await this.readSource(bytes));
    return revision === this.loadRevision ? buffer : null;
  }
  /** Create the audio context and master gain on first use, then reuse them. */
  ensureContext(): AudioContext {
    if (!this.context) {
      this.context = this.contextFactory();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.backgroundGain = this.context.createGain();
      this.backgroundGain.gain.value = this.backgroundVolume;
      this.gain.connect(this.backgroundGain);
      this.backgroundGain.connect(this.context.destination);
    }
    return this.context;
  }

  /** A fresh ArrayBuffer for decode calls; the caller's bytes are never detached. */
  private async readSource(bytes: AudioSource): Promise<ArrayBuffer> {
    if (typeof bytes === "string") {
      return (await fetch(bytes)).arrayBuffer();
    }
    if (ArrayBuffer.isView(bytes)) {
      return toArrayBuffer(asBytes(bytes));
    }
    return bytes.slice(0);
  }

  /**
   * Load and decode a song, cancelling any earlier load.
   *
   * Returns false when a newer load or clear superseded this one.
   */
  async load(bytes: AudioSource, name = "music.mp3"): Promise<boolean> {
    this.cancelLoad?.();
    const revision = ++this.loadRevision;
    this.pause();
    this.releaseMedia();
    this.disposeStretcher();
    this.buffer = null;
    this.loadedSource = null;
    const context = this.ensureContext();
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await this.readSource(bytes));
    } catch (error) {
      if (revision !== this.loadRevision) {
        return false;
      }
      if (hasAudioElement()) {
        return this.loadMedia(bytes, name, revision, context);
      }
      throw error;
    }
    if (revision !== this.loadRevision) {
      return false;
    }
    this.buffer = decoded;
    this.loadedSource = bytes;
    this.position = 0;
    this.applyPitchStrategy();
    await this.prepareStretcher(decoded, revision);
    return revision === this.loadRevision;
  }

  /** Open a media element only when Web Audio decoding fails. */
  private async loadMedia(
    bytes: AudioSource,
    name: string,
    revision: number,
    context: AudioContext,
  ): Promise<boolean> {
    const media = this.media ?? createAudioElement();
    if (!this.media) {
      media.preload = "auto";
      // Web Audio needs CORS enabled before assigning a desktop asset URL.
      media.crossOrigin = "anonymous";
      this.media = media;
    }
    const ownsUrl = typeof bytes !== "string";
    const url =
      typeof bytes === "string"
        ? bytes
        : objectUrlFor(new Blob([toBlobPart(asBytes(bytes))], { type: mediaType(name) }));
    try {
      await this.waitForMetadata(media, url, name);
      if (revision !== this.loadRevision) {
        return false;
      }
      this.mediaSource ??= context.createMediaElementSource(media);
      if (this.gain) {
        this.mediaSource.connect(this.gain);
      }
      this.applyPitchStrategy(media);
      media.playbackRate = this.rate;
      this.mediaUrl = url;
      this.ownsMediaUrl = ownsUrl;
      this.position = 0;
      return true;
    } catch (error) {
      if (revision !== this.loadRevision) {
        return false;
      }
      this.releaseMedia();
      throw error;
    } finally {
      if (ownsUrl && this.mediaUrl !== url) {
        releaseObjectUrl(url);
      }
    }
  }

  /** Load one URL into the shared element and wait for its metadata. */
  private waitForMetadata(media: HTMLAudioElement, url: string, name: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let onLoadedMetadata: (() => void) | null = null;
      let onError: (() => void) | null = null;
      const finish = (error?: unknown) => {
        clearTimeout(timeout);
        if (media.onloadedmetadata === onLoadedMetadata) {
          media.onloadedmetadata = null;
        }
        if (media.onerror === onError) {
          media.onerror = null;
        }
        if (this.cancelLoad === cancel) {
          this.cancelLoad = null;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const cancel = () =>
        finish(Object.assign(new Error(t("system.audio.loadCancelled")), { name: "AbortError" }));
      this.cancelLoad = cancel;
      const timeout = setTimeout(
        () => finish(new Error(t("system.audio.readTimeout", { name }))),
        15000,
      );
      onLoadedMetadata = () => finish();
      onError = () => finish(new Error(t("system.audio.decodeFailed", { name })));
      media.onloadedmetadata = onLoadedMetadata;
      media.onerror = onError;
      media.src = url;
    });
  }

  /** Pause the shared element and release its current object URL. */
  releaseMedia(): void {
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute("src");
      this.media.load();
      this.mediaSource?.disconnect();
      if (this.ownsMediaUrl && this.mediaUrl) {
        releaseObjectUrl(this.mediaUrl);
      }
    }
    this.mediaUrl = null;
    this.ownsMediaUrl = false;
  }
  /** Cancel the current load, stop playback, and drop decoded state. */
  clear(): void {
    this.loadRevision++;
    this.cancelLoad?.();
    this.pause();
    this.disposeStretcher();
    this.releaseMedia();
    this.buffer = null;
    this.loadedSource = null;
    this.position = 0;
  }
  /** Song duration in seconds, falling back to the media element or 600. */
  get duration(): number {
    return this.buffer?.duration || this.media?.duration || 600;
  }
  /** Whether decoded playback uses the pitch-preserving worklet. */
  get usesStretcher(): boolean {
    return Boolean(this.stretcher && this.buffer && this.preservePitch);
  }

  /**
   * Output latency of the current audio context in seconds.
   *
   * The context clock runs ahead of what the speakers have emitted. Visuals use
   * this value; hit-sound scheduling keeps the raw processing clock so audio
   * events stay aligned with the music graph.
   */
  get outputLatency(): number {
    const context = this.context;
    if (!context) {
      return 0;
    }
    const value = Number(context.outputLatency ?? context.baseLatency ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, 0.1)) : 0;
  }

  /** The audio graph's processing clock, used when scheduling more audio. */
  get audioTime(): number {
    if (!this.playing) {
      return this.position;
    }
    if (this.usesStretcher) {
      const context = this.context;
      return context
        ? this.position + Math.max(0, context.currentTime - this.anchor) * this.rate
        : this.position;
    }
    const media = this.media;
    if (this.usesMedia && this.position >= 0 && media) {
      return this.mediaStart || media.seeking ? this.position : media.currentTime;
    }
    const context = this.context;
    return context
      ? this.position + Math.max(0, context.currentTime - this.anchor) * this.rate
      : this.position;
  }
  /** Whether the media element is the fallback clock because decoding failed. */
  get usesMedia(): boolean {
    return Boolean(this.media && this.mediaUrl && !this.buffer);
  }
  /** Whether the clock source has advanced enough to report playback time. */
  get clockReady(): boolean {
    if (!this.playing) {
      return false;
    }
    if (this.usesStretcher) {
      return Boolean(this.context && this.context.currentTime + 0.005 >= this.anchor);
    }
    if (!this.usesMedia || this.position < 0) {
      return true;
    }
    const media = this.media;
    if (!media || this.mediaStart) {
      return false;
    }
    return !media.seeking && media.paused !== true && media.readyState >= 2;
  }
  /** How far ahead callers may schedule when the media clock is not ready. */
  get scheduleHorizon(): number {
    return this.usesMedia && this.position < 0 ? 0 : Infinity;
  }
  /**
   * Current audible position in seconds for the picture and the playhead.
   *
   * Web Audio's `currentTime` is the processing clock, which is ahead of the
   * speakers by `outputLatency`. Reporting the audible time keeps the preview
   * and the timeline from leading the music; `audioTime` remains the clock for
   * scheduling additional audio.
   */
  get time(): number {
    if (!this.playing) {
      return this.position;
    }
    if (this.usesStretcher) {
      const context = this.context;
      return context
        ? this.position +
            Math.max(0, context.currentTime - this.anchor - this.outputLatency) * this.rate
        : this.position;
    }
    const media = this.media;
    if (this.usesMedia && this.position >= 0 && media) {
      return this.mediaStart || media.seeking ? this.position : media.currentTime;
    }
    const context = this.context;
    return context
      ? this.position +
          Math.max(0, context.currentTime - this.anchor - this.outputLatency) * this.rate
      : this.position;
  }

  /** Start or resume the fallback media element at the current position. */
  async startMedia(): Promise<void> {
    const media = this.media;
    if (!media) {
      return;
    }
    const revision = this.playRevision;
    const start: MediaStart = { media, revision };
    this.mediaStart = start;
    try {
      if (media.seeking) {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            media.removeEventListener("seeked", seeked);
            media.removeEventListener("error", failed);
            start.cancel = null;
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          };
          const seeked = () => {
            if (!media.seeking) {
              finish();
            }
          };
          const failed = () => finish(new Error(t("system.audio.seekFailed")));
          start.cancel = () => finish();
          media.addEventListener("seeked", seeked);
          media.addEventListener("error", failed);
          seeked();
        });
      }
      if (revision !== this.playRevision || media !== this.media || !this.playing) {
        return;
      }
      this.applyPitchStrategy();
      await media.play();
      if (
        this.mediaStart === start &&
        revision === this.playRevision &&
        media === this.media &&
        this.playing
      ) {
        this.mediaStart = null;
      }
      if (revision !== this.playRevision && (!this.playing || media !== this.media)) {
        media.pause();
      }
    } catch (error) {
      if (revision === this.playRevision && media === this.media) {
        this.pause();
        if (!(error instanceof Error) || error.name !== "AbortError") {
          throw error;
        }
      }
    }
  }

  /** Resume the audio context and start playback from the current position. */
  async play(): Promise<void> {
    if (this.playing) {
      return;
    }
    const revision = ++this.playRevision;
    await this.ensureContext().resume();
    if (revision !== this.playRevision || this.playing) {
      return;
    }
    if (this.position >= this.duration) {
      this.position = 0;
    }
    this.anchor = this.ensureContext().currentTime;
    this.playing = true;
    this.startSource();
    if (this.usesMedia && this.position >= 0) {
      await this.startMedia();
    }
  }

  /** Start the buffer, stretcher, or media element from the current position. */
  startSource(): void {
    if (this.usesStretcher) {
      this.startStretcher();
      return;
    }
    if (this.usesMedia) {
      const target = Math.max(0, this.position);
      const media = this.media;
      if (media && Math.abs(media.currentTime - target) > 1e-7) {
        media.currentTime = target;
      }
      return;
    }
    const context = this.context;
    if (!context || !this.buffer || this.position >= this.duration) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    const gain = this.gain;
    if (gain) {
      source.connect(gain);
    }
    source.start(
      context.currentTime + Math.max(0, -this.position) / this.rate,
      Math.max(0, this.position),
    );
    this.source = source;
  }

  /** Start the stretcher and adopt its anchor as the transport clock. */
  private startStretcher(): void {
    const stretcher = this.stretcher;
    if (!stretcher || this.position >= this.duration) {
      return;
    }
    this.anchor = stretcher.start(this.position, this.rate);
  }

  /** Decode the song once for the worklet; a failure falls back to resampling. */
  private async prepareStretcher(buffer: AudioBuffer, revision: number): Promise<void> {
    const context = this.context;
    const gain = this.gain;
    if (!context || !gain) {
      return;
    }
    try {
      const stretcher = await TimeStretchStretcher.create(context, buffer, gain);
      if (revision !== this.loadRevision) {
        stretcher.dispose();
        return;
      }
      this.disposeStretcher();
      this.stretcher = stretcher;
    } catch (error) {
      if (revision !== this.loadRevision) {
        return;
      }
      this.lastError = error;
      this.stretcher = null;
      if (!this.stretcherFailureReported) {
        this.stretcherFailureReported = true;
        this.onError?.(error);
      }
    }
  }

  /** Release the stretcher worklet and drop its reference. */
  private disposeStretcher(): void {
    this.stretcher?.dispose();
    this.stretcher = null;
  }

  /** Advance the transport across a negative media position after a seek. */
  update(): void {
    if (!this.playing || !this.usesMedia || this.position >= 0 || this.time < 0) {
      return;
    }
    this.position = this.time;
    this.anchor = this.ensureContext().currentTime;
    this.playRevision++;
    this.startSource();
    this.startMedia().catch((error: unknown) => {
      this.lastError = error;
    });
  }

  /** Stop every clock source and freeze the current position. */
  pause(): void {
    this.playRevision++;
    const position = this.time;
    const media = this.media;
    const usePausedMediaTime =
      this.playing && this.usesMedia && this.position >= 0 && !this.mediaStart && !media?.seeking;
    this.stopSource();
    this.position = Math.min(
      usePausedMediaTime && media ? media.currentTime : position,
      this.duration,
    );
    this.playing = false;
  }

  /**
   * Stop the media element, stretcher, and buffer source without moving the
   * position. A restart keeps the stretcher running so the next start can
   * crossfade from it instead of fading to silence first.
   */
  stopSource(fadeStretcher = true): void {
    this.mediaStart?.cancel?.();
    this.mediaStart = null;
    this.media?.pause();
    if (fadeStretcher) {
      this.stretcher?.stop();
    }
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  /**
   * Move the transport to a position in seconds.
   *
   * A paused seek may exceed the song duration so the preview can follow chart
   * content past the audio; playing seeks are clamped to the duration.
   */
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) {
      throw new Error(t("system.audio.invalidPosition"));
    }
    this.playRevision++;
    const restart = this.playing && seconds < this.duration && this.usesStretcher;
    this.stopSource(!restart);
    // A chart may keep notes and events past the audio's end. A paused seek
    // therefore keeps the requested chart position so the preview can follow it;
    // playback itself remains bounded by the media duration.
    this.position = this.playing ? Math.min(seconds, this.duration) : seconds;
    if (this.position >= this.duration) {
      this.playing = false;
      if (restart) {
        this.stretcher?.stop();
      }
    }
    const media = this.media;
    if (this.playing) {
      this.anchor = this.ensureContext().currentTime;
      this.startSource();
      if (this.usesMedia && this.position >= 0) {
        this.startMedia().catch((error: unknown) => {
          this.lastError = error;
        });
      }
    } else if (this.usesMedia && media) {
      const target = Math.max(0, this.position);
      if (Math.abs(media.currentTime - target) > 1e-7) {
        media.currentTime = target;
      }
    }
  }

  /** Resolve the pitch strategy for decoded or fallback playback. */
  private applyPitchStrategy(media = this.usesMedia ? this.media : null): void {
    const supported = media ? supportsPitchPreservation(media) : true;
    const preserve =
      this.pitchStrategy !== "resample" && (this.pitchStrategy === "preserve" || supported);
    this.preservePitch = preserve;
    if (media) {
      writePreservesPitch(media, preserve);
    }
  }

  /** Change playback rate, preserving position and the active clock path. */
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(t("system.audio.invalidRate"));
    }
    if (rate === this.rate) {
      return;
    }
    const position = this.time;
    const wasMedia = this.usesMedia;
    const wasStretcher = this.usesStretcher;
    this.rate = rate;
    this.applyPitchStrategy();
    const media = wasMedia ? this.media : null;
    if (media) {
      media.playbackRate = rate;
    }
    if (wasStretcher || this.usesStretcher || !(wasMedia && this.usesMedia)) {
      this.seek(position);
    } else if (media) {
      this.position = position;
      this.anchor = this.context?.currentTime ?? 0;
      if (!this.mediaStart) {
        this.playRevision++;
      }
    }
  }

  /** Set master volume, clamped to `[0, 1]`. */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) {
      throw new Error(t("system.audio.invalidVolume"));
    }
    this.volume = clamp01(volume);
    if (this.gain) {
      this.gain.gain.value = this.volume;
    }
  }

  /** Cross-fades all editor audio to a foreground or background multiplier. */
  setBackgroundVolume(multiplier: number): void {
    this.backgroundVolume = clamp01(Number.isFinite(multiplier) ? multiplier : 1);
    if (this.context && this.backgroundGain) {
      rampGain(this.backgroundGain.gain, this.context.currentTime, this.backgroundVolume);
    }
  }

  /** Change pitch policy, re-seeking only when the clock path changes. */
  setPitchStrategy(strategy: AudioPitchStrategy): void {
    const position = this.time;
    const wasMedia = this.usesMedia;
    const wasStretcher = this.usesStretcher;
    this.pitchStrategy = strategy;
    this.applyPitchStrategy();
    if (wasMedia !== this.usesMedia || wasStretcher !== this.usesStretcher) {
      this.seek(position);
    }
  }

  /** Set the pitch policy from a boolean: true preserves pitch, false resamples. */
  setPreservePitch(enabled: boolean): void {
    this.setPitchStrategy(enabled ? "preserve" : "resample");
  }
}
