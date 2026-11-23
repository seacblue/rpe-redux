/** Merge continuous linear event tracks by splitting at existing beat boundaries. */
import type { JudgeLineEvent } from "../chart.ts";
import { beatValue, type Beat } from "../timing/beat.ts";
import { EventTrack } from "../timing/events.ts";
import type { TempoMap } from "../timing/tempo.ts";

/**
 * Sum linear tracks into one event list split at every existing boundary.
 *
 * Returns null when any source uses easing, Bézier, trajectory or transform
 * fields the linear form cannot represent exactly.
 */
export function composeLinearNoiseTracks(
  tracks: readonly JudgeLineEvent[][],
  tempo: TempoMap | undefined,
  appear: Beat,
): JudgeLineEvent[] | null {
  if (!tempo) {
    return null;
  }
  const boundaries = new Map<number, Beat>();
  boundaries.set(beatValue(appear), appear);
  for (const events of tracks) {
    let previous: JudgeLineEvent | undefined;
    for (const event of events) {
      if (
        typeof event.start !== "number" ||
        typeof event.end !== "number" ||
        !Number.isFinite(event.start) ||
        !Number.isFinite(event.end) ||
        (event.easingType ?? 1) !== 1 ||
        event.bezier ||
        event.trajectory ||
        event.inst ||
        (event.easingLeft ?? 0) === (event.easingRight ?? 1) ||
        "transformStart" in event ||
        "transformEnd" in event ||
        "anchor" in event ||
        "transformStep" in event ||
        beatValue(event.endTime) <= beatValue(event.startTime) ||
        (previous &&
          (beatValue(previous.endTime) > beatValue(event.startTime) ||
            previous.end !== event.start))
      ) {
        return null;
      }
      boundaries.set(beatValue(event.startTime), event.startTime);
      boundaries.set(beatValue(event.endTime), event.endTime);
      previous = event;
    }
  }
  const points = [...boundaries].sort((a, b) => a[0] - b[0]);
  if (points.length < 2 || points[0][0] < beatValue(appear)) {
    return null;
  }
  const runtime = tracks.map((events) => new EventTrack(events, tempo));
  const value = (beat: Beat) => {
    const seconds = tempo.seconds(beat);
    return runtime.reduce((sum, track) => sum + Number(track.value(seconds)), 0);
  };
  return points.slice(0, -1).map(([, start], index) => ({
    startTime: [...start],
    endTime: [...points[index + 1][1]],
    start: value(start),
    end: value(points[index + 1][1]),
    easingType: 1,
  }));
}
