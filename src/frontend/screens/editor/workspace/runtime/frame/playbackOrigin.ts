/** Keeps the timeline viewport synchronized with the transport during playback. */

interface PlaybackOriginViewport {
  setPlaybackActive(active: boolean): void;
  setOrigin(value: number, source: "playback"): boolean;
}

/** Publish playback ownership and the current beat to the timeline viewport. */
export function updatePlaybackViewportOrigin(
  viewport: PlaybackOriginViewport,
  beat: number,
  playing: boolean,
  pending: boolean,
): void {
  viewport.setPlaybackActive(playing || pending);
  if (playing || pending) {
    viewport.setOrigin(beat, "playback");
  }
}
