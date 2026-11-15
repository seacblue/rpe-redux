/**
 * Queue automatic Changelog requests until the editor is not playing.
 *
 * The update store stays independent of React and the modal queue. The Help
 * surface registers both current-release and update-release openers here.
 */
import { editorPlaying } from "../../../../core/edit/state/publishedValues.ts";

/** The current opener, or null before the Help surface registers. */
let launch: (() => void) | null = null;
/** The update opener, or null before the Help surface registers. */
let updateLaunch: (() => void) | null = null;
/** The automatic request waiting for an opener or for playback to stop. */
let pending: "current" | "update" | null = null;
/** Disposer for the one playback listener used by a deferred request. */
let stopPlaybackSubscription: (() => void) | null = null;

/** Stop listening once no automatic request remains queued. */
function clearPlaybackSubscription(): void {
  stopPlaybackSubscription?.();
  stopPlaybackSubscription = null;
}

/** Open the queued surface as soon as its opener exists and playback is idle. */
function flushPending(): void {
  if (editorPlaying.get() || !pending) {
    return;
  }
  const request = pending;
  const opener = request === "update" ? updateLaunch : launch;
  if (!opener) {
    return;
  }
  pending = null;
  clearPlaybackSubscription();
  opener();
}

/** Queue a surface request when playback owns the user's attention. */
function request(kind: "current" | "update"): void {
  const opener = kind === "update" ? updateLaunch : launch;
  if (opener && !editorPlaying.get()) {
    opener();
    return;
  }
  pending = kind;
  if (editorPlaying.get() && !stopPlaybackSubscription) {
    stopPlaybackSubscription = editorPlaying.subscribe(flushPending);
  }
}

/** Register the changelog opener; returns the disposer. */
export function bindChangelogLauncher(opener: () => void): () => void {
  launch = opener;
  flushPending();
  return () => {
    if (launch === opener) {
      launch = null;
    }
  };
}

/** Register the update-release Changelog opener; returns the disposer. */
export function bindUpdateChangelogLauncher(opener: () => void): () => void {
  updateLaunch = opener;
  flushPending();
  return () => {
    if (updateLaunch === opener) {
      updateLaunch = null;
    }
  };
}

/** Ask for the current-release Changelog when playback is idle. */
export function requestChangelog(): void {
  request("current");
}

/** Ask for the update-release Changelog when playback is idle. */
export function requestUpdateChangelog(): void {
  request("update");
}
