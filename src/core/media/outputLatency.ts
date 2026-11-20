/**
 * Device-latency arithmetic for the visual playback clock.
 *
 * The picture and the sound leave the transport at different moments. Two
 * independent chains cause that:
 *
 * 1. The audio chain: a sample enters the graph at `currentTime` and reaches the
 *    speaker after the render-graph stage (`baseLatency`) plus the device buffer
 *    (`outputLatency`). Subtracting the sum makes the picture wait for the sound.
 * 2. The display chain: a frame painted inside `requestAnimationFrame` is not on
 *    screen yet. It still has to be composited and presented at the next vertical
 *    blank, which no audio clock accounts for.
 *
 * Both corrections are subtracted from the position the picture is drawn from, so
 * they belong in one place. Keeping them here also lets them be tested without a
 * running audio context.
 */

/** The latency stages a host reports for one audio context, in seconds. */
export interface LatencyStages {
  /** Render-quantum and graph delay before a sample leaves the renderer. */
  readonly baseLatency?: number;
  /** Device buffer delay after the renderer hands the sample over. */
  readonly outputLatency?: number;
}

/** Largest total latency accepted from a host, in seconds. */
const MAX_TOTAL_SECONDS = 0.5;

/**
 * Total delay between a sample entering the graph and the device emitting it.
 *
 * Both stages contribute, so they are summed. A host that omits one stage keeps
 * the other, and a missing or non-finite stage contributes zero rather than
 * poisoning the total with `NaN`.
 */
export function totalOutputLatency(stages: LatencyStages): number {
  const base = Number(stages.baseLatency ?? 0);
  const output = Number(stages.outputLatency ?? 0);
  const total =
    (Number.isFinite(base) ? Math.max(0, base) : 0) +
    (Number.isFinite(output) ? Math.max(0, output) : 0);
  return Math.min(total, MAX_TOTAL_SECONDS);
}

/** The context fields the latency report reads. */
export interface LatencyReportSource extends LatencyStages {
  /** The processing clock, in seconds. */
  readonly currentTime: number;
  /** Optional device timestamp for the audio the speaker has already emitted. */
  readonly getOutputTimestamp?: () => { readonly contextTime?: number };
}

/** What the visual clock subtracts, next to what the device reports. */
export interface LatencyReport {
  /** Render-graph delay reported by the host, in seconds. */
  readonly baseLatency: number;
  /** Device-buffer delay reported by the host, in seconds. */
  readonly outputLatency: number;
  /**
   * Measured distance between the processing clock and the emitted audio.
   *
   * Comparing it with `outputLatency` shows whether the value subtracted from the
   * visual clock matches the real output chain. `null` means the host does not
   * report a device timestamp yet.
   */
  readonly drainedSeconds: number | null;
}

/**
 * Snapshot of the latency terms the visual clock depends on.
 *
 * Kept apart from the transport so the arithmetic can be exercised without a
 * running audio context: a suspended or device-less context reports no usable
 * timestamp, and that has to read as "unknown" rather than as zero.
 */
export function latencyReport(source: LatencyReportSource): LatencyReport {
  const baseLatency = Number(source.baseLatency ?? 0);
  let drainedSeconds: number | null = null;
  try {
    const emitted = source.getOutputTimestamp?.().contextTime;
    if (typeof emitted === "number" && Number.isFinite(emitted) && emitted > 0) {
      drainedSeconds = Number(source.currentTime) - emitted;
    }
  } catch {
    drainedSeconds = null;
  }
  return {
    baseLatency: Number.isFinite(baseLatency) ? Math.max(0, baseLatency) : 0,
    outputLatency: totalOutputLatency(source),
    drainedSeconds,
  };
}

/**
 * Seconds a painted frame waits before it is visible.
 *
 * A frame drawn inside `requestAnimationFrame` is handed to the compositor and
 * presented at the next vertical blank. The value was calibrated by ear on the
 * reference device, with the audio chain already corrected to within one render
 * quantum: 32 ms still left the sound leading by about 20 ms, so the display
 * chain there is closer to 52 ms. The page cannot measure this — the compositor
 * does not expose its present time — which is why it also carries a setting.
 */
export const DISPLAY_LEAD_SECONDS = 0.052;

/**
 * How far ahead of the audible position the picture must be drawn.
 *
 * A frame painted now becomes visible one display chain later. By then the sound
 * has advanced by that same amount, so drawing the *current* audible position
 * puts the picture behind the sound by exactly the display lead. Drawing the
 * audible position plus this lead makes the frame correct at the moment it is
 * actually seen.
 *
 * `calibrationSeconds` is the user's own correction: positive moves the picture
 * further ahead, negative moves it back. The result is clamped to a range that can
 * only be a correction, never a transport jump.
 */
export function visualLeadSeconds(calibrationSeconds = 0): number {
  const calibration = Number.isFinite(calibrationSeconds) ? calibrationSeconds : 0;
  return Math.min(0.2, Math.max(-0.2, DISPLAY_LEAD_SECONDS + calibration));
}
