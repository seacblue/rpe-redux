/** Owns the frozen plugin facade for detached chart reads and stable object lookup. */
import { getChartApi, readAllChartItems, type ChartApi } from "../edit/chart/api.ts";
import {
  addBeatFraction,
  addBeats,
  isBeat,
  subtractBeats,
  type Beat,
} from "../global/chart/timing/beat.ts";
import { apiCall, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import type {
  ChartReadCollection,
  ChartEventReadRef,
  ChartReadEvent,
  ChartReadLine,
  ChartReadLineGroup,
  ChartReadMeta,
  ChartReadNote,
  ChartReadTiming,
  ChartNoteReadRef,
  ChartReadAllOptions,
  ChartReadAllResult,
  ChartReadPage,
  ChartReadPageIssue,
  ChartReadPageOptions,
  ChartReadState,
  ChartReadRange,
  ChartReadSnapshot,
  ChartReadItem,
  ChartResourceReference,
} from "../edit/chart/api.ts";
import type { ChartObjectId } from "../global/chart/identity.ts";

/** Run one facade call against the connected chart runtime. */
function withChart<T>(run: (api: ChartApi) => T): ApiResult<T> {
  const api = getChartApi();
  return api ? apiCall(() => run(api)) : unavailableResult<T>("No editor chart runtime connected");
}

/** Reject malformed public beat inputs before exact arithmetic runs. */
function requireBeat(value: readonly number[], path: string): void {
  if (!isBeat(value)) {
    throw new Error(`${path} must be a valid beat triple`);
  }
}

/** Detached chart reads exposed to plugins. */
export const chart = Object.freeze({
  /** Exact arithmetic helpers for reduced chart beat triples. */
  beats: Object.freeze({
    /** Add two beat triples without converting through floating point. */
    add(left: readonly number[], right: readonly number[]): ApiResult<Beat> {
      return apiCall(() => {
        requireBeat(left, "left");
        requireBeat(right, "right");
        return addBeats(left, right);
      });
    },
    /** Add an exact fraction to a beat triple without converting through floating point. */
    addFraction(
      beat: readonly number[],
      numerator: number,
      denominator: number,
    ): ApiResult<Beat> {
      return apiCall(() => {
        requireBeat(beat, "beat");
        return addBeatFraction(beat, numerator, denominator);
      });
    },
    /** Subtract one beat triple from another without converting through floating point. */
    subtract(left: readonly number[], right: readonly number[]): ApiResult<Beat> {
      return apiCall(() => {
        requireBeat(left, "left");
        requireBeat(right, "right");
        return subtractBeats(left, right);
      });
    },
  }),
  /** Report whether a chart runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getChartApi(), "No editor chart runtime connected");
  },
  /** The current chart fingerprint and revision generation. */
  state(): ApiResult<ChartReadState> {
    return withChart((api) => api.state());
  },
  /** Return the authored note/event content bounds, not the media duration. */
  range(): ApiResult<ChartReadRange> {
    return withChart((api) => api.range());
  },
  /**
   * Read one collection as a transparent page.
   *
   * Pass `offset` and `limit` to jump to any page, or `cursor` to continue the
   * previous page. The result echoes the effective `offset` and `limit` and
   * reports `total`, `hasMore`, and `nextCursor`; a chart edit invalidates both
   * offsets that were pinned with `chartFingerprint` and any live cursor.
   */
  read<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadPageOptions,
  ): ApiResult<ChartReadPage<ChartReadItem<Collection>>> {
    return withChart((api) => api.read(collection, options));
  },
  /**
   * Read every item of one collection as one array.
   *
   * The host drains pages internally, so the caller never sees a cursor, page
   * offset, or `hasMore` flag. A chart edit during the read fails the whole
   * request with `stale_read`; retry against the new revision.
   */
  readAll<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadAllOptions,
  ): ApiResult<readonly ChartReadItem<Collection>[]> {
    const api = getChartApi();
    if (!api) {
      return unavailableResult<readonly ChartReadItem<Collection>[]>(
        "No editor chart runtime connected",
      );
    }
    const result: ChartReadAllResult<ChartReadItem<Collection>> = readAllChartItems(
      (target, pageOptions) => api.read(target, pageOptions),
      collection,
      options,
    );
    if (result.status === "invalid_request") {
      return {
        ok: false,
        error: {
          code: "invalid_request",
          message: `Chart read request was rejected: ${result.reason}`,
        },
      };
    }
    if (result.status === "stale_read") {
      return {
        ok: false,
        error: {
          code: "stale_read",
          message: "Chart changed while reading; retry against the new revision",
        },
      };
    }
    return { ok: true, value: result.items };
  },
  /**
   * A frozen, detached copy of the whole chart, or null when none is open.
   *
   * This materializes every line, note, and event. Prefer `read` for large
   * charts and for anything that must cross the Extension bridge.
   */
  snapshot(): ApiResult<ChartReadSnapshot | null> {
    return withChart((api) => api.snapshot());
  },
  /** The chart metadata block, or null when none is open. */
  metadata(): ApiResult<ChartReadMeta | null> {
    return withChart((api) => api.metadata());
  },
  /** Song, image, texture, and attach-ui resource names declared by the chart. */
  resources(): ApiResult<readonly ChartResourceReference[]> {
    return withChart((api) => api.resources());
  },
  /** Every judge line in chart order. */
  lines(): ApiResult<readonly ChartReadLine[]> {
    return withChart((api) => api.lines());
  },
  /** Return named judge-line folders and their current line indices. */
  lineGroups(): ApiResult<readonly ChartReadLineGroup[]> {
    return withChart((api) => api.lineGroups());
  },
  /** One judge line by id, or null when the id is unknown. */
  line(id: ChartObjectId): ApiResult<ChartReadLine | null> {
    return withChart((api) => api.line(id));
  },
  /** A line's parent id, or the owning line id for a note or event. */
  parentId(id: ChartObjectId): ApiResult<ChartObjectId | null> {
    return withChart((api) => api.parentId(id));
  },
  /**
   * Every note with its owning line and index.
   *
   * This materializes the whole collection in one call. Use `read("notes")`
   * when the chart may be large or the result crosses the Extension bridge.
   *
   * @deprecated Use `readAll("notes")`; this helper remains for compatibility.
   */
  notes(): ApiResult<readonly ChartNoteReadRef[]> {
    return withChart((api) => api.notes());
  },
  /** One note reference by id, or null when the id is unknown. */
  note(id: ChartObjectId): ApiResult<ChartNoteReadRef | null> {
    return withChart((api) => api.note(id));
  },
  /**
   * Every event with its line, track, layer, and index.
   *
   * This materializes the whole collection in one call. Use `read("events")`
   * when the chart may be large or the result crosses the Extension bridge.
   *
   * @deprecated Use `readAll("events")`; this helper remains for compatibility.
   */
  events(): ApiResult<readonly ChartEventReadRef[]> {
    return withChart((api) => api.events());
  },
  /** One event reference by id, or null when the id is unknown. */
  event(id: ChartObjectId): ApiResult<ChartEventReadRef | null> {
    return withChart((api) => api.event(id));
  },
});

export type ChartHandle = typeof chart;

export type { Beat };

export type {
  ChartEventReadRef,
  ChartReadCollection,
  ChartReadEvent,
  ChartReadItem,
  ChartReadLine,
  ChartReadLineGroup,
  ChartReadMeta,
  ChartReadNote,
  ChartReadTiming,
  ChartNoteReadRef,
  ChartReadAllOptions,
  ChartReadAllResult,
  ChartReadPage,
  ChartReadPageIssue,
  ChartReadPageOptions,
  ChartReadSnapshot,
  ChartReadState,
  ChartReadRange,
  ChartResourceReference,
};
export type { ChartObjectId } from "../global/chart/identity.ts";
