/**
 * Provides one controller over the audio settings already used by
 * playback. It never invents another gain graph: music writes `volume`, while
 * each hitsound meter writes the existing per-kind hitsound setting.
 */
import "../settings/features/audio.ts";
import { HIT_SOUND_KINDS } from "./hitsounds.ts";
import { values } from "../state/values.ts";
import { clamp01 } from "../utils/numbers.ts";

/** The existing playback values exposed by the audio settings controller. */
export const AUDIO_VOLUME_METERS = ["music", "tap", "drag", "flick", "custom"] as const;
/** One existing music or object-hitsound setting. */
export type AudioVolumeMeter = (typeof AUDIO_VOLUME_METERS)[number];

/** A mounted player that needs the shared music setting applied immediately. */
export interface AudioMixerOwner {
  setMusicVolume?(value: number): void;
}

/** The state consumed by the sidebar volume console. */
export interface AudioMixerSnapshot {
  readonly values: Readonly<Record<AudioVolumeMeter, number>>;
}

const SETTING_IDS: Record<AudioVolumeMeter, string> = {
  music: "volume",
  tap: "hitsound-tap",
  drag: "hitsound-drag",
  flick: "hitsound-flick",
  custom: "hitsound-custom",
};
const DEFAULTS: Record<AudioVolumeMeter, number> = {
  music: 0.75,
  tap: 0.3,
  drag: 0.3,
  flick: 0.3,
  custom: 0.3,
};
/** A controller that fans the existing settings into mounted players and UI. */
class AudioMixController {
  private readonly owners = new Set<AudioMixerOwner>();
  private readonly listeners = new Set<() => void>();
  private readonly settingDisposers: (() => void)[] = [];
  private cachedSnapshot: AudioMixerSnapshot | null = null;

  constructor() {
    for (const meter of AUDIO_VOLUME_METERS) {
      const id = SETTING_IDS[meter];
      if (values.byId.has(id)) {
        this.settingDisposers.push(values.byId.subscribe(id, () => this.refreshOwners()));
      }
    }
    // Keep the public tuple aligned with the setting schema if a new kind is added.
    for (const kind of HIT_SOUND_KINDS) {
      if (!AUDIO_VOLUME_METERS.includes(kind)) {
        throw new Error(`Missing audio volume meter for hitsound kind: ${kind}`);
      }
    }
  }

  /** Read the current snapshot for React or a server render. */
  snapshot = (): AudioMixerSnapshot => {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }
    const current = Object.fromEntries(
      AUDIO_VOLUME_METERS.map((meter) => [meter, this.read(meter)]),
    ) as Record<AudioVolumeMeter, number>;
    this.cachedSnapshot = Object.freeze({
      values: Object.freeze(current),
    });
    return this.cachedSnapshot;
  };

  /** Subscribe to existing setting changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Register a mounted music player and immediately apply the current setting. */
  registerOwner(owner: AudioMixerOwner): () => void {
    this.owners.add(owner);
    this.applyOwner(owner);
    return () => this.owners.delete(owner);
  }

  /** Set one existing playback setting from the sidebar volume console. */
  set(meter: AudioVolumeMeter, value: number): void {
    const id = SETTING_IDS[meter];
    if (!values.byId.has(id)) {
      return;
    }
    values.byId.set(id, String(clamp01(Number.isFinite(value) ? value : 0)));
  }

  /** Set every existing hit-sound channel from the sidebar effects control. */
  setEffects(value: number): void {
    const next = clamp01(Number.isFinite(value) ? value : 0);
    for (const kind of HIT_SOUND_KINDS) {
      this.set(kind, next);
    }
  }

  /** Release subscriptions when the application host is torn down. */
  dispose(): void {
    for (const dispose of this.settingDisposers.splice(0)) {
      dispose();
    }
    this.owners.clear();
    this.listeners.clear();
  }

  private read(meter: AudioVolumeMeter): number {
    const id = SETTING_IDS[meter];
    const value = values.byId.has(id) ? Number(values.byId.get<unknown>(id)) : DEFAULTS[meter];
    return clamp01(Number.isFinite(value) ? value : DEFAULTS[meter]);
  }

  private applyOwner(owner: AudioMixerOwner): void {
    owner.setMusicVolume?.(this.read("music"));
  }

  private refreshOwners(): void {
    for (const owner of this.owners) {
      this.applyOwner(owner);
    }
    this.notify();
  }

  private notify(): void {
    this.cachedSnapshot = null;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** The single controller shared by the sidebar console and playback surfaces. */
export const audioMixer = new AudioMixController();
