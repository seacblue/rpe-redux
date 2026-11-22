/**
 * Expands a sampled trajectory into ordinary move and rotate events.
 *
 * Samples map onto x, y and rotation tracks, then split through
 * `simplifyTrajectorySamples` into eased pieces the chart format can store.
 */
import { beatValue, fromNumber } from "../timing/beat.ts";
import { createEvent } from "../chart.ts";
import type { JudgeLineEvent } from "../chart.ts";
import type { TempoMap } from "../timing/tempo.ts";
import { compileTrajectory, trajectoryHasRotation } from "./curveTrajectory.ts";
import { simplifyTrajectorySamples, trajectorySplitSettings } from "./trajectorySimplify.ts";
import type { TrajectorySplitInput } from "./trajectorySimplify.ts";
import { trajectoryError } from "./errorContract.ts";

/** Which coordinate of a trajectory sample each move track writes. */
type TrajectoryAxis = "x" | "y" | "rotation";

/** Maps each expanded event track to the sample coordinate it stores. */
export const TRAJECTORY_AXES: Record<string, TrajectoryAxis> = {
  moveXEvents: "x",
  moveYEvents: "y",
  rotateEvents: "rotation",
};

/** The split options `expandTrajectory` accepts, plus an explicit segment count. */
export interface TrajectoryExpandOverrides extends TrajectorySplitInput {
  segments?: number;
}

/**
 * Splits one whole-curve trajectory event into the per-track events that replace
 * it, keyed by `TRAJECTORY_AXES`.
 *
 * This is a chart transformation with no editor state of its own: the caller
 * supplies the tempo map. The document layer needs it for PEZ export, so it
 * lives with the model.
 */
export function expandTrajectory(
  event: JudgeLineEvent,
  tempo: TempoMap,
  overrides: TrajectoryExpandOverrides = {},
): Map<string, JudgeLineEvent[]> {
  const trajectory = event.trajectory;
  if (!trajectory) {
    throw trajectoryError("eventRequired");
  }
  const evaluate = compileTrajectory(trajectory.options);
  const start = tempo.seconds(event.startTime);
  const end = tempo.seconds(event.endTime);
  const count = overrides.segments ?? trajectory.segments ?? 128;
  if (!Number.isInteger(count) || count < 4 || count > 8192) {
    throw trajectoryError("invalidSegments");
  }
  const settings = trajectorySplitSettings({ ...trajectory.split, ...overrides });
  const samples = Array.from({ length: count + 1 }, (unused, index) => evaluate(index / count));
  const result = new Map<string, JudgeLineEvent[]>(
    Object.entries(TRAJECTORY_AXES)
      .filter(([type]) => type !== "rotateEvents" || trajectoryHasRotation(trajectory.options))
      .map(([type]): [string, JudgeLineEvent[]] => [type, []]),
  );
  // Pin the first and last samples to the event's own beat endpoints.
  const beatAt = (index: number) =>
    index === 0
      ? beatValue(event.startTime)
      : index === count
        ? beatValue(event.endTime)
        : tempo.beat(start + ((end - start) * index) / count);
  for (const [type, entries] of result) {
    const values = samples.map((point) => point[TRAJECTORY_AXES[type]]);
    const pieces = settings.simplify
      ? simplifyTrajectorySamples(values, settings.tolerance)
      : Array.from({ length: count }, (unused, index) => ({
          first: index,
          last: index + 1,
          easingType: 1,
        }));
    for (const piece of pieces) {
      entries.push({
        ...createEvent(
          values[piece.first],
          values[piece.last],
          beatAt(piece.first),
          beatAt(piece.last),
        ),
        easingType: piece.easingType,
        startTime:
          piece.first === 0 ? [...event.startTime] : fromNumber(beatAt(piece.first), 192000000),
        endTime:
          piece.last === count ? [...event.endTime] : fromNumber(beatAt(piece.last), 192000000),
      });
    }
  }
  return result;
}
