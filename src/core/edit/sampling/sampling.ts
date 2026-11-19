/**
 * Workspace sampling rules for event values.
 *
 * A sampling session reads both anchors of one event at once, supports the five
 * geometric values the workspace can paint, and writes the start value, the end
 * value, and the easing curve in one history entry. This module owns the durable
 * guide preferences, the guide values, and the commit, so the inspector and the
 * workspace overlay cannot disagree about what a sample means.
 */
import { t } from "../../../i18n/index.ts";
import { assertChart } from "../../global/chart/chart.ts";
import { createChartObjectId } from "../../global/chart/identity.ts";
import type { JudgeLineEvent, LineEventValue } from "../../global/chart/chart.ts";
import {
  PREFERENCE_SECTIONS,
  preferences,
  readPreference,
  writePreference,
} from "../../state/preferences.ts";
import { createValue } from "../../state/values.ts";
import { isRecord } from "../../utils/guards.ts";
import { clamp } from "../../utils/numbers.ts";
import {
  chartWithEventLists,
  eventListAt,
  globalXYBindingEnabled,
  sameEventSpan,
  xyCounterpartType,
} from "../events/eventTracks.ts";
import type { EditorSession } from "../session/session.ts";

/** The event property a sampler reads from the workspace. */
export type SamplingAxis = "x" | "y" | "rotation" | "alpha" | "speed";

/** Smallest XY guide spacing, in chart units. */
export const SAMPLING_GUIDE_MIN = 10;
/** Largest XY guide spacing, in chart units. */
export const SAMPLING_GUIDE_MAX = 200;
/** Smallest rotation guide spacing, in degrees. */
export const SAMPLING_ANGLE_MIN = 5;
/** Largest rotation guide spacing, in degrees. */
export const SAMPLING_ANGLE_MAX = 90;
/** Smallest opacity guide spacing, in opacity units. */
export const SAMPLING_ALPHA_MIN = 1;
/** Largest opacity guide spacing, in opacity units. */
export const SAMPLING_ALPHA_MAX = 255;
/** Smallest speed guide spacing. */
export const SAMPLING_SPEED_MIN = 0.5;
/** Largest speed guide spacing. */
export const SAMPLING_SPEED_MAX = 10;
/** Smallest guide opacity percentage. */
export const SAMPLING_GUIDE_OPACITY_MIN = 0;
/** Largest guide opacity percentage. */
export const SAMPLING_GUIDE_OPACITY_MAX = 100;

/** Durable sampler preferences shared by every sampling session. */
export interface SamplingSettings {
  /** Whether guide-assisted snapping is active. */
  guidesEnabled: boolean;
  /** XY guide spacing in chart units. */
  guideStep: number;
  /** Rotation guide spacing in degrees. */
  angleGuideStep: number;
  /** Opacity guide spacing in opacity units. */
  alphaGuideStep: number;
  /** Speed guide spacing in speed units. */
  speedGuideStep: number;
  /** Whether sampling one horizontal or vertical event creates its counterpart. */
  xyBinding: boolean;
  /** Opacity percentage applied to sampler and trajectory helper lines. */
  guideOpacity: number;
}

/** Defaults used before the first preference write. */
export const DEFAULT_SAMPLING_SETTINGS: SamplingSettings = {
  guidesEnabled: true,
  guideStep: 50,
  angleGuideStep: 30,
  alphaGuideStep: 20,
  speedGuideStep: 2,
  xyBinding: true,
  guideOpacity: 50,
};

/** One event a sampling session targets. */
export interface SamplingTarget {
  lineIndex: number;
  eventType: string;
  eventIndex: number;
  /** Stable chart object id when the event has one, so edits follow reordering. */
  eventId?: string;
  eventLayer: number;
  axis: SamplingAxis;
}

