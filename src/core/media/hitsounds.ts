/**
 * Plays chart hit sounds alongside preview playback.
 *
 * `HitSounds` resolves the active note skin's audio, applies per-kind volumes and
 * offsets, and `SoundTriggerPolicy` caps simultaneous voices per resource and
 * timestamp; the trigger list itself comes from `hitTimeline` and is rebuilt
 * whenever the chart document's content revision changes.
 */
import { clamp01 } from "../utils/numbers.ts";
import { TempoMap } from "../global/chart/timing/tempo.ts";
import { lowerBound, upperBound } from "../utils/search.ts";
import { assetBytes, assetPath } from "../global/document/resources.ts";
import { type AssetMap } from "../global/document/types.ts";
import { assetUrl } from "../platform/assetUrl.ts";
import { toArrayBuffer } from "../utils/bytes.ts";
import type { AudioTransport } from "./audio.ts";
import type { Chart } from "../global/chart/chart.ts";
import { hitTimeline, type HitSoundOffsetMap, type HitTimelineEntry } from "./hitTimeline.ts";
import { activeNoteSkin, loadNoteSkinWithFallback } from "./noteSkins.ts";

export { hitTimeline, type HitTimelineEntry } from "./hitTimeline.ts";

/** Note kinds with an independently adjustable hit sound. */
export const HIT_SOUND_KINDS = ["tap", "drag", "flick", "custom"] as const;
/** One hit-sound slot. */
export type HitSoundKind = (typeof HIT_SOUND_KINDS)[number];
/** Volume per hit-sound slot. */
export type HitSoundVolumes = Record<HitSoundKind, number>;
const HIT_SOUND_KIND_SET: ReadonlySet<string> = new Set(HIT_SOUND_KINDS);

/** Narrow an arbitrary sound name to a known kind, defaulting to custom. */
function hitSoundKind(sound: string): HitSoundKind {
  return HIT_SOUND_KIND_SET.has(sound) ? (sound as HitSoundKind) : "custom";
}

/**
 * Caps how often one resource may sound inside a single playback timestamp. The counter
 * resets whenever the timestamp changes, so a dense chord cannot stack voices without bound.
 */
export class SoundTriggerPolicy {
  declare enabled: boolean;
  declare limit: number;
  declare seconds: number;
  declare counts: Map<string, number>;

  /** Create a policy with the given enable flag and per-timestamp voice limit. */
  constructor(enabled = true, limit = 5) {
    this.enabled = enabled;
    this.limit = limit;
    this.reset();
  }
  /** Forget the current timestamp's accepted-voice counts. */
  reset(): void {
    this.seconds = NaN;
    this.counts = new Map();
  }
  /** Accept one voice for a resource at a timestamp when under the limit. */
  accept(resource: string, seconds: number): boolean {
    if (!this.enabled) {
      return true;
    }
    if (this.limit <= 0) {
      return false;
    }
    if (this.seconds !== seconds) {
      this.counts.clear();
      this.seconds = seconds;
    }
    const count = this.counts.get(resource) ?? 0;
    if (count >= this.limit) {
      return false;
    }
    this.counts.set(resource, count + 1);
    return true;
  }
}

/**
 * Schedules chart hit sounds through the shared audio transport.
 *
 * Resolves hit-sound bytes from the chart assets, then the active note skin, then
 * the bundled fallback; per-kind volumes, offsets, and a burst policy bound the
 * voices that reach the audio graph.
 */
