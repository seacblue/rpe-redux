/**
 * The chart time the picture shows for the audible transport position.
 *
 * A frame painted while the transport moves is presented one display chain later,
 * so the picture leads the sound by the display lead. Two transitions need care:
 *
 * - A pause stops that clock. The picture keeps the position it last drew, because
 *   dropping back to the audible position would jump the playhead by the lead.
 * - A start schedules its first samples one output chain before they reach the
 *   speaker. Jumping straight to the full lead would move the playhead forward
 *   while the sound is still silent, so the lead is established over that drain.
 *
 * An explicit seek releases the held position, so a paused seek reports exactly
 * where the transport landed.
 */

/** Maps the audible chart clock to the chart time the picture shows. */
export interface PictureClock {
  /**
   * Chart time to draw or report for this audible position.
   *
   * While the transport moves, the result leads by the display lead and becomes
   * the position a pause holds. The lead is reached gradually over a start's
   * output drain. While the transport is stopped, the held position wins so the
   * picture does not move; without one, the audible position is returned.
   */
  seconds(audibleSeconds: number): number;
  /** Forget the held position after an explicit transport seek. */
  release(): void;
}

/**
 * Builds a picture clock over the live transport state, lead setting, and start
 * drain.
 *
 * The inputs are read per call: playback can start or stop between frames, the
 * lead setting can change while the editor is open, and the drain advances every
 * frame of a start.
 */
export function createPictureClock(options: {
  /** Whether the transport is producing time. */
  playing(): boolean;
  /** How far ahead of the audible position a moving transport draws. */
  leadSeconds(): number;
  /** How far the current start has drained toward the speaker, from 0 to 1. */
  drainProgress(): number;
}): PictureClock {
  let held: number | null = null;
  let starting = false;
  let startDraw = Number.NaN;
  return {
    seconds(audibleSeconds: number): number {
      if (!options.playing()) {
        starting = false;
        startDraw = Number.NaN;
        return held ?? audibleSeconds;
      }
      if (!starting) {
        starting = true;
        startDraw = held ?? audibleSeconds;
      }
      const target = audibleSeconds + options.leadSeconds();
      const progress = Number(options.drainProgress());
      const drain = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
      if (drain < 1 && Number.isFinite(startDraw)) {
        held = startDraw + (target - startDraw) * drain;
      } else {
        held = target;
        startDraw = Number.NaN;
      }
      return held;
    },
    release(): void {
      held = null;
      starting = false;
      startDraw = Number.NaN;
    },
  };
}
