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
  private readonly constantRate: number;
  private cachedSeconds = Number.NaN;
  private cachedValue = 0;

  /** Create a cursor bound to the line's immutable speed-integral layers. */
  constructor(speeds: readonly SpeedIntegral[]) {
    const dynamic: SpeedIntegral[] = [];
    let constantRate = 0;
    for (const speed of speeds) {
      if (speed.constantSpeed === null) {
        dynamic.push(speed);
      } else {
        constantRate += speed.constantSpeed * 120;
      }
    }
    this.speeds = dynamic;
    this.constantRate = constantRate;
  }

  /** Return the exact accumulated floor at `seconds`. */
  value(seconds: number): number {
    if (this.speeds.length === 0 && this.constantRate === 0) {
      return 0;
    }
    if (seconds === this.cachedSeconds) {
      return this.cachedValue;
    }
    // SpeedIntegral's pre-first-event branch clamps chart time below zero to zero;
    // preserve that exact convention for the folded constant layers.
    let value = seconds > 0 ? seconds * this.constantRate : 0;
    for (let index = 0; index < this.speeds.length; index += 1) {
      value += this.speeds[index].distance(seconds);
    }
    this.cachedSeconds = seconds;
    this.cachedValue = value;
    return value;
  }
}
