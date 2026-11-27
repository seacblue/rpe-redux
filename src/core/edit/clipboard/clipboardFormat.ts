/**
 * Defines the RPE-compatible JSON contract shared by editor selection clipboard
 * writes and reads, keeping malformed external text out of an edit session.
 */
import { beatValue, toBeat } from "../../global/chart/timing/beat.ts";
import type { ClippedEvent, EditorSession } from "../session/session.ts";
import type { JudgeLineEvent, JudgeLineNote, LineEventValue } from "../../global/chart/chart.ts";

/** The host capability used to bridge selection JSON to the system clipboard. */
export interface SystemClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/** The chart objects and placement metadata needed by paste. */
export interface ClipboardSnapshot {
  notes: JudgeLineNote[];
  noteLines: number[];
  events: ClippedEvent[];
  eventLines: number[];
  /** Source layer for each event when a deep copy preserves layers. */
  eventLayers?: number[];
  /** Whether paste should restore each event to its source layer. */
  preserveLayers?: boolean;
  /** Whether paste should keep source line/layer offsets instead of one target. */
  relativePlacement?: boolean;
}

interface RpeNote {
  above: number | string | null;
  alpha: number;
  color: number[];
  endTime: [number, number, number];
  isFake: number;
  judgeArea: number;
  line: number;
  positionX: number;
  size: number;
  speed: number;
  startTime: [number, number, number];
  type: number;
  visibleTime: number;
  yOffset: number;
}

interface RpeClipboardPayload {
  events?: RpeEvent[];
  notes?: RpeNote[];
}

interface RpeEvent {
  bezier?: number | boolean;
  bezierPoints?: number[];
  easingLeft: number;
  easingRight: number;
  easingType: number;
  end: LineEventValue;
  endTime: [number, number, number];
  layer: number;
  line: number;
  linkgroup: number;
  start: LineEventValue;
  startTime: [number, number, number];
  type: number;
}

const RPE_EVENT_TRACKS = [
  "moveXEvents",
  "moveYEvents",
  "rotateEvents",
  "alphaEvents",
  "speedEvents",
  "scaleXEvents",
  "scaleYEvents",
  "colorEvents",
  "paintEvents",
  "textEvents",
  "inclineEvents",
  "gifEvents",
] as const;

const RPE_EVENT_TYPE_BY_TRACK = new Map<string, number>(
  RPE_EVENT_TRACKS.map((track, index) => [track, index + 1]),
);

const RPE_EVENT_TRACK_BY_TYPE = new Map<number, string>(
  RPE_EVENT_TRACKS.map((track, index) => [index + 1, track]),
);

/** Copies a snapshot without retaining references to the active session. */
export function cloneClipboardSnapshot(snapshot: ClipboardSnapshot): ClipboardSnapshot {
  return structuredClone({
    notes: snapshot.notes,
    noteLines: snapshot.noteLines ?? [],
    events: snapshot.events,
    eventLines: snapshot.eventLines ?? [],
    eventLayers: snapshot.eventLayers ?? [],
    preserveLayers: snapshot.preserveLayers === true,
    relativePlacement: snapshot.relativePlacement !== false,
  });
}

/** Captures the current selection clipboard from one editor session. */
export function clipboardSnapshot(session: EditorSession): ClipboardSnapshot {
  return cloneClipboardSnapshot({
    notes: session.clipboard,
    noteLines: session.clipboardNoteLines ?? [],
    events: session.eventClipboard,
    eventLines: session.eventClipboardLines ?? [],
    eventLayers: session.eventClipboardLayers ?? [],
    preserveLayers: session.eventClipboardPreserveLayers === true,
    relativePlacement: session.clipboardRelativePlacement !== false,
  });
}

/** Replaces the current session clipboard with a validated external snapshot. */
export function attachClipboardSnapshot(session: EditorSession, snapshot: ClipboardSnapshot): void {
  const copy = cloneClipboardSnapshot(snapshot);
  session.clipboard = copy.notes;
  session.clipboardNoteLines = copy.noteLines;
  session.eventClipboard = copy.events;
  session.eventClipboardLines = copy.eventLines;
  session.eventClipboardLayers = copy.eventLayers ?? [];
  session.eventClipboardPreserveLayers = copy.preserveLayers === true;
  session.clipboardRelativePlacement = copy.relativePlacement !== false;
}

