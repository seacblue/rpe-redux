/*
 * Exact time cache for one judge line's accumulated floor.
 *
 * Floor is independent from the rest of LineState, so this module keeps only
 * the exact line-level result and leaves position, visual, and text tracks alone.
 */
import { SpeedIntegral } from "../timing/events.ts";

/** Cache one exact floor result while reusing SpeedIntegral's own event cursor. */
export class LineFloorCursor {
  private readonly speeds: readonly SpeedIntegral[];
  private cachedSeconds = Number.NaN;
  private cachedValue = 0;

  /** Create a cursor bound to the line's immutable speed-integral layers. */
  constructor(speeds: readonly SpeedIntegral[]) {
    this.speeds = speeds;
  }

  /** Return the exact accumulated floor at `seconds`. */
  value(seconds: number): number {
    if (seconds === this.cachedSeconds) {
      return this.cachedValue;
    }
    let value = 0;
    for (let index = 0; index < this.speeds.length; index += 1) {
      value += this.speeds[index].distance(seconds);
    }
    this.cachedSeconds = seconds;
    this.cachedValue = value;
    return value;
  }
}
