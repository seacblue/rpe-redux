/* eslint-disable max-lines -- model constructors, parsing, id normalization, and serialization are one document contract. */
/**
 * The RPE chart model: document shapes, constructors, parsing and serialization.
 *
 * Defines event, note and line structures plus the type guards used across the
 * editor, creates fresh charts, normalises object ids, and delegates JSON
 * structural validation to `chartValidation.ts`. This is the single definition
 * of what a chart document contains.
 */
import { t } from "../../../i18n/index.ts";
import { fromNumber, type Beat } from "./timing/beat.ts";
import type { EditableTrajectoryOptions } from "./trajectory/curveTrajectory.ts";
import type { TrajectorySplitInput } from "./trajectory/trajectorySimplify.ts";
import {
  createChartObjectId,
  createChartIdentityFactory,
  isChartObjectId,
  type ChartObjectId,
} from "./identity.ts";
import { isRecord } from "../../utils/guards.ts";
import { yieldToHost } from "../../utils/yieldToHost.ts";
import { extensionRegistry } from "../../extensions/runtime.ts";
import { EVENT_TYPES, EVENT_TRACKS } from "./chartVocabulary.ts";
import { containsCycle } from "./cycles.ts";
import { assertChartStructure } from "./chartValidation.ts";
import type { BlockArea } from "./noise/blockArea.ts";

export {
  EVENT_TYPES,
  EXTENDED_TYPES,
  EVENT_TRACKS,
  NOTE_TYPES,
  isEventTrack,
  isNoteType,
  type EventTrackName,
  type ExtendedType,
  type NoteType,
} from "./chartVocabulary.ts";

/** A runtime track lookup on a line layer. */
export type MutableEventLayer = LineEventLayer & {
  [track: string]: JudgeLineEvent[] | undefined;
};

/** Iterate the normal layers and the extended layer without duplicating the join rule. */
export function lineEventLayers(line: JudgeLine): LineEventLayer[] {
  return [...(line.eventLayers ?? []), line.extended].filter((layer): layer is LineEventLayer =>
    Boolean(layer),
  );
}

/**
 * RPE event payloads are polymorphic: numbers for the geometric tracks, `[r, g, b]`
 * for colours, `%P%`-templated strings for text, and opaque objects for shader paint.
 */
export type LineEventValue = number | number[] | string | null;

export interface JudgeLineEvent {
  id?: ChartObjectId;
  startTime: Beat;
  endTime: Beat;
  start: LineEventValue;
  end: LineEventValue;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: number | boolean;
  bezierPoints?: number[];
  linkgroup?: number;
  /** Present on whole-trajectory moves; validated by `assertChart`. */
  trajectory?: {
    version: number;
    options?: EditableTrajectoryOptions;
    split?: TrajectorySplitInput;
    segments: number;
  };
  /** Set on the virtual copies the runtime derives from a trajectory event. */
  trajectoryAxis?: "x" | "y" | "rotation";
  /** Shader text events may carry a custom font. */
  font?: string;
  [extra: string]: unknown;
}

export interface JudgeLineNote {
  id?: ChartObjectId;
  type: number;
  startTime: Beat;
  endTime: Beat;
  positionX?: number;
  above?: number | string | null;
  isFake?: number;
  speed?: number;
  size?: number;
  yOffset?: number;
  visibleTime?: number;
  alpha?: number;
  /** Colour-blended note textures keep their RGB triple here. */
  color?: number[];
  [extra: string]: unknown;
}

export interface LineEventLayer {
  moveXEvents?: JudgeLineEvent[];
  moveYEvents?: JudgeLineEvent[];
  rotateEvents?: JudgeLineEvent[];
  alphaEvents?: JudgeLineEvent[];
  speedEvents?: JudgeLineEvent[];
  scaleXEvents?: JudgeLineEvent[];
  scaleYEvents?: JudgeLineEvent[];
  colorEvents?: JudgeLineEvent[];
  paintEvents?: JudgeLineEvent[];
  textEvents?: JudgeLineEvent[];
  inclineEvents?: JudgeLineEvent[];
  gifEvents?: JudgeLineEvent[];
}