/** One sampled scalar, with the chart-space point when the axis came from XY. */
export interface SamplingValue {
  axis: SamplingAxis;
  scalar: number;
  /** Chart-space pointer location retained for the rendered anchor; writes use only the active axis. */
  point?: { x: number; y: number };
}

/** The two value anchors one sample fills. */
export interface SamplingAnchors {
  start: SamplingValue;
  end: SamplingValue;
}

/** Easing fields a sample may write; omitted fields keep the event's current value. */
export interface SamplingCurve {
  /** Curve preset index in the range 1..29. */
  easingType?: number;
  /** Whether the event uses the cubic bezier control points instead of the preset. */
  bezier?: number | boolean;
  /** Four control points `[x1, y1, x2, y2]`; x stays in `[0, 1]` and never decreases. */
  bezierPoints?: number[];
  /** Start of the selected preset sub-range in `[0, 1]`. */
  easingLeft?: number;
  /** End of the selected preset sub-range in `[0, 1]`. */
  easingRight?: number;
}

/** Identity cubic bezier control points. */
const IDENTITY_BEZIER_POINTS = [0, 0, 1, 1] as const;

/** The axis one event track samples, or null when the track has no sampler. */
export function samplingAxisForEventType(type: string): SamplingAxis | null {
  switch (type) {
    case "moveXEvents":
      return "x";
    case "moveYEvents":
      return "y";
    case "rotateEvents":
      return "rotation";
    case "alphaEvents":
      return "alpha";
    case "speedEvents":
      return "speed";
    default:
      return null;
  }
}

/** The value domain one axis samples, used to map a workspace dimension to a value. */
export function samplingRangeOf(axis: SamplingAxis): { min: number; max: number } {
  switch (axis) {
    case "x":
    case "y":
      return { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY };
    case "rotation":
      return { min: -180, max: 180 };
    case "alpha":
      return { min: 0, max: 255 };
    case "speed":
      return { min: 0, max: 20 };
  }
}

/** Round to a fixed decimal count while keeping negative zero out of chart data. */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) {
    return value === 0 ? 0 : value;
  }
  const nudged = scaled + Math.sign(scaled) * Number.EPSILON * Math.abs(scaled);
  const rounded = Math.round(nudged) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Clamp one stored or patched setting and keep two decimal places. */
function boundedSetting(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? roundTo(clamp(value, minimum, maximum), 2)
    : fallback;
}

/** Read a boolean setting under its current name, then its legacy name. */
function storedBoolean(
  stored: Record<string, unknown>,
  primary: string,
  legacy: string | undefined,
  fallback: boolean,
): boolean {
  if (typeof stored[primary] === "boolean") {
    return stored[primary] as boolean;
  }
  if (legacy !== undefined && typeof stored[legacy] === "boolean") {
    return stored[legacy] as boolean;
  }
  return fallback;
}

/** Read a bounded number under its current name, then its legacy name. */
function storedNumber(
  stored: Record<string, unknown>,
  primary: string,
  legacy: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  for (const key of legacy === undefined ? [primary] : [primary, legacy]) {
    const value = stored[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return boundedSetting(value, minimum, maximum, fallback);
    }
  }
  return fallback;
}

/** Build the guide list for a bounded linear axis. */
function steppedGuides(minimum: number, maximum: number, step: number, includeMaximum: boolean) {
  const values: number[] = [];
  const count = Math.floor((maximum - minimum) / step + 1e-9);
  for (let index = 0; index <= count; index++) {
    const value = roundTo(minimum + index * step, 2);
    if (!includeMaximum && value >= maximum - 1e-9) {
      break;
    }
    values.push(value);
  }
  if (includeMaximum && values.at(-1) !== maximum) {
    values.push(maximum);
  }
  return values;
}

