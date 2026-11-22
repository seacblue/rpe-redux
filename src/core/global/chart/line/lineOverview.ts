/**
 * Data for the line-overview grid: windowing, stepping and per-line timed items.
 *
 * `LineOverviewIndex` resolves a line's notes and events to seconds for the
 * overview timeline, while `lineOverviewWindow` and `lineOverviewLayout` supply
 * the paging geometry. Drawing stays in the frontend.
 */
import { IntervalIndex } from "../../../utils/intervalIndex.ts";
import { upperBound } from "../../../utils/search.ts";
import { isRecord } from "../../../utils/guards.ts";
import { EVENT_TYPES } from "../chart.ts";
import type { JudgeLine, JudgeLineNote, LineEventLayer } from "../chart.ts";
import type { TempoSource } from "../timing/events.ts";

/** True when a value carries the beat pair the overview timeline needs. */
function isOverviewTimedItem(value: unknown): value is OverviewTimedItem {
  return isRecord(value) && Array.isArray(value.startTime) && Array.isArray(value.endTime);
}

/** Read one extended event track from a layer, keeping only timed items. */
function extendedEvents(
  layer: LineEventLayer | undefined,
  type: string,
): readonly OverviewTimedItem[] {
  const list = isRecord(layer) ? layer[type] : undefined;
  return Array.isArray(list) ? list.filter(isOverviewTimedItem) : [];
}

/** Move `index` by `direction` with wrap-around, or null when there are no lines. */
export function stepLine(index: number, direction: number, count: number): number | null {
  return count > 0 ? (((index + Math.sign(direction)) % count) + count) % count : null;
}

/** Step through a supplied index list; an unknown current index enters at either end. */
export function stepOverviewLine<T>(index: T, direction: number, indices: readonly T[]): T | null {
  if (!indices.length || !direction) {
    return null;
  }
  const position = indices.indexOf(index);
  if (position < 0) {
    return direction > 0 ? (indices[0] ?? null) : (indices.at(-1) ?? null);
  }
  const stepped = stepLine(position, direction, indices.length);
  return stepped === null ? null : indices[stepped];
}

/** The visible page of the overview grid and its row bounds. */
export interface OverviewWindow {
  totalRows: number;
  maxRow: number;
  firstRow: number;
  indices: number[];
}

/** Resolve the page of grid rows that contains `index`. */
export function lineOverviewWindow(
  index: number,
  count: number,
  columns: number,
  rows: number,
  browseRow: number | null = null,
): OverviewWindow {
  const totalRows = Math.ceil(count / columns);
  const maxRow = Math.max(0, totalRows - rows);
  const firstRow = Math.max(
    0,
    Math.min(maxRow, browseRow ?? Math.floor(index / columns) - Math.floor(rows / 2)),
  );
  const first = firstRow * columns;
  return {
    totalRows,
    maxRow,
    firstRow,
    indices: Array.from(
      { length: Math.max(0, Math.min(columns * rows, count - first)) },
      (unused, offset) => first + offset,
    ),
  };
}

/** Grid geometry derived from the available panel size. */
export interface OverviewLayout {
  columns: number;
  rows: number;
  thumbnailHeight: number;
  panelWidth: number;
}

/** Compute the column count, row count and thumbnail height for a panel size. */
export function lineOverviewLayout(width: number, height: number): OverviewLayout {
  const panelWidth = Math.min(width - 16, width * 0.88, 1060);
  const columns = Math.max(2, Math.min(6, Math.floor((panelWidth - 36) / 140)));
  const previousRows = height < 300 ? 2 : 3;
  const thumbnailHeight = Math.floor(
    Math.max(24, Math.min(96, (height * 0.84 - 36) / previousRows - 26)),
  );
  return { columns, rows: previousRows + 1, thumbnailHeight, panelWidth };
}

/** One note or event on the overview timeline, resolved to seconds. */
export interface OverviewTimedItem {
  startTime: readonly number[];
  endTime: readonly number[];
  [extra: string]: unknown;
}

