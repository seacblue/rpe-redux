/**
 * The chart shape written into JSON document saves and PEZ exports.
 *
 * A file export is Redux's own container even when the chart is saved in place.
 * It preserves the chart's declared RPE layout version, records the application
 * version that produced it, projects editor-only noise settings to
 * `blockAreaList`, and fills the package identity plus the line, note and event
 * defaults native RPE always writes.
 */
import { BUILD_APP_VERSION } from "../../platform/buildInfo.ts";
import { isRecord } from "../../utils/guards.ts";
import {
  CURRENT_RPE_VERSION,
  DEFAULT_BEZIER_POINTS,
  EVENT_TRACKS,
  HOOK_TAIL_FIELD,
  lineEventLayers,
  serializeChart,
  type Chart,
  type ControlPoint,
  type EventTrackName,
  type JudgeLine,
  type JudgeLineEvent,
  type JudgeLineNote,
  type LineEventLayer,
  type LineEventValue,
} from "./chart.ts";
import { CONTROL_TRACKS, type ControlTrackField } from "./chartTracks.ts";
import { projectNoiseLinesForExport } from "./noise/noiseLine.ts";
import { prepareChartForPersistence, type PersistenceWarning } from "./persistence.ts";

/** Range for the 16-digit numeric package ids native RPE uses. */
const PACKAGE_ID_MODULUS = 10_000_000_000_000_000n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/** Native RPE's end distance for the synthetic control tracks. */
const CONTROL_X_END = 9_999_999;

/** One entry of the shared control-track catalog. */
type ControlTrack = (typeof CONTROL_TRACKS)[number];

/** A line's complete control-track set, keyed by stored field. */
type ControlDefaults = Record<ControlTrackField, ControlPoint[]>;

/** Export-only record of the native defaults this projection had to add. */
interface ExportDefaults {
  id?: string;
  judgeLineGroup?: string[];
  controls?: number[];
  incline?: number[];
  extended?: number[];
  /** Line indices whose notes received native default fields. */
  notes?: number[];
  /** Line indices whose event tracks received native default fields. */
  events?: number[];
  /** Hooked events' cached tails, keyed by object id, removed from the file. */
  hookTails?: Record<string, LineEventValue>;
  [key: string]: unknown;
}

/**
 * A stable numeric id for a chart that has not authored one.
 *
 * RPE 1.5 and later scan only numeric folders under `Resources`, so a package
 * needs a numeric `META.id`, `Path`, and chart stem to appear after import.
 * The first judge line's object id is stable for the life of the working chart;
 * charts without object ids fall back to package metadata.
 */
function generatedChartId(chart: Chart, chartName: string): string {
  const lineId = String(chart.judgeLineList?.[0]?.id ?? "").trim();
  const source = lineId
    ? lineId
    : [
        chartName.replaceAll("\\", "/").split("/").at(-1) ?? "",
        String(chart.META.name ?? ""),
        String(chart.META.song ?? ""),
        String(chart.META.charter ?? ""),
        String(chart.META.composer ?? ""),
      ].join("\u0000");
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(source)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return (hash % PACKAGE_ID_MODULUS).toString().padStart(16, "0");
}

/**
 * Resolve an author-supplied package id, or null when the chart needs one.
 *
 * The id must be a legal single path segment so it can name the Resources
 * folder, the chart entry, and the Info.txt `Path`.
 */
