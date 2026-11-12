/**
 * Owns the application's four user-facing audio buses and applies them to the
 * currently mounted audio owners. The overlay and shortcut layer only talk to
 * this module; individual screens never need to know which player is active.
 */
import "../settings/features/audio.ts";
import { PREFERENCE_SECTIONS } from "../state/preferences.ts";
import { defineValue, values, type ValueHandle } from "../state/values.ts";
import { clamp01 } from "../utils/numbers.ts";

/** The volume meters exposed by the osu!lazer-style overlay. */
export const AUDIO_VOLUME_METERS = ["master", "music", "effect", "hitsound"] as const;
/** One user-facing audio meter. */
export type AudioVolumeMeter = (typeof AUDIO_VOLUME_METERS)[number];

/** A runtime audio player that can receive the global mix. */
export interface AudioMixerOwner {
  setMasterVolume?(value: number): void;
  setMusicVolume?(value: number): void;
  setEffectVolume?(value: number): void;
  setHitsoundVolume?(value: number): void;
}

/** The state consumed by the React overlay. */
export interface AudioMixerSnapshot {
  readonly visible: boolean;
  readonly selected: AudioVolumeMeter;
  readonly muted: boolean;
  readonly values: Readonly<Record<AudioVolumeMeter, number>>;
}

const DEFAULTS: Record<AudioVolumeMeter, number> = {
  master: 1,
  music: 0.75,
  effect: 1,
  hitsound: 1,
};
type PersistedBus = Exclude<AudioVolumeMeter, "music">;
const PERSISTED_BUS_VALUES: Record<PersistedBus, ValueHandle<number>> = {
  master: defineValue({
    id: "audio.mixer.master",
    initial: DEFAULTS.master,
    persist: PREFERENCE_SECTIONS.values,
  }),
  effect: defineValue({
    id: "audio.mixer.effect",
    initial: DEFAULTS.effect,
    persist: PREFERENCE_SECTIONS.values,
  }),
  hitsound: defineValue({
    id: "audio.mixer.hitsound",
    initial: DEFAULTS.hitsound,
    persist: PREFERENCE_SECTIONS.values,
  }),
};
const METER_STEP = 0.05;
const PRECISE_METER_STEP = 0.01;
const HIDE_DELAY_MS = 1000;

/** A single shared application mixer with persistence and owner fan-out. */
class AudioMixController {
  private readonly owners = new Set<AudioMixerOwner>();
  private readonly listeners = new Set<() => void>();
  private readonly settingDisposers: (() => void)[] = [];
  private visible = false;
  private selected: AudioVolumeMeter = "master";
  private lastUnmutedMaster = DEFAULTS.master;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedSnapshot: AudioMixerSnapshot | null = null;

  constructor() {
    if (values.byId.has("volume")) {
      this.settingDisposers.push(values.byId.subscribe("volume", () => this.refreshOwners()));
    }
    for (const value of Object.values(PERSISTED_BUS_VALUES)) {
      this.settingDisposers.push(value.subscribe(() => this.refreshOwners()));
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
      muted: current.master <= 0,
      values: Object.freeze(current),
    });
    return this.cachedSnapshot;
  };

  /** Subscribe to visibility, selection, and persisted meter changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Register a music or effect player and immediately apply the live mix. */
  registerOwner(owner: AudioMixerOwner): () => void {
    this.owners.add(owner);
    this.applyOwner(owner);
    return () => this.owners.delete(owner);
  }

  /** Move the visible meter selection, matching osu!lazer's wraparound behavior. */
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

  /** Select one meter from a pointer gesture without changing visibility. */
  selectMeter(meter: AudioVolumeMeter): void {
    this.selected = meter;
    this.notify();
  }

  /** Increase or decrease the selected meter; the first press only reveals it. */
  adjustSelected(direction: -1 | 1, precise = false): void {
    if (!this.visible) {
      this.show();
      return;
    }
    this.adjust(this.selected, direction, precise);
  }

  /** Apply a wheel delta to one meter and keep the overlay alive. */
  adjust(meter: AudioVolumeMeter, direction: -1 | 1, precise = false): void {
    this.selected = meter;
    const step = precise ? PRECISE_METER_STEP : METER_STEP;
    this.set(meter, this.read(meter) + direction * step);
    this.show();
  }

  /** Set a meter from a pointer position in the overlay. */
  set(meter: AudioVolumeMeter, value: number): void {
    const next = clamp01(Number.isFinite(value) ? value : 0);
    if (meter === "music") {
      values.byId.set("volume", String(next));
    } else {
      PERSISTED_BUS_VALUES[meter].set(next);
    }
    if (meter === "master" && next > 0) {
      this.lastUnmutedMaster = next;
    }
    this.show();
  }

  /** Toggle master mute while remembering the previous non-zero level. */
  toggleMute(): void {
    const current = this.read("master");
    if (current > 0) {
      this.lastUnmutedMaster = current;
      this.set("master", 0);
    } else {
      this.set("master", this.lastUnmutedMaster || DEFAULTS.master);
    }
    this.show();
  }

  /** Explicitly reveal the overlay and restart its one-second popout timer. */
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
    const value =
      meter === "music"
        ? Number(values.byId.get<unknown>("volume"))
        : PERSISTED_BUS_VALUES[meter].get();
    return clamp01(Number.isFinite(value) ? value : DEFAULTS[meter]);
  }

  private applyOwner(owner: AudioMixerOwner): void {
    owner.setMasterVolume?.(this.read("master"));
    owner.setMusicVolume?.(this.read("music"));
    owner.setEffectVolume?.(this.read("effect"));
    owner.setHitsoundVolume?.(this.read("hitsound"));
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

/** The single mixer shared by editor preview, library preview, and the overlay. */
export const audioMixer = new AudioMixController();