/** Converts an editor note to the note shape accepted by RPE's clipboard. */
function toRpeNote(note: JudgeLineNote, line: number): RpeNote {
  const color =
    Array.isArray(note.color) &&
    note.color.length >= 3 &&
    note.color.slice(0, 3).every((value) => typeof value === "number" && Number.isFinite(value))
      ? note.color.slice(0, 3)
      : [255, 255, 255];
  return {
    above: note.above ?? 1,
    alpha: note.alpha ?? 255,
    color,
    endTime: [...note.endTime] as [number, number, number],
    isFake: note.isFake ?? 0,
    judgeArea: 1,
    line,
    positionX: note.positionX ?? 0,
    size: note.size ?? 1,
    speed: note.speed ?? 1,
    startTime: [...note.startTime] as [number, number, number],
    type: note.type,
    visibleTime: note.visibleTime ?? 999999,
    yOffset: note.yOffset ?? 0,
  };
}

/** Converts one internal event to the event shape accepted by RPE's clipboard. */
function toRpeEvent(clipped: ClippedEvent, line: number, layer: number): RpeEvent | null {
  const type = RPE_EVENT_TYPE_BY_TRACK.get(clipped.type);
  if (type === undefined) {
    return null;
  }
  const event = clipped.event;
  const base: RpeEvent = {
    easingLeft: event.easingLeft ?? 0,
    easingRight: event.easingRight ?? 1,
    easingType: event.easingType ?? 1,
    end: structuredClone(event.end),
    endTime: [...event.endTime] as [number, number, number],
    layer,
    line,
    linkgroup: event.linkgroup ?? 0,
    start: structuredClone(event.start),
    startTime: [...event.startTime] as [number, number, number],
    type,
  };
  if (clipped.type !== "speedEvents") {
    base.bezier = event.bezier ?? 0;
    base.bezierPoints = event.bezier
      ? Array.isArray(event.bezierPoints)
        ? [...event.bezierPoints]
        : [0, 0, 0, 0]
      : [0, 0, 0, 0];
  }
  return base;
}

/** Serializes notes as the RPE-compatible JSON clipboard shape. */
export function serializeClipboardSnapshot(snapshot: ClipboardSnapshot): string {
  const copy = cloneClipboardSnapshot(snapshot);
  const payload: RpeClipboardPayload = {};
  if (copy.events.length) {
    const events = copy.events.flatMap((clipped, index) => {
      const line = copy.eventLines[index];
      const layer = copy.eventLayers?.[index];
      const serialized = toRpeEvent(
        clipped,
        Number.isInteger(line) && line >= 0 ? line : 0,
        typeof layer === "number" && Number.isInteger(layer) && layer >= 0 ? layer : 0,
      );
      return serialized ? [serialized] : [];
    });
    if (events.length) {
      payload.events = events;
    }
  }
  if (copy.notes.length) {
    payload.notes = copy.notes.map((note, index) => {
      const line = copy.noteLines[index];
      return toRpeNote(note, Number.isInteger(line) && line >= 0 ? line : 0);
    });
  }
  if (!payload.events && !payload.notes) {
    payload.notes = [];
  }
  return JSON.stringify(payload);
}

