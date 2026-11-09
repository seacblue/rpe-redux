/**
 * Copy, cut, paste and delete over a captured selection.
 *
 * Paste projects the clipboard onto a target line and beat (optionally
 * mirroring X or keeping the original time) and commits once, so a paste never
 * rewrites the clipboard itself and produces a single undo entry.
 */
import { t } from "../../../i18n/index.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";
import { countScoringNotes } from "../../global/chart/chart.ts";
import {
  beatValue,
  compareBeats,
  fromNumber,
  normalizeBeat,
  subtractBeats,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import type { JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import { EVENT_TYPES, MAX_BASE_EVENT_LAYERS } from "../../global/chart/chartVocabulary.ts";
import { judgeLineTraits, lineAllowsNotes } from "../../global/chart/line/lineTraits.ts";
import { alignShaderParameters } from "../../global/chart/shader/shaderEvents.ts";
import { createXYCounterpart } from "../events/eventCommands.ts";
import {
  chartWithEventLists,
  eventKey,
  eventListAt,
  globalXYBindingEnabled,
  NOISE_ACTIVE_EVENTS,
  sameEventSpan,
  xyCounterpartType,
} from "../events/eventTracks.ts";
import { captureSelection } from "../selection/snapshot.ts";
import { commitSelectionEdit, shiftedTime } from "../selection/edits.ts";
import type { EditorSession } from "../session/session.ts";

/** How `projectClipboard`/`pasteObjects` relocate the clipboard. */
export interface ClipboardOptions {
  mirror?: boolean;
  keepTime?: boolean;
  targetLineIndex?: number;
}

/** A beat interval covered by clipboard content or one paste. */
export interface ClipboardBeatRange {
  start: number;
  end: number;
}

/** The clipboard projected onto a target beat, ready to be inserted. */
export interface ClipboardProjection {
  notes: JudgeLineNote[];
  events: { type: string; event: JudgeLineEvent }[];
  noteLines?: number[];
  eventLines?: number[];
  eventLayers?: number[];
  sourceAnchor?: number;
  /** The clipboard beat used as the paste origin. */
  anchorBeat?: number;
  targetLineIndex?: number;
}

/** Copies selected notes and events into the session clipboard; returns the count. */
export function copyObjects(session: EditorSession): number {
  const snapshot = captureSelection(session);
  const count = snapshot.notes.length + snapshot.events.length;
  if (!count) {
    return 0;
  }
  session.clipboard = structuredClone(snapshot.notes.map((entry) => entry.note));
  session.clipboardNoteLines = snapshot.notes.map((entry) =>
    Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex,
  );
  session.eventClipboard = structuredClone(
    snapshot.events.map(({ type, event }) => ({ type, event })),
  );
  session.eventClipboardLines = snapshot.events.map((entry) =>
    Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex,
  );
  // An ordinary copy travels to the active layer on paste, which is what makes
  // copying from one layer and pasting into another work.
  session.eventClipboardLayers = snapshot.events.map(() => session.eventLayer);
  session.eventClipboardPreserveLayers = false;
  return count;
}

/** Base event tracks that exist once per line layer. */
const BASE_EVENT_TYPES = new Set<string>(EVENT_TYPES);

/** Event tracks whose values describe the line transform mirrored by paste. */
const MIRROR_EVENT_TYPES = new Set(["moveXEvents", "moveYEvents", "rotateEvents"]);

/**
 * Copy every base layer of the selected event types inside the selection span.
 *
 * The selected event types define the tracks; the earliest selected start and
 * latest selected end define the span. An event is included when its start falls
 * inside that span, so the copied block keeps the selected anchor at its first
 * beat. Notes in the same selection are copied normally.
 */
export function copyObjectsAllLayers(session: EditorSession): number {
  const snapshot = captureSelection(session);
  if (!snapshot.events.length) {
    return copyObjects(session);
  }
  const types = [...new Set(snapshot.events.map((entry) => entry.type))];
  const lines = [...new Set(snapshot.events.map((entry) => entry.lineIndex))].sort(
    (left, right) => left - right,
  );
  let rangeStart: Beat | null = null;
  let rangeEnd: Beat | null = null;
  for (const { event } of snapshot.events) {
    const start = normalizeBeat(event.startTime);
    const end = normalizeBeat(event.endTime);
    if (!rangeStart || compareBeats(start, rangeStart) < 0) {
      rangeStart = start;
    }
    if (!rangeEnd || compareBeats(end, rangeEnd) > 0) {
      rangeEnd = end;
    }
  }
  if (!rangeStart || !rangeEnd) {
    return 0;
  }
  const inRange = (event: JudgeLineEvent): boolean => {
    const start = normalizeBeat(event.startTime);
    return compareBeats(start, rangeStart) >= 0 && compareBeats(start, rangeEnd) <= 0;
  };
  const events: { type: string; event: JudgeLineEvent }[] = [];
  const eventLines: number[] = [];
  const eventLayers: number[] = [];
  for (const lineIndex of lines) {
    const line = session.chart.judgeLineList?.[lineIndex];
    if (!line) {
      continue;
    }
    const layerCount = Math.max(1, line.eventLayers?.length ?? 0);
    for (const type of types) {
      if (BASE_EVENT_TYPES.has(type)) {
        for (let layer = 0; layer < layerCount; layer += 1) {
          for (const event of eventListAt(session, lineIndex, type, layer)) {
            if (!inRange(event)) {
              continue;
            }
            events.push({ type, event: structuredClone(event) });
            eventLines.push(lineIndex);
            eventLayers.push(layer);
          }
        }
      } else {
        // Extended, shader, and virtual tracks have one list rather than layers.
        for (const event of eventListAt(session, lineIndex, type)) {
          if (!inRange(event)) {
            continue;
          }
          events.push({ type, event: structuredClone(event) });
          eventLines.push(lineIndex);
          eventLayers.push(session.eventLayer);
        }
      }
    }
  }
  session.clipboard = structuredClone(snapshot.notes.map((entry) => entry.note));
  session.clipboardNoteLines = snapshot.notes.map((entry) =>
    Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex,
  );
  session.eventClipboard = events;
  session.eventClipboardLines = eventLines;
  session.eventClipboardLayers = eventLayers;
  session.eventClipboardPreserveLayers = true;
  return session.clipboard.length + events.length;
}

/** Copies the selection, then deletes it as one entry; returns the copied count. */
export function cutObjects(session: EditorSession): number {
  const count = copyObjects(session);
  if (!count) {
    return 0;
  }
  deleteObjects(session, t("editor.commands.clipboard.cutLabel"));
  return count;
}

/** Deletes selected notes and events and returns how many were removed. */
export function deleteObjects(
  session: EditorSession,
  label = t("editor.commands.clipboard.deleteLabel"),
): number {
  const snapshot = captureSelection(session);
  const count = snapshot.notes.length + snapshot.events.length;
  if (!count) {
    return 0;
  }
  // Group event removals per line; entries may repeat a line because the guard
  // accepts both key shapes, and filtering the same list twice is idempotent.
  const removalsByLine = new Map<number, Map<string, Set<number>>>();
  for (const entry of snapshot.events) {
    const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
    const line = removalsByLine.get(lineIndex) ?? new Map<string, Set<number>>();
    const indices = line.get(entry.type) ?? new Set<number>();
    indices.add(entry.index);
    line.set(entry.type, indices);
    removalsByLine.set(lineIndex, line);
  }
  if (globalXYBindingEnabled()) {
    for (const [lineIndex, removals] of removalsByLine) {
      for (const [type, indices] of [...removals]) {
        const counterpartType = xyCounterpartType(type);
        if (!counterpartType) {
          continue;
        }
        const sourceEvents = eventListAt(session, lineIndex, type, session.eventLayer);
        const counterpartEvents = eventListAt(
          session,
          lineIndex,
          counterpartType,
          session.eventLayer,
        );
        const counterpartIndices = removals.get(counterpartType) ?? new Set<number>();
        for (const index of indices) {
          const source = sourceEvents[index];
          if (!source) {
            continue;
          }
          const counterpartIndex = counterpartEvents.findIndex((event) =>
            sameEventSpan(event, source),
          );
          if (counterpartIndex >= 0) {
            counterpartIndices.add(counterpartIndex);
          }
        }
        if (counterpartIndices.size) {
          removals.set(counterpartType, counterpartIndices);
        }
      }
    }
  }
  const updatesByLine = new Map<number, Map<string, JudgeLineEvent[]>>();
  for (const [lineIndex, removals] of removalsByLine) {
    const updates = new Map<string, JudgeLineEvent[]>();
    for (const [type, indices] of removals) {
      const original = eventListAt(session, lineIndex, type, session.eventLayer);
      updates.set(
        type,
        original.filter((event, index) => !indices.has(index)),
      );
    }
    if (updates.size) {
      updatesByLine.set(lineIndex, updates);
    }
  }
  let chart = session.chart;
  for (const [lineIndex, updates] of updatesByLine) {
    chart = chartWithEventLists(chart, Number(lineIndex), session.eventLayer, updates);
  }
  const noteEntries = snapshot.notes;
  if (noteEntries.length) {
    const lines = [...(chart.judgeLineList ?? [])];
    const byLine = new Map<number, Set<number>>();
    for (const entry of noteEntries) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : session.lineIndex;
      if (!byLine.has(lineIndex)) {
        byLine.set(lineIndex, new Set());
      }
      byLine.get(lineIndex)?.add(entry.index);
    }
    for (const [lineIndex, selected] of byLine) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      const notes = (line.notes ?? []).filter((note, index) => !selected.has(index));
      lines[lineIndex] = { ...line, notes, numOfNotes: countScoringNotes(notes) };
    }
    chart = { ...chart, judgeLineList: lines };
  }
  commitSelectionEdit(
    session,
    {
      chart,
      lineIndex: session.lineIndex,
      eventLayer: session.eventLayer,
      focus: session.focus,
      selection: new Set(),
      eventSelection: new Set(),
      multiLineSelection: new Map(),
      multiEventSelection: new Map(),
    },
    label,
    {},
    { normalized: true, skipValidation: true, estimatedBytes: count * 256 },
  );
  return count;
}

