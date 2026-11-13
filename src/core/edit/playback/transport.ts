/**
 * The editor's playback controller: play, pause, rate, and seeking.
 *
 * The audio transport and hitsound player are injected structurally, so the
 * controller runs against the browser host or a test double. A pending start is
 * shared by repeated play calls and invalidated by a seek or pause, so an old
 * start cannot publish state after a newer request.
 */
import type { Chart } from "../../global/chart/chart.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";

/**
 * The slice of the audio transport this controller drives.
 *
 * Declared structurally to keep this controller independent of the platform transport.
 * The browser runtime supplies the actual audio transport through this interface.
 */
export interface PlaybackAudio {
  readonly playing: boolean;
  readonly rate: number;
  readonly duration: number;
  readonly time: number;
  pause(): void;
  play(): Promise<unknown>;
  seek(seconds: number): void;
}

/** The slice of the hitsound player this controller drives. */
export interface PlaybackSounds {
  chart: Chart | null;
  prepare(): Promise<unknown>;
  stop(): void;
}

/** Drives play, pause, rate, and seeking across audio and hitsound owners. */
export class EditorPlayback {
  audio: PlaybackAudio;
  sounds: PlaybackSounds;
  onSeek: () => void;
  request: number;
  pending: boolean;
  private starting: Promise<void> | null;

  /** Wires the controller to its audio and hitsound owners. */
  constructor(audio: PlaybackAudio, sounds: PlaybackSounds, onSeek: () => void) {
    this.audio = audio;
    this.sounds = sounds;
    this.onSeek = onSeek;
    this.request = 0;
    this.pending = false;
    this.starting = null;
  }
  /** Stops audio and hitsounds and invalidates any pending start. */
  pause(): void {
    this.request++;
    this.pending = false;
    this.audio.pause();
    this.sounds.stop();
  }
  /** Seeks the transport, stopping hitsounds and notifying the seek listener. */
  seek(seconds: number, pause = true): void {
    if (pause) {
      this.pause();
    }
    this.audio.seek(seconds);
    this.sounds.stop();
    this.onSeek();
  }
  /** Pauses when playing or pending; otherwise starts playback. */
  async toggle(chart: Chart): Promise<void> {
    if (this.audio.playing || this.pending) {
      this.pause();
      return;
    }
    await this.play(chart);
  }
  /** Starts audio and hitsounds once; repeated calls share the pending start. */
  play(chart: Chart): Promise<void> {
    if (this.pending && this.starting) {
      return this.starting;
    }
    if (this.audio.playing) {
      return Promise.resolve();
    }
    const request = ++this.request;
    this.pending = true;
    this.starting = (async () => {
      try {
        this.sounds.chart = chart;
        if (this.request === request) {
          // Resume the audio graph inside the user's gesture stack; waiting for
          // hitsound fetch/decode can outlive transient user activation.
          const audioStart = this.audio.play();
          // Hit sounds enhance the visual clock and never hold the first preview
          // frame behind network/decode work. HitSounds discards resources for a
          // replaced document; the request check below prevents a superseded
          // start from publishing state.
          void this.sounds.prepare().catch(() => undefined);
          await audioStart;
        }
      } catch (error) {
        // A seek or pause can invalidate an audio start while its promise is
        // settling; a rejection from a superseded request is cancellation.
        if (this.request === request) {
          throw error;
        }
      } finally {
        if (this.request === request) {
          this.pending = false;
          this.starting = null;
        }
      }
    })();
    return this.starting;
  }
}

// ------------------------------------------------------------------ shortcuts

/**
 * Transport keys, declared beside the controller they drive.
 *
 * Play/pause is workspace-scoped because the transport is shared chrome: the
 * same Space must work on the global and design pages, not only over the
 * timeline. The step keys stay editor-scoped; their arrows and Z/X act on the
 * timeline and would shadow page navigation elsewhere.
 */
export const playbackShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "playback.pause",
    category: "editor.playback",
    title: "shortcuts.editor.pause",
    scope: "workspace",
    defaults: [{ key: "SPACE" }],
  },
  {
    id: "playback.start",
    category: "editor.playback",
    title: "shortcuts.editor.startPlayback",
    scope: "editor",
    // Start without toggling: an RPE migration binds it to RPE's start key.
    defaults: [],
  },
  {
    id: "playback.stop",
    category: "editor.playback",
    title: "shortcuts.editor.stopPlaybackRestore",
    scope: "editor",
    defaults: [],
  },
  {
    id: "playback.stopStay",
    category: "editor.playback",
    title: "shortcuts.editor.stopPlaybackStay",
    scope: "editor",
    defaults: [],
  },
  {
    id: "playback.replay",
    category: "editor.playback",
    title: "shortcuts.editor.replayPlayback",
    scope: "editor",
    defaults: [],
  },
  {
    id: "playback.step.previous",
    shared: true,
    category: "editor.playback",
    title: "shortcuts.editor.lastBeat",
    scope: "editor",
    // Z/X keep line stepping on the left hand; the arrows stay as the familiar
    // second binding.
    defaults: [{ key: "Z" }, { key: "LEFTARROW" }],
    enabledFor: (context) => !context.hasSelection,
  },
  {
    id: "playback.step.next",
    shared: true,
    category: "editor.playback",
    title: "shortcuts.editor.nextBeat",
    scope: "editor",
    defaults: [{ key: "X" }, { key: "RIGHTARROW" }],
    enabledFor: (context) => !context.hasSelection,
  },
];