export class HitSounds {
  transport: AudioTransport;
  buffers: Map<string, AudioBuffer>;
  sources: Set<AudioBufferSourceNode>;
  volume: number;
  soundVolumes: HitSoundVolumes;
  onlyCurrentLine: boolean;
  assets: AssetMap;
  chartName: string;
  generation: number;
  maxVoices: number;
  maxBurst: number;
  cacheBudget: number;
  cacheBytes: number;
  soundAbort: AbortController;
  pendingSounds: Map<string, Promise<AudioBuffer | null>>;
  maxSameTime: number;
  offsets: HitSoundOffsetMap;
  soundPolicy: SoundTriggerPolicy;
  gain: GainNode | null;
  channelGains: Record<HitSoundKind, GainNode | null>;
  chart: Chart | null;
  tempo: TempoMap | null;
  compiled: Chart | null;
  /** Document content revision the compiled trigger list was built from. */
  compiledRevision: number | null;
  /** History content revision the list was built from, which separates edits from paging. */
  compiledEditRevision: number | null;
  /**
   * Chart offset in seconds the trigger list was built with.
   *
   * A committed offset moves every trigger against the audio clock, so the
   * cursor cannot survive it; every other edit keeps the cursor's meaning.
   */
  compiledOffset: number | null;
  compiledLine: number | null;
  entries: HitTimelineEntry[];
  revision: number;
  next: number;
  /** Latest trigger time consumed in the current transport run. */
  scheduledUntil: number;
  /**
   * Transport position recorded while playback is stopped, or null while it runs.
   *
   * A paused edit resumes from this exact position; the first playing frame's
   * clock has already advanced past it.
   */
  pausedAt: number | null;
  skinAudio: Promise<Map<string, Uint8Array>> | null;

  /** Create an idle hit-sound player for one transport. */
  constructor(transport: AudioTransport) {
    this.transport = transport;
    this.buffers = new Map();
    this.sources = new Set();
    this.volume = 0.3;
    this.soundVolumes = { tap: 0.3, drag: 0.3, flick: 0.3, custom: 0.3 };
    this.onlyCurrentLine = false;
    this.assets = new Map();
    this.chartName = "";
    this.generation = 0;
    this.maxVoices = 192;
    this.maxBurst = 96;
    this.cacheBudget = 32 * 1024 ** 2;
    this.cacheBytes = 0;
    this.soundAbort = new AbortController();
    this.pendingSounds = new Map();
    this.maxSameTime = 5;
    this.offsets = { tap: 0, drag: 0, flick: 0, custom: 0 };
    this.soundPolicy = new SoundTriggerPolicy();
    this.gain = null;
    this.channelGains = { tap: null, drag: null, flick: null, custom: null };
    this.chart = null;
    this.tempo = null;
    this.compiled = null;
    this.compiledRevision = null;
    this.compiledEditRevision = null;
    this.compiledOffset = null;
    this.compiledLine = null;
    this.entries = [];
    this.revision = -1;
    this.next = 0;
    this.scheduledUntil = Number.NEGATIVE_INFINITY;
    this.pausedAt = null;
    this.skinAudio = null;
  }

  /** Stop playback and disconnect the master and per-kind gains. */
  dispose(): void {
    this.setProject(null, new Map(), "");
    this.gain?.disconnect();
    this.gain = null;
    for (const channelGain of Object.values(this.channelGains)) {
      channelGain?.disconnect();
    }
    this.channelGains = { tap: null, drag: null, flick: null, custom: null };
  }

  /** Build the gain graph and preload sounds needed near the playhead. */
  async prepare(): Promise<void> {
    const context = this.transport.ensureContext();
    if (!this.gain) {
      this.gain = context.createGain();
      this.gain.connect(this.transport.backgroundGain ?? context.destination);
    }
    this.gain.gain.value = this.volume;
    for (const kind of HIT_SOUND_KINDS) {
      if (!this.channelGains[kind]) {
        this.channelGains[kind] = context.createGain();
        this.channelGains[kind]?.connect(this.gain);
      }
      const channelGain = this.channelGains[kind];
      if (channelGain) {
        channelGain.gain.value = this.volume === 0 ? 0 : this.soundVolumes[kind] / this.volume;
      }
    }
    const names = new Set(["tap", "drag", "flick"]);
    if (this.chart) {
      const tempo = this.tempo ?? new TempoMap(this.chart.BPMList);
      const now = this.transport.audioTime;
      for (const entry of hitTimeline(this.chart, tempo, this.offsets)) {
        if (entry.time >= now - 0.1 && entry.time <= now + 2) {
          names.add(entry.sound);
        }
      }
    }
    await Promise.all([...names].map((name) => this.loadSound(name)));
  }

