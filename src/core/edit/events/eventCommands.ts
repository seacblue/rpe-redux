/**
 * The operations that put an event onto a track and take it off again: placing
 * one where the pointer is, and deleting what is selected. They read and write
 * through `eventTracks.ts` and commit through `eventEdits.ts`, so the undo rule
 * lives in one place.
 */

import { t } from "../../../i18n/index.ts";
import { createEvent, isEventTrack, pinHookedEvent } from "../../global/chart/chart.ts";
import { createChartObjectId } from "../../global/chart/identity.ts";
import { judgeLineTraits } from "../../global/chart/line/lineTraits.ts";
import type { JudgeLineEvent, LineEventValue } from "../../global/chart/chart.ts";
import {
  beatValue,
  compareBeats,
  isBeat,
  maxBeat,
  minBeat,
  toBeat,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { trajectoryHasRotation } from "../../global/chart/trajectory/curveTrajectory.ts";
import type { EditorSession } from "../session/session.ts";
import {
  validateActionTarget,
  type ActionResult,
  type ActionTarget,
  type CoordinateActionInput,
} from "../operations/result.ts";
import {
  chartWithEventLists,
  eventKey,
  eventList,
  eventListAt,
  NOISE_ACTIVE_EVENTS,
  globalXYBindingEnabled,
  sameEventSpan,
  synchronizeXYEventTimes,
  xyCounterpartType,
} from "./eventTracks.ts";
import { commitEventLists, selectedEvents } from "./eventEdits.ts";
import { captureSelection } from "../selection/snapshot.ts";
import { commitSelectionEdit } from "../selection/edits.ts";

/** Appends an event with a fresh id and selects it. */
export function insertEventAt(
  session: EditorSession,
  lineIndex: number,
  type: string,
  event: JudgeLineEvent | PlacedShaderEvent,
  eventLayer = session.eventLayer,
  beforeSelection = session.selectionState(),
): void {
  const events = eventListAt(session, lineIndex, type, eventLayer);
  const insertedEvent = { ...event, id: createChartObjectId() } as JudgeLineEvent;
  const updates = new Map<string, JudgeLineEvent[]>([[type, [...events, insertedEvent]]]);
  let placedEvents = 1;
  const counterpartType = xyCounterpartType(type);
  if (counterpartType && globalXYBindingEnabled()) {
    const counterpart = createXYCounterpart(
      session,
      lineIndex,
      eventLayer,
      insertedEvent,
      counterpartType,
    );
    if (counterpart) {
      const counterpartEvents = eventListAt(session, lineIndex, counterpartType, eventLayer);
      updates.set(counterpartType, [...counterpartEvents, counterpart]);
      placedEvents += 1;
    }
  }
  const chart = chartWithEventLists(session.chart, lineIndex, eventLayer, updates);
  const key = eventKey(type, events.length);
  session.focus = "events";
  session.selection.clear();
  if (session.multiLineActive && session.multiLineMode === "events") {
    session.multiEventSelection.set(lineIndex, new Set([key]));
    if (lineIndex === session.lineIndex) {
      session.eventSelection = new Set([key]);
    }
  } else {
    session.eventSelection = new Set([key]);
  }
  session.commitChart(
    t("editor.commands.eventCommands.commitAddEvent"),
    chart,
    beforeSelection,
    {},
    {
      normalized: true,
      placement: { notes: 0, events: placedEvents },
    },
  );
}

/** Create a missing XY counterpart without changing an existing mismatched event. */
export function createXYCounterpart(
  session: EditorSession,
  lineIndex: number,
  eventLayer: number,
  source: JudgeLineEvent,
  counterpartType: "moveXEvents" | "moveYEvents",
  existingEvents = eventListAt(session, lineIndex, counterpartType, eventLayer),
): JudgeLineEvent | null {
  if (existingEvents.some((event) => sameEventSpan(event, source))) {
    return null;
  }
  try {
    const candidate = placedEvent(
      session,
      counterpartType,
      source.startTime,
      source.endTime,
      source.easingType,
      lineIndex,
      Boolean(source.inst),
      { eventLayer },
    );
    if (!candidate || "shader" in candidate) {
      return null;
    }
    const counterpart = {
      ...candidate,
      id: createChartObjectId(),
    };
    const counterpartFields = counterpart as Record<string, unknown>;
    const sourceFields = source as Record<string, unknown>;
    for (const field of [
      "easingType",
      "easingLeft",
      "easingRight",
      "bezier",
      "bezierPoints",
    ] as const) {
      const value = sourceFields[field];
      if (value === undefined) {
        delete counterpartFields[field];
      } else {
        counterpartFields[field] = structuredClone(value);
      }
    }
    return counterpart;
  } catch (error) {
    if (error instanceof EventPlacementError) {
      return null;
    }
    throw error;
  }
}

/** A freshly placed shader paint event, before it is serialized onto its track. */
interface PlacedShaderEvent {
  startTime: number[];
  endTime: number[];
  shader: string;
  global: boolean;
  order: number;
  vars: Record<string, unknown>;
}

interface EventPlacementOptions {
  eventLayer?: number;
  start?: LineEventValue;
  end?: LineEventValue;
}

/**
 * Builds an event for a placed span, rejecting overlaps; null when too short.
 *
 * Triples are ordered and compared exactly, so a grid placement keeps its
 * denominator. A plain number is quantized once at the boundary.
 */
export function placedEvent(
  session: EditorSession,
  type: string,
  first: number | readonly number[],
  second: number | readonly number[],
  easingType: number | null | undefined,
  lineIndex = session.lineIndex,
  inst = false,
  options: EventPlacementOptions = {},
): JudgeLineEvent | PlacedShaderEvent | null {
  const firstBeat = toBeat(first);
  const secondBeat = toBeat(second);
  const start = minBeat(firstBeat, secondBeat);
  const end = maxBeat(firstBeat, secondBeat);
  // No event may start and end on the same beat, hooked or not.
  if (beatValue(end) - beatValue(start) < 0.001) {
    return null;
  }
  const events = eventListAt(session, lineIndex, type, options.eventLayer ?? session.eventLayer);
  if (type === "paintEvents") {
    return {
      startTime: start,
      endTime: end,
      shader: "chromatic",
      global: false,
      order: 0,
      vars: {},
    };
  }
  const trajectories = ["moveYEvents", "rotateEvents"].includes(type)
    ? eventListAt(session, lineIndex, "moveXEvents").filter(
        (event) =>
          event.trajectory &&
          (type !== "rotateEvents" || trajectoryHasRotation(event.trajectory.options)),
      )
    : [];
  if (
    [...events, ...trajectories].some(
      (event) => compareBeats(start, event.endTime) < 0 && compareBeats(event.startTime, end) < 0,
    )
  ) {
    throw new EventPlacementError(
      "event.overlap",
      t("editor.commands.eventCommands.error.overlap"),
    );
  }
  let previous: JudgeLineEvent | undefined;
  let previousStart: readonly number[] | undefined;
  for (const event of events) {
    if (
      compareBeats(event.endTime, start) <= 0 &&
      (!previousStart || compareBeats(event.startTime, previousStart) >= 0)
    ) {
      previous = event;
      previousStart = event.startTime;
    }
  }
  const fallback =
    type === NOISE_ACTIVE_EVENTS
      ? 1
      : type === "alphaEvents"
        ? 255
        : type.startsWith("scale")
          ? judgeLineTraits(session.chart.judgeLineList?.[lineIndex]).isNoise
            ? 0
            : 1
          : type === "speedEvents"
            ? 10
            : type === "textEvents"
              ? ""
              : type === "colorEvents"
                ? [255, 255, 255]
                : 0;
  const value = structuredClone(options.start ?? previous?.end ?? fallback);
  return {
    ...createEvent(value, structuredClone(options.end ?? value), start, end),
    easingType: easingType ?? previous?.easingType ?? 1,
    inst: inst ? 1 : 0,
    ...(inst ? { end: structuredClone(value) } : {}),
  };
}

interface EventActionPayload {
  start?: LineEventValue;
  end?: LineEventValue;
  easingType?: number;
  instant?: boolean;
  nextStartBeat?: number | Beat;
  nextEndBeat?: number | Beat;
}

type EventActionInput = CoordinateActionInput<EventActionPayload>;

const EVENT_EPSILON = 1e-6;

/** True when `input` is an object carrying an event-action target. */
export function isEventActionInput(input: unknown): input is EventActionInput {
  return Boolean(input && typeof input === "object" && "target" in input);
}

/** One exact event endpoint. */
export interface EventBeatCoordinate {
  beat: Beat;
  positionX: number;
}

/** Exact-beat event target used by pointer placement. */
export interface EventBeatTarget {
  lineIndex: number;
  layer: number;
  eventType: string;
  from: EventBeatCoordinate;
  to: EventBeatCoordinate;
}

/** Places one event at a numeric target after line and track compatibility checks. */
export function placeEventAtTarget(
  session: EditorSession,
  input: EventActionInput,
): ActionResult<JudgeLineEvent | PlacedShaderEvent> {
  const validation = validateEventInput(input);
  if (validation) {
    return validation;
  }
  const target = input.target;
  if (!target.to) {
    return rejected("to.requiredForEvent");
  }
  return placeEventAtBeatTarget(
    session,
    {
      lineIndex: target.lineIndex,
      layer: target.layer as number,
      eventType: target.eventType as string,
      from: { beat: toBeat(target.from.beat), positionX: target.from.positionX },
      to: { beat: toBeat(target.to.beat), positionX: target.to.positionX },
    },
    input.payload,
  );
}

/** Places one event at an exact-beat target, keeping both anchors' triples intact. */
export function placeEventAtBeatTarget(
  session: EditorSession,
  target: EventBeatTarget,
  payload: EventActionPayload = {},
): ActionResult<JudgeLineEvent | PlacedShaderEvent> {
  const type = target.eventType;
  if (!isEventTrack(type) && type !== NOISE_ACTIVE_EVENTS) {
    return rejected("eventType.unsupported");
  }
  if (!Number.isInteger(target.lineIndex) || target.lineIndex < 0) {
    return rejected("target.lineIndex.nonNegativeInteger");
  }
  if (!Number.isInteger(target.layer) || target.layer < 0) {
    return rejected("layer.nonNegativeInteger");
  }
  if (!isBeat(target.from.beat) || !isBeat(target.to.beat)) {
    return rejected("target.beat.invalid");
  }
  if (!Number.isFinite(target.from.positionX) || !Number.isFinite(target.to.positionX)) {
    return rejected("target.positionX.finite");
  }
  if (!session.chart.judgeLineList?.[target.lineIndex]) {
    return rejected("target.lineIndex.exists");
  }
  const traits = judgeLineTraits(session.chart.judgeLineList[target.lineIndex]);
  if (
    (type === "alphaEvents" && !traits.allowsAlphaEvents) ||
    (type === "speedEvents" && !traits.allowsSpeedEvents) ||
    (type === NOISE_ACTIVE_EVENTS && !traits.isNoise)
  ) {
    return rejected("event.noiseLine.incompatible");
  }
  const beforeSelection = session.selectionState();
  session.selectLine(target.lineIndex);
  session.eventLayer = target.layer;
  try {
    const event = placedEvent(
      session,
      type,
      target.from.beat,
      target.to.beat,
      payload.easingType,
      target.lineIndex,
      payload.instant ?? false,
      { eventLayer: target.layer, start: payload.start, end: payload.end },
    );
    if (!event) {
      return { status: "unchanged", reason: "no_change" };
    }
    insertEventAt(
      session,
      target.lineIndex,
      type,
      event as JudgeLineEvent,
      target.layer,
      beforeSelection,
    );
    return { status: "committed", value: event };
  } catch (error) {
    return rejected(error instanceof EventPlacementError ? error.code : "event.failed");
  }
}

/** Deletes events matching a beat range and returns the removed count. */
export function deleteEventsAtTarget(
  session: EditorSession,
  input: EventActionInput,
): ActionResult<number> {
  const validation = validateEventInput(input);
  if (validation) {
    return validation;
  }
  const target = input.target;
  const type = target.eventType as string;
  if (!session.chart.judgeLineList?.[target.lineIndex]) {
    return rejected("target.lineIndex.exists");
  }
  const events = eventListAt(session, target.lineIndex, type, target.layer);
  const indices = matchingEventIndices(events, target);
  if (!indices.length) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  const beforeSelection = session.selectionState();
  const removals = new Map<string, Set<number>>([[type, new Set(indices)]]);
  addXYCounterpartRemovals(
    session,
    target.lineIndex,
    target.layer as number,
    type,
    indices,
    removals,
  );
  const updates = new Map<string, JudgeLineEvent[]>();
  for (const [track, trackIndices] of removals) {
    updates.set(
      track,
      eventListAt(session, target.lineIndex, track, target.layer).filter(
        (_, index) => !trackIndices.has(index),
      ),
    );
  }
  const chart = chartWithEventLists(
    session.chart,
    target.lineIndex,
    target.layer as number,
    updates,
  );
  session.selectLine(target.lineIndex);
  session.eventLayer = target.layer as number;
  session.focus = "events";
  session.selection.clear();
  session.eventSelection.clear();
  session.commitChart(
    t("editor.commands.eventCommands.commitDeleteEvents"),
    chart,
    beforeSelection,
    {},
    {
      normalized: true,
      placement: { notes: 0, events: 0 },
    },
  );
  return { status: "committed", value: indices.length };
}

/** Updates matching events, rejecting overlap created by the patch. */
export function updateEventsAtTarget(
  session: EditorSession,
  input: EventActionInput,
): ActionResult<number> {
  const validation = validateEventInput(input);
  if (validation) {
    return validation;
  }
  const patchValidation = validateEventPatch(input.payload ?? {});
  if (patchValidation) {
    return patchValidation;
  }
  if (!Object.values(input.payload ?? {}).some((value) => value !== undefined)) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  const target = input.target;
  const type = target.eventType as string;
  if (!session.chart.judgeLineList?.[target.lineIndex]) {
    return rejected("target.lineIndex.exists");
  }
  const events = eventListAt(session, target.lineIndex, type, target.layer);
  const indices = matchingEventIndices(events, target);
  if (!indices.length) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  const selected = new Set(indices);
  const updated = events.map((event, index) =>
    selected.has(index) ? updateEvent(event, input.payload ?? {}) : event,
  );
  if (updated.some((event) => event === null)) {
    return rejected("event.endBeforeStart");
  }
  const nextEvents = updated as JudgeLineEvent[];
  if (nextEvents.every((event, index) => event === events[index])) {
    return { status: "unchanged", reason: "no_change", value: 0 };
  }
  if (hasEventOverlap(session, target.lineIndex, target.layer as number, type, nextEvents)) {
    return rejected("event.overlap");
  }
  const updates = new Map<string, JudgeLineEvent[]>([[type, nextEvents]]);
  synchronizeXYEventTimes(
    (counterpartType) =>
      eventListAt(session, target.lineIndex, counterpartType, target.layer as number),
    updates,
    indices.map((index) => ({ type, before: events[index], after: nextEvents[index] })),
  );
  const beforeSelection = session.selectionState();
  const chart = chartWithEventLists(
    session.chart,
    target.lineIndex,
    target.layer as number,
    updates,
  );
  session.selectLine(target.lineIndex);
  session.eventLayer = target.layer as number;
  session.focus = "events";
  session.selection.clear();
  session.eventSelection = new Set(indices.map((index) => eventKey(type, index)));
  session.commitChart(
    t("editor.commands.eventCommands.commitAddEvent"),
    chart,
    beforeSelection,
    {},
    {
      normalized: true,
      placement: { notes: 0, events: 0 },
    },
  );
  return { status: "committed", value: indices.length };
}

/** Applies a patch, refusing an empty span; `instant` locks the values only. */
function updateEvent(event: JudgeLineEvent, payload: EventActionPayload): JudgeLineEvent | null {
  const startBeat =
    payload.nextStartBeat === undefined ? toBeat(event.startTime) : toBeat(payload.nextStartBeat);
  const endBeat =
    payload.nextEndBeat === undefined ? toBeat(event.endTime) : toBeat(payload.nextEndBeat);
  if (compareBeats(endBeat, startBeat) <= 0) {
    return null;
  }
  const start = payload.start === undefined ? event.start : structuredClone(payload.start);
  const end = payload.instant ? structuredClone(start) : structuredClone(payload.end ?? event.end);
  const next = {
    ...event,
    startTime: startBeat,
    endTime: endBeat,
    start,
    end,
    ...(payload.easingType === undefined ? {} : { easingType: payload.easingType }),
  };
  return pinHookedEvent(next, event);
}

/** Indices whose start beat falls inside the target range. */
function matchingEventIndices(events: readonly JudgeLineEvent[], target: ActionTarget): number[] {
  const startBeat = Math.min(target.from.beat, target.to?.beat ?? target.from.beat);
  const endBeat = Math.max(target.from.beat, target.to?.beat ?? target.from.beat);
  return events.reduce<number[]>((matches, event, index) => {
    const beat = beatValue(event.startTime);
    if (beat >= startBeat - EVENT_EPSILON && beat <= endBeat + EVENT_EPSILON) {
      matches.push(index);
    }
    return matches;
  }, []);
}

/** Validates an event action's target, track name, and layer. */
function validateEventInput(input: EventActionInput): ActionResult<never> | null {
  if (!input?.target) {
    return rejected("target.required");
  }
  const targetValidation = validateActionTarget(input.target);
  if (targetValidation) {
    return targetValidation;
  }
  const target = input.target;
  if (
    !target.eventType ||
    (!isEventTrack(target.eventType) && target.eventType !== NOISE_ACTIVE_EVENTS)
  ) {
    return rejected("eventType.unsupported");
  }
  if (!Number.isInteger(target.layer) || (target.layer ?? -1) < 0) {
    return rejected("layer.nonNegativeInteger");
  }
  return null;
}

/** Validates finite beats and supported event values in a patch. */
function validateEventPatch(payload: EventActionPayload): ActionResult<never> | null {
  for (const [name, value] of [
    ["nextStartBeat", payload.nextStartBeat],
    ["nextEndBeat", payload.nextEndBeat],
  ] as const) {
    if (value !== undefined && !validBeatInput(value)) {
      return rejected(`${name}.invalid`);
    }
  }
  if (
    payload.easingType !== undefined &&
    (typeof payload.easingType !== "number" || !Number.isFinite(payload.easingType))
  ) {
    return rejected("easingType.finite");
  }
  if (payload.start !== undefined && !validEventValue(payload.start)) {
    return rejected("start.unsupportedValue");
  }
  if (payload.end !== undefined && !validEventValue(payload.end)) {
    return rejected("end.unsupportedValue");
  }
  return null;
}

/** True for a finite numeric beat or a structurally valid triple. */
function validBeatInput(value: number | readonly number[]): boolean {
  return typeof value === "number" ? Number.isFinite(value) : isBeat(value);
}

/** True for null, string, finite number, or a finite-number array value. */
function validEventValue(value: LineEventValue): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) &&
      value.every((item) => typeof item === "number" && Number.isFinite(item)))
  );
}

