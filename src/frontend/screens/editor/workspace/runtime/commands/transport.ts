/**
 * The transport, as the commands see it.
 *
 * Play, audition, rewind and seek are reached from the View menu, the top bar's
 * play button, the editor's own keys and a plugin's script. They live here
 * rather than in a table the editor installs, so each surface names a function:
 * `transport.beginAudition()` is this file's function, not an entry looked up by
 * name.
 *
 * The editor connects its transport — the audio clock, the seek policy, the frame
 * invalidation — while it mounts, and disconnects it when it is disposed. Nothing
 * is connected while the shell is at the start page, so a command that fires then
 * does nothing rather than throwing.
 */
import { beatValue, parseBeat } from "../../../../../../core/global/chart/timing/beat.ts";
import type { EditorPlayback } from "../../../../../../core/edit/playback/transport.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import {
  editorAuditioning,
  editorAuditionKind,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { createLateBound } from "../../../../../../core/utils/lateBound.ts";
import type { AuditionOptions } from "../../../../../contracts/editorCommands.ts";
import { viewControls } from "./viewControls.ts";

/** Services the transport commands operate on. */
export interface TransportBindings {
  /** Play, or stop what is playing. */
  togglePlayback(): Promise<unknown>;
  /** Seek to one beat, as the session counts beats. */
  seekBeat(beat: number): void;
  playback: Pick<EditorPlayback, "play" | "pause" | "seek" | "audio" | "pending">;
  getSession(): EditorSession;
  invalidate(): void;
  reportError(error: unknown): void;
}

const transportBindings = createLateBound<TransportBindings>();

/** Hands the mounted editor's transport to the commands below. */
export function connectTransport(bindings: TransportBindings): () => void {
  auditionRequest++;
  auditionAnchor = null;
  auditionReturnsTime = true;
  auditionPreviewOnly = false;
  auditionLayoutOnly = false;
  auditionPausesOnRelease = false;
  playbackAnchor = null;
  editorAuditioning.set(false);
  editorAuditionKind.set(null);
  return transportBindings.bind(bindings);
}

/** Audio position captured when the current audition began. */
let auditionAnchor: number | null = null;
/** Whether releasing the current audition returns to `auditionAnchor`. */
let auditionReturnsTime = true;
/** Whether the current audition owns the preview-only layout. */
let auditionPreviewOnly = false;
/**
 * Whether the current hold only hides the authoring surfaces over a running
 * playback. The U hold pauses the transport when it is released.
 */
let auditionLayoutOnly = false;
/** Whether a layout-only hold should pause the running transport on release. */
let auditionPausesOnRelease = false;
/** Guards a pending play start from clearing a newer audition's state. */
let auditionRequest = 0;
/** Audio position when the current playback started; the restore key uses it. */
let playbackAnchor: number | null = null;

/** Enter RPE's playback layout: the authoring regions hide behind the preview. */
function enterPlaybackPreview(): void {
  viewControls.enterPlaybackPreview();
}

/** Leave RPE's playback layout and show the authoring regions again. */
function exitPlaybackPreview(): void {
  viewControls.exitPlaybackPreview();
}

/** Start playback from the current position and remember where it began. */
function playFromCurrent(bound: TransportBindings): void {
  playbackAnchor = bound.playback.audio.time;
  enterPlaybackPreview();
  void bound.playback
    .play(bound.getSession().chart)
    .then(bound.invalidate)
    .catch(bound.reportError);
}

/** Play, or stop what is playing. */
export function togglePlayback(): void {
  // A held audition owns the transport; play/pause stays inert for its duration.
  if (auditionAnchor !== null) {
    return;
  }
  const bound = transportBindings.value();
  if (!bound) {
    return;
  }
  // RPE's own play/pause key is the plain transport toggle: it does not change
  // the layout, but the restore key still needs to know where playback began.
  if (!bound.playback.audio.playing && !bound.playback.pending) {
    playbackAnchor = bound.playback.audio.time;
  }
  bound.togglePlayback();
}

/**
 * Start a temporary audition at the current audio position.
 *
 * The toolbar's hold button and the held T/U shortcuts use this. Preview-only
 * auditions restore the layout on release; `restoreTime` also returns to the
 * moment the user was inspecting. T changes an active playback into an
 * audition, so releasing T seeks back to its starting position. U keeps the
 * current position while held and pauses there when playback was already
 * running.
 */
