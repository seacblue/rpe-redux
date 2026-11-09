/**
 * Authors curve trajectories as ordinary move/rotate events and expands
 * trajectory wrappers already stored on a judge line.
 *
 * The editor generates plain events; a `trajectory` object is only used inside
 * the single transaction that expands the sampled curve, so a failed generation
 * never leaves a partially written event list behind.
 */
import { t } from "../../../i18n/index.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";
import { beatCopy, beatValue, fromNumber, type Beat } from "../../global/chart/timing/beat.ts";
import { createEvent, assertChart } from "../../global/chart/chart.ts";
import type { Chart, JudgeLineEvent, LineEventLayer } from "../../global/chart/chart.ts";
import {
  compileTrajectory,
  sampleCurveTrajectory,
  trajectoryHasRotation,
} from "../../global/chart/trajectory/curveTrajectory.ts";
import type { EditableTrajectoryOptions } from "../../global/chart/trajectory/curveTrajectory.ts";
import { trajectorySplitSettings } from "../../global/chart/trajectory/trajectorySimplify.ts";
import type { TrajectorySplitInput } from "../../global/chart/trajectory/trajectorySimplify.ts";
import { EventTrack } from "../../global/chart/timing/events.ts";
import { TempoMap } from "../../global/chart/timing/tempo.ts";
import {
  TRAJECTORY_AXES,
  expandTrajectory,
  type TrajectoryExpandOverrides,
} from "../../global/chart/trajectory/expandTrajectory.ts";
import { chartWithEventLists } from "./eventTracks.ts";

/** A layer whose track map accepts a runtime-computed track name. */
type TrackedLayer = LineEventLayer & { [track: string]: JudgeLineEvent[] | undefined };

/** Builds an unexpanded trajectory event with copied beats and split settings. */
export function createTrajectoryEvent(
  options: EditableTrajectoryOptions,
  startTime: Beat,
  endTime: Beat,
  segments = 128,
  split: TrajectorySplitInput = {},
): JudgeLineEvent {
  const start = beatValue(startTime);
  const end = beatValue(endTime);
  if (start < 0 || end <= start) {
    throw new Error(t("editor.commands.trajectoryCommands.error.trajectoryRange"));
  }
  if (!Number.isInteger(segments) || segments < 4 || segments > 8192) {
    throw new Error(t("editor.commands.trajectoryCommands.error.segments"));
  }
  sampleCurveTrajectory(options, 257);
  const evaluate = compileTrajectory(options);
  return {
    ...createEvent(evaluate(0).x, evaluate(1).x, start, end),
    startTime: beatCopy(startTime),
    endTime: beatCopy(endTime),
    trajectory: {
      version: 1,
      options: structuredClone(options),
      segments,
      split: trajectorySplitSettings(split),
    },
  };
}