  /**
   * Load and cache one sound by name; concurrent calls share one decode.
   *
   * Returns null when no source has the sound or a project change superseded it.
   */
  loadSound(name: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(name)) {
      return Promise.resolve(this.buffers.get(name) ?? null);
    }
    if (this.pendingSounds.has(name)) {
      return this.pendingSounds.get(name) ?? Promise.resolve(null);
    }
    const generation = this.generation,
      signal = this.soundAbort.signal;
    /** Read bytes from assets, the skin, or the bundled fallback and decode them. */
    const load = async (): Promise<AudioBuffer | null> => {
      let bytes = assetBytes(this.assets, name, this.chartName);
      const assetUri = this.assets.uri;
      const path = assetPath(this.assets, name, this.chartName);
      if (!bytes && path && this.assets.read) {
        bytes = (await this.assets.read(path)) ?? null;
      }
      if (!bytes && assetUri && path) {
        const response = await fetch(assetUri(path), { signal });
        if (response.ok) {
          bytes = new Uint8Array(await response.arrayBuffer());
        }
      }
      if (!bytes) {
        const skinAudio = await this.loadSkinAudio();
        bytes = skinAudio.get(name) ?? null;
      }
      if (!bytes && ["tap", "drag", "flick"].includes(name)) {
        const response = await fetch(assetUrl(`redux/SE/${name}.ogg`), { signal });
        if (response.ok) {
          bytes = new Uint8Array(await response.arrayBuffer());
        }
      }
      if (!bytes) {
        return null;
      }
      const buffer = await this.transport.ensureContext().decodeAudioData(toArrayBuffer(bytes));
      if (generation !== this.generation) {
        return null;
      }
      const cost = buffer.length * buffer.numberOfChannels * 4;
      if (cost <= this.cacheBudget) {
        this.buffers.set(name, buffer);
        this.cacheBytes += cost;
        for (const [key, value] of this.buffers) {
          if (this.cacheBytes <= this.cacheBudget) {
            break;
          }
          if (["tap", "drag", "flick", name].includes(key)) {
            continue;
          }
          this.buffers.delete(key);
          this.cacheBytes -= value.length * value.numberOfChannels * 4;
        }
      }
      return buffer;
    };
    const pending = load()
      .catch(() => null)
      .finally(() => {
        if (generation === this.generation) {
          this.pendingSounds.delete(name);
        }
      });
    this.pendingSounds.set(name, pending);
    return pending;
  }

  /** Load and cache the active skin's hit-sound byte map for this project. */
  private loadSkinAudio(): Promise<Map<string, Uint8Array>> {
    if (!this.skinAudio) {
      this.skinAudio = loadNoteSkinWithFallback(activeNoteSkin())
        .then((skin) => {
          const sounds = new Map<string, Uint8Array>();
          for (const [name, path] of Object.entries(skin.manifest.audio ?? {})) {
            // `hold` is note playback audio and `high` is not a hit sound;
            // neither enters the playback map.
            if (name === "hold" || name === "high") {
              continue;
            }
            const bytes = skin.files.get(path);
            if (bytes) {
              sounds.set(name, bytes);
            }
          }
          return sounds;
        })
        .catch(() => new Map());
    }
    return this.skinAudio;
  }

  /** Drop the cached skin audio and the four standard sound buffers. */
  invalidateSkinAudio(): void {
    this.skinAudio = null;
    for (const name of ["tap", "drag", "flick", "custom"]) {
      const buffer = this.buffers.get(name);
      if (buffer) {
        this.cacheBytes -= buffer.length * buffer.numberOfChannels * 4;
        this.buffers.delete(name);
      }
    }
  }

  /** Start one trigger when the transport is playing and the voice budget allows. */
  playEntry(entry: HitTimelineEntry, buffer: AudioBuffer | null | undefined): void {
    if (
      !buffer ||
      !this.gain ||
      !this.transport.playing ||
      this.transport.audioTime > entry.time + 0.08 ||
      this.sources.size >= this.maxVoices ||
      !this.soundPolicy.accept(entry.sound, entry.time)
    ) {
      return;
    }
    const context = this.transport.context;
    if (!context) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.channelGains[hitSoundKind(entry.sound)] ?? this.gain);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    source.start(
      context.currentTime +
        Math.max(0, entry.time - this.transport.audioTime) / this.transport.rate,
    );
    this.sources.add(source);
  }

  /**
   * Bind a project and reset caches, buffers, and the trigger policy.
   *
   * Pass null when no chart is open.
   */
  setProject(chart: Chart | null, assets: AssetMap, chartName: string): void {
    this.stop();
    this.generation++;
    this.soundAbort.abort();
    this.soundAbort = new AbortController();
    this.pendingSounds.clear();
    this.soundPolicy.reset();
    this.buffers.clear();
    this.cacheBytes = 0;
    this.chart = chart;
    this.assets = assets;
    this.chartName = chartName;
    this.compiled = null;
    this.compiledRevision = null;
    this.compiledEditRevision = null;
    this.compiledOffset = null;
    this.compiledLine = null;
    this.entries = [];
    this.tempo = null;
    this.onlyCurrentLine = false;
    this.pausedAt = null;
    this.invalidateSkinAudio();
  }

  /** Set master volume and give every kind the same gain. */
  setVolume(value: number): void {
    this.volume = clamp01(value);
    if (this.gain) {
      this.gain.gain.value = this.volume;
    }
    for (const kind of HIT_SOUND_KINDS) {
      this.soundVolumes[kind] = this.volume;
      const gain = this.channelGains[kind];
      if (gain) {
        gain.gain.value = this.volume === 0 ? 0 : 1;
      }
    }
  }

  /** Set one kind's gain relative to the master volume. */
  setSoundVolume(kind: HitSoundKind, value: number): void {
    const volume = clamp01(value);
    this.soundVolumes[kind] = volume;
    const gain = this.channelGains[kind];
    if (gain) {
      gain.gain.value = this.volume === 0 ? 0 : volume / this.volume;
    }
  }

  /** Stop every scheduled and playing hit sound. */
  stop(): void {
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.revision = -1;
    this.scheduledUntil = Number.NEGATIVE_INFINITY;
    // A replay restarts on the same timestamps, so the per-timestamp voice
    // budget belongs to one transport run and must not accumulate across runs.
    this.soundPolicy.reset();
  }

  /**
   * Advance the trigger cursor and schedule sounds within the look-ahead window.
   *
   * `contentRevision` is the owner's monotonic document revision. A paged chart
   * document mutates one facade chart in place across edits and line
   * materializations, so chart identity alone cannot tell this scheduler that
   * its trigger list is stale. `editRevision` is the history content revision:
   * a paged line materialization only adds future notes, while an edit can move
   * or delete a note whose voice is already scheduled.
   */
  tick(
    chart: Chart,
    tempo: TempoMap,
    currentLine: number | null = null,
    contentRevision: number | null = null,
    editRevision: number | null = null,
  ): void {
    if (!this.transport.playing || this.transport.clockReady === false) {
      this.pausedAt = this.transport.audioTime;
      this.stop();
      return;
    }
    const resumedAt = this.pausedAt;
    this.pausedAt = null;
    const line = this.onlyCurrentLine ? currentLine : null;
    const revision = contentRevision ?? null;
    const edit = editRevision ?? revision;
    const structural =
      this.compiled !== chart || this.tempo !== tempo || this.compiledLine !== line;
    const rebuilt =
      structural || this.compiledRevision !== revision || this.compiledEditRevision !== edit;
    const chartOffset = (chart.META.offset ?? 0) / 1000;
    // A committed offset moves every trigger against the audio clock, so the
    // cursor index no longer names the same instant.
    const offsetChanged = this.compiledOffset !== null && this.compiledOffset !== chartOffset;
    if (rebuilt) {
      // An edited chart invalidates scheduled voices; a paged line that merely
      // became materialized does not, so a loading burst never stops and
      // re-schedules the notes it just queued.
      const edited = structural || this.compiled === null || this.compiledEditRevision !== edit;
      if (edited) {
        this.stop();
      }
      this.compiled = chart;
      this.tempo = tempo;
      this.compiledLine = line;
      this.compiledRevision = revision;
      this.compiledEditRevision = edit;
      this.compiledOffset = chartOffset;
      this.entries = hitTimeline(chart, tempo, this.offsets, line);
      if (offsetChanged) {
        // The offset re-times the whole list, and the playhead itself has
        // already sounded, so only strictly later triggers are scheduled.
        this.next = upperBound(this.entries, this.transport.audioTime, (entry) => entry.time);
      } else if (edited && resumedAt !== null) {
        // A paused edit resumes from the exact position playback stopped at;
        // the first playing frame has already moved the clock past it. Include
        // a trigger sitting exactly on that position.
        this.next = lowerBound(this.entries, resumedAt, (entry) => entry.time);
      } else {
        // Paging keeps `scheduledUntil`, so voices already queued are not
        // scheduled twice. A live edit stopped those voices and cleared it, so
        // the cut look-ahead is scheduled again from the seek tolerance.
        this.next = upperBound(
          this.entries,
          Math.max(this.transport.audioTime - 0.02, this.scheduledUntil),
          (entry) => entry.time,
        );
      }
    }
    const time = this.transport.audioTime;
    if (this.revision !== this.transport.playRevision) {
      this.stop();
      this.revision = this.transport.playRevision;
      // A rebuild in this tick already anchored the cursor from the new list. The
      // seek tolerance below exists for a transport seek that lands a hair past a
      // trigger; applying it after an offset edit would rewind the cursor onto
      // the note the playhead sits on and sound it a second time.
      if (!rebuilt) {
        this.next = upperBound(this.entries, time - 0.02, (entry) => entry.time);
      }
    } else if (offsetChanged) {
      // The offset commit is not always followed by a seek in the same tick.
      this.next = upperBound(this.entries, time, (entry) => entry.time);
    }
    // `next` already points past the previous look-ahead window. During normal
    // monotonic playback the first unscheduled entry is therefore still newer
    // than the moving lower bound; avoid a binary search on every RAF. A seek
    // or a long main-thread stall can move the bound past that entry, so retain
    // the upper-bound repair path for that case.
    const repairBound = time - 0.08;
    if (this.entries[this.next]?.time <= repairBound) {
      this.next = upperBound(this.entries, repairBound, (entry) => entry.time);
    }
    const until = time + 0.1 * this.transport.rate;
    let burst = 0;
    while (
      this.next < this.entries.length &&
      this.entries[this.next].time <= until &&
      this.entries[this.next].time < (this.transport.scheduleHorizon ?? Infinity)
    ) {
      const entry = this.entries[this.next++];
      this.scheduledUntil = entry.time;
      if (burst++ >= this.maxBurst) {
        continue;
      }
      const buffer = this.buffers.get(entry.sound);
      if (buffer) {
        this.playEntry(entry, buffer);
      } else {
        const generation = this.generation;
        this.loadSound(entry.sound).then((loaded) => {
          if (generation === this.generation) {
            this.playEntry(entry, loaded);
          }
        });
      }
    }
  }
}