/** One point of `alphaControl`/`posControl`/`sizeControl`/`skewControl`/`yControl`. */
export interface ControlPoint {
  x?: number;
  alpha?: number;
  pos?: number;
  size?: number;
  skew?: number;
  y?: number;
  easing?: number;
  [extra: string]: unknown;
}

export interface JudgeLine {
  id?: ChartObjectId;
  Name?: string;
  Group?: number | string;
  Texture?: string;
  bpmfactor?: number;
  father?: number | string | null;
  rotateWithFather?: boolean;
  isCover?: number;
  zOrder?: number;
  anchor?: number[];
  isGif?: boolean;
  attachUI?: string;
  eventLayers?: (LineEventLayer | null)[];
  extended?: LineEventLayer;
  notes?: JudgeLineNote[];
  numOfNotes?: number;
  alphaControl?: ControlPoint[];
  posControl?: ControlPoint[];
  sizeControl?: ControlPoint[];
  skewControl?: ControlPoint[];
  yControl?: ControlPoint[];
  [extra: string]: unknown;
}

/**
 * Whether a child line follows its parent's rotation.
 *
 * RPE leaves this off when `rotateWithFather` is absent: the parent still
 * supplies the coordinate origin, but its angle does not turn the child. Only
 * an explicit flag opts into rotation inheritance.
 */
export function inheritsParentRotation(line: Pick<JudgeLine, "rotateWithFather">): boolean {
  // The stored flag may be `1`; any truthy value opts into inheritance.
  return Boolean(line.rotateWithFather);
}

export interface ChartMeta {
  RPEVersion?: number;
  /** Application version that produced a Redux export, as a semantic version. */
  ReduxVersion?: string;
  /** RPE project id: the Resources folder name and the package's Info Path. */
  id?: string;
  /** Export-only record of native defaults; stripped when the file is opened. */
  ReduxExportDefaults?: Record<string, unknown>;
  name?: string;
  composer?: string;
  charter?: string;
  illustration?: string;
  level?: string;
  song?: string;
  background?: string;
  offset?: number;
  numOfNotes?: number;
  [extra: string]: unknown;
}

export interface BpmEntry {
  bpm: number;
  startTime: Beat;
  [extra: string]: unknown;
}

export interface Chart {
  META: ChartMeta;
  BPMList: BpmEntry[];
  judgeLineGroup?: string[];
  judgeLineList?: JudgeLine[];
  /** Noise areas, stored in RPE coordinates and beats. */
  blockAreaList?: BlockArea[];
  [extra: string]: unknown;
}

/** The neutral cubic-bezier control points: a straight, identity curve. */
export const DEFAULT_BEZIER_POINTS = Object.freeze([0, 0, 1, 1] as const);

/** A root line's `father` value. */
export const NO_LINE_PARENT = -1;

/** Z order a newly created line starts with. */
export const CREATED_LINE_Z_ORDER = 0;

/** Z order a compatibility conversion fills for a line that lacks one. */
export const COMPATIBILITY_LINE_Z_ORDER = 0;

/**
 * Z order an imported external line receives from its source position.
 *
 * The exchange formats draw lines in list order, so the source index is the
 * initial depth until the author changes it.
 */
export function importedLineZOrder(index: number): number {
  return index;
}

/**
 * Read a line's `father` field as a parent line index.
 *
 * RPE writes `-1`, `null`, an empty string, or no field for a root line; every
 * other value is coerced, so numeric strings resolve like numbers.
 */
export function lineParentIndex(father: unknown): number {
  return father === undefined || father === null || father === "" ? NO_LINE_PARENT : Number(father);
}

/** Create one event with start/end values and beat triples. */
export function createEvent(
  start: LineEventValue = 0,
  end: LineEventValue = start,
  startBeat = 0,
  endBeat = startBeat + 1,
): JudgeLineEvent {
  return {
    id: createChartObjectId(),
    startTime: fromNumber(startBeat),
    endTime: fromNumber(endBeat),
    start,
    end,
    easingType: 1,
    easingLeft: 0,
    easingRight: 1,
    bezier: 0,
    bezierPoints: [...DEFAULT_BEZIER_POINTS],
    linkgroup: 0,
  };
}

