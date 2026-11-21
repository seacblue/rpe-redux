/**
 * Plans a batch edit over a captured selection.
 *
 * A plan records each object's before and after value so the panel can show
 * the change without writing anything, and the preview is a pure function of
 * the snapshot, parameters and seed.
 */
import { t } from "../../../i18n/index.ts";
import {
  addBeatFraction,
  addBeats,
  beatValue,
  fromNumber,
  normalizeBeat,
  toBeat,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { countScoringNotes, HOOK_TAIL_FIELD, pinHookedEvent } from "../../global/chart/chart.ts";
import type { JudgeLineEvent, JudgeLineNote } from "../../global/chart/chart.ts";
import type { ExpressionScope } from "../../utils/batchScript.ts";
import { alignShaderParameters } from "../../global/chart/shader/shaderEvents.ts";
import { eventList, eventKey, chartWithEventLists } from "../events/eventTracks.ts";
import type { EventSession } from "../events/eventTracks.ts";
import type { MultiEditKind } from "./parameters.ts";
import type { SelectionSnapshot } from "../selection/snapshot.ts";
import { batchOperation, beatDistribution, distribution, randomSource } from "./distribution.ts";
import type {
  BatchItem,
  BatchEditOptions,
  BatchChange,
  MultiEditResult,
} from "./planVocabulary.ts";
export { batchOperation } from "./distribution.ts";

/** One note or event captured for a batch edit, normalized across the two kinds. */
interface BatchEntry {
  type: string;
  index: number;
  lineIndex: number;
  before: BatchItem;
}

export function scopeFor(
  item: BatchItem,
  kind: MultiEditKind,
  line: number,
  index: number,
  count: number,
): ExpressionScope {
  const start = beatValue(item.startTime);
  const end = beatValue(item.endTime);
  const scope = {
    n: kind === "notes" ? index : index + 1,
    i: index,
    N: count,
    u: count > 1 ? index / (count - 1) : 0,
    line,
    t: start,
    t1: start,
    t2: end,
    "st.time": start,
    "ed.time": end,
    duration: end - start,
  };
  if (kind === "notes") {
    // The engine's scope is numbers-only; the note fields are stored untyped on
    // the chart, so each read is asserted rather than coerced.
    const tint = Array.isArray(item.tint)
      ? item.tint
      : Array.isArray(item.color)
        ? item.color
        : undefined;
    return {
      ...scope,
      x: item.positionX as number,
      speed: (item.speed ?? 1) as number,
      size: (item.size ?? 1) as number,
      yOffset: (item.yOffset ?? 0) as number,
      visibleTime: (item.visibleTime ?? 999999) as number,
      alpha: (item.alpha ?? 255) as number,
      judgeArea: (item.judgeArea ?? 1) as number,
      red: (tint?.[0] ?? 255) as number,
      green: (tint?.[1] ?? 255) as number,
      blue: (tint?.[2] ?? 255) as number,
      type: item.type as number,
      isFake: (item.isFake ?? 0) as number,
      above: (item.above ?? 1) as number,
      v: (item.speed ?? 1) as number,
      w: (item.size ?? 1) as number,
      width: (item.size ?? 1) as number,
      yoffset: (item.yOffset ?? 0) as number,
      vt: (item.visibleTime ?? 999999) as number,
    };
  }
  return {
    ...scope,
    start: item.start as number,
    end: item.end as number,
    "st.x": item.start as number,
    "ed.x": item.end as number,
    easing: (item.easingType ?? 1) as number,
    linkgroup: (item.linkgroup ?? 0) as number,
    inst: (item.inst ?? 0) as number,
    order: scope.u,
  };
}

const EXPRESSION_SCOPE_PROBE: BatchItem = {
  startTime: [1, 0, 1],
  endTime: [2, 0, 1],
  positionX: 1,
  speed: 1,
  size: 1,
  yOffset: 1,
  visibleTime: 1,
  alpha: 1,
  judgeArea: 1,
  tint: [1, 1, 1],
  type: 1,
  isFake: 0,
  above: 1,
  start: 1,
  end: 2,
  easingType: 1,
  linkgroup: 1,
  inst: 1,
};

/** Build the validation scope from the planner's real expression vocabulary. */
export function expressionScopeFor(kind: MultiEditKind): ExpressionScope {
  return scopeFor(EXPRESSION_SCOPE_PROBE, kind, 0, 1, 3);
}

/** Return the exact names accepted by the planner for one expression kind. */
export function expressionScopeFields(kind: MultiEditKind): readonly string[] {
  return Object.freeze(Object.keys(expressionScopeFor(kind)));
}

function writeField(item: BatchItem, field: string, value: number): void {
  if (field === "t1" || field === "t2") {
    item[field === "t1" ? "startTime" : "endTime"] = fromNumber(value);
  } else if (field === "duration") {
    item.endTime = addBeats(item.startTime, toBeat(Math.max(0, value)));
  } else if (field === "both") {
    item.start = value;
    item.end = value;
  } else if (["red", "green", "blue"].includes(field)) {
    const existing = Array.isArray(item.tint)
      ? item.tint
      : Array.isArray(item.color)
        ? item.color
        : [255, 255, 255];
    const tint = [...existing];
    tint[["red", "green", "blue"].indexOf(field)] = Math.max(0, Math.min(255, Math.trunc(value)));
    item.tint = tint;
  } else {
    item[field === "x" ? "positionX" : field === "easing" ? "easingType" : field] = value;
  }
}

/** Validate one planned event or note change; the clone planner shares this gate. */
export function validateChange(
  change: BatchChange,
  lineCount: number,
  snapshot: SelectionSnapshot,
): void {
  const { after, kind, type } = change;
  if (
    !Number.isInteger(change.lineIndex) ||
    change.lineIndex < 0 ||
    change.lineIndex >= lineCount
  ) {
    throw new Error(
      t("editor.commands.multiEdit.error.targetLineMissing", { index: change.lineIndex }),
    );
  }
  if (kind === "notes") {
    if (typeof after.type !== "number" || ![1, 2, 3, 4].includes(after.type)) {
      throw new Error(t("editor.commands.multiEdit.error.noteType"));
    }
    const above = after.above ?? 1;
    const isFake = after.isFake ?? 0;
    if (
      typeof above !== "number" ||
      ![0, 1, 2].includes(above) ||
      typeof isFake !== "number" ||
      ![0, 1].includes(isFake)
    ) {
      throw new Error(t("editor.commands.multiEdit.error.aboveIsFake"));
    }
    after.above = above === 1 ? 1 : after.type === 2 ? 0 : 2;
    if (
      after.type === 2 &&
      change.before.type !== 2 &&
      beatValue(after.endTime) === beatValue(after.startTime)
    ) {
      after.endTime = addBeatFraction(after.startTime, 1, 4);
    }
  }
  if (kind === "notes" && after.type !== 2) {
    if (
      beatValue(after.startTime) === beatValue(change.before.startTime) &&
      beatValue(after.endTime) !== beatValue(change.before.endTime)
    ) {
      after.startTime = [...after.endTime];
    } else {
      after.endTime = [...after.startTime];
    }
  }
  // A batch edit may target either value of a hooked event. Its tail stays
  // locked to the head, so a tail the batch actually authored replaces the
  // cache and the pair is pinned again; a batch that only moves the head keeps
  // the tail cached before the edit. A batch that clears the hook gives up the
  // cache instead of restoring it, because the batch wrote that tail on purpose.
  if (kind === "events" && after.inst) {
    change.after = pinHookedEvent(after as JudgeLineEvent, change.before as JudgeLineEvent);
  } else if (kind === "events" && change.before.inst) {
    delete after[HOOK_TAIL_FIELD];
  }
  // A hook whose pair this editor cannot pin — another tool wrote it unpaired —
  // keeps its flag only while both values still match.
  if (
    kind === "events" &&
    change.after.inst &&
    JSON.stringify(change.after.start) !== JSON.stringify(change.after.end)
  ) {
    change.after.inst = 0;
  }
  const inst = change.after.inst ?? 0;
  if (kind === "events" && !(inst === 0 || inst === 1 || inst === false || inst === true)) {
    throw new Error(t("editor.commands.multiEdit.error.inst"));
  }
  if (
    kind === "events" &&
    type === "paintEvents" &&
    snapshot.shaderAutoAlign !== false &&
    beatValue(after.startTime) !== beatValue(change.before.startTime)
  ) {
    change.after = alignShaderParameters(after as JudgeLineEvent);
  }
  for (const [key, value] of Object.entries(change.after)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(t("editor.commands.multiEdit.error.notFinite", { key }));
    }
  }
  const easingType = after.easingType;
  if (
    easingType !== undefined &&
    (typeof easingType !== "number" ||
      !Number.isInteger(easingType) ||
      easingType < 1 ||
      easingType > 29)
  ) {
    throw new Error(t("editor.commands.multiEdit.error.easingResult"));
  }
}