/** Inserts the trajectory event and trims or replaces overlapping move/rotate spans. */
export function trajectoryChart(
  initialChart: Chart,
  lineIndex: number,
  layerIndex: number,
  event: JudgeLineEvent,
  editing: JudgeLineEvent | null = null,
  replace = false,
): Chart {
  let chart = initialChart;
  if (editing) {
    for (let sourceLine = 0; sourceLine < (chart.judgeLineList ?? []).length; sourceLine++) {
      for (
        let sourceLayer = 0;
        sourceLayer < (chart.judgeLineList?.[sourceLine]?.eventLayers ?? []).length;
        sourceLayer++
      ) {
        const source = chart.judgeLineList?.[sourceLine]?.eventLayers?.[sourceLayer]?.moveXEvents;
        if (source?.includes(editing) && (sourceLine !== lineIndex || sourceLayer !== layerIndex)) {
          chart = chartWithEventLists(
            chart,
            sourceLine,
            sourceLayer,
            new Map([["moveXEvents", source.filter((candidate) => candidate !== editing)]]),
          );
        }
      }
    }
  }
  const line = chart.judgeLineList?.[lineIndex];
  if (!line || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 3) {
    throw new Error(t("editor.commands.trajectoryCommands.error.targetLine"));
  }
  const layer: TrackedLayer = { ...(line.eventLayers?.[layerIndex] ?? {}) };
  const begin = beatValue(event.startTime);
  const finish = beatValue(event.endTime);
  const tempo = new TempoMap(chart.BPMList);
  const factor = line.bpmfactor ?? 1;
  const updates = new Map<string, JudgeLineEvent[]>();
  for (const type of Object.keys(TRAJECTORY_AXES)) {
    if (type === "rotateEvents" && !trajectoryHasRotation(event.trajectory?.options)) {
      continue;
    }
    const entries: JudgeLineEvent[] = [];
    for (const original of layer[type] ?? []) {
      if (original === editing) {
        continue;
      }
      const start = beatValue(original.startTime);
      const end = beatValue(original.endTime);
      if (begin >= end || finish <= start) {
        entries.push(original);
        continue;
      }
      if (!replace) {
        throw new Error(t("editor.commands.trajectoryCommands.error.occupiedRange"));
      }
      if (original.trajectory) {
        throw new Error(t("editor.commands.trajectoryCommands.error.existingTrajectory"));
      }
      const track = new EventTrack([original], tempo, factor);
      const secondsStart = tempo.seconds(original.startTime, factor);
      const secondsEnd = tempo.seconds(original.endTime, factor);
      /** Rebuilds the surviving part of a trimmed event with adjusted easing. */
      const clipped = (first: number, last: number): JudgeLineEvent => {
        const startTime = fromNumber(first, 192000000);
        const endTime = fromNumber(last, 192000000);
        const left = original.easingLeft ?? 0;
        const range = (original.easingRight ?? 1) - left;
        return {
          ...original,
          startTime,
          endTime,
          start: track.value(tempo.seconds(startTime, factor)),
          end: track.value(tempo.seconds(endTime, factor)),
          easingLeft:
            left +
            (range * (tempo.seconds(startTime, factor) - secondsStart)) /
              (secondsEnd - secondsStart),
          easingRight:
            left +
            (range * (tempo.seconds(endTime, factor) - secondsStart)) / (secondsEnd - secondsStart),
        };
      };
      if (original.bezier && (start < begin || end > finish)) {
        throw new Error(t("editor.commands.trajectoryCommands.error.bezierCrossing"));
      }
      if (start < begin) {
        entries.push(clipped(start, begin));
      }
      if (end > finish) {
        entries.push(clipped(finish, end));
      }
    }
    if (type === "moveXEvents") {
      entries.push(event);
    }
    updates.set(type, entries);
  }
  const result = chartWithEventLists(chart, lineIndex, layerIndex, updates);
  assertChart(result);
  return result;
}

/**
 * Author a trajectory as ordinary move/rotate events.
 *
 * The editor inserts the authored event, expands it, and removes the temporary
 * `event.trajectory` wrapper in one chart transaction. Charts that already carry
 * trajectory data remain readable through `splitTrajectoryChart`.
 */
export function generateTrajectoryChart(
  chart: Chart,
  lineIndex: number,
  layerIndex: number,
  event: JudgeLineEvent,
  editing: JudgeLineEvent | null = null,
  replace = false,
): Chart {
  const withTrajectory = trajectoryChart(chart, lineIndex, layerIndex, event, editing, replace);
  return splitTrajectoryChart(withTrajectory, lineIndex, layerIndex, event, {
    segments: event.trajectory?.segments,
  });
}

/** Replaces one trajectory event with its expanded plain-event samples. */
export function splitTrajectoryChart(
  chart: Chart,
  lineIndex: number,
  layerIndex: number,
  event: JudgeLineEvent,
  settings: TrajectoryExpandOverrides = {},
): Chart {
  const line = chart.judgeLineList?.[lineIndex];
  if (!line) {
    throw new Error(t("editor.commands.trajectoryCommands.error.selectTrajectory"));
  }
  const layer: TrackedLayer = { ...(line.eventLayers?.[layerIndex] ?? {}) };
  if (!layer.moveXEvents?.includes(event) || !event.trajectory) {
    throw new Error(t("editor.commands.trajectoryCommands.error.selectTrajectory"));
  }
  const fragments = expandTrajectory(
    event,
    new TempoMap(chart.BPMList),
    line.bpmfactor ?? 1,
    settings,
  );
  const updates = new Map<string, JudgeLineEvent[]>(
    [...fragments].map(([type, entries]): [string, JudgeLineEvent[]] => [
      type,
      [...(layer[type] ?? []).filter((candidate) => candidate !== event), ...entries].sort(
        (left, right) => beatValue(left.startTime) - beatValue(right.startTime),
      ),
    ]),
  );
  return chartWithEventLists(chart, lineIndex, layerIndex, updates);
}

// ------------------------------------------------------------------ shortcuts

/** Curve capture stays unbound by default; both actions are available for custom bindings. */
export const trajectoryShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "event.trajectory.capture.begin",
    category: "editor.curve",
    title: "shortcuts.editor.curveBegin",
    scope: "editor",
    defaults: [],
  },
  {
    id: "event.trajectory.capture.end",
    category: "editor.curve",
    title: "shortcuts.editor.curveEnd",
    scope: "editor",
    defaults: [],
  },
];