/** The guide values one axis paints under the current settings. */
export function samplingGuideValues(axis: SamplingAxis, settings: SamplingSettings): number[] {
  switch (axis) {
    case "x":
    case "y":
      return [];
    case "alpha": {
      const step = Math.round(
        boundedSetting(
          settings.alphaGuideStep,
          SAMPLING_ALPHA_MIN,
          SAMPLING_ALPHA_MAX,
          DEFAULT_SAMPLING_SETTINGS.alphaGuideStep,
        ),
      );
      return steppedGuides(0, 255, step, true);
    }
    case "rotation": {
      const step = boundedSetting(
        settings.angleGuideStep,
        SAMPLING_ANGLE_MIN,
        SAMPLING_ANGLE_MAX,
        DEFAULT_SAMPLING_SETTINGS.angleGuideStep,
      );
      return steppedGuides(-180, 180, step, true);
    }
    case "speed": {
      const step = boundedSetting(
        settings.speedGuideStep,
        SAMPLING_SPEED_MIN,
        SAMPLING_SPEED_MAX,
        DEFAULT_SAMPLING_SETTINGS.speedGuideStep,
      );
      return steppedGuides(0, 20, step, true);
    }
  }
}

/** Normalize an axis value while retaining scalar values outside the guide domain. */
export function normalizeSamplingScalar(axis: SamplingAxis, raw: number): number {
  const value = Number.isFinite(raw) ? raw : 0;
  switch (axis) {
    case "x":
    case "y":
      return roundTo(value, 2);
    case "rotation":
      return value;
    case "alpha":
      return Math.round(value);
    case "speed":
      return roundTo(value, 2);
  }
}

/** Read the stored sampler preferences, migrating the old grid field names. */
export function readSamplingSettings(): SamplingSettings {
  const stored = readPreference<unknown>(PREFERENCE_SECTIONS.sampler, null);
  const record = isRecord(stored) ? stored : {};
  return {
    guidesEnabled: storedBoolean(
      record,
      "guidesEnabled",
      "gridEnabled",
      DEFAULT_SAMPLING_SETTINGS.guidesEnabled,
    ),
    guideStep: storedNumber(
      record,
      "guideStep",
      "gridSize",
      SAMPLING_GUIDE_MIN,
      SAMPLING_GUIDE_MAX,
      DEFAULT_SAMPLING_SETTINGS.guideStep,
    ),
    angleGuideStep: storedNumber(
      record,
      "angleGuideStep",
      "angleGridSize",
      SAMPLING_ANGLE_MIN,
      SAMPLING_ANGLE_MAX,
      DEFAULT_SAMPLING_SETTINGS.angleGuideStep,
    ),
    alphaGuideStep: Math.round(
      storedNumber(
        record,
        "alphaGuideStep",
        undefined,
        SAMPLING_ALPHA_MIN,
        SAMPLING_ALPHA_MAX,
        DEFAULT_SAMPLING_SETTINGS.alphaGuideStep,
      ),
    ),
    speedGuideStep: storedNumber(
      record,
      "speedGuideStep",
      undefined,
      SAMPLING_SPEED_MIN,
      SAMPLING_SPEED_MAX,
      DEFAULT_SAMPLING_SETTINGS.speedGuideStep,
    ),
    xyBinding: storedBoolean(record, "xyBinding", undefined, DEFAULT_SAMPLING_SETTINGS.xyBinding),
    guideOpacity: storedNumber(
      record,
      "guideOpacity",
      undefined,
      SAMPLING_GUIDE_OPACITY_MIN,
      SAMPLING_GUIDE_OPACITY_MAX,
      DEFAULT_SAMPLING_SETTINGS.guideOpacity,
    ),
  };
}

/** The live settings cell shared by the inspector and the workspace overlay. */
export const samplingSettings = createValue<SamplingSettings>({ initial: readSamplingSettings() });

// Durable preferences may be adopted from the local service after this module
// loads; re-read the section so the sampler controls follow the stored values.
preferences.subscribe(PREFERENCE_SECTIONS.sampler, () => {
  samplingSettings.set(readSamplingSettings());
});