/**
 * Build the chart a plan describes and record the selection it leaves behind.
 *
 * The clone planner shares this assembler: `removeSource` drops the original
 * selection, and `selectCopies` focuses the new copies so a clone commit behaves
 * like a paste rather than like an edit.
 */
export function assemble(
  snapshot: SelectionSnapshot,
  changes: BatchChange[],
  kind: MultiEditKind,
  removeSource = false,
  selectCopies = false,
): MultiEditResult {
  let chart = snapshot.chart;
  const selection = new Set<number>(
    kind === "notes" ? snapshot.notes.map((entry) => entry.index) : [],
  );
  const eventSelection = new Set<string>(
    kind === "events" && !removeSource
      ? snapshot.events
          .filter((entry) => (entry.lineIndex ?? snapshot.lineIndex) === snapshot.lineIndex)
          .map((entry) => eventKey(entry.type, entry.index))
      : [],
  );
  const multiEventSelection = new Map<number, Set<string>>();
  // A plan that keeps its sources leaves them selected on every source line;
  // copies add their own entries below. A removal starts from an empty map.
  if (kind === "events" && !removeSource) {
    for (const entry of snapshot.events) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      let lineSelection = multiEventSelection.get(lineIndex);
      if (!lineSelection) {
        lineSelection = new Set();
        multiEventSelection.set(lineIndex, lineSelection);
      }
      lineSelection.add(eventKey(entry.type, entry.index));
    }
  }
  const sourceEventLines = new Set<number>(
    snapshot.events.map((entry) =>
      Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex,
    ),
  );
  const affected = new Set<number>(
    changes.flatMap((change) => [
      snapshot.lineIndex,
      change.lineIndex,
      ...(kind === "events" ? sourceEventLines : []),
    ]),
  );
  const notesByLine = new Map<number, JudgeLineNote[]>();
  const eventsByLine = new Map<number, Map<string, JudgeLineEvent[]>>();
  const selectedNotes = new Set<number>(snapshot.notes.map((entry) => entry.index));
  const noteUpdates = new Map<number, BatchChange>(
    changes
      .filter((change) => !change.copy)
      .map((change): [number, BatchChange] => [change.index, change]),
  );
  for (const lineIndex of affected) {
    const line = (chart.judgeLineList ?? [])[lineIndex];
    if (kind === "notes") {
      const notes: JudgeLineNote[] = [];
      if (lineIndex === snapshot.lineIndex) {
        selection.clear();
      }
      (line?.notes ?? []).forEach((note, index) => {
        const change = lineIndex === snapshot.lineIndex ? noteUpdates.get(index) : null;
        if (change && change.lineIndex !== lineIndex) {
          return;
        }
        if (lineIndex === snapshot.lineIndex && selectedNotes.has(index)) {
          selection.add(notes.length);
        }
        notes.push((change?.after ?? note) as JudgeLineNote);
      });
      notesByLine.set(lineIndex, notes);
    } else {
      eventsByLine.set(lineIndex, new Map());
    }
  }
  if (removeSource) {
    const selected = new Map<string, { lineIndex: number; type: string; indices: Set<number> }>();
    for (const entry of snapshot.events) {
      const lineIndex = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      const key = `${lineIndex}:${entry.type}`;
      if (!selected.has(key)) {
        selected.set(key, { lineIndex, type: entry.type, indices: new Set() });
      }
      selected.get(key)?.indices.add(entry.index);
    }
    for (const { lineIndex, type, indices } of selected.values()) {
      const session: EventSession = { chart, lineIndex, eventLayer: snapshot.eventLayer };
      const original = eventList(session, type);
      eventsByLine.get(lineIndex)?.set(
        type,
        original.filter((event, index) => !indices.has(index)),
      );
    }
  }
  for (const change of changes) {
    if (kind === "notes") {
      if (change.lineIndex !== snapshot.lineIndex || change.copy) {
        const notes = notesByLine.get(change.lineIndex) ?? [];
        if (change.lineIndex === snapshot.lineIndex) {
          selection.add(notes.length);
        }
        notes.push(change.after as JudgeLineNote);
      }
    } else {
      const updates = eventsByLine.get(change.lineIndex);
      if (updates && !updates.has(change.type)) {
        const session: EventSession = {
          chart,
          lineIndex: change.lineIndex,
          eventLayer: snapshot.eventLayer,
        };
        updates.set(change.type, [...eventList(session, change.type)]);
      }
      const events = updates?.get(change.type) ?? [];
      if (change.copy) {
        const position = events.length;
        events.push(change.after as JudgeLineEvent);
        if (change.lineIndex === snapshot.lineIndex) {
          eventSelection.add(eventKey(change.type, position));
        }
        if (selectCopies) {
          let lineSelection = multiEventSelection.get(change.lineIndex);
          if (!lineSelection) {
            lineSelection = new Set();
            multiEventSelection.set(change.lineIndex, lineSelection);
          }
          lineSelection.add(eventKey(change.type, position));
        }
      } else {
        events[change.index] = change.after as JudgeLineEvent;
      }
    }
  }
  // `numOfNotes` counts playable notes, not Holds, everywhere else this chart is
  // written; a batch edit has to agree or the saved chart and the library's
  // note count both drift.
  if (notesByLine.size) {
    chart = {
      ...chart,
      judgeLineList: (chart.judgeLineList ?? []).map((line, index) =>
        notesByLine.has(index)
          ? {
              ...line,
              notes: notesByLine.get(index) ?? [],
              numOfNotes: countScoringNotes(notesByLine.get(index)),
            }
          : line,
      ),
    };
  }
  for (const [lineIndex, updates] of eventsByLine) {
    if (updates.size) {
      chart = chartWithEventLists(chart, lineIndex, snapshot.eventLayer, updates);
    }
  }
  // This chart is a UI preview. The commit path (`commitSelectionEdit`) owns
  // structural validation; validating here rebuilt and walked the whole large
  // chart every time multi-selection changed.
  if (kind === "events" && !removeSource) {
    for (const change of changes) {
      if (!change.copy) {
        const lineIndex = Number.isInteger(change.lineIndex)
          ? change.lineIndex
          : snapshot.lineIndex;
        let lineSelection = multiEventSelection.get(lineIndex);
        if (!lineSelection) {
          lineSelection = new Set();
          multiEventSelection.set(lineIndex, lineSelection);
        }
        lineSelection.add(eventKey(change.type, change.index));
      }
    }
  }
  return {
    chart,
    lineIndex: snapshot.lineIndex,
    eventLayer: snapshot.eventLayer,
    focus: kind,
    selection,
    eventSelection,
    multiEventSelection,
    changes,
  };
}