/** Reads and validates an RPE-compatible selection payload from arbitrary text. */
export function parseClipboardSnapshot(text: string): ClipboardSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<RpeClipboardPayload>;
  if (!Array.isArray(candidate.events) && !Array.isArray(candidate.notes)) {
    return null;
  }
  const notes: JudgeLineNote[] = [];
  const noteLines: number[] = [];
  const events: ClippedEvent[] = [];
  const eventLines: number[] = [];
  const eventLayers: number[] = [];
  const sourceEvents = candidate.events ?? [];
  const sourceNotes = candidate.notes ?? [];
  try {
    for (const event of sourceEvents) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        return null;
      }
      const source = event as unknown as Record<string, unknown>;
      if (typeof source.type !== "number" || !Number.isInteger(source.type)) {
        return null;
      }
      const type = RPE_EVENT_TRACK_BY_TYPE.get(source.type);
      if (!type) {
        return null;
      }
      beatValue(source.startTime as number[]);
      beatValue(source.endTime as number[]);
      if (!isLineEventValue(source.start) || !isLineEventValue(source.end)) {
        return null;
      }
      const line = source.line === undefined ? 0 : source.line;
      const layer = source.layer === undefined ? 0 : source.layer;
      if (!isNonNegativeInteger(line) || !isNonNegativeInteger(layer)) {
        return null;
      }
      const normalized: JudgeLineEvent = {
        startTime: toBeat(source.startTime as number[]),
        endTime: toBeat(source.endTime as number[]),
        start: structuredClone(source.start) as LineEventValue,
        end: structuredClone(source.end) as LineEventValue,
        easingType: numberOrDefault(source.easingType, 1),
        easingLeft: numberOrDefault(source.easingLeft, 0),
        easingRight: numberOrDefault(source.easingRight, 1),
        linkgroup: numberOrDefault(source.linkgroup, 0),
      };
      if (type !== "speedEvents") {
        normalized.bezier = bezierOrDefault(source.bezier);
        const bezierPoints = Array.isArray(source.bezierPoints)
          ? source.bezierPoints.filter(
              (value): value is number => typeof value === "number" && Number.isFinite(value),
            )
          : [];
        normalized.bezierPoints = bezierPoints.length === 4 ? bezierPoints : [0, 0, 0, 0];
      }
      events.push({ type, event: normalized });
      eventLines.push(Number(line));
      eventLayers.push(Number(layer));
    }
    for (const note of sourceNotes) {
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        return null;
      }
      const source = note as unknown as Record<string, unknown>;
      if (typeof source.type !== "number") {
        return null;
      }
      beatValue(source.startTime as number[]);
      beatValue(source.endTime as number[]);
      const line = source.line === undefined ? 0 : source.line;
      if (!Number.isInteger(line) || Number(line) < 0) {
        return null;
      }
      const color =
        Array.isArray(source.color) && source.color.length >= 3
          ? source.color
              .slice(0, 3)
              .filter(
                (value): value is number => typeof value === "number" && Number.isFinite(value),
              )
          : [];
      const normalized: JudgeLineNote = {
        type: source.type,
        startTime: toBeat(source.startTime as number[]),
        endTime: toBeat(source.endTime as number[]),
        positionX: typeof source.positionX === "number" ? source.positionX : 0,
        above:
          typeof source.above === "number" ||
          typeof source.above === "string" ||
          source.above === null
            ? source.above
            : 1,
        isFake: typeof source.isFake === "number" ? source.isFake : 0,
        speed: typeof source.speed === "number" ? source.speed : 1,
        size: typeof source.size === "number" ? source.size : 1,
        yOffset: typeof source.yOffset === "number" ? source.yOffset : 0,
        visibleTime: typeof source.visibleTime === "number" ? source.visibleTime : 999999,
        alpha: typeof source.alpha === "number" ? source.alpha : 255,
        ...(color.length ? { color } : {}),
      };
      notes.push(normalized);
      noteLines.push(Number(line));
    }
  } catch {
    return null;
  }
  return cloneClipboardSnapshot({
    notes,
    noteLines,
    events,
    eventLines,
    eventLayers,
    preserveLayers: events.length > 0,
    relativePlacement: false,
  });
}

/** Whether a clipboard value is one of RPE's JSON event value types. */
function isLineEventValue(value: unknown): value is LineEventValue {
  return (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "number"))
  );
}

/** Return a finite numeric field or its RPE default. */
function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Return the RPE bezier flag or its disabled default. */
function bezierOrDefault(value: unknown): number | boolean {
  return typeof value === "number" || typeof value === "boolean" ? value : 0;
}

/** Validate the non-negative integer indexes carried by RPE clipboard objects. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Returns a stable comparison key for two snapshots or a system clipboard read. */
export function clipboardSnapshotKey(snapshot: ClipboardSnapshot): string {
  return serializeClipboardSnapshot(snapshot);
}