/** Persist one settings change and publish it to every sampler surface. */
export function updateSamplingSettings(patch: Partial<SamplingSettings>): SamplingSettings {
  const current = samplingSettings.get();
  const next: SamplingSettings = {
    guidesEnabled:
      typeof patch.guidesEnabled === "boolean" ? patch.guidesEnabled : current.guidesEnabled,
    guideStep:
      patch.guideStep === undefined
        ? current.guideStep
        : boundedSetting(
            patch.guideStep,
            SAMPLING_GUIDE_MIN,
            SAMPLING_GUIDE_MAX,
            current.guideStep,
          ),
    angleGuideStep:
      patch.angleGuideStep === undefined
        ? current.angleGuideStep
        : boundedSetting(
            patch.angleGuideStep,
            SAMPLING_ANGLE_MIN,
            SAMPLING_ANGLE_MAX,
            current.angleGuideStep,
          ),
    alphaGuideStep:
      patch.alphaGuideStep === undefined
        ? current.alphaGuideStep
        : Math.round(
            boundedSetting(
              patch.alphaGuideStep,
              SAMPLING_ALPHA_MIN,
              SAMPLING_ALPHA_MAX,
              current.alphaGuideStep,
            ),
          ),
    speedGuideStep:
      patch.speedGuideStep === undefined
        ? current.speedGuideStep
        : boundedSetting(
            patch.speedGuideStep,
            SAMPLING_SPEED_MIN,
            SAMPLING_SPEED_MAX,
            current.speedGuideStep,
          ),
    xyBinding: typeof patch.xyBinding === "boolean" ? patch.xyBinding : current.xyBinding,
    guideOpacity:
      patch.guideOpacity === undefined
        ? current.guideOpacity
        : boundedSetting(
            patch.guideOpacity,
            SAMPLING_GUIDE_OPACITY_MIN,
            SAMPLING_GUIDE_OPACITY_MAX,
            current.guideOpacity,
          ),
  };
  writePreference(PREFERENCE_SECTIONS.sampler, next);
  samplingSettings.set(next);
  return next;
}

/** Resolve the sampling-local toggle together with the settings-page override. */
export function samplingXYBindingEnabled(settings: SamplingSettings): boolean {
  return settings.xyBinding || globalXYBindingEnabled();
}

/** Validated bezier points, with an all-identical degenerate control set repaired. */
function normalizeProvidedBezierPoints(points: unknown): number[] {
  if (
    !Array.isArray(points) ||
    points.length !== 4 ||
    !points.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new Error("Sampling bezierPoints must contain four finite numbers.");
  }
  const values = points as number[];
  const [firstX, , secondX] = values;
  if (firstX < 0 || firstX > 1 || secondX < 0 || secondX > 1 || firstX > secondX) {
    throw new Error(
      "Sampling bezierPoints x coordinates must stay within [0, 1] and not decrease.",
    );
  }
  const degenerate = values.every((value) => value === values[0]);
  return degenerate ? [...IDENTITY_BEZIER_POINTS] : [...values];
}

/** Repair existing or missing control points instead of writing an unusable curve. */
function repairBezierPoints(points: unknown): number[] {
  try {
    return [...normalizeProvidedBezierPoints(points)];
  } catch {
    return [...IDENTITY_BEZIER_POINTS];
  }
}