export function previewMultiEdit(
  snapshot: SelectionSnapshot,
  kind: MultiEditKind,
  options: BatchEditOptions = {},
): MultiEditResult {
  const field = options.field ?? (kind === "notes" ? "x" : "both");
  const eventType = options.eventType;
  const operation = options.operation ?? "By";
  const random = randomSource(options.seed ?? 1);
  const modifier =
    field === "hitSound"
      ? null
      : field === "t1" || field === "t2"
        ? beatDistribution(options, random)
        : distribution(options, random);
  const groups = new Map<string, BatchEntry[]>();
  const applicationMode =
    kind === "events" && options.eventApplicationMode === "global" ? "global" : "per-line";
  const sourceEntries: BatchEntry[] =
    kind === "notes"
      ? snapshot.notes.map((entry) => ({
          type: "",
          index: entry.index,
          lineIndex: entry.lineIndex,
          before: entry.note,
        }))
      : snapshot.events
          .filter((entry) => !eventType || entry.type === eventType)
          .map((entry) => ({
            type: entry.type,
            index: entry.index,
            lineIndex: entry.lineIndex,
            before: entry.event,
          }));
  // Events are grouped per channel, and — unless the author asked for one global
  // pass — per source line, because a distribution walks each group in time.
  for (const entry of sourceEntries) {
    const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
    const key =
      kind === "notes"
        ? "notes"
        : applicationMode === "global"
          ? entry.type
          : `${sourceLine}:${entry.type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(entry);
  }
  const changes: BatchChange[] = [];
  for (const entries of groups.values()) {
    entries.sort(
      (left, right) =>
        beatValue(left.before.startTime) - beatValue(right.before.startTime) ||
        left.index - right.index,
    );
    let time: Beat = entries.length ? normalizeBeat(entries[0].before.startTime) : [0, 0, 1];
    const groupChanges: BatchChange[] = [];
    entries.forEach((entry, index) => {
      const sourceLine = Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex;
      const after: BatchItem = structuredClone(entry.before);
      const scope = scopeFor(after, kind, sourceLine, index, entries.length);
      const change: BatchChange = {
        kind,
        type: entry.type,
        index: entry.index,
        before: entry.before,
        after,
        lineIndex: sourceLine,
        copy: false,
      };
      if (field === "hitSound") {
        if (operation !== "To") {
          throw new Error(t("editor.commands.multiEdit.error.hitSoundOperation"));
        }
        after.hitSound = String(options.lower || options.upper || "");
      } else {
        const endpointDistribution =
          kind === "notes" || ["line", "duration", "order"].includes(field);
        const progress = endpointDistribution ? scope.u : (index + 1) / entries.length;
        const value = modifier !== null ? modifier(index, progress) : null;
        if (value === null) {
          return;
        }
        if (field === "line") {
          change.lineIndex = Math.round(batchOperation(sourceLine, value, operation));
          change.copy = kind === "events";
        } else if (field === "both") {
          if (typeof after.start !== "number" || typeof after.end !== "number") {
            throw new Error(t("editor.commands.multiEdit.error.valueOnly"));
          }
          after.start = batchOperation(after.start, value, operation);
          after.end = batchOperation(after.end, value, operation);
        } else if (field === "duration" && kind === "events") {
          const duration = Math.max(0, batchOperation(scope.duration, value, operation));
          const durationBeat = toBeat(duration);
          after.startTime = time;
          after.endTime = addBeats(time, durationBeat);
          time = addBeats(time, durationBeat);
        } else if (field === "order") {
          change.priority = batchOperation(scope.u, value, operation);
        } else {
          if (typeof scope[field] !== "number") {
            throw new Error(t("editor.commands.multiEdit.error.unsupportedField"));
          }
          writeField(after, field, batchOperation(scope[field], value, operation));
        }
      }
      groupChanges.push(change);
    });
    if (field === "order") {
      const ordered = groupChanges.toSorted(
        (left, right) => (left.priority ?? 0) - (right.priority ?? 0),
      );
      groupChanges.forEach((change, index) => {
        change.after = {
          ...structuredClone(ordered[index].before),
          startTime: [...change.before.startTime],
          endTime: [...change.before.endTime],
        };
      });
    }
    for (const change of groupChanges) {
      validateChange(change, (snapshot.chart.judgeLineList ?? []).length, snapshot);
      changes.push(change);
    }
  }
  if (!changes.length) {
    throw new Error(t("editor.commands.multiEdit.error.noMatch"));
  }
  return assemble(snapshot, changes, kind);
}