/**
 * The earliest beat in the clipboard, as an exact triple.
 *
 * Comparing tuples keeps a `1/3` anchor exact when the paste target is
 * subtracted from it.
 */
export function clipboardStartBeat(session: EditorSession): Beat | null {
  let earliest: Beat | null = null;
  const consider = (beat: readonly number[]): void => {
    const value = normalizeBeat(beat);
    if (!earliest || compareBeats(value, earliest) < 0) {
      earliest = value;
    }
  };
  for (const note of session.clipboard) {
    consider(note.startTime);
  }
  for (const { event } of session.eventClipboard) {
    consider(event.startTime);
  }
  return earliest;
}

/** The latest clipboard beat as an exact triple, or null for an empty clipboard. */
export function clipboardEndBeat(session: EditorSession): Beat | null {
  let latest: Beat | null = null;
  const consider = (beat: readonly number[]): void => {
    const value = normalizeBeat(beat);
    if (!latest || compareBeats(value, latest) > 0) {
      latest = value;
    }
  };
  for (const note of session.clipboard) {
    consider(note.endTime);
    consider(note.startTime);
  }
  for (const { event } of session.eventClipboard) {
    consider(event.endTime);
    consider(event.startTime);
  }
  return latest;
}

/** The earliest clipboard beat as a number, for the surfaces that draw it. */
export function clipboardStart(session: EditorSession): number {
  const earliest = clipboardStartBeat(session);
  return earliest ? beatValue(earliest) : Infinity;
}