export function beginAudition(options: AuditionOptions = {}): boolean {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null || auditionLayoutOnly) {
    return false;
  }
  if (bound.playback.audio.playing) {
    if (options.previewOnly !== true) {
      return false;
    }
    if (options.restoreTime === false) {
      auditionLayoutOnly = true;
      auditionPausesOnRelease = true;
      viewControls.beginPreviewOnlyHold();
      return true;
    }
    auditionAnchor = bound.playback.audio.time;
    auditionReturnsTime = true;
    auditionPreviewOnly = true;
    viewControls.beginPreviewOnlyHold();
    editorAuditioning.set(true);
    editorAuditionKind.set("restore");
    return true;
  }
  const request = ++auditionRequest;
  auditionAnchor = bound.playback.audio.time;
  auditionReturnsTime = options.restoreTime !== false;
  auditionPreviewOnly = options.previewOnly === true;
  if (auditionPreviewOnly) {
    viewControls.beginPreviewOnlyHold();
  }
  editorAuditioning.set(true);
  editorAuditionKind.set(auditionPreviewOnly ? (auditionReturnsTime ? "restore" : "stay") : null);
  void bound.playback
    .play(bound.getSession().chart)
    .then(bound.invalidate)
    .catch((error) => {
      if (request !== auditionRequest) {
        return;
      }
      if (auditionPreviewOnly) {
        viewControls.endPreviewOnlyHold();
      }
      auditionAnchor = null;
      auditionReturnsTime = true;
      auditionPreviewOnly = false;
      editorAuditioning.set(false);
      editorAuditionKind.set(null);
      bound.reportError(error);
    });
  return true;
}

/**
 * Stop a temporary audition, restoring its layout and optionally its position.
 *
 * A layout-only hold restores the regions it hid; a U hold over active playback
 * also pauses at the release position.
 */
export function endAudition(): void {
  if (auditionLayoutOnly) {
    const bound = transportBindings.value();
    const pauseOnRelease = auditionPausesOnRelease;
    auditionLayoutOnly = false;
    auditionPausesOnRelease = false;
    viewControls.endPreviewOnlyHold();
    if (pauseOnRelease) {
      bound?.playback.pause();
      bound?.invalidate();
    }
    return;
  }
  const bound = transportBindings.value();
  if (auditionAnchor === null) {
    return;
  }
  const anchor = auditionAnchor;
  const restoreTime = auditionReturnsTime;
  const restorePreview = auditionPreviewOnly;
  auditionRequest++;
  auditionAnchor = null;
  auditionReturnsTime = true;
  auditionPreviewOnly = false;
  editorAuditioning.set(false);
  editorAuditionKind.set(null);
  if (restorePreview) {
    viewControls.endPreviewOnlyHold();
  }
  if (!bound) {
    return;
  }
  if (restoreTime) {
    bound.playback.seek(anchor);
  } else {
    bound.playback.pause();
  }
  bound.invalidate();
}

/**
 * Toggle RPE's playback preview and start playback when idle.
 *
 * The first press opens the preview from the editor and starts playing; a press
 * while the preview is already open closes it and pauses, so the key is a
 * preview toggle rather than a one-way entrance.
 */
export function startPlayback(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  if (viewControls.playbackPreviewActive()) {
    exitPlaybackPreview();
    bound.playback.pause();
    bound.invalidate();
    return;
  }
  if (bound.playback.audio.playing || bound.playback.pending) {
    enterPlaybackPreview();
    bound.invalidate();
    return;
  }
  playFromCurrent(bound);
}

/**
 * RPE's restore key: open the preview while the editor is playing, and restore
 * the editor (ending playback) when the preview is already open.
 *
 * A playing editor only hides its authoring regions; it never stops the clock,
 * so the first press keeps the chart running. The second press seeks back to the
 * position playback began and closes the preview.
 */
export function stopPlayback(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  const previewing = viewControls.playbackPreviewActive();
  if (previewing) {
    if (bound.playback.audio.playing || bound.playback.pending) {
      bound.playback.seek(playbackAnchor ?? bound.playback.audio.time);
    }
    exitPlaybackPreview();
    bound.invalidate();
    return;
  }
  if (bound.playback.audio.playing || bound.playback.pending) {
    enterPlaybackPreview();
    bound.invalidate();
    return;
  }
  playFromCurrent(bound);
}

/**
 * RPE's stay key: start playback when idle, otherwise show the editor again and
 * pause at the current position.
 */
export function stopPlaybackStay(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  if (bound.playback.audio.playing || bound.playback.pending) {
    bound.playback.pause();
    exitPlaybackPreview();
    bound.invalidate();
    return;
  }
  playFromCurrent(bound);
}

/** Seek to the start, hide the authoring regions, and play from the beginning. */
export function replayPlayback(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  playbackAnchor = 0;
  enterPlaybackPreview();
  bound.playback.seek(0);
  void bound.playback
    .play(bound.getSession().chart)
    .then(bound.invalidate)
    .catch(bound.reportError);
}

/** Go back to the first beat without starting the transport. */
export function rewind(): void {
  transportBindings.value()?.seekBeat(0);
}

/** Seek to one beat, written as the field that asked holds it. */
export function seekToBeat(beat: string): void {
  const bound = transportBindings.value();
  if (!bound) {
    return;
  }
  try {
    bound.seekBeat(beatValue(parseBeat(beat)));
  } catch (error) {
    bound.reportError(error);
  }
}

/** The transport commands, as the menu, the bar and the keys see them. */
export const transport = Object.freeze({
  togglePlayback,
  startPlayback,
  stopPlayback,
  stopPlaybackStay,
  replayPlayback,
  beginAudition,
  endAudition,
  rewind,
  seekToBeat,
});
