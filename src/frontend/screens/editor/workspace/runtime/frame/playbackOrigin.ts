/** Keeps the timeline viewport synchronized with the transport during playback. */

interface PlaybackOriginViewport {
  setPlaybackActive(active: boolean): void;
  setOrigin(value: number, source: "playback"): boolean;
}

/** Options for synchronizing a transport position into the timeline. */
export interface PlaybackOriginOptions {
  /** Force a paused seek to publish its settled picture position. */
  readonly publishWhilePaused?: boolean;
}

/** Publish playback ownership and the current beat to the timeline viewport. */
export function updatePlaybackViewportOrigin(
  viewport: PlaybackOriginViewport,
  beat: number,
  playing: boolean,
  pending: boolean,
  options: PlaybackOriginOptions = {},
): void {
  const active = playing || pending;
  viewport.setPlaybackActive(active);
  if (active || options.publishWhilePaused) {
    viewport.setOrigin(beat, "playback");
  }
}