/** Create an empty judge line with a stable id and default event layers. */
export function createLine(name = t("model.line.untitled")): JudgeLine {
  const layer: LineEventLayer = Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      [
        createEvent(
          type === "alphaEvents" ? 255 : type === "speedEvents" ? 10 : 0,
          undefined,
          0,
          1,
        ),
      ],
    ]),
  );
  return {
    id: createChartObjectId(),
    Name: name,
    Group: 0,
    Texture: "line.png",
    bpmfactor: 1,
    father: NO_LINE_PARENT,
    rotateWithFather: false,
    isCover: 1,
    zOrder: CREATED_LINE_Z_ORDER,
    anchor: [0.5, 0.5],
    isGif: false,
    eventLayers: [layer],
    extended: {},
    notes: [],
    numOfNotes: 0,
  };
}

/** The RPEVersion written into every chart this editor creates. */
export const CURRENT_RPE_VERSION = 170;

/** Create a valid empty chart shell with default metadata, BPM and lists. */
export function createChart(): Chart {
  return {
    META: {
      RPEVersion: CURRENT_RPE_VERSION,
      name: t("model.chart.untitled"),
      composer: "",
      charter: "",
      illustration: "",
      level: "",
      song: "",
      background: "",
      offset: 0,
    },
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    judgeLineGroup: ["Default"],
    judgeLineList: [createLine()],
  };
}

/** Create a note with the requested type, X position and beat range. */
export function createNote(
  type: number,
  beat: number,
  positionX: number,
  endBeat = beat + 1,
): JudgeLineNote {
  return {
    id: createChartObjectId(),
    type,
    startTime: fromNumber(beat),
    endTime: fromNumber(type === 2 ? endBeat : beat),
    positionX,
    above: 1,
    isFake: 0,
    speed: 1,
    size: 1,
    yOffset: 0,
    visibleTime: 999999,
    alpha: 255,
  };
}

/**
 * Remove whole-trajectory payloads before validation or serialization.
 *
 * The editor stores trajectory motion as expanded per-axis events, so a stored
 * `trajectory` field carries no live meaning.
 */
export function stripLegacyTrajectory(chart: unknown): void {
  if (!isRecord(chart)) {
    return;
  }
  const stripEvent = (value: unknown): void => {
    if (isRecord(value)) {
      delete value.trajectory;
      delete value.trajectoryAxis;
    }
  };
  const stripLayer = (layer: unknown): void => {
    if (!isRecord(layer)) {
      return;
    }
    for (const events of Object.values(layer)) {
      if (Array.isArray(events)) {
        events.forEach(stripEvent);
      }
    }
  };
  const lines = chart.judgeLineList;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      if (!isRecord(line)) {
        continue;
      }
      for (const layer of Array.isArray(line.eventLayers) ? line.eventLayers : []) {
        stripLayer(layer);
      }
      stripLayer(line.extended);
    }
  }
  for (const key of ["effects", "shaderEvents"] as const) {
    const events = chart[key];
    if (Array.isArray(events)) {
      events.forEach(stripEvent);
    }
  }
  const meta = chart.META;
  if (isRecord(meta) && Array.isArray(meta.effects)) {
    meta.effects.forEach(stripEvent);
  }
}

/**
 * Complete parsing after the extension parse hook has seen the text.
 *
 * A `chart:parsed` hook can rewrite the object, so its presence keeps the
 * pre-hook gate and validates once more after the hook. Without the hook the
 * parsed value is checked exactly once.
 */
function finishParsedChart(chart: Chart, validateBeforeHook = false): Chart {
  stripLegacyTrajectory(chart);
  if (extensionRegistry.hasHook("chart:parsed")) {
    if (validateBeforeHook) {
      assertChart(chart);
    }
    const parsedPayload = { chart };
    extensionRegistry.emitHook("chart:parsed", parsedPayload);
    stripLegacyTrajectory(parsedPayload.chart);
    chart = parsedPayload.chart;
  }
  assertChart(chart);
  normalizeChartObjectIds(chart);
  return chart;
}

