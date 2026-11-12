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
import { editorAuditioning } from "../../../../../../core/edit/state/publishedValues.ts";
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
  playbackAnchor = null;
  editorAuditioning.set(false);
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
 * playback. Such a hold never starts, pauses, or seeks the transport.
 */
let auditionLayoutOnly = false;
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
 * moment the user was inspecting. A playback that is already running keeps the
 * clock: the hold then only hides the authoring surfaces, so releasing it
 * neither pauses nor seeks and the chart keeps playing.
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
    auditionLayoutOnly = true;
    viewControls.beginPreviewOnlyHold();
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
      bound.reportError(error);
    });
  return true;
}

/**
 * Stop a temporary audition, restoring its layout and optionally its position.
 *
 * A layout-only hold leaves a running playback untouched; releasing it only
 * restores the regions it hid.
 */
export function endAudition(): void {
  if (auditionLayoutOnly) {
    auditionLayoutOnly = false;
    viewControls.endPreviewOnlyHold();
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
 * Start playback and hide the authoring regions (RPE's start key).
 *
 * When already playing the key only ensures the preview layout is active, so it
 * cannot restart or rewind a running playback.
 */
export function startPlayback(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  if (bound.playback.audio.playing || bound.playback.pending) {
    enterPlaybackPreview();
    return;
  }
  playFromCurrent(bound);
}

/**
 * RPE's restore key: start playback when idle, otherwise show the editor again
 * and jump back to where playback began.
 */
export function stopPlayback(): void {
  const bound = transportBindings.value();
  if (!bound || auditionAnchor !== null) {
    return;
  }
  if (bound.playback.audio.playing || bound.playback.pending) {
    const anchor = playbackAnchor ?? bound.playback.audio.time;
    bound.playback.seek(anchor);
    exitPlaybackPreview();
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
