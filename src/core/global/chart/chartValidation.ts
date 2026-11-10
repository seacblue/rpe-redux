/**
 * Structural validation for a chart document.
 *
 * `assertChart` in `chart.ts` stays the whole-chart boundary: it runs the cycle
 * check, offers the extension hook, and then delegates the format rules here.
 * `assertEventTrackStructure` exposes the same per-event rules for an edit that
 * replaced one track, so the input path validates only the events it touched
 * while load, save, export, and transaction preview keep the full gate.
 */
import { t } from "../../../i18n/index.ts";
import { isBeat } from "./timing/beat.ts";
import { TempoMap } from "./timing/tempo.ts";
import { sampleCurveTrajectory } from "./trajectory/curveTrajectory.ts";
import { trajectorySplitSettings } from "./trajectory/trajectorySimplify.ts";
import { EVENT_TRACKS, isNoteType } from "./chartVocabulary.ts";
import { CONTROL_TRACKS } from "./chartTracks.ts";
import type { Chart, JudgeLine, JudgeLineEvent, JudgeLineNote, LineEventValue } from "./chart.ts";

/** Whether one event endpoint follows the track's value type. */
function validEventValue(entry: LineEventValue, type: string): boolean {
  if (type === "textEvents") {
    return typeof entry === "string";
  }
  if (type === "colorEvents") {
    return Array.isArray(entry) && entry.length === 3 && entry.every(Number.isFinite);
  }
  return Number.isFinite(entry);
}

/** Validate one note at a known line path; builds field paths only on failure. */
function assertNoteStructure(note: JudgeLineNote, linePath: string, index: number): void {
  if (!isBeat(note.startTime)) {
    throw new Error(
      t("model.beat.invalidTuple", { path: `${linePath}.notes[${index}].startTime` }),
    );
  }
  if (!isBeat(note.endTime)) {
    throw new Error(t("model.beat.invalidTuple", { path: `${linePath}.notes[${index}].endTime` }));
  }
  if (!isNoteType(note.type) || !Number.isFinite(note.positionX)) {
    throw new Error(t("model.chart.invalidNoteType", { path: `${linePath}.notes[${index}]` }));
  }
  if (note.speed !== undefined && !Number.isFinite(note.speed)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${linePath}.notes[${index}].speed`,
      }),
    );
  }
  if (note.size !== undefined && !Number.isFinite(note.size)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${linePath}.notes[${index}].size`,
      }),
    );
  }
  if (note.alpha !== undefined && !Number.isFinite(note.alpha)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${linePath}.notes[${index}].alpha`,
      }),
    );
  }
  if (note.yOffset !== undefined && !Number.isFinite(note.yOffset)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${linePath}.notes[${index}].yOffset`,
      }),
    );
  }
  if (note.visibleTime !== undefined && !Number.isFinite(note.visibleTime)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${linePath}.notes[${index}].visibleTime`,
      }),
    );
  }
}

/** Validate one event inside a named track; builds field paths only on failure. */
function assertEventStructure(
  event: JudgeLineEvent | null | undefined,
  type: string,
  trackPath: string,
  index: number,
): void {
  if (event?.trajectory) {
    if (type !== "moveXEvents" || event.trajectory.version !== 1) {
      throw new Error(t("model.chart.trajectoryTrack"));
    }
    sampleCurveTrajectory(event.trajectory.options, 65);
    trajectorySplitSettings(event.trajectory.split);
    if (
      !Number.isInteger(event.trajectory.segments) ||
      event.trajectory.segments < 4 ||
      event.trajectory.segments > 8192
    ) {
      throw new Error(t("model.trajectory.invalidSegments"));
    }
  }
  if (!isBeat(event?.startTime)) {
    throw new Error(t("model.beat.invalidTuple", { path: `${trackPath}[${index}].startTime` }));
  }
  if (!isBeat(event?.endTime)) {
    throw new Error(t("model.beat.invalidTuple", { path: `${trackPath}[${index}].endTime` }));
  }
  // Both beats are valid, so `event` is an object; the optional accesses above
  // only exist to keep a null entry on the beat-tuple error path.
  const current = event as JudgeLineEvent;
  if (
    type !== "paintEvents" &&
    (!validEventValue(current.start, type) || !validEventValue(current.end, type))
  ) {
    throw new Error(t("model.chart.invalidEventValue", { path: `${trackPath}[${index}]` }));
  }
  if (current.easingLeft !== undefined && !Number.isFinite(current.easingLeft)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${trackPath}[${index}].easingLeft`,
      }),
    );
  }
  if (current.easingRight !== undefined && !Number.isFinite(current.easingRight)) {
    throw new Error(
      t("model.validation.mustBeFiniteNumber", {
        target: `${trackPath}[${index}].easingRight`,
      }),
    );
  }
  if (
    current.bezier &&
    (!Array.isArray(current.bezierPoints) ||
      current.bezierPoints.length !== 4 ||
      !current.bezierPoints.every(Number.isFinite))
  ) {
    throw new Error(t("model.chart.invalidBezierPoints", { path: `${trackPath}[${index}]` }));
  }
}

