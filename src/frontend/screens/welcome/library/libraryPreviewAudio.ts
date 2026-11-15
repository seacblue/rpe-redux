/**
 * The song-select audio preview for the home library.
 *
 * One player owns two audio elements so a selection change can fade the old
 * track out while the new one fades in. Library assets stream from the local
 * service. Playback failures stay silent: preview is an enhancement, not a gate
 * on opening a chart.
 */
import type { LibraryEntry } from "./libraryEntries.ts";
import { rampGain } from "../../../../core/media/gainRamp.ts";

const FADE_MS = 360;
const PREVIEW_START_SETTLE_MS = 120;
const TARGET_VOLUME = 0.45;

/** The playhead snapshot the welcome detail card paints below its cover. */
export interface LibraryPreviewProgress {
  currentTime: number;
  duration: number;
}

/** Identity of an entry's audio source, empty when it has none. */
function sourceId(entry: LibraryEntry | null): string {
  if (!entry?.audio) {
    return "";
  }
  return `${entry.key}|${entry.audio.url ?? ""}|${entry.audio.name}`;
}

/** Cross-fading preview player with two audio elements. */
export class LibraryPreviewAudio {
  private readonly elements = [new Audio(), new Audio()];
  private active: HTMLAudioElement | null = null;
  private fading: HTMLAudioElement | null = null;
  private starting: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly gains = new Map<HTMLAudioElement, GainNode>();
  private backgroundVolume = 1;
  private musicVolume = 0.75;
  private revision = 0;
  private playingId = "";
  private reported = false;
  private readonly onPlayingChange: (playing: boolean) => void;
  private readonly onProgressChange: (progress: LibraryPreviewProgress) => void;

  /** Prepares both silent elements and binds the failure handler. */
  constructor(
    onPlayingChange: (playing: boolean) => void,
    onProgressChange: (progress: LibraryPreviewProgress) => void = () => undefined,
  ) {
    this.onPlayingChange = onPlayingChange;
    this.onProgressChange = onProgressChange;
    for (const element of this.elements) {
      element.autoplay = false;
      element.loop = true;
      element.preload = "auto";
      element.crossOrigin = "anonymous";
      element.volume = 1;
      element.addEventListener("error", () => {
        if (this.active === element) {
          this.active = null;
          this.stopElement(element);
          this.report(false);
          this.reportProgress(null);
        }
      });
      element.addEventListener("timeupdate", () => this.reportProgress(element));
      element.addEventListener("loadedmetadata", () => this.reportProgress(element));
      element.addEventListener("durationchange", () => this.reportProgress(element));
    }
  }