/** One resolved note or event on the overview timeline. */
export interface OverviewEntry<TItem extends OverviewTimedItem = OverviewTimedItem> {
  start: number;
  end: number;
  channel: number;
  layer: number;
  item: TItem;
}

/** Seconds-resolved indexes of one line's notes and events for the overview. */
export class LineOverviewIndex {
  declare notes: IntervalIndex<OverviewEntry<JudgeLineNote>>;
  declare events: IntervalIndex<OverviewEntry>;
  declare noteEnds: number[];
  declare eventEnds: number[];

  /**
   * Index one line's notes and events.
   *
   * `extended` selects extended tracks instead of ordinary layers; `layer`
   * restricts ordinary layers to one index.
   */
  constructor(
    line: JudgeLine,
    tempo: TempoSource,
    shaders: readonly OverviewTimedItem[] = [],
    layer: number | undefined = undefined,
    extended = false,
  ) {
    const timing = <TItem extends OverviewTimedItem>(item: TItem): OverviewEntry<TItem> => ({
      item,
      start: tempo.seconds(item.startTime),
      end: tempo.seconds(item.endTime),
      channel: 0,
      layer: 0,
    });
    const notes = (line.notes ?? []).map((note) => timing(note));
    const events: OverviewEntry[] = [];
    if (extended) {
      const extendedTypes = [
        "scaleXEvents",
        "scaleYEvents",
        "colorEvents",
        "paintEvents",
        "textEvents",
      ];
      for (const type of Object.keys(line.extended ?? {})) {
        const channel = extendedTypes.indexOf(type);
        if (channel < 0) {
          continue;
        }
        for (const event of extendedEvents(line.extended, type)) {
          events.push({ ...timing(event), channel, layer: 0 });
        }
      }
      for (const event of shaders) {
        events.push({ ...timing(event), channel: 3, layer: 0 });
      }
    } else {
      const layers: (LineEventLayer | undefined | null)[] =
        layer === undefined ? (line.eventLayers ?? []) : [line.eventLayers?.[layer] ?? {}];
      layers.forEach((currentLayer, layerIndex) =>
        EVENT_TYPES.forEach((type, channel) => {
          for (const event of currentLayer?.[type] ?? []) {
            events.push({
              ...timing(event),
              channel,
              layer: layer === undefined ? layerIndex : layer,
            });
          }
        }),
      );
      if (layer === undefined) {
        for (const type of Object.keys(line.extended ?? {})) {
          if (type === "paintEvents") {
            continue;
          }
          for (const event of extendedEvents(line.extended, type)) {
            events.push({ ...timing(event), channel: 5, layer: 0 });
          }
        }
      }
      // Shader effects join the extended channel; ordinary layers keep their track channels.
      for (const event of shaders) {
        events.push({ ...timing(event), channel: 5, layer: layer ?? 0 });
      }
    }
    this.notes = new IntervalIndex(
      notes,
      (entry) => entry.start,
      (entry) => entry.end,
    );
    this.events = new IntervalIndex(
      events,
      (entry) => entry.start,
      (entry) => entry.end,
    );
    this.noteEnds = notes.map((entry) => entry.end).sort((left, right) => left - right);
    this.eventEnds = events.map((entry) => entry.end).sort((left, right) => left - right);
  }

  /** True when the line has any note or event within `[start, end]`, as filtered. */
  matches(start: number, end: number, notesOnly: boolean, eventsOnly: boolean): boolean {
    return (
      (!notesOnly || this.notes.has(start, end)) && (!eventsOnly || this.events.has(start, end))
    );
  }

  /** Notes and events in `[start, end]`, plus how many entries end after `seconds`. */
  sample(
    seconds: number,
    start: number,
    end: number,
  ): {
    notes: OverviewEntry<JudgeLineNote>[];
    events: OverviewEntry[];
    notesLeft: number;
    eventsLeft: number;
  } {
    return {
      notes: this.notes.query(start, end).map((entry) => entry.item),
      events: this.events.query(start, end).map((entry) => entry.item),
      notesLeft: this.noteEnds.length - upperBound(this.noteEnds, seconds),
      eventsLeft: this.eventEnds.length - upperBound(this.eventEnds, seconds),
    };
  }
}