/**
 * Validate one event track with the same rules the whole-chart validator uses.
 *
 * `path` is the track's JSON path (`judgeLineList[2].moveXEvents`); callers pass
 * a list that they just built, so only the affected events are walked.
 */
export function assertEventTrackStructure(
  events: readonly JudgeLineEvent[] | null | undefined,
  type: string,
  path: string,
): void {
  if (events == null) {
    return;
  }
  if (!Array.isArray(events)) {
    throw new Error(t("model.validation.mustBeArray", { target: path }));
  }
  for (let index = 0; index < events.length; index++) {
    assertEventStructure(events[index], type, path, index);
  }
}

/** Throws a descriptive error when the chart header fails structural rules. */
export function assertChartHeaderStructure(value: Chart): void {
  if (
    !value ||
    typeof value !== "object" ||
    !value.META ||
    typeof value.META !== "object" ||
    Array.isArray(value.META)
  ) {
    throw new Error(t("model.chart.missingMeta"));
  }
  if (value.judgeLineList != null && !Array.isArray(value.judgeLineList)) {
    throw new Error(t("model.validation.mustBeArray", { target: "judgeLineList" }));
  }
  new TempoMap(value.BPMList);
  if (value.META.offset !== undefined && !Number.isFinite(value.META.offset)) {
    throw new Error(t("model.chart.offsetNotFinite"));
  }
}

/** Throws a descriptive error when one judge line fails structural rules. */
export function assertJudgeLineStructure(line: JudgeLine, lineIndex: number): void {
  const path = `judgeLineList[${lineIndex}]`;
  if (!line || typeof line !== "object") {
    throw new Error(t("model.chart.invalidJudgeLine", { path }));
  }
  if (line.bpmfactor !== undefined && (!Number.isFinite(line.bpmfactor) || line.bpmfactor <= 0)) {
    throw new Error(t("model.chart.bpmFactorPositive", { path }));
  }
  if (line.notes != null && !Array.isArray(line.notes)) {
    throw new Error(t("model.validation.mustBeArray", { target: `${path}.notes` }));
  }
  const notes = line.notes ?? [];
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (!note || typeof note !== "object") {
      throw new Error(t("model.chart.invalidNote", { path: `${path}.notes[${index}]` }));
    }
    assertNoteStructure(note, path, index);
  }
  if (line.eventLayers != null && !Array.isArray(line.eventLayers)) {
    throw new Error(t("model.validation.mustBeArray", { target: `${path}.eventLayers` }));
  }
  for (const layer of [...(line.eventLayers ?? []), line.extended]) {
    if (!layer) {
      continue;
    }
    for (const type of EVENT_TRACKS) {
      const events = layer[type];
      if (events != null && !Array.isArray(events)) {
        throw new Error(t("model.validation.mustBeArray", { target: `${path}.${type}` }));
      }
      assertEventTrackStructure(events, type, `${path}.${type}`);
    }
  }
  for (const { field, property } of CONTROL_TRACKS) {
    const list = line[field];
    if (list == null) {
      continue;
    }
    if (!Array.isArray(list)) {
      throw new Error(t("model.validation.mustBeArray", { target: `${path}.${field}` }));
    }
    for (const [index, point] of list.entries()) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.[property])) {
        throw new Error(
          t("model.chart.invalidControlPoint", { path: `${path}.${field}[${index}]` }),
        );
      }
    }
  }
}

/** Throws a descriptive error when a chart fails the format's structural rules. */
export function assertChartStructure(value: Chart): void {
  assertChartHeaderStructure(value);
  (value.judgeLineList ?? []).forEach((line, lineIndex) => {
    assertJudgeLineStructure(line, lineIndex);
  });
}
