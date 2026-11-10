/**
 * Generates ordinary chart events from one curve Bezier path and shares the
 * t-easing map the live preview marker samples through.
 */
import { beatValue } from "../../../../core/global/chart/timing/beat.ts";
import {
  createEvent,
  type Chart,
  type JudgeLineEvent,
  type LineEventLayer,
} from "../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../core/edit/session/session.ts";
import { simplifyTrajectorySamples } from "../../../../core/global/chart/trajectory/trajectorySimplify.ts";
import { easing } from "../../../../core/utils/easing.ts";
import { t } from "../../../../i18n/index.ts";
import { sampleComponentAt, type CurvePathComponent } from "./pathModel.ts";

/** Inputs for one generation commit. */
export interface GenerateOptions {
  component: CurvePathComponent;
  startBeat: number;
  endBeat: number;
  layer: number;
  /** Maximum beat distance between two sampled cut points. */
  cutStepBeats: number;
  /** Easing applied to the path parameter while events walk the curve. */
  tEasing: number;
  /** Fit sampled values into eased event pieces when true. */
  fit: boolean;
  /** Allowed value error when fitting. */
  fitTolerance: number;
  replace: boolean;
}

/** The committed chart and the number of events it gained. */
export interface GenerateResult {
  chart: Chart;
  count: number;
}

/** Upper bound on sampled cut intervals for one generated path. */
const MAX_CUT_INTERVALS = 8192;

/**
 * Map one raw 0-1 transport progress through the generation's t-easing.
 *
 * The preview marker and `easedSampleProgresses` share this function so the
 * marker always sits on the path position the next generated cut would use.
 * Overshooting curves clamp to the path endpoints.
 */
export function easedPathProgress(progress: number, tEasing: number): number {
  const type = Number.isInteger(tEasing) && tEasing >= 1 && tEasing <= 29 ? tEasing : 1;
  const amount = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return Math.min(1, Math.max(0, easing(amount, type)));
}

/**
 * Normalized path positions for one generated range.
 *
 * Cut points stay evenly spaced in beat time; easing moves them along the
 * path, so the generated movement accelerates and decelerates. Overshooting
 * curves are clamped to the path endpoints, which keeps every event valid.
 */
export function easedSampleProgresses(count: number, tEasing: number): number[] {
  const intervals = Number.isInteger(count) && count > 0 ? count : 1;
  return Array.from({ length: intervals + 1 }, (unused, index) =>
    easedPathProgress(index / intervals, tEasing),
  );
}

/**
 * Turn one sampled axis into ordinary events.
 *
 * Each cut interval becomes one piece when fitting is off. With fitting on,
 * `simplifyTrajectorySamples` groups consecutive samples into the longest
 * eased pieces that stay within the tolerance.
 */
export function curveEventPieces(
  values: readonly number[],
  startBeat: number,
  endBeat: number,
  fit: boolean,
  tolerance: number,
): JudgeLineEvent[] {
  const count = values.length - 1;
  if (count < 1) {
    return [];
  }
  const beatAt = (index: number) => startBeat + ((endBeat - startBeat) * index) / count;
  const pieces = fit
    ? simplifyTrajectorySamples(values, tolerance)
    : Array.from({ length: count }, (unused, index) => ({
        first: index,
        last: index + 1,
        easingType: 1,
      }));
  return pieces.map((piece) => {
    const event = createEvent(
      values[piece.first],
      values[piece.last],
      beatAt(piece.first),
      beatAt(piece.last),
    );
    event.easingType = piece.easingType;
    return event;
  });
}

/** Whether two beat spans share more than an endpoint. */
function overlaps(event: JudgeLineEvent, start: number, end: number): boolean {
  return beatValue(event.startTime) < end && beatValue(event.endTime) > start;
}

/** Replace or extend one event track, refusing a non-replace overlap. */
function withTrack(
  layer: LineEventLayer,
  track: "moveXEvents" | "moveYEvents",
  events: JudgeLineEvent[],
  start: number,
  end: number,
  replace: boolean,
): LineEventLayer {
  const existing = layer[track] ?? [];
  if (!replace && existing.some((event) => overlaps(event, start, end))) {
    throw new Error("curve.range.occupied");
  }
  // A track stores its events in time order. The replaced range can sit before
  // or after the surviving events, so appending alone would leave a later event
  // ahead of the generated pieces.
  const combined = [
    ...(replace ? existing.filter((event) => !overlaps(event, start, end)) : existing),
    ...events,
  ].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime));
  return { ...layer, [track]: combined };
}

/** Build and commit one path as ordinary moveX/moveY events; throws `curve.*` error codes on invalid input. */
export function generateCurveEvents(
  session: EditorSession,
  options: GenerateOptions,
): GenerateResult {
  if (!session.editable) {
    throw new Error("curve.readonly");
  }
  if (options.endBeat <= options.startBeat) {
    throw new Error("curve.range.invalid");
  }
  if (options.layer < 0 || options.layer > 3) {
    throw new Error("curve.layer.invalid");
  }
  if (!Number.isFinite(options.cutStepBeats) || options.cutStepBeats <= 0) {
    throw new Error("curve.cut.invalid");
  }
  if (options.fit && (!Number.isFinite(options.fitTolerance) || options.fitTolerance <= 0)) {
    throw new Error("curve.fit.invalid");
  }
  const intervals = Math.max(
    1,
    Math.ceil((options.endBeat - options.startBeat) / options.cutStepBeats),
  );
  if (intervals > MAX_CUT_INTERVALS) {
    throw new Error("curve.cut.tooFine");
  }
  const points = sampleComponentAt(
    options.component,
    easedSampleProgresses(intervals, options.tEasing),
  );
  if (points.length < 2) {
    throw new Error("curve.path.empty");
  }
  const xEvents = curveEventPieces(
    points.map((entry) => entry.x),
    options.startBeat,
    options.endBeat,
    options.fit,
    options.fitTolerance,
  );
  const yEvents = curveEventPieces(
    points.map((entry) => entry.y),
    options.startBeat,
    options.endBeat,
    options.fit,
    options.fitTolerance,
  );
  const chart = session.chart;
  const lines = [...(chart.judgeLineList ?? [])];
  const line = lines[session.lineIndex];
  if (!line) {
    throw new Error("curve.line.missing");
  }
  const layers = [...(line.eventLayers ?? [])];
  while (layers.length <= options.layer) {
    layers.push({});
  }
  let layer = layers[options.layer] ?? {};
  layer = withTrack(
    layer,
    "moveXEvents",
    xEvents,
    options.startBeat,
    options.endBeat,
    options.replace,
  );
  layer = withTrack(
    layer,
    "moveYEvents",
    yEvents,
    options.startBeat,
    options.endBeat,
    options.replace,
  );
  layers[options.layer] = layer;
  lines[session.lineIndex] = { ...line, eventLayers: layers };
  const next: Chart = { ...chart, judgeLineList: lines };
  const beforeSelection = session.selectionState();
  const committed = session.commitChart(
    t("editorPanels.curvePreview.authoring.commitGenerate"),
    next,
    beforeSelection,
    {},
    {
      afterSelection: {
        ...beforeSelection,
        eventLayer: options.layer,
        focus: "events",
        selection: [],
        eventSelection: [],
      },
    },
  );
  if (!committed) {
    throw new Error("curve.readonly");
  }
  return { chart: next, count: xEvents.length + yEvents.length };
}
