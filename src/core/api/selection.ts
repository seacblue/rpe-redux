/**
 * Owns the selection API a plugin sees.
 *
 * Range inputs use chart coordinates: notes need beat plus `positionX`, while
 * events use a beat interval and an explicit event track and layer.
 * `mode` is the edit operation: `replace`, `add`, `remove`, or `toggle`.
 * Operations return the shared result envelope; subscriptions return a
 * disposer directly so the sandbox bridge can transfer it as a handle.
 *
 * Minimal usage (after an editor has mounted):
 * ```js
 * redux.selection.notes.range({
 *   lineIndex: 0,
 *   from: { beat: 4, positionX: -1 },
 *   to: { beat: 8, positionX: 1 },
 *   mode: "replace",
 * });
 * redux.selection.events.range({
 *   lineIndex: 0,
 *   eventType: "moveX",
 *   layer: 0,
 *   fromBeat: 4,
 *   toBeat: 8,
 *   mode: "add",
 * });
 * ```
 */
import { getSelectionApi, type SelectionApi } from "../edit/selection/api.ts";
import { apiCall, availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import type {
  EventSelectionRangeRequest,
  EventSelectionRequest,
  NoteSelectionRangeRequest,
  NoteSelectionRequest,
  SelectionApiSnapshot,
  SelectionOperationResult,
  SelectionPasteRequest,
} from "../edit/selection/api.ts";

/** Run one selection call against the connected editor. */
function withSelection<T>(run: (api: SelectionApi) => T): ApiResult<T> {
  const api = getSelectionApi();
  return api
    ? apiCall(() => run(api))
    : unavailableResult<T>("No editor selection runtime connected");
}

/** Note and event selection exposed to plugins. */
export const selection = Object.freeze({
  /** Report whether a selection runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(getSelectionApi(), "No editor selection runtime connected");
  },
  /** The current selection snapshot. */
  state: (): ApiResult<SelectionApiSnapshot> => withSelection((api) => api.state()),
  /**
   * Observe selection changes; returns a disposer.
   *
   * Subscriptions use a direct disposer instead of `ApiResult` so a missing
   * runtime behaves like an empty subscription and the sandbox bridge can
   * transfer the returned function as a handle.
   */
  subscribe: (listener: (selection: SelectionApiSnapshot) => void): (() => void) => {
    const api = getSelectionApi();
    return api ? api.subscribe(listener) : () => {};
  },
  /** Clear notes, events, or both, then return the new snapshot. */
  clear: (area: "notes" | "events" | "all" = "all"): ApiResult<SelectionApiSnapshot> =>
    withSelection((api) => api.clear(area)),
  /** Copy the current selection to the editor clipboard. */
  copy: (): ApiResult<SelectionOperationResult> => withSelection((api) => api.copy()),
  /** Copy the current selection and remove it from the chart. */
  cut: (): ApiResult<SelectionOperationResult> => withSelection((api) => api.cut()),
  /** Remove the current selection from the chart. */
  delete: (): ApiResult<SelectionOperationResult> => withSelection((api) => api.delete()),
  /** Paste the clipboard at a beat on a target line. */
  paste: (request: SelectionPasteRequest): ApiResult<SelectionOperationResult> =>
    withSelection((api) => api.paste(request)),
  /** Note selection operations. */
  notes: Object.freeze({
    /** Select note indices on one judge line. */
    select: (request: NoteSelectionRequest): ApiResult<SelectionApiSnapshot> =>
      withSelection((api) => api.notes.select(request)),
    /** Select notes intersecting a chart-space rectangle. */
    range: (request: NoteSelectionRangeRequest): ApiResult<SelectionApiSnapshot> =>
      withSelection((api) => api.notes.range(request)),
  }),
  /** Event selection operations. */
  events: Object.freeze({
    /** Select event indices on one track and layer. */
    select: (request: EventSelectionRequest): ApiResult<SelectionApiSnapshot> =>
      withSelection((api) => api.events.select(request)),
    /** Select events on one or more tracks overlapping a beat interval. */
    range: (request: EventSelectionRangeRequest): ApiResult<SelectionApiSnapshot> =>
      withSelection((api) => api.events.range(request)),
  }),
});

export type SelectionHandle = typeof selection;

/** The public name for the editor's selection snapshot. */
export type {
  EventLayerRef,
  EventSelectionRangeRequest,
  EventSelectionRequest,
  NoteSelectionRangeRequest,
  NoteSelectionRequest,
  SelectionMode,
  SelectionPoint,
  SelectedEventRef,
  SelectedNoteRef,
  SelectionApiSnapshot as SelectionSnapshot,
  SelectionOperationResult,
  SelectionPasteRequest,
} from "../edit/selection/api.ts";
