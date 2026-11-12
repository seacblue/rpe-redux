/**
 * Provides one transient controller over the audio settings already used by
 * playback. It never invents another gain graph: music writes `volume`, while
 * each hitsound meter writes the existing per-kind hitsound setting.
 */
import "../settings/features/audio.ts";
import { HIT_SOUND_KINDS } from "./hitsounds.ts";
import { values } from "../state/values.ts";
import { clamp01 } from "../utils/numbers.ts";

/** The existing playback values exposed by the transient audio controller. */
export const AUDIO_VOLUME_METERS = ["music", "tap", "drag", "flick", "custom"] as const;
/** One existing music or object-hitsound setting. */
export type AudioVolumeMeter = (typeof AUDIO_VOLUME_METERS)[number];

/** A mounted player that needs the shared music setting applied immediately. */
export interface AudioMixerOwner {
  setMusicVolume?(value: number): void;
}

/** The state consumed by the React overlay. */
export interface AudioMixerSnapshot {
  readonly visible: boolean;
  readonly selected: AudioVolumeMeter;
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
const METER_STEP = 0.05;
const PRECISE_METER_STEP = 0.01;
const HIDE_DELAY_MS = 1000;

/** A transient controller that fans the existing settings into mounted players. */
class AudioMixController {
  private readonly owners = new Set<AudioMixerOwner>();
  private readonly listeners = new Set<() => void>();
  private readonly settingDisposers: (() => void)[] = [];
  private visible = false;
  private selected: AudioVolumeMeter = "music";
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
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
      visible: this.visible,
      selected: this.selected,
      values: Object.freeze(current),
    });
    return this.cachedSnapshot;
  };

  /** Subscribe to visibility, selection, and existing setting changes. */
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

  /** Move the visible meter selection without changing any setting. */
  select(direction: -1 | 1): void {
    if (!this.visible) {
      return;
    }
    const index = AUDIO_VOLUME_METERS.indexOf(this.selected);
    this.selected =
      AUDIO_VOLUME_METERS[
        (index + direction + AUDIO_VOLUME_METERS.length) % AUDIO_VOLUME_METERS.length
      ];
    this.notify();
  }

  /** Select one existing setting from a pointer gesture without showing the HUD. */
  selectMeter(meter: AudioVolumeMeter): void {
    this.selected = meter;
    this.notify();
  }

  /** Increase or decrease the selected existing setting; the first press reveals the HUD. */
  adjustSelected(direction: -1 | 1, precise = false): void {
    if (!this.visible) {
      this.show();
      return;
    }
    this.adjust(this.selected, direction, precise);
  }

  /** Apply a wheel delta to one existing setting and keep the HUD alive briefly. */
  adjust(meter: AudioVolumeMeter, direction: -1 | 1, precise = false): void {
    this.selected = meter;
    const step = precise ? PRECISE_METER_STEP : METER_STEP;
    this.set(meter, this.read(meter) + direction * step);
  }

  /** Set one existing playback setting from a pointer position in the HUD. */
  set(meter: AudioVolumeMeter, value: number): void {
    const id = SETTING_IDS[meter];
    if (!values.byId.has(id)) {
      return;
    }
    values.byId.set(id, String(clamp01(Number.isFinite(value) ? value : 0)));
    this.show();
  }

  /** Explicitly reveal the HUD and restart its one-second hide timer. */
  show(): void {
    this.visible = true;
    this.scheduleHide();
    this.notify();
  }

  /** Release subscriptions when the application host is torn down. */
  dispose(): void {
    this.cancelHide();
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

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.visible = false;
      this.notify();
    }, HIDE_DELAY_MS);
  }
}

/** The single transient controller shared by editor and library playback. */
export const audioMixer = new AudioMixController();