/** Validate one easing range boundary. */
function unitEasingValue(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Sampling ${name} must be a finite number between 0 and 1.`);
  }
  return value;
}

/**
 * Apply the optional curve payload to one event.
 *
 * A missing field keeps the event's current value. An invalid preset index is
 * ignored so the existing easing survives, while structurally invalid control
 * points or range bounds throw before any chart is committed.
 */
function applySamplingCurve(
  event: JudgeLineEvent,
  easingType: number | undefined,
  curve: SamplingCurve,
): JudgeLineEvent {
  const next: JudgeLineEvent = { ...event };
  const requestedEasing = curve.easingType === undefined ? easingType : curve.easingType;
  if (
    typeof requestedEasing === "number" &&
    Number.isInteger(requestedEasing) &&
    requestedEasing >= 1 &&
    requestedEasing <= 29
  ) {
    next.easingType = requestedEasing;
  }

  const providedPoints =
    curve.bezierPoints === undefined ? null : normalizeProvidedBezierPoints(curve.bezierPoints);
  const bezierSelected = curve.bezier !== undefined && Boolean(curve.bezier);
  if (curve.bezier !== undefined) {
    next.bezier = bezierSelected ? 1 : 0;
  }
  if (providedPoints) {
    next.bezierPoints = providedPoints;
  } else if (bezierSelected || Boolean(next.bezier)) {
    next.bezierPoints = repairBezierPoints(next.bezierPoints);
  }

  if (curve.easingLeft !== undefined || curve.easingRight !== undefined) {
    const currentLeft =
      typeof event.easingLeft === "number" && Number.isFinite(event.easingLeft)
        ? event.easingLeft
        : 0;
    const currentRight =
      typeof event.easingRight === "number" && Number.isFinite(event.easingRight)
        ? event.easingRight
        : 1;
    const left =
      curve.easingLeft === undefined
        ? currentLeft
        : unitEasingValue(curve.easingLeft, "easingLeft");
    const right =
      curve.easingRight === undefined
        ? currentRight
        : unitEasingValue(curve.easingRight, "easingRight");
    if (left > right) {
      throw new Error("Sampling easingLeft must not exceed easingRight.");
    }
    if (curve.easingLeft !== undefined) {
      next.easingLeft = left;
    }
    if (curve.easingRight !== undefined) {
      next.easingRight = right;
    }
  }
  return next;
}

/** True when a value is a finite number and usable as a sampled scalar. */
function numericValue(value: LineEventValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The event index a target addresses, preferring its stable id. */
function resolveEventIndex(target: SamplingTarget, events: readonly JudgeLineEvent[]): number {
  if (target.eventId) {
    const byId = events.findIndex((event) => event.id === target.eventId);
    if (byId >= 0) {
      return byId;
    }
  }
  return target.eventIndex;
}

/** Copy the curve fields from the edited event onto its XY counterpart. */
function copyCurveFields(target: JudgeLineEvent, source: JudgeLineEvent): void {
  if (source.easingType === undefined) {
    delete target.easingType;
  } else {
    target.easingType = source.easingType;
  }
  if (source.easingLeft === undefined) {
    delete target.easingLeft;
  } else {
    target.easingLeft = source.easingLeft;
  }
  if (source.easingRight === undefined) {
    delete target.easingRight;
  } else {
    target.easingRight = source.easingRight;
  }
  if (source.bezier === undefined) {
    delete target.bezier;
  } else {
    target.bezier = source.bezier;
  }
  if (source.bezierPoints === undefined) {
    delete target.bezierPoints;
  } else {
    target.bezierPoints = structuredClone(source.bezierPoints);
  }
}

/**
 * Build the counterpart event for XY binding.
 *
 * The copy carries the edited event's time span, values, and full easing curve
 * but never its link group or trajectory metadata. An existing counterpart keeps
 * its id; a new one receives a fresh id.
 */
function counterpartEvent(
  source: JudgeLineEvent,
  start: number,
  end: number,
  existing?: JudgeLineEvent,
): JudgeLineEvent {
  const copy = structuredClone(existing ?? source);
  copy.startTime = structuredClone(source.startTime);
  copy.endTime = structuredClone(source.endTime);
  copy.start = start;
  copy.end = end;
  copyCurveFields(copy, source);
  delete copy.linkgroup;
  delete copy.trajectory;
  delete copy.trajectoryAxis;
  copy.id = existing?.id ?? createChartObjectId();
  return copy;
}

/** Outcome of one sampled commit. */
export interface SamplingApplyResult {
  /** Whether XY binding created a missing counterpart track event. */
  createdCounterpart: boolean;
}

/**
 * Write both sampled anchors and the easing curve into the targeted event.
 *
 * Every write is one history entry. The fourth argument is either the preset
 * easing index or a full curve payload; the optional sixth argument adds curve
 * fields when the fourth is a number. With XY binding enabled and both anchors
 * carrying a chart point, a horizontal or vertical sample also creates or
 * updates the counterpart event on the other axis.
 */
export function applySamplingAnchors(
  session: EditorSession,
  target: SamplingTarget,
  anchors: SamplingAnchors,
  easingType: number | SamplingCurve,
  settings: SamplingSettings,
  curve?: SamplingCurve,
): SamplingApplyResult {
  const events = eventListAt(session, target.lineIndex, target.eventType, target.eventLayer);
  const index = resolveEventIndex(target, events);
  const event = events[index];
  if (!event) {
    throw new Error(t("editorPanels.sampling.eventMissing"));
  }
  if (numericValue(event.start) === null || (!event.inst && numericValue(event.end) === null)) {
    throw new Error(t("editorPanels.sampling.eventMissing"));
  }

  const startScalar = normalizeSamplingScalar(target.axis, anchors.start.scalar);
  const endScalar = normalizeSamplingScalar(target.axis, anchors.end.scalar);
  const positionalEasing = typeof easingType === "number" ? easingType : undefined;
  const curvePayload: SamplingCurve =
    typeof easingType === "number" ? { ...(curve ?? {}) } : { ...easingType, ...(curve ?? {}) };
  const nextEvent = applySamplingCurve(
    {
      ...event,
      ...(event.inst
        ? { start: startScalar, end: startScalar }
        : { start: startScalar, end: endScalar }),
    },
    positionalEasing,
    curvePayload,
  );

  const updates = new Map<string, JudgeLineEvent[]>();
  const sourceTrack = [...events];
  sourceTrack[index] = nextEvent;
  updates.set(target.eventType, sourceTrack);

  let createdCounterpart = false;
  const counterpartType = xyCounterpartType(target.eventType);
  const startPoint = anchors.start.point;
  const endPoint = anchors.end.point;
  if (counterpartType && samplingXYBindingEnabled(settings) && startPoint && endPoint) {
    const counterpartAxis: SamplingAxis = target.eventType === "moveXEvents" ? "y" : "x";
    const coordinate = counterpartAxis === "y" ? "y" : "x";
    const counterpartStart = normalizeSamplingScalar(counterpartAxis, startPoint[coordinate]);
    const counterpartEnd = nextEvent.inst
      ? counterpartStart
      : normalizeSamplingScalar(counterpartAxis, endPoint[coordinate]);
    const counterpartTrack = eventListAt(
      session,
      target.lineIndex,
      counterpartType,
      target.eventLayer,
    );
    const existingIndex = counterpartTrack.findIndex((candidate) =>
      sameEventSpan(candidate, nextEvent),
    );
    if (existingIndex >= 0) {
      const nextTrack = [...counterpartTrack];
      nextTrack[existingIndex] = counterpartEvent(
        nextEvent,
        counterpartStart,
        counterpartEnd,
        counterpartTrack[existingIndex],
      );
      updates.set(counterpartType, nextTrack);
    } else {
      updates.set(counterpartType, [
        ...counterpartTrack,
        counterpartEvent(nextEvent, counterpartStart, counterpartEnd),
      ]);
      createdCounterpart = true;
    }
  }

  const chart = chartWithEventLists(session.chart, target.lineIndex, target.eventLayer, updates);
  assertChart(chart);
  const committed = session.commitChart(
    t("editor.session.sampleEvent"),
    chart,
    session.selectionState(),
    {},
    { normalized: true },
  );
  if (!committed) {
    throw new Error(t("editorPanels.sampling.readOnly"));
  }
  return { createdCounterpart };
}