/** The clipboard's exact beat span, or null when it holds no objects. */
export function clipboardBeatRange(session: EditorSession): ClipboardBeatRange | null {
  const start = clipboardStartBeat(session);
  const end = clipboardEndBeat(session);
  return start && end ? { start: beatValue(start), end: beatValue(end) } : null;
}

/** Relocates the clipboard to a beat and line without modifying the session. */
export function projectClipboard(
  session: EditorSession,
  beat: number | Beat,
  { mirror = false, keepTime = false, targetLineIndex }: ClipboardOptions = {},
): ClipboardProjection {
  const lineCount = session.chart?.judgeLineList?.length ?? 0;
  const noteLines = session.clipboard.map((unused, index) =>
    Number.isInteger(session.clipboardNoteLines?.[index])
      ? session.clipboardNoteLines[index]
      : session.lineIndex,
  );
  const sourceEventLines = session.eventClipboard.map((unused, index) =>
    Number.isInteger(session.eventClipboardLines?.[index])
      ? session.eventClipboardLines[index]
      : session.lineIndex,
  );
  const sourceEventLayers = session.eventClipboard.map((unused, index) => {
    const layer = session.eventClipboardLayers?.[index];
    return Number.isInteger(layer) ? layer : session.eventLayer;
  });
  const targetLayerAnchor = session.eventClipboardPreserveLayers
    ? Math.min(
        ...session.eventClipboard.flatMap(({ type }, index) =>
          BASE_EVENT_TYPES.has(type) ? [sourceEventLayers[index]] : [],
        ),
      )
    : session.eventLayer;
  const layerAnchor = Number.isFinite(targetLayerAnchor) ? targetLayerAnchor : session.eventLayer;
  const eventLines: number[] = [];
  const eventLayers: number[] = [];
  const eventEntries: { type: string; event: JudgeLineEvent }[] = [];
  for (const [index, entry] of session.eventClipboard.entries()) {
    let layer = session.eventLayer;
    if (session.eventClipboardPreserveLayers) {
      layer = BASE_EVENT_TYPES.has(entry.type)
        ? session.eventLayer + sourceEventLayers[index] - layerAnchor
        : session.eventLayer;
      // The base layer range is 0-3. A block that overflows the end silently
      // drops those entries instead of leaking into the synthetic extended map.
      if (BASE_EVENT_TYPES.has(entry.type) && layer >= MAX_BASE_EVENT_LAYERS) {
        continue;
      }
    }
    eventEntries.push(entry);
    eventLines.push(sourceEventLines[index]);
    eventLayers.push(layer);
  }
  // The anchor includes the entries that survive the layer clamp, so a dropped
  // first layer cannot leave the pasted block one beat away from the target.
  let earliest: Beat | null = null;
  const consider = (value: readonly number[]): void => {
    const candidate = normalizeBeat(value);
    if (!earliest || compareBeats(candidate, earliest) < 0) {
      earliest = candidate;
    }
  };
  for (const note of session.clipboard) {
    consider(note.startTime);
  }
  for (const { event } of eventEntries) {
    consider(event.startTime);
  }
  if (!earliest) {
    return { notes: [], events: [] };
  }
  // The caller may still hand over a continuous coordinate; the subtraction of
  // the clipboard anchor is exact from here on.
  const targetBeat = typeof beat === "number" ? fromNumber(beat) : normalizeBeat(beat);
  const delta = keepTime ? ([0, 0, 1] as Beat) : subtractBeats(targetBeat, earliest);
  const shifted = compareBeats(delta, [0, 0, 1]) !== 0;
  const sourceLines = [...noteLines, ...eventLines];
  const sourceAnchor = sourceLines.length ? Math.min(...sourceLines) : session.lineIndex;
  const target =
    typeof targetLineIndex === "number" && Number.isInteger(targetLineIndex)
      ? targetLineIndex
      : session.lineIndex;
  const mapLine = (source: number): number => {
    const mapped = target + source - sourceAnchor;
    if (!lineCount) {
      return mapped;
    }
    return ((mapped % lineCount) + lineCount) % lineCount;
  };
  const notes = session.clipboard.map((note) => ({
    ...shiftedTime(note, delta),
    positionX: Number(note.positionX) * (mirror ? -1 : 1),
  }));
  const events = eventEntries.map(({ type, event }) => {
    let next = shiftedTime(event, delta);
    if (type === "paintEvents" && shifted && session.shaderAutoAlign !== false) {
      next = alignShaderParameters(next);
    }
    if (
      mirror &&
      MIRROR_EVENT_TYPES.has(type) &&
      typeof next.start === "number" &&
      typeof next.end === "number"
    ) {
      next = { ...next, start: -next.start, end: -next.end };
    }
    return { type, event: next };
  });
  return {
    notes,
    events,
    noteLines: noteLines.map(mapLine),
    eventLines: eventLines.map(mapLine),
    eventLayers,
    sourceAnchor,
    anchorBeat: beatValue(earliest),
    targetLineIndex: target,
  };
}

