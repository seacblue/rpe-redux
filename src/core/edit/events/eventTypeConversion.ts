/**
 * Moving a selected event to another numeric event track.
 *
 * The ordinary tracks live on the active base layer, while scale X and scale Y
 * live on the line's extended map. A conversion reuses the event object, so its
 * values, easing, id, hook, and link group survive unchanged; only the track it
 * is stored in changes. The target track keeps everything it already holds,
 * including an event with the same span, and the whole move is one undo entry.
 */
import { t } from "../../../i18n/index.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import type { JudgeLineEvent } from "../../global/chart/chart.ts";
import type { EditorSession } from "../session/session.ts";
import { restoreSelection } from "../session/selectionHistory.ts";
import { chartWithEventLists, eventKey, eventListAt } from "./eventTracks.ts";

/** The tracks an event's type can be converted to, in menu order. */
export const CONVERTIBLE_EVENT_TYPES = [
  "moveXEvents",
  "moveYEvents",
  "rotateEvents",
  "alphaEvents",
  "speedEvents",
  "scaleXEvents",
  "scaleYEvents",
] as const;

/** One event track that takes a numeric value. */
export type ConvertibleEventType = (typeof CONVERTIBLE_EVENT_TYPES)[number];

/** True when `value` names a track the event inspector can convert between. */
export function isConvertibleEventType(value: string): value is ConvertibleEventType {
  return (CONVERTIBLE_EVENT_TYPES as readonly string[]).includes(value);
}

/** The selected event: its line, track, and index inside that track. */
export interface EventTypeSource {
  /** The event's line; the session line when omitted. */
  lineIndex?: number;
  type: string;
  index: number;
}

/**
 * Move one selected event to `targetType` on the same layer.
 *
 * An ordinary target writes to the active base layer; scale X/Y write to the
 * line's extended map. The event is inserted in beat order and every event
 * already on the target track stays, so a shared span leaves two events at the
 * same position. Returns the new selection key, or null when nothing changes.
 */
export function convertEventType(
  session: EditorSession,
  source: EventTypeSource,
  targetType: string,
): string | null {
  if (!isConvertibleEventType(source.type) || !isConvertibleEventType(targetType)) {
    throw new Error(t("editorPanels.inspector.event.typeUnsupported"));
  }
  if (source.type === targetType) {
    return null;
  }
  const lineIndex = source.lineIndex ?? session.lineIndex;
  const eventLayer = session.eventLayer;
  const events = eventListAt(session, lineIndex, source.type, eventLayer);
  const event = events[source.index];
  if (!event) {
    throw new Error(t("editorPanels.inspector.event.typeUnsupported"));
  }
  const targetEvents = eventListAt(session, lineIndex, targetType, eventLayer);
  const start = beatValue(event.startTime);
  const firstLater = targetEvents.findIndex((candidate) => beatValue(candidate.startTime) > start);
  const index = firstLater < 0 ? targetEvents.length : firstLater;
  const nextTarget = [...targetEvents];
  nextTarget.splice(index, 0, event);
  const nextSource = events.filter((_, candidate) => candidate !== source.index);
  const chart = chartWithEventLists(
    session.chart,
    lineIndex,
    eventLayer,
    new Map<string, JudgeLineEvent[]>([
      [source.type, nextSource],
      [targetType, nextTarget],
    ]),
  );
  const beforeSelection = session.selectionState();
  const key = eventKey(targetType, index);
  if (session.multiLineActive && session.multiLineMode === "events") {
    const multiSelection = new Map(session.multiEventSelection);
    multiSelection.set(lineIndex, new Set([key]));
    session.multiEventSelection = multiSelection;
    if (lineIndex === session.lineIndex) {
      session.eventSelection = new Set([key]);
    }
  } else {
    session.eventSelection = new Set([key]);
  }
  session.focus = "events";
  session.selection.clear();
  const committed = session.commitChart(
    t("editorPanels.inspector.event.modifyType"),
    chart,
    beforeSelection,
    {},
    { normalized: true, placement: { notes: 0, events: 0 } },
  );
  if (!committed) {
    restoreSelection(session, beforeSelection);
    session.notify();
    return null;
  }
  return key;
}
