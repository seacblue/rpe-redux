/** Owns the frozen plugin facade for detached chart reads and stable object lookup. */
import { getChartApi, type ChartApi } from "../edit/chart/api.ts";
import { apiCall, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import type {
  ChartReadCollection,
  ChartEventReadRef,
  ChartReadEvent,
  ChartReadLine,
  ChartReadMeta,
  ChartReadNote,
  ChartNoteReadRef,
  ChartReadPage,
  ChartReadPageOptions,
  ChartReadState,
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

/** Detached chart reads exposed to plugins. */
export const chart = Object.freeze({
  /** Report whether a chart runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getChartApi(), "No editor chart runtime connected");
  },
  /** The current chart fingerprint and revision generation. */
  state(): ApiResult<ChartReadState> {
    return withChart((api) => api.state());
  },
  /** Read one collection as a page; stale cursors and fingerprints are reported. */
  read<Collection extends ChartReadCollection>(
    collection: Collection,
    options?: ChartReadPageOptions,
  ): ApiResult<ChartReadPage<ChartReadItem<Collection>>> {
    return withChart((api) => api.read(collection, options));
  },
  /** A frozen, detached copy of the whole chart, or null when none is open. */
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
  /** One judge line by id, or null when the id is unknown. */
  line(id: ChartObjectId): ApiResult<ChartReadLine | null> {
    return withChart((api) => api.line(id));
  },
  /** A line's parent id, or the owning line id for a note or event. */
  parentId(id: ChartObjectId): ApiResult<ChartObjectId | null> {
    return withChart((api) => api.parentId(id));
  },
  /** Every note with its owning line and index. */
  notes(): ApiResult<readonly ChartNoteReadRef[]> {
    return withChart((api) => api.notes());
  },
  /** One note reference by id, or null when the id is unknown. */
  note(id: ChartObjectId): ApiResult<ChartNoteReadRef | null> {
    return withChart((api) => api.note(id));
  },
  /** Every event with its line, track, layer, and index. */
  events(): ApiResult<readonly ChartEventReadRef[]> {
    return withChart((api) => api.events());
  },
  /** One event reference by id, or null when the id is unknown. */
  event(id: ChartObjectId): ApiResult<ChartEventReadRef | null> {
    return withChart((api) => api.event(id));
  },
});

export type ChartHandle = typeof chart;

export type {
  ChartEventReadRef,
  ChartReadCollection,
  ChartReadEvent,
  ChartReadItem,
  ChartReadLine,
  ChartReadMeta,
  ChartReadNote,
  ChartNoteReadRef,
  ChartReadPage,
  ChartReadPageOptions,
  ChartReadSnapshot,
  ChartReadState,
  ChartResourceReference,
};
export type { ChartObjectId } from "../global/chart/identity.ts";
