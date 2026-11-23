/**
 * Event value tools that act on the selected events.
 *
 * Cutting samples an event into smaller trajectory-free parts, while sticking
 * joins an event's value to its neighbour in either direction; both commit
 * through `eventEdits.ts`, so a tool run stays a single undo entry.
 */
import { t } from "../../../i18n/index.ts";
import {
  addBeatFraction,
  beatCopy,
  beatFromFraction,
  beatValue,
  compareBeats,
  fromNumber,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { easing, bezier } from "../../utils/easing.ts";
import {
  DEFAULT_BEZIER_POINTS,
  EVENT_TYPES,
  HOOK_TAIL_FIELD,
  isHookedEvent,
  setEventHooked,
} from "../../global/chart/chart.ts";
import type { JudgeLineEvent } from "../../global/chart/chart.ts";
import { snapTime } from "../../global/chart/editing/editGrid.ts";
import type { TempoGrid } from "../../global/chart/editing/editGrid.ts";
import { eventList, eventKey } from "./eventTracks.ts";
import { selectedEvents, commitEventLists } from "./eventEdits.ts";
import type { EditorSession } from "../session/session.ts";
import { commitSelectionEdit, editCapturedSelection } from "../selection/edits.ts";
import { captureSelection } from "../selection/snapshot.ts";
import { selectedEventAnchor } from "../selection/eventSelectionAnchor.ts";

const cutTypes = new Set<string>([...EVENT_TYPES, "scaleXEvents", "scaleYEvents", "colorEvents"]);

/** How finely `cutEventParts` subdivides the selected events. */
export interface CutOptions {
  division?: number;
  density?: number;
  beat?: number;
  tempo?: TempoGrid;
  factor?: number;
}

/** True when the event is a cuttable track with a non-empty, untraced span. */
export function canCutEvent(type: string, event: JudgeLineEvent): boolean {
  return (
    !event.trajectory && cutTypes.has(type) && compareBeats(event.endTime, event.startTime) > 0
  );
}

/** Splits one event into snapped, easing-free parts; null when not cuttable. */
export function cutEventParts(
  type: string,
  event: JudgeLineEvent,
  { division = 4, density = 2, beat, tempo, factor = 1 }: CutOptions = {},
): JudgeLineEvent[] | null {
  if (!canCutEvent(type, event)) {
    return null;
  }
  if (!Number.isFinite(density) || density <= 0 || !Number.isFinite(division) || division < 1) {
    throw new Error(t("editor.commands.eventTools.error.densityZero"));
  }
  const subdivisions = Math.max(1, Math.trunc(division * density));
  const startBeat = beatCopy(event.startTime);
  const endBeat = beatCopy(event.endTime);
  const start = beatValue(startBeat);
  const end = beatValue(endBeat);
  // The cut grid is anchored on the snapped beat when it falls inside the event.
  // Both the anchor and every cut are triples, so a 1/3 division cuts at exactly
  // `start + k/3`.
  const snapped: Beat = tempo
    ? snapTime(tempo.seconds(beat ?? start), division, tempo)
    : Number.isSafeInteger(division) && division > 0
      ? beatFromFraction(Math.round((beat ?? start) * division), division)
      : fromNumber(beat ?? start);
  const anchor: Beat =
    compareBeats(snapped, startBeat) > 0 && compareBeats(snapped, endBeat) < 0
      ? snapped
      : startBeat;
  const count = Math.ceil((end - start) * subdivisions) + 1;
  if (count > 100000) {
    throw new Error(t("editor.commands.eventTools.error.tooManyParts"));
  }
  const cuts: Beat[] = [startBeat];
  const first = Math.floor((start - beatValue(anchor)) * subdivisions) + 1;
  const last = Math.ceil((end - beatValue(anchor)) * subdivisions);
  for (let index = first; index <= last; index++) {
    const point = addBeatFraction(anchor, index, subdivisions);
    if (compareBeats(point, endBeat) >= 0) {
      break;
    }
    if (compareBeats(point, startBeat) > 0) {
      cuts.push(point);
    }
  }
  cuts.push(endBeat);
  /** Samples the source event's value at one beat position. */
  const sample = (position: number): number | number[] => {
    const progress = (position - start) / (end - start);
    const amount = event.bezier
      ? bezier(progress, event.bezierPoints ?? [])
      : easing(progress, event.easingType, event.easingLeft ?? 0, event.easingRight ?? 1);
    const from = event.start;
    const to = event.end;
    if (Array.isArray(from)) {
      const parts: number[] = Array.isArray(to) ? to : [];
      return from.map((value, index) => Math.trunc(value + (parts[index] - value) * amount));
    }
    const value = Number(from) + (Number(to) - Number(from)) * amount;
    return type === "alphaEvents" ? Math.trunc(value) : value;
  };
  return cuts.slice(0, -1).map((point, index) => {
    const next = cuts[index + 1];
    const part: JudgeLineEvent = {
      ...structuredClone(event),
      startTime: point,
      endTime: next,
      start: sample(beatValue(point)),
      end: sample(beatValue(next)),
      easingType: 1,
      easingLeft: 0,
      easingRight: 1,
      bezier: 0,
      bezierPoints: [...DEFAULT_BEZIER_POINTS],
      linkgroup: 0,
      inst: 0,
    };
    // A part is a plain span, so the source hook's cached tail does not apply.
    delete part[HOOK_TAIL_FIELD];
    return part;
  });
}

/** Cuts every selected event and returns how many changed, were generated, or were skipped. */
export function cutSelectedEvents(
  session: EditorSession,
  options: CutOptions = {},
): { changed: number; generated: number; skipped: number } {
  const updates = new Map<string, JudgeLineEvent[]>();
  const selection = new Set<string>();
  let changed = 0;
  let generated = 0;
  let skipped = 0;
  for (const type of new Set(selectedEvents(session).map((entry) => entry.type))) {
    const events: { item: JudgeLineEvent; selected: boolean }[] = [];
    eventList(session, type).forEach((event, index) => {
      const selected = session.eventSelection.has(eventKey(type, index));
      const parts = selected ? cutEventParts(type, event, options) : null;
      if (selected && !parts) {
        skipped++;
      }
      if (parts) {
        changed++;
        generated += parts.length;
      }
      if (generated > 100000) {
        throw new Error(t("editor.commands.eventTools.error.tooManyParts"));
      }
      for (const item of parts ?? [event]) {
        events.push({ item, selected });
      }
    });
    events.sort((left, right) => compareBeats(left.item.startTime, right.item.startTime));
    events.forEach((entry, index) => {
      if (entry.selected) {
        selection.add(eventKey(type, index));
      }
    });
    updates.set(
      type,
      events.map((entry) => entry.item),
    );
  }
  if (changed) {
    commitEventLists(session, t("editor.commands.eventTools.commitCut"), updates, selection);
  }
  return { changed, generated, skipped };
}

/** Which neighbour a stick edit joins. */
export type EventStickDirection = "next" | "previous";

/**
 * Sticks each selected event's value to its neighbour on the same track.
 *
 * Sticking to the next event writes that event's start value into the selected
 * event's end; sticking to the previous one writes the previous event's end
 * value into its start. A hooked event carries one value, so both anchors
 * receive it. A track without a neighbour in that direction is skipped, and so
 * is a shader track, whose value pair is shader parameters rather than an
 * interpolated number.
 */
export function stickSelectedEvents(
  session: EditorSession,
  direction: EventStickDirection,
): { changed: number; skipped: number } {
  const updates = new Map<string, JudgeLineEvent[]>();
  const selected = selectedEvents(session);
  let changed = 0;
  let skipped = 0;
  for (const type of new Set(selected.map((entry) => entry.type))) {
    if (type === "paintEvents") {
      skipped += selected.filter((entry) => entry.type === type).length;
      continue;
    }
    const events = [...eventList(session, type)];
    const order = events
      .map((event, index) => ({ event, index }))
      .sort(
        (left, right) =>
          compareBeats(left.event.startTime, right.event.startTime) || left.index - right.index,
      );
    const step = direction === "next" ? 1 : -1;
    for (let position = 0; position < order.length; position++) {
      const entry = order[position];
      if (!session.eventSelection.has(eventKey(type, entry.index))) {
        continue;
      }
      const neighbour = order[position + step];
      if (!neighbour) {
        skipped++;
        continue;
      }
      // Read the neighbour as it stands now, so a run of selected events chains
      // through the value the previous iteration already wrote.
      const source = events[neighbour.index];
      const value = structuredClone(direction === "next" ? source.start : source.end);
      const current = events[entry.index];
      const next: JudgeLineEvent = {
        ...current,
        ...(direction === "next" ? { end: value } : { start: value }),
        ...(current.inst
          ? direction === "next"
            ? { start: structuredClone(value) }
            : { end: structuredClone(value) }
          : {}),
      };
      // An event already touching its neighbour is not a change; reporting it
      // would make a second stick look like a new edit.
      if (
        JSON.stringify(next.start) === JSON.stringify(current.start) &&
        JSON.stringify(next.end) === JSON.stringify(current.end)
      ) {
        continue;
      }
      events[entry.index] = next;
      changed++;
    }
    updates.set(type, events);
  }
  if (changed) {
    commitEventLists(session, t("editor.commands.eventTools.commitStick"), updates);
  }
  return { changed, skipped };
}

/**
 * Toggles the hook state of every selected event as one edit.
 *
 * The last event added by the selection gesture is the state authority: an
 * unhooked last event hooks the whole selection, while a hooked last event
 * unhooks it.
 */
export function toggleSelectedEventsHooked(session: EditorSession): {
  changed: number;
  skipped: number;
} {
  const snapshot = captureSelection(session);
  const selected = snapshot.events;
  const anchor = selectedEventAnchor(session);
  const last =
    (anchor &&
      selected.find(
        (entry) =>
          entry.lineIndex === anchor.lineIndex && eventKey(entry.type, entry.index) === anchor.key,
      )) ??
    selected.at(-1);
  if (!last) {
    return { changed: 0, skipped: 0 };
  }
  const hooked = !isHookedEvent(last.event);
  const changed = selected.reduce(
    (count, entry) => count + (isHookedEvent(entry.event) === hooked ? 0 : 1),
    0,
  );
  if (changed) {
    const result = editCapturedSelection(snapshot, {
      event: (event) => setEventHooked(event, hooked),
    });
    commitSelectionEdit(session, result, t("editor.commands.eventTools.commitToggleHooked"));
  }
  return { changed, skipped: selected.length - changed };
}
