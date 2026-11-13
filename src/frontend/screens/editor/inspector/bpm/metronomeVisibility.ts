/** Owns the activation rule for the timing pane's playback metronome. */

/** Return whether the timing pane is the active Inspector surface. */
export function shouldRunMetronome(activeInspector: string): boolean {
  return activeInspector === "timing";
}