/**
 * Parse an already decoded JSON value, reusing the caller's single `JSON.parse`.
 *
 * The extension parse hook still receives the original text and may replace the
 * value as it does for `parseChart`.
 */
export function parseChartValue(value: unknown, text = ""): Chart {
  const parsePayload = { text, chart: null as Chart | null };
  if (extensionRegistry.hasHook("chart:parse")) {
    extensionRegistry.emitHook("chart:parse", parsePayload);
  }
  return parsePayload.chart
    ? finishParsedChart(parsePayload.chart)
    : finishParsedChart(value as Chart, true);
}

/** Parse and validate chart text, running the extension parse hooks once. */
export function parseChart(text: string): Chart {
  const parsePayload = { text, chart: null as Chart | null };
  if (extensionRegistry.hasHook("chart:parse")) {
    extensionRegistry.emitHook("chart:parse", parsePayload);
  }
  if (parsePayload.chart) {
    return finishParsedChart(parsePayload.chart);
  }
  let chart: unknown;
  try {
    chart = JSON.parse(parsePayload.text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(t("model.chart.invalidDocument"));
  }
  return finishParsedChart(chart as Chart, true);
}

/** Charts whose ids were already normalized by this module or a worker. */
const normalizedCharts = new WeakSet<Chart>();
/** Objects and collections already normalized in a previous chart revision. */
const normalizedObjects = new WeakSet<object>();
const normalizedCollections = new WeakSet<object>();

/** Mark a chart whose ids were already normalized by a worker. */
export function markChartObjectIdsNormalized(chart: Chart): Chart {
  normalizedCharts.add(chart);
  return chart;
}

/** True when this exact chart's object ids were normalized by parse or a worker. */
export function isChartObjectIdsNormalized(chart: Chart): boolean {
  return normalizedCharts.has(chart);
}

/** Mark one freshly generated object as already carrying a trusted id. */
export function markChartObjectIdNormalized(value: object): void {
  normalizedObjects.add(value);
}

/** Mark a copy-on-write collection whose members were already identity-checked. */
export function markChartObjectCollectionNormalized(value: object): void {
  normalizedCollections.add(value);
}

type ChartIdentityAssigner = (value: Record<string, unknown>) => void;

/** One id set and factory shared by every object in a chart. */
function createChartIdentityAssigner(
  factory: ReturnType<typeof createChartIdentityFactory>,
): ChartIdentityAssigner {
  const ids = new Set<string>();
  return (value) => {
    const existing = value.id;
    if (!isChartObjectId(existing) || ids.has(existing)) {
      value.id = factory.next();
    }
    if (typeof value.id === "string") {
      ids.add(value.id);
    }
  };
}

/** Assign ids to a line's notes. */
function assignLineNoteIds(line: JudgeLine, assign: ChartIdentityAssigner): void {
  const notes = line.notes;
  if (!notes) {
    return;
  }
  for (const note of notes) {
    assign(note);
    normalizedObjects.add(note);
  }
  normalizedCollections.add(notes);
}

/** Assign ids to every event on a line, including extended tracks. */
function assignLineEventIds(line: JudgeLine, assign: ChartIdentityAssigner): void {
  for (const layer of lineEventLayers(line)) {
    for (const type of EVENT_TRACKS) {
      const events = layer[type];
      if (!events) {
        continue;
      }
      for (const event of events) {
        assign(event);
        normalizedObjects.add(event);
      }
      normalizedCollections.add(events);
    }
  }
}

/** Assign a line's event ids in slices, yielding to the host between slices. */
async function assignLineEventIdsAsync(
  line: JudgeLine,
  assign: ChartIdentityAssigner,
  yieldIfNeeded: () => Promise<void>,
): Promise<void> {
  let assigned = 0;
  for (const layer of lineEventLayers(line)) {
    for (const type of EVENT_TRACKS) {
      const events = layer[type];
      if (!events) {
        continue;
      }
      for (const event of events) {
        assign(event);
        normalizedObjects.add(event);
        assigned += 1;
        if (assigned % 256 === 0) {
          await yieldIfNeeded();
        }
      }
      normalizedCollections.add(events);
    }
  }
}

/** Assign ids to shader effects across every effect root. */
function assignChartEffectIds(chart: Chart, assign: ChartIdentityAssigner): void {
  for (const effects of [chart.effects, chart.shaderEvents, chart.META.effects]) {
    if (!Array.isArray(effects)) {
      continue;
    }
    for (const effect of effects) {
      if (isRecord(effect)) {
        assign(effect);
        normalizedObjects.add(effect);
      }
    }
    normalizedCollections.add(effects);
  }
}

/**
 * Normalize one note/event collection against the previous line revision.
 *
 * Unchanged objects are already marked. A new object may keep an id only when
 * that id belonged to an object this revision replaced; a duplicate id still
 * present in the line, or an id borrowed from another line, is reassigned.
 */
function normalizeCollectionIncremental(
  items: readonly Record<string, unknown>[] | undefined,
  previousItems: readonly Record<string, unknown>[] | undefined,
  used: Set<string>,
  factory: ReturnType<typeof createChartIdentityFactory>,
): boolean {
  if (!items || normalizedCollections.has(items)) {
    return true;
  }
  let lookup: Map<string, object> | undefined;
  let present: WeakSet<object> | undefined;
  const buildLookup = (): void => {
    if (lookup && present) {
      return;
    }
    lookup = new Map<string, object>();
    for (const previousItem of previousItems ?? []) {
      const id = previousItem.id;
      if (isChartObjectId(id) && !lookup.has(id)) {
        lookup.set(id, previousItem);
      }
    }
    present = new WeakSet<object>();
    for (const currentItem of items) {
      present.add(currentItem);
    }
  };
  for (const [index, item] of items.entries()) {
    if (normalizedObjects.has(item)) {
      continue;
    }
    // Copy-on-write keeps unchanged positions by identity. Avoid even reading
    // their ids; this is the common path for a one-note edit in a large line.
    if (previousItems?.[index] === item) {
      continue;
    }
    const existing = item.id;
    if (isChartObjectId(existing) && !used.has(existing)) {
      const previousAtIndex = previousItems?.[index];
      if (previousAtIndex?.id === existing && previousAtIndex !== item) {
        used.add(existing);
        normalizedObjects.add(item);
        continue;
      }
      buildLookup();
      const old = lookup?.get(existing);
      if (!old) {
        return false;
      }
      if (old === item || !present?.has(old)) {
        used.add(existing);
        normalizedObjects.add(item);
        continue;
      }
    }
    const generated = factory.next();
    item.id = generated;
    used.add(generated);
    normalizedObjects.add(item);
  }
  normalizedCollections.add(items);
  return true;
}

/**
 * Normalize one changed line without walking the rest of the chart.
 *
 * A copy-on-write clone keeps every untouched container by identity. The line
 * id check, the note collection, and each event track are therefore only
 * visited when this revision actually replaced that container, and a line that
 * is the previous revision's own object returns immediately.
 */
function normalizeLineIncremental(
  line: JudgeLine,
  previousLine: JudgeLine | undefined,
  factory: ReturnType<typeof createChartIdentityFactory>,
): boolean {
  if (line === previousLine && normalizedObjects.has(line)) {
    return true;
  }
  let used: Set<string> | null = null;
  // Allocate the shared id set only for a line with a changed collection.
  const usedIds = (): Set<string> => {
    if (!used) {
      used = new Set<string>();
      if (isChartObjectId(line.id)) {
        used.add(line.id);
      }
    }
    return used;
  };
  if (!normalizedObjects.has(line)) {
    const existing = line.id;
    if (isChartObjectId(existing) && previousLine?.id !== existing) {
      return false;
    }
    if (!isChartObjectId(existing)) {
      line.id = factory.next();
    }
    normalizedObjects.add(line);
  }
  if (line.notes !== previousLine?.notes) {
    if (!normalizeCollectionIncremental(line.notes, previousLine?.notes, usedIds(), factory)) {
      return false;
    }
  }
  // Untouched layers and tracks are shared by identity with the previous line
  // revision and were normalized there; skip laying them out again.
  if (line.eventLayers === previousLine?.eventLayers && line.extended === previousLine?.extended) {
    return true;
  }
  const currentLayers = lineEventLayers(line);
  const previousLayers = previousLine ? lineEventLayers(previousLine) : [];
  for (const [layerIndex, layer] of currentLayers.entries()) {
    // Copy-on-write transactions preserve untouched layer and track arrays by
    // identity. Their ids were valid in the previous revision, so walking a
    // shared million-event track here would only duplicate work.
    if (layer === previousLayers[layerIndex]) {
      continue;
    }
    const previousLayer = previousLayers[layerIndex];
    for (const type of EVENT_TRACKS) {
      if (layer[type] === previousLayer?.[type]) {
        continue;
      }
      if (!normalizeCollectionIncremental(layer[type], previousLayer?.[type], usedIds(), factory)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Normalize a chart derived from `previous` by touching only changed lines.
 *
 * A copy-on-write copy keeps every untouched line object identical to the
 * previous chart's line at the same slot, and that object was normalized there,
 * so untouched lines cost nothing. The previous line for a changed line is read
 * from the same slot first; only a reordered or replaced line needs the id map.
 *
 * Returns false when an id cannot be attributed to the same previous line; the
 * caller then runs the whole-chart pass, which preserves duplicate repair for
 * copied objects and reordered or newly inserted lines.
 */
function normalizeChartObjectIdsIncremental(
  chart: Chart,
  previous: Chart,
  factory: ReturnType<typeof createChartIdentityFactory>,
): boolean {
  if (
    chart.effects !== previous.effects ||
    chart.shaderEvents !== previous.shaderEvents ||
    chart.META.effects !== previous.META.effects
  ) {
    return false;
  }
  const previousLines = previous.judgeLineList ?? [];
  const lines = chart.judgeLineList ?? [];
  let previousById: Map<string, JudgeLine> | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const atSameSlot = previousLines[index];
    // The line object survived the copy-on-write clone unchanged and was
    // normalized in an earlier revision.
    if (line === atSameSlot && normalizedObjects.has(line)) {
      continue;
    }
    let previousLine: JudgeLine | undefined;
    if (atSameSlot && isChartObjectId(line.id) && atSameSlot.id === line.id) {
      previousLine = atSameSlot;
    } else if (isChartObjectId(line.id)) {
      if (!previousById) {
        previousById = new Map<string, JudgeLine>();
        for (const candidate of previousLines) {
          if (isChartObjectId(candidate.id) && !previousById.has(candidate.id)) {
            previousById.set(candidate.id, candidate);
          }
        }
      }
      previousLine = previousById.get(line.id);
      // A moved object may claim its id only when that line is not also still
      // present elsewhere; a copied line carrying another line's id is a
      // duplicate the incremental pass must hand to the whole-chart repair.
      if (previousLine && previousLine !== line && lines.includes(previousLine)) {
        return false;
      }
    }
    if (!normalizeLineIncremental(line, previousLine, factory)) {
      return false;
    }
  }
  return true;
}

/** Add ids to every chart object, preserving valid unique ids already present. */
export function normalizeChartObjectIds(
  chart: Chart,
  factory: ReturnType<typeof createChartIdentityFactory> = createChartIdentityFactory(),
  previous?: Chart,
): Chart {
  if (normalizedCharts.has(chart)) {
    return chart;
  }
  if (previous && normalizeChartObjectIdsIncremental(chart, previous, factory)) {
    normalizedObjects.add(chart);
    normalizedCharts.add(chart);
    return chart;
  }
  const assign = createChartIdentityAssigner(factory);
  for (const line of chart.judgeLineList ?? []) {
    assign(line);
    normalizedObjects.add(line);
    assignLineNoteIds(line, assign);
    assignLineEventIds(line, assign);
  }
  assignChartEffectIds(chart, assign);
  normalizedObjects.add(chart);
  normalizedCharts.add(chart);
  return chart;
}

/** Normalize missing or duplicate object ids in yielding slices for large charts. */
export async function normalizeChartObjectIdsAsync(chart: Chart): Promise<Chart> {
  if (normalizedCharts.has(chart)) {
    return chart;
  }
  const assign = createChartIdentityAssigner(createChartIdentityFactory());
  let lastYield = performance.now();
  const yieldIfNeeded = async (): Promise<void> => {
    if (performance.now() - lastYield >= 6) {
      await yieldToHost();
      lastYield = performance.now();
    }
  };
  for (const line of chart.judgeLineList ?? []) {
    assign(line);
    normalizedObjects.add(line);
    assignLineNoteIds(line, assign);
    await yieldIfNeeded();
    await assignLineEventIdsAsync(line, assign, yieldIfNeeded);
    await yieldIfNeeded();
  }
  assignChartEffectIds(chart, assign);
  normalizedObjects.add(chart);
  normalizedCharts.add(chart);
  return chart;
}

/** Read the RPE above/below flag in either boolean or numeric form. */
export function noteIsAbove(note: { above?: unknown }): boolean {
  return Number(note.above ?? 1) === 1;
}

/**
 * Scoring weight of one note: Holds (type 2) do not score.
 *
 * Shared by the tally below and the transaction kernel's incremental count.
 */
export function noteScoringWeight(note: { type?: number } | undefined): number {
  return note?.type === 2 ? 0 : 1;
}

/**
 * Count scoring notes: every note except a Hold.
 *
 * Charts show this tally as `numOfNotes`; a chart with 3 Taps and 2 Holds reads 3.
 */
export function countScoringNotes(notes: readonly { type?: number }[] | undefined): number {
  return (notes ?? []).reduce((sum, note) => sum + noteScoringWeight(note), 0);
}

/**
 * A `float` narrowed to a 32-bit signed integer.
 *
 * The result truncates toward zero, and any non-finite or out-of-range value
 * becomes the sentinel `-2147483648`. Color channels and tracks compiled with
 * integer endpoints use this rule.
 */
export function channelInteger(value: number): number {
  return !Number.isFinite(value) || value >= 2147483648 || value < -2147483648
    ? -2147483648
    : Math.trunc(value);
}

/** Apply the RPE integer rule to every channel of an RGB tuple. */
export function colorChannels(value: readonly number[]): number[] {
  return value.map(channelInteger);
}

/** Serialize a validated chart while preserving negative zero and numeric formatting. */
export function serializeChart(chart: unknown): string {
  const output = { chart, compact: false, text: null as string | null };
  if (extensionRegistry.hasHook("chart:serialize")) {
    extensionRegistry.emitHook("chart:serialize", output);
  }
  if (output.text !== null) {
    return output.text;
  }
  stripLegacyTrajectory(output.chart);
  assertChart(output.chart);
  return stringifyPreservingNumbers(output.chart) + "\n";
}

/** True when the value graph contains a negative zero that JSON would drop. */
function containsNegativeZero(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "number") {
    return Object.is(value, -0);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      if (containsNegativeZero(child, seen)) {
        return true;
      }
    }
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key in record) {
    if (Object.hasOwn(record, key) && containsNegativeZero(record[key], seen)) {
      return true;
    }
  }
  return false;
}

/** Serialize JSON while keeping negative zero as `-0`. */
function stringifyPreservingNumbers(value: unknown): string {
  // Use the native path whenever the graph contains no negative zero.
  if (!containsNegativeZero(value)) {
    return JSON.stringify(value, null, 2);
  }
  const ordinary = JSON.stringify(value, null, 2);
  let marker = "\u0000rpe-negative-zero\u0000";
  while (ordinary.includes(JSON.stringify(marker))) {
    marker += "#";
  }
  return JSON.stringify(
    value,
    (key, entry) => (Object.is(entry, -0) ? marker : entry),
    2,
  ).replaceAll(JSON.stringify(marker), "-0");
}

/** Throw a descriptive error when a chart fails the shared structural rules. */
export function assertChart(chart: unknown): asserts chart is Chart {
  if (containsCycle(chart)) {
    throw new Error(t("model.chart.cyclic"));
  }
  const validation = { chart, handled: false };
  if (extensionRegistry.hasHook("chart:validate")) {
    extensionRegistry.emitHook("chart:validate", validation);
  }
  if (validation.handled) {
    return;
  }
  assertChartStructure(validation.chart as Chart);
}