/** The beat span of one projected paste, after its relative shift. */
function projectedBeatRange(projected: ClipboardProjection): ClipboardBeatRange | null {
  let start = Infinity;
  let end = -Infinity;
  const consider = (item: { startTime: readonly number[]; endTime: readonly number[] }): void => {
    start = Math.min(start, beatValue(item.startTime));
    end = Math.max(end, beatValue(item.endTime));
  };
  for (const note of projected.notes) {
    consider(note);
  }
  for (const { event } of projected.events) {
    consider(event);
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** Inserts the projected clipboard as one history entry; false when empty. */
export function pasteObjects(
  session: EditorSession,
  beat: number | Beat,
  options: ClipboardOptions = {},
): boolean {
  const projected = structuredClone(projectClipboard(session, beat, options));
  if (!projected.notes.length && !projected.events.length) {
    return false;
  }
  const beatRange = projectedBeatRange(projected);
  let chart = session.chart;
  const selection = new Set<number>();
  const eventSelection = new Set<string>();
  const multiEventSelection = new Map<number, Set<string>>();
  const eventUpdates = new Map<
    string,
    { lineIndex: number; layer: number; updates: Map<string, JudgeLineEvent[]> }
  >();
  for (let index = 0; index < projected.events.length; index += 1) {
    const { type, event } = projected.events[index];
    const lineIndex = projected.eventLines?.[index] ?? session.lineIndex;
    const layer = projected.eventLayers?.[index] ?? session.eventLayer;
    const traits = judgeLineTraits(session.chart.judgeLineList?.[lineIndex]);
    if (
      (type === "alphaEvents" && !traits.allowsAlphaEvents) ||
      (type === "speedEvents" && !traits.allowsSpeedEvents) ||
      (type === NOISE_ACTIVE_EVENTS && !traits.isNoise)
    ) {
      continue;
    }
    const groupKey = `${lineIndex}:${layer}`;
    let group = eventUpdates.get(groupKey);
    if (!group) {
      group = { lineIndex, layer, updates: new Map() };
      eventUpdates.set(groupKey, group);
    }
    let events = group.updates.get(type);
    if (!events) {
      events = [...eventListAt(session, lineIndex, type, layer)];
      group.updates.set(type, events);
    }
    const key = eventKey(type, events.length);
    events.push(event);
    const counterpartType = xyCounterpartType(type);
    if (counterpartType && globalXYBindingEnabled()) {
      const counterpartEvents =
        group.updates.get(counterpartType) ??
        eventListAt(session, lineIndex, counterpartType, layer);
      const counterpartIsPasted = projected.events.some((candidate, candidateIndex) => {
        if (candidateIndex === index || candidate.type !== counterpartType) {
          return false;
        }
        const candidateLine = projected.eventLines?.[candidateIndex] ?? session.lineIndex;
        const candidateLayer = projected.eventLayers?.[candidateIndex] ?? session.eventLayer;
        return (
          candidateLine === lineIndex &&
          candidateLayer === layer &&
          sameEventSpan(candidate.event, event)
        );
      });
      if (
        !counterpartIsPasted &&
        !counterpartEvents.some((candidate) => sameEventSpan(candidate, event))
      ) {
        const counterpart = createXYCounterpart(
          session,
          lineIndex,
          layer,
          event,
          counterpartType,
          counterpartEvents,
        );
        if (counterpart) {
          const nextCounterpartEvents = group.updates.get(counterpartType) ?? [
            ...counterpartEvents,
          ];
          nextCounterpartEvents.push(counterpart);
          group.updates.set(counterpartType, nextCounterpartEvents);
        }
      }
    }
    // The selection model addresses one layer at a time. A layer-preserving
    // paste still commits every layer, but only the active layer is selected.
    if (layer === session.eventLayer) {
      let lineSelection = multiEventSelection.get(lineIndex);
      if (!lineSelection) {
        lineSelection = new Set();
        multiEventSelection.set(lineIndex, lineSelection);
      }
      lineSelection.add(key);
      if (lineIndex === session.lineIndex) {
        eventSelection.add(key);
      }
    }
  }
  for (const { lineIndex, layer, updates } of eventUpdates.values()) {
    chart = chartWithEventLists(chart, lineIndex, layer, updates);
  }
  const multiLineSelection = new Map<number, Set<number>>();
  if (projected.notes.length) {
    const lines = [...(chart.judgeLineList ?? [])];
    const grouped = new Map<number, JudgeLineNote[]>();
    projected.notes.forEach((note, index) => {
      const lineIndex = projected.noteLines?.[index] ?? session.lineIndex;
      if (!grouped.has(lineIndex)) {
        grouped.set(lineIndex, []);
      }
      grouped.get(lineIndex)?.push(note);
    });
    for (const [lineIndex, notesToAdd] of grouped) {
      const line = lines[lineIndex];
      if (!line || !lineAllowsNotes(line)) {
        continue;
      }
      const existing = line.notes ?? [];
      const notes = [...existing, ...notesToAdd];
      const selected = new Set(notesToAdd.map((unused, index) => existing.length + index));
      lines[lineIndex] = { ...line, notes, numOfNotes: countScoringNotes(notes) };
      multiLineSelection.set(lineIndex, selected);
      if (lineIndex === session.lineIndex) {
        for (const index of selected) {
          selection.add(index);
        }
      }
    }
    chart = { ...chart, judgeLineList: lines };
  }
  const committed = commitSelectionEdit(
    session,
    {
      chart,
      lineIndex: session.lineIndex,
      eventLayer: session.eventLayer,
      focus: projected.notes.length ? "notes" : "events",
      selection,
      eventSelection,
      multiLineSelection,
      multiEventSelection,
    },
    options?.mirror
      ? t("editor.commands.clipboard.pasteMirrorLabel")
      : t("editor.commands.clipboard.pasteLabel"),
    {},
    { beatRange: beatRange ?? undefined },
  );
  if (committed) {
    session.lastPasteBeatRange = beatRange;
  }
  return committed;
}

// ------------------------------------------------------------------ shortcuts

/**
 * The clipboard keys belong to the operations they call.
 *
 * `Delete` removes the selected objects; the context-menu delete uses the same
 * action.
 */
export const clipboardShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "edit.copy",
    category: "editor.clipboard",
    title: "shortcuts.editor.copy",
    scope: "editor",
    defaults: [{ key: "C", modifiers: ["CTRL"] }],
  },
  {
    id: "edit.copy.allLayers",
    category: "editor.clipboard",
    title: "shortcuts.editor.copyAllLayers",
    scope: "editor",
    defaults: [{ key: "C", modifiers: ["CTRL", "SHIFT"] }],
  },
  {
    id: "edit.cut",
    category: "editor.clipboard",
    title: "shortcuts.editor.cut",
    scope: "editor",
    defaults: [{ key: "X", modifiers: ["CTRL"] }],
  },
  {
    id: "edit.paste",
    category: "editor.clipboard",
    title: "shortcuts.editor.paste",
    scope: "editor",
    defaults: [{ key: "V", modifiers: ["CTRL"] }],
  },
  {
    id: "edit.paste.keepTime",
    category: "editor.clipboard",
    title: "shortcuts.editor.keepTimePaste",
    scope: "editor",
    defaults: [{ key: "V", modifiers: ["CTRL", "SHIFT"] }],
  },
  {
    id: "edit.paste.mirror",
    category: "editor.clipboard",
    title: "shortcuts.editor.mirrorPaste",
    scope: "editor",
    defaults: [{ key: "B", modifiers: ["CTRL"] }],
  },
  {
    id: "edit.clipboard.jumpStart",
    category: "editor.clipboard",
    title: "shortcuts.editor.clipboardJumpStart",
    scope: "editor",
    // The CLI and settings page can assign a key; navigation stays unbound by
    // default so the left-hand editing layout is unchanged.
    defaults: [],
  },
  {
    id: "edit.clipboard.jumpEnd",
    category: "editor.clipboard",
    title: "shortcuts.editor.clipboardJumpEnd",
    scope: "editor",
    defaults: [],
  },
  {
    id: "edit.clipboard.clear",
    category: "editor.clipboard",
    title: "shortcuts.editor.clearClipboard",
    scope: "editor",
    defaults: [{ key: "DELETE", modifiers: ["CTRL", "SHIFT"] }],
  },
  {
    id: "edit.delete",
    category: "editor.editing",
    title: "shortcuts.editor.delete",
    scope: "editor",
    defaults: [{ key: "D" }, { key: "DELETE" }],
  },
];