/** True when an event overlaps another event or a covering trajectory. */
function hasEventOverlap(
  session: EditorSession,
  lineIndex: number,
  layer: number,
  type: string,
  events: readonly JudgeLineEvent[],
): boolean {
  const trajectories = ["moveYEvents", "rotateEvents"].includes(type)
    ? eventListAt(session, lineIndex, "moveXEvents", layer).filter(
        (event) =>
          event.trajectory &&
          (type !== "rotateEvents" || trajectoryHasRotation(event.trajectory.options)),
      )
    : [];
  return events.some(
    (event, index) =>
      events.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          beatValue(event.startTime) < beatValue(other.endTime) &&
          beatValue(other.startTime) < beatValue(event.endTime),
      ) ||
      trajectories.some(
        (other) =>
          beatValue(event.startTime) < beatValue(other.endTime) &&
          beatValue(other.startTime) < beatValue(event.endTime),
      ),
  );
}

/** Carries a stable rejection code for a failed event placement. */
class EventPlacementError extends Error {
  readonly code: string;

  /** Creates a placement error with the code returned to the caller. */
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Builds a rejected result carrying one issue code. */
function rejected(issue: string): ActionResult<never> {
  return { status: "rejected", reason: "invalid_input", issues: [issue] };
}

/** Deletes selected events on one line or across multi-line panels. */
export function deleteEvents(session: EditorSession): void {
  if (session.multiLineActive && session.multiLineMode === "events") {
    const snapshot = captureSelection(session);
    const groups = new Map<number, Map<string, Set<number>>>();
    for (const entry of snapshot.events) {
      const line = groups.get(entry.lineIndex) ?? new Map<string, Set<number>>();
      const indices = line.get(entry.type) ?? new Set<number>();
      indices.add(entry.index);
      line.set(entry.type, indices);
      groups.set(entry.lineIndex, line);
    }
    if (!groups.size) {
      return;
    }
    if (globalXYBindingEnabled()) {
      for (const [lineIndex, types] of groups) {
        for (const [type, indices] of [...types]) {
          addXYCounterpartRemovals(
            session,
            lineIndex,
            session.eventLayer,
            type,
            [...indices],
            types,
          );
        }
      }
    }
    let chart = session.chart;
    for (const [lineIndex, types] of groups) {
      const updates = new Map<string, JudgeLineEvent[]>();
      for (const [type, indices] of types) {
        updates.set(
          type,
          eventListAt(session, lineIndex, type, session.eventLayer).filter(
            (event, index) => !indices.has(index),
          ),
        );
      }
      chart = chartWithEventLists(chart, lineIndex, session.eventLayer, updates);
    }
    commitSelectionEdit(
      session,
      {
        chart,
        lineIndex: session.lineIndex,
        eventLayer: session.eventLayer,
        focus: "events",
        selection: new Set(session.selection),
        eventSelection: new Set(),
        multiLineSelection: session.multiLineSelection,
        multiEventSelection: new Map(),
      },
      t("editor.commands.eventCommands.commitDeleteEvents"),
    );
    return;
  }
  const updates = new Map<string, JudgeLineEvent[]>();
  const removals = new Map<string, Set<number>>();
  for (const { type, index } of selectedEvents(session)) {
    const indices = removals.get(type) ?? new Set<number>();
    indices.add(index);
    removals.set(type, indices);
  }
  if (globalXYBindingEnabled()) {
    for (const [type, indices] of [...removals]) {
      addXYCounterpartRemovals(
        session,
        session.lineIndex,
        session.eventLayer,
        type,
        [...indices],
        removals,
      );
    }
  }
  for (const [type, indices] of removals) {
    updates.set(
      type,
      eventList(session, type).filter((_, index) => !indices.has(index)),
    );
  }
  if (updates.size) {
    commitEventLists(session, t("editor.commands.eventCommands.commitDeleteEvents"), updates, []);
  }
}

/** Add exact-span XY counterparts to a deletion plan, leaving mismatched spans alone. */
function addXYCounterpartRemovals(
  session: EditorSession,
  lineIndex: number,
  eventLayer: number,
  type: string,
  indices: readonly number[],
  removals: Map<string, Set<number>>,
): void {
  const counterpartType = xyCounterpartType(type);
  if (!counterpartType) {
    return;
  }
  const events = eventListAt(session, lineIndex, type, eventLayer);
  const counterparts = eventListAt(session, lineIndex, counterpartType, eventLayer);
  const counterpartIndices = removals.get(counterpartType) ?? new Set<number>();
  for (const index of indices) {
    const source = events[index];
    if (!source) {
      continue;
    }
    const counterpartIndex = counterparts.findIndex((event) => sameEventSpan(event, source));
    if (counterpartIndex >= 0) {
      counterpartIndices.add(counterpartIndex);
    }
  }
  if (counterpartIndices.size) {
    removals.set(counterpartType, counterpartIndices);
  }
}