function declaredChartId(chart: Chart): string | null {
  const declared = String(chart.META.id ?? "").trim();
  if (declared && declared !== "." && declared !== ".." && !/[\\/:*?"<>|\0]/.test(declared)) {
    return declared;
  }
  return null;
}

/**
 * Resolve the package id used by `META.id`, `Path`, and the chart entry stem.
 *
 * An id authored by RPE or a previous Redux export is preserved when it is a
 * legal single path segment. Otherwise the chart receives a stable 16-digit
 * numeric id so native RPE can discover the imported Resources folder.
 */
export function chartExportId(chart: Chart, chartName = ""): string {
  return declaredChartId(chart) ?? generatedChartId(chart, chartName);
}

/** One pair of native control points, shared by every line that lacks a track. */
function defaultControls(track: ControlTrack): ControlPoint[] {
  const value = track.neutral;
  return [
    { x: 0, [track.property]: value, easing: 1 },
    { x: CONTROL_X_END, [track.property]: value, easing: 1 },
  ];
}

/** Whether two JSON values have the same serialized shape and contents. */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One line after the projection, plus which defaults it needed. */
interface NormalizedLine {
  line: JudgeLine;
  addedControls: boolean;
  addedIncline: boolean;
  addedExtended: boolean;
  addedNotes: boolean;
  addedEvents: boolean;
}

/** Fill the control tracks, notes and event layers native RPE expects on a line. */
function normalizeLine(
  line: JudgeLine,
  defaults: ReturnType<typeof createControlDefaults>,
  hookTails: Map<string, LineEventValue>,
): NormalizedLine {
  const addedControls = CONTROL_TRACKS.some(({ field }) => !Array.isArray(line[field]));
  const addedIncline = line.extended?.inclineEvents == null;
  const addedExtended = line.extended == null;
  let addedNotes = false;
  const notes = line.notes?.map((note) => {
    const normalized = withNoteDefaults(note);
    if (normalized.added) {
      addedNotes = true;
    }
    return normalized.note;
  });
  let addedEvents = false;
  const eventLayers = line.eventLayers?.map((layer) => {
    if (!layer) {
      return layer;
    }
    const normalized = withLayerDefaults(layer, hookTails);
    if (normalized.added) {
      addedEvents = true;
    }
    return normalized.layer;
  });
  const extendedSource: LineEventLayer = {
    ...line.extended,
    inclineEvents: line.extended?.inclineEvents ?? [],
  };
  const extended = withLayerDefaults(extendedSource, hookTails);
  if (extended.added) {
    addedEvents = true;
  }
  const controls = Object.fromEntries(
    CONTROL_TRACKS.map(({ field }) => [
      field,
      Array.isArray(line[field]) ? line[field] : defaults[field],
    ]),
  ) as ControlDefaults;
  return {
    line: {
      ...line,
      ...controls,
      ...(notes ? { notes } : {}),
      ...(eventLayers ? { eventLayers } : {}),
      extended: extended.layer,
    },
    addedControls,
    addedIncline,
    addedExtended,
    addedNotes,
    addedEvents,
  };
}

/** Create the five neutral tracks once per export and share them across lines. */
function createControlDefaults(): ControlDefaults {
  return Object.fromEntries(
    CONTROL_TRACKS.map((track) => [track.field, defaultControls(track)]),
  ) as ControlDefaults;
}

/**
 * Native RPE's spelling of an event's unused bezier controls.
 *
 * RPE reads `bezierPoints` only when `bezier` is truthy, so this array is inert.
 * The working chart uses `DEFAULT_BEZIER_POINTS`; deriving the export spelling
 * keeps one working default while preserving the bytes native RPE has always
 * received.
 */
const NATIVE_EXPORT_BEZIER_POINTS = Object.freeze(DEFAULT_BEZIER_POINTS.map(() => 0));

/**
 * Fill the note fields native RPE always writes.
 *
 * RPE expects a complete note record even though the documented defaults are
 * neutral. An imported chart may omit them, which makes its notes invisible or
 * unmoving in RPE; the export view therefore materializes the same values.
 * The version-170 tint and judge-area fields stay optional.
 */
function withNoteDefaults(note: JudgeLineNote): { note: JudgeLineNote; added: boolean } {
  const next: JudgeLineNote = { ...note };
  let added = false;
  if (next.above == null) {
    next.above = 1;
    added = true;
  }
  if (next.isFake == null) {
    next.isFake = 0;
    added = true;
  }
  if (next.speed == null) {
    next.speed = 1;
    added = true;
  }
  if (next.size == null) {
    next.size = 1;
    added = true;
  }
  if (next.yOffset == null) {
    next.yOffset = 0;
    added = true;
  }
  if (next.visibleTime == null) {
    next.visibleTime = 999_999;
    added = true;
  }
  if (next.alpha == null) {
    next.alpha = 255;
    added = true;
  }
  return { note: added ? next : note, added };
}

/**
 * Fill the fields native RPE writes for one ordinary event.
 *
 * Speed tracks omit bezier fields in native output; every track still gets the
 * easing range and link group so RPE does not read a missing right boundary as
 * zero and collapse the event.
 *
 * A hook's cached tail is editor-only, so it is removed here and collected for
 * `META.ReduxExportDefaults`; the file therefore carries the pinned pair every
 * other tool expects while this editor can restore the tail it replaced.
 */
function withEventDefaults(
  event: JudgeLineEvent,
  type: EventTrackName,
  hookTails: Map<string, LineEventValue>,
): { event: JudgeLineEvent; added: boolean } {
  const next: JudgeLineEvent = { ...event };
  let added = false;
  let stripped = false;
  const cachedTail = next[HOOK_TAIL_FIELD];
  if (cachedTail !== undefined) {
    delete next[HOOK_TAIL_FIELD];
    if (typeof next.id === "string") {
      hookTails.set(next.id, structuredClone(cachedTail) as LineEventValue);
    }
    stripped = true;
  }
  if (next.linkgroup == null) {
    next.linkgroup = 0;
    added = true;
  }
  if (next.easingLeft == null) {
    next.easingLeft = 0;
    added = true;
  }
  if (next.easingRight == null) {
    next.easingRight = 1;
    added = true;
  }
  if (next.easingType == null) {
    next.easingType = 1;
    added = true;
  }
  if (type !== "speedEvents") {
    if (next.bezier == null) {
      next.bezier = 0;
      added = true;
    }
    if (next.bezierPoints == null) {
      next.bezierPoints = [...NATIVE_EXPORT_BEZIER_POINTS];
      added = true;
    }
  }
  return { event: added || stripped ? next : event, added };
}

/** Fill every ordinary track on one layer; shader paint events keep their own shape. */
function withLayerDefaults(
  layer: LineEventLayer,
  hookTails: Map<string, LineEventValue>,
): {
  layer: LineEventLayer;
  added: boolean;
} {
  const next: LineEventLayer = { ...layer };
  let added = false;
  let replaced = false;
  for (const type of EVENT_TRACKS) {
    if (type === "paintEvents") {
      continue;
    }
    const events = layer[type];
    if (!Array.isArray(events)) {
      continue;
    }
    let changed = false;
    const normalized = events.map((event) => {
      if (!isRecord(event)) {
        return event;
      }
      const result = withEventDefaults(event as JudgeLineEvent, type, hookTails);
      if (result.event !== event) {
        changed = true;
      }
      if (result.added) {
        added = true;
      }
      return result.event;
    });
    if (changed) {
      next[type] = normalized;
      replaced = true;
    }
  }
  return { layer: replaced ? next : layer, added };
}

/**
 * Write the export marker and the native RPE package defaults.
 *
 * The working document is never mutated. `chartName` only seeds a generated id
 * and is not stored; a chart that already carries `META.id` keeps it.
 */
function projectChartForExportCore(chart: Chart, chartName = ""): Chart {
  const projected = projectNoiseLinesForExport(chart);
  const declared = projected.META.RPEVersion;
  const defaults: ExportDefaults = {};
  const declaredId = declaredChartId(projected);
  const id = declaredId ?? generatedChartId(projected, chartName);
  if (!declaredId) {
    defaults.id = id;
  }
  const judgeLineGroup = Array.isArray(projected.judgeLineGroup)
    ? projected.judgeLineGroup
    : ["Default"];
  if (!Array.isArray(projected.judgeLineGroup)) {
    defaults.judgeLineGroup = judgeLineGroup;
  }
  const sourceLines = projected.judgeLineList;
  const controlDefaults = createControlDefaults();
  const hookTails = new Map<string, LineEventValue>();
  const controlLines: number[] = [];
  const inclineLines: number[] = [];
  const extendedLines: number[] = [];
  const noteLines: number[] = [];
  const eventLines: number[] = [];
  const lines = sourceLines?.map((line, index) => {
    const normalized = normalizeLine(line, controlDefaults, hookTails);
    if (normalized.addedControls) {
      controlLines.push(index);
    }
    if (normalized.addedIncline) {
      inclineLines.push(index);
    }
    if (normalized.addedExtended) {
      extendedLines.push(index);
    }
    if (normalized.addedNotes) {
      noteLines.push(index);
    }
    if (normalized.addedEvents) {
      eventLines.push(index);
    }
    return normalized.line;
  });
  if (controlLines.length) {
    defaults.controls = controlLines;
  }
  if (inclineLines.length) {
    defaults.incline = inclineLines;
  }
  if (extendedLines.length) {
    defaults.extended = extendedLines;
  }
  if (noteLines.length) {
    defaults.notes = noteLines;
  }
  if (eventLines.length) {
    defaults.events = eventLines;
  }
  if (hookTails.size) {
    defaults.hookTails = Object.fromEntries(hookTails);
  }
  const meta = { ...projected.META };
  delete meta.ReduxExportDefaults;
  return {
    ...projected,
    META: {
      ...meta,
      // A layout version newer than this editor is preserved.
      RPEVersion:
        typeof declared === "number" && declared > CURRENT_RPE_VERSION
          ? declared
          : CURRENT_RPE_VERSION,
      // The marker describes the exporting application, not the working chart.
      ReduxVersion: BUILD_APP_VERSION,
      id,
      ...(Object.keys(defaults).length ? { ReduxExportDefaults: defaults } : {}),
    },
    judgeLineGroup,
    judgeLineList: lines,
  };
}

/** Project a chart and preserve warnings from Extension-owned output rules. */
export function projectChartForExportWithWarnings(
  chart: Chart,
  chartName = "",
): { readonly chart: Chart; readonly warnings: readonly PersistenceWarning[] } {
  const prepared = prepareChartForPersistence(chart, "export");
  return {
    chart: projectChartForExportCore(prepared.chart, chartName),
    warnings: prepared.warnings,
  };
}

/** Project a chart for a native file without exposing the warning report. */
export function projectChartForExport(chart: Chart, chartName = ""): Chart {
  return projectChartForExportWithWarnings(chart, chartName).chart;
}

/** Serialize the chart exactly as a JSON document or PEZ package should contain it. */
export function serializeChartForExport(chart: Chart, chartName = ""): string {
  return serializeChart(projectChartForExport(chart, chartName));
}

/**
 * Put each hook's cached tail back onto the event that exported it.
 *
 * The file carries only the pinned pair, so the cache that lets this editor
 * unhook the event again travels in `ReduxExportDefaults` and is written back
 * here. An id that no event carries is dropped: the event was removed between
 * export and import, and inventing a tail would change an authored value.
 */
function restoreHookTails(lines: readonly unknown[], hookTails: Record<string, unknown>): void {
  const pending = new Map(Object.entries(hookTails));
  if (!pending.size) {
    return;
  }
  for (const line of lines) {
    if (!isRecord(line)) {
      continue;
    }
    for (const layer of lineEventLayers(line as JudgeLine)) {
      for (const type of EVENT_TRACKS) {
        if (type === "paintEvents") {
          continue;
        }
        const events = layer[type];
        if (!Array.isArray(events)) {
          continue;
        }
        for (const event of events) {
          if (!isRecord(event) || typeof event.id !== "string") {
            continue;
          }
          const tail = pending.get(event.id);
          if (tail === undefined) {
            continue;
          }
          event[HOOK_TAIL_FIELD] = tail;
          pending.delete(event.id);
        }
      }
    }
  }
}

/**
 * Remove the transport-only export marker from a chart being opened.
 *
 * `ReduxVersion` describes the file that was read, not the working document.
 * The same export may have filled native defaults the working chart did not
 * author; `ReduxExportDefaults` records exactly those values so reopening
 * restores the canonical chart instead of treating the defaults as edits.
 */
export function stripReduxExportVersion(chart: unknown): void {
  if (!isRecord(chart) || !isRecord(chart.META)) {
    return;
  }
  const meta = chart.META;
  const hadVersion = "ReduxVersion" in meta;
  delete meta.ReduxVersion;
  const defaults = meta.ReduxExportDefaults;
  delete meta.ReduxExportDefaults;
  if (!hadVersion || !isRecord(defaults)) {
    return;
  }
  if (typeof defaults.id === "string" && meta.id === defaults.id) {
    delete meta.id;
  }
  if (
    Array.isArray(defaults.judgeLineGroup) &&
    sameJson(chart.judgeLineGroup, defaults.judgeLineGroup)
  ) {
    delete chart.judgeLineGroup;
  }
  const lines = Array.isArray(chart.judgeLineList) ? chart.judgeLineList : [];
  if (isRecord(defaults.hookTails)) {
    restoreHookTails(lines, defaults.hookTails);
  }
  if (Array.isArray(defaults.controls)) {
    for (const index of defaults.controls) {
      const line = Number.isInteger(index) ? lines[index as number] : undefined;
      if (!isRecord(line)) {
        continue;
      }
      for (const track of CONTROL_TRACKS) {
        if (sameJson(line[track.field], defaultControls(track))) {
          delete line[track.field];
        }
      }
    }
  }
  if (Array.isArray(defaults.incline)) {
    for (const index of defaults.incline) {
      const line = Number.isInteger(index) ? lines[index as number] : undefined;
      const extended = isRecord(line) ? line.extended : undefined;
      if (
        isRecord(extended) &&
        Array.isArray(extended.inclineEvents) &&
        !extended.inclineEvents.length
      ) {
        delete extended.inclineEvents;
      }
    }
  }
  if (Array.isArray(defaults.extended)) {
    for (const index of defaults.extended) {
      const line = Number.isInteger(index) ? lines[index as number] : undefined;
      if (isRecord(line) && isRecord(line.extended) && !Object.keys(line.extended).length) {
        delete line.extended;
      }
    }
  }
  if (Array.isArray(defaults.notes)) {
    for (const index of defaults.notes) {
      const line = Number.isInteger(index) ? lines[index as number] : undefined;
      const notes = isRecord(line) && Array.isArray(line.notes) ? line.notes : [];
      for (const note of notes) {
        if (!isRecord(note)) {
          continue;
        }
        if (note.above === 1) {
          delete note.above;
        }
        if (note.isFake === 0) {
          delete note.isFake;
        }
        if (note.speed === 1) {
          delete note.speed;
        }
        if (note.size === 1) {
          delete note.size;
        }
        if (note.yOffset === 0) {
          delete note.yOffset;
        }
        if (note.visibleTime === 999_999) {
          delete note.visibleTime;
        }
        if (note.alpha === 255) {
          delete note.alpha;
        }
      }
    }
  }
  if (Array.isArray(defaults.events)) {
    for (const index of defaults.events) {
      const line = Number.isInteger(index) ? lines[index as number] : undefined;
      if (!isRecord(line)) {
        continue;
      }
      for (const layer of lineEventLayers(line as JudgeLine)) {
        for (const type of EVENT_TRACKS) {
          if (type === "paintEvents") {
            continue;
          }
          const events = layer[type];
          if (!Array.isArray(events)) {
            continue;
          }
          for (const event of events) {
            if (!isRecord(event)) {
              continue;
            }
            if (event.bezier === 0) {
              delete event.bezier;
            }
            if (sameJson(event.bezierPoints, NATIVE_EXPORT_BEZIER_POINTS)) {
              delete event.bezierPoints;
            }
            if (event.easingLeft === 0) {
              delete event.easingLeft;
            }
            if (event.easingRight === 1) {
              delete event.easingRight;
            }
            if (event.easingType === 1) {
              delete event.easingType;
            }
            if (event.linkgroup === 0) {
              delete event.linkgroup;
            }
          }
        }
      }
    }
  }
}
