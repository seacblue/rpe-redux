/**
 * Editing the selected events: which ones are selected, what one transform makes
 * of them, and the single commit that writes the result.
 *
 * `selectedEvents` and `transformEvents` only plan; `commitEventLists` is the one
 * function here that touches the session, which is what keeps "an event edit is
 * one undo entry" true for every caller.
 */

import { assertChart, isEventTrack } from "../../global/chart/chart.ts";
import type { Chart, JudgeLineEvent } from "../../global/chart/chart.ts";
import { assertEventTrackStructure } from "../../global/chart/chartValidation.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import { alignShaderParameters } from "../../global/chart/shader/shaderEvents.ts";
import type { EditorSession } from "../session/session.ts";
import {
  chartWithEventLists,
  eventKey,
  eventList,
  eventListAt,
  NOISE_ACTIVE_EVENTS,
  parseEventKey,
  synchronizeXYEventTimes,
  type EventTimeChange,
  type EventSession,
} from "./eventTracks.ts";

/** Structural equality for JSON-like event data; reference-equal subtrees short-circuit. */
function sameEventValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (!sameEventValue(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(right)
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key) || !sameEventValue(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

/** Whether applying one track update would leave that track exactly as it is. */
function sameEventList(
  current: readonly JudgeLineEvent[],
  next: readonly JudgeLineEvent[],
): boolean {
  if (current === next) {
    return true;
  }
  if (current.length !== next.length) {
    return false;
  }
  for (let index = 0; index < current.length; index++) {
    if (!sameEventValue(current[index], next[index])) {
      return false;
    }
  }
  return true;
}

/** Resolves the current event-selection keys to typed event entries. */
export function selectedEvents(
  session: EventSession & { eventSelection: ReadonlySet<string> },
): { type: string; index: number; event: JudgeLineEvent }[] {
  return [...session.eventSelection].flatMap((key) => {
    const parsed = parseEventKey(key);
    if (!parsed) {
      return [];
    }
    const event = eventList(session, parsed.type)[parsed.index];
    return event ? [{ ...parsed, event }] : [];
  });
}

/**
 * Writes replaced event tracks to one line as a single undo entry.
 *
 * A track that is structurally unchanged is dropped before it reaches history,
 * so a second handler for the same field value cannot create a duplicate undo
 * entry. The edit itself only validates the tracks it replaced; the whole-chart
 * `assertChart` gate stays on load, save/export, and transaction preview.
 */
export function commitEventLists(
  session: EditorSession,
  label: string,
  updates: Map<string, JudgeLineEvent[]>,
  selection: Iterable<string> = session.eventSelection,
): void {
  if ([...updates].every(([type, events]) => sameEventList(eventList(session, type), events))) {
    return;
  }
  const beforeSelection = session.selectionState();
  const chart = chartWithEventLists(session.chart, session.lineIndex, session.eventLayer, updates);
  for (const [type, events] of updates) {
    if (type === NOISE_ACTIVE_EVENTS || !isEventTrack(type)) {
      continue;
    }
    assertEventTrackStructure(events, type, `judgeLineList[${session.lineIndex}].${type}`);
  }
  session.eventSelection = new Set(selection);
  session.focus = "events";
  session.selection.clear();
  // Event-list edits preserve every chart object id, so normalization and the
  // whole-chart placement walk are skipped and a dense drag commit stays
  // bounded by the changed line.
  session.commitChart(
    label,
    chart,
    beforeSelection,
    {},
    {
      normalized: true,
      placement: { notes: 0, events: 0 },
    },
  );
}

/**
 * Validate the tracks a captured multi-line event edit replaced.
 *
 * The selection map names every touched line and track; when a caller has no
 * map to narrow the edit, the whole chart stays the safe fallback.
 */
export function assertMultiEventSelectionStructure(
  chart: Chart,
  eventLayer: number,
  multiEventSelection: ReadonlyMap<number, Iterable<string>> | undefined,
): void {
  if (!multiEventSelection || multiEventSelection.size === 0) {
    assertChart(chart);
    return;
  }
  for (const [lineIndex, keys] of multiEventSelection) {
    const types = new Set<string>();
    for (const key of keys) {
      const parsed = parseEventKey(key);
      if (parsed) {
        types.add(parsed.type);
      }
    }
    for (const type of types) {
      if (!isEventTrack(type)) {
        continue;
      }
      const events = eventListAt({ chart, lineIndex, eventLayer }, lineIndex, type);
      assertEventTrackStructure(events, type, `judgeLineList[${lineIndex}].${type}`);
    }
  }
}

/** Transforms selected events, keeps link groups aligned, and commits once. */
export function transformEvents(
  session: EditorSession,
  label: string,
  transform: (event: JudgeLineEvent, type: string) => JudgeLineEvent,
): void {
  const updates = new Map<string, JudgeLineEvent[]>();
  const linked = new Map<string, JudgeLineEvent>();
  const timeChanges: EventTimeChange[] = [];
  for (const { type, index, event } of selectedEvents(session)) {
    let track = updates.get(type);
    if (!track) {
      track = [...eventList(session, type)];
      updates.set(type, track);
    }
    let next = transform(event, type);
    if (
      type === "paintEvents" &&
      session.shaderAutoAlign !== false &&
      beatValue(next.startTime) !== beatValue(event.startTime)
    ) {
      next = alignShaderParameters(next);
    }
    track[index] = next;
    if (
      Math.abs(beatValue(next.startTime) - beatValue(event.startTime)) >= 1e-9 ||
      Math.abs(beatValue(next.endTime) - beatValue(event.endTime)) >= 1e-9
    ) {
      timeChanges.push({ type, before: event, after: next });
    }
    const link = Number(event.linkgroup ?? 0);
    if (link > 0 && type !== "paintEvents") {
      linked.set(`${type}:${link}`, next);
    }
  }
  for (const [group, next] of linked) {
    const [type, linkText] = group.split(":");
    const link = Number(linkText);
    const events = updates.get(type) ?? [...eventList(session, type)];
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (
        Number(event.linkgroup ?? 0) !== link ||
        session.eventSelection.has(eventKey(type, index))
      ) {
        continue;
      }
      events[index] = {
        ...event,
        start: structuredClone(next.start),
        end: structuredClone(next.end),
        easingType: next.easingType,
        easingLeft: next.easingLeft,
        easingRight: next.easingRight,
        bezier: next.bezier,
        bezierPoints: structuredClone(next.bezierPoints),
      };
    }
    updates.set(type, events);
  }
  synchronizeXYEventTimes((type) => eventList(session, type), updates, timeChanges);
  if (updates.size) {
    commitEventLists(session, label, updates);
  }
}