  /** Starts the entry's track, or fades out when the entry has none. */
  select(entry: LibraryEntry | null): void {
    const id = sourceId(entry);
    if (id === this.playingId) {
      return;
    }
    this.playingId = id;
    const revision = ++this.revision;
    this.stopFade();
    this.stopStarting();
    this.stopScheduledStart();
    this.reportProgress(null);
    if (!entry?.audio) {
      this.fadeOutCurrent();
      return;
    }
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.start(entry, revision);
    }, PREVIEW_START_SETTLE_MS);
  }

  /** Stops every element immediately; the next selection starts a fresh track. */
  suspend(): void {
    this.revision++;
    this.playingId = "";
    this.stopFade();
    this.stopStarting();
    this.stopScheduledStart();
    for (const element of this.elements) {
      this.stopElement(element);
    }
    this.active = null;
    this.report(false);
    this.reportProgress(null);
  }

  /** Stops playback and releases both elements. */
  dispose(): void {
    this.suspend();
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.gains.clear();
  }

  /** Smoothly changes the output multiplier without interrupting the current song. */
  setBackgroundVolume(multiplier: number): void {
    this.backgroundVolume = Math.max(0, Math.min(1, Number.isFinite(multiplier) ? multiplier : 1));
    if (this.context && this.master) {
      rampGain(this.master.gain, this.context.currentTime, this.backgroundVolume);
    }
  }

  /** Applies the music bus volume to the active cross-fade gains. */
  setMusicVolume(value: number): void {
    this.musicVolume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (!this.context) {
      return;
    }
    for (const [element, gain] of this.gains) {
      rampGain(
        gain.gain,
        this.context.currentTime,
        element === this.active ? this.targetVolume() : 0,
      );
    }
  }

  /** Moves the active preview playhead by a signed number of seconds. */
  seekBy(seconds: number): void {
    if (!Number.isFinite(seconds) || !this.active) {
      return;
    }
    const duration = Number.isFinite(this.active.duration) ? Math.max(0, this.active.duration) : 0;
    if (duration <= 0) {
      return;
    }
    this.active.currentTime = Math.max(0, Math.min(duration, this.active.currentTime + seconds));
    this.reportProgress(this.active);
  }

  /** Seeks the active preview to a normalized position on its progress rail. */
  seekTo(ratio: number): void {
    if (!this.active || !Number.isFinite(ratio)) {
      return;
    }
    const duration = Number.isFinite(this.active.duration) ? Math.max(0, this.active.duration) : 0;
    if (duration <= 0) {
      return;
    }
    this.active.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
    this.reportProgress(this.active);
  }

  /** Creates the audio-thread mixer on the first user-initiated playback. */
  private ensureMixer(): AudioContext {
    if (!this.context) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.backgroundVolume;
      master.connect(context.destination);
      for (const element of this.elements) {
        const gain = context.createGain();
        gain.gain.value = 0;
        context.createMediaElementSource(element).connect(gain);
        gain.connect(master);
        this.gains.set(element, gain);
      }
      this.context = context;
      this.master = master;
    }
    return this.context;
  }

  /** Loads and plays the entry's URL on the idle element, unless a newer selection won. */
  private async start(entry: LibraryEntry, revision: number): Promise<void> {
    const url = entry.audio?.url;
    if (!url || revision !== this.revision) {
      if (revision === this.revision) {
        this.fadeOutCurrent();
      }
      return;
    }
    const next = this.active === this.elements[0] ? this.elements[1] : this.elements[0];
    const previous = this.active;
    this.stopElement(next);
    next.src = url;
    next.currentTime = 0;
    this.starting = next;
    try {
      const context = this.ensureMixer();
      const gain = this.gains.get(next);
      if (gain) {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(0, context.currentTime);
      }
      if (context.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
      await next.play();
    } catch {
      if (this.starting === next) {
        this.starting = null;
        this.stopElement(next);
      }
      if (revision === this.revision) {
        this.fadeOutCurrent();
      }
      return;
    }
    if (revision !== this.revision) {
      if (this.starting === next) {
        this.starting = null;
        this.stopElement(next);
      }
      return;
    }
    this.starting = null;
    this.active = next;
    this.report(true);
    this.reportProgress(next);
    this.fade(previous, next);
  }

  /** Cross-fades from the previous element to the new one over one animation. */
  private fade(previous: HTMLAudioElement | null, next: HTMLAudioElement): void {
    const context = this.context;
    const nextGain = this.gains.get(next);
    if (!context || !nextGain) {
      return;
    }
    this.fading = previous;
    rampGain(nextGain.gain, context.currentTime, this.targetVolume(), FADE_MS / 1000);
    const previousGain = previous && this.gains.get(previous);
    if (previousGain) {
      rampGain(previousGain.gain, context.currentTime, 0, FADE_MS / 1000);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fading = null;
      if (previous) {
        this.stopElement(previous);
      }
    }, FADE_MS);
  }

  /** Fades the active element out and releases it. */
  private fadeOutCurrent(): void {
    const active = this.active;
    this.active = null;
    if (!active) {
      this.report(false);
      return;
    }
    this.fading = active;
    const gain = this.gains.get(active);
    if (this.context && gain) {
      rampGain(gain.gain, this.context.currentTime, 0, FADE_MS / 1000);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fading = null;
      this.stopElement(active);
      this.report(false);
    }, FADE_MS);
  }

  /** Cancels the running fade animation and releases the fading element. */
  private stopFade(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.fading) {
      this.stopElement(this.fading);
      this.fading = null;
    }
  }

  /** Releases the element that has not started playing yet. */
  private stopStarting(): void {
    if (this.starting) {
      this.stopElement(this.starting);
      this.starting = null;
    }
  }

  /** Cancels a preview start that was superseded during keyboard navigation. */
  private stopScheduledStart(): void {
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  /** Pauses an element and drops its source so the next load starts clean. */
  private stopElement(element: HTMLAudioElement): void {
    element.pause();
    element.removeAttribute("src");
    element.load();
  }

  /** The music level applied to the active cross-fade gain. */
  private targetVolume(): number {
    return TARGET_VOLUME * this.musicVolume;
  }

  /** Notifies the owner only when the playing state actually flips. */
  private report(playing: boolean): void {
    if (this.reported === playing) {
      return;
    }
    this.reported = playing;
    this.onPlayingChange(playing);
  }

  /** Publishes a finite, clamped playhead snapshot for the detail card. */
  private reportProgress(element: HTMLAudioElement | null): void {
    if (!element) {
      this.onProgressChange({ currentTime: 0, duration: 0 });
      return;
    }
    const duration = Number.isFinite(element.duration) ? Math.max(0, element.duration) : 0;
    const currentTime = Number.isFinite(element.currentTime)
      ? Math.max(0, Math.min(duration || element.currentTime, element.currentTime))
      : 0;
    this.onProgressChange({ currentTime, duration });
  }
}
