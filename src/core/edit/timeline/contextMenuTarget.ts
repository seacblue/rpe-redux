/**
 * Pure context-menu targeting for the timeline.
 *
 * The timeline controller resolves a pointer hit, applies the selection rule a
 * right press uses, and then asks these helpers for the plain payload an
 * Extension action receives. Keeping the mapping here makes the hit-to-target
 * contract testable without a canvas.
 */
import type { Chart } from "../../global/chart/chart.ts";
import type { EventLayerRef, SelectedEventRef } from "../selection/api.ts";
import type { ContextMenuTarget, ToolbarActionRunner } from "../../shell/registries/toolbar.ts";

/** One note selected by line and index. */
export interface NoteSelectionRef {
  lineIndex: number;
  index: number;
}

/** One event selection key on a line, in the session's `type:index` form. */
export interface EventSelectionKeyRef {
  lineIndex: number;
  key: string;
}

/** A readable selection state for the right-press selection rule. */
export interface ContextMenuSelectionState<T> {
  lineIndex: number;
  selection: ReadonlySet<T>;
  multiLineActive: boolean;
  multiLineSelection: ReadonlyMap<number, ReadonlySet<T>>;
}

/** The replacement selection plus whether anything changed. */
export interface ContextMenuSelectionUpdate<T> {
  lineIndex: number;
  selection: Set<T>;
  multiLineSelection: Map<number, Set<T>>;
  changed: boolean;
}

/** Current pointer modifiers that decide replace versus append. */
export interface ContextMenuModifiers {
  ctrl: boolean;
  shift: boolean;
}

/** Clone a per-line selection map without sharing its sets. */
function cloneSelectionMap<T>(source: ReadonlyMap<number, ReadonlySet<T>>): Map<number, Set<T>> {
  const next = new Map<number, Set<T>>();
  for (const [lineIndex, values] of source) {
    next.set(lineIndex, new Set(values));
  }
  return next;
}

/**
 * Apply the right-press rule to one object.
 *
 * An object already inside the current selection keeps the selection intact.
 * An unselected object replaces the selection on a plain press and is appended
 * on Ctrl or Shift. A plain press in multi-line mode also drops the other
 * panels' selections, matching a plain left click.
 */
function selectionForContextMenu<T>(
  state: ContextMenuSelectionState<T>,
  hit: { lineIndex: number; value: T },
  modifiers: ContextMenuModifiers,
): ContextMenuSelectionUpdate<T> {
  const multiLineSelection = cloneSelectionMap(state.multiLineSelection);
  const source = state.multiLineActive
    ? (state.multiLineSelection.get(hit.lineIndex) ?? new Set<T>())
    : hit.lineIndex === state.lineIndex
      ? state.selection
      : new Set<T>();
  const selection = new Set(source);
  if (selection.has(hit.value)) {
    return { lineIndex: hit.lineIndex, selection, multiLineSelection, changed: false };
  }
  const append = modifiers.ctrl || modifiers.shift;
  if (!append) {
    selection.clear();
  }
  selection.add(hit.value);
  if (state.multiLineActive) {
    if (!append) {
      for (const lineIndex of [...multiLineSelection.keys()]) {
        if (lineIndex !== hit.lineIndex) {
          multiLineSelection.delete(lineIndex);
        }
      }
    }
    multiLineSelection.set(hit.lineIndex, new Set(selection));
  }
  return { lineIndex: hit.lineIndex, selection, multiLineSelection, changed: true };
}

/** Selection rule for a right press on a note. */
export function noteSelectionForContextMenu(
  state: ContextMenuSelectionState<number>,
  hit: { lineIndex: number; index: number },
  modifiers: ContextMenuModifiers,
): ContextMenuSelectionUpdate<number> {
  return selectionForContextMenu(state, { lineIndex: hit.lineIndex, value: hit.index }, modifiers);
}

/** Selection rule for a right press on an event. */
export function eventSelectionForContextMenu(
  state: ContextMenuSelectionState<string>,
  hit: { lineIndex: number; key: string },
  modifiers: ContextMenuModifiers,
): ContextMenuSelectionUpdate<string> {
  return selectionForContextMenu(state, { lineIndex: hit.lineIndex, value: hit.key }, modifiers);
}

/**
 * Resolve chart ids for the selected notes.
 *
 * Normalized charts carry an id on every note. If any selected note lacks one,
 * the target is withheld instead of mixing a real id with a synthetic key.
 */
export function noteTargetFromRefs(
  chart: Chart,
  refs: readonly NoteSelectionRef[],
  lineIndex: number,
  beat: number,
  chartSeconds: number,
): ContextMenuTarget | undefined {
  if (!refs.length) {
    return undefined;
  }
  const noteIds: string[] = [];
  for (const ref of refs) {
    const id = chart.judgeLineList?.[ref.lineIndex]?.notes?.[ref.index]?.id;
    if (id === undefined) {
      return undefined;
    }
    noteIds.push(id);
  }
  return { surface: "notes", noteIds, lineIndex, beat, chartSeconds };
}

/** Convert the session's `type:index` keys into typed event references. */
export function eventRefsFromSelection(
  selection: readonly EventSelectionKeyRef[],
  layer: EventLayerRef,
): SelectedEventRef[] {
  return selection.flatMap(({ lineIndex, key }) => {
    const separator = key.indexOf(":");
    const eventType = key.slice(0, separator);
    const index = Number(key.slice(separator + 1));
    if (separator <= 0 || !eventType || !Number.isInteger(index) || index < 0) {
      return [];
    }
    return [{ lineIndex, eventType, layer, index }];
  });
}

/** Target for a right press on an event. */
export function eventTargetFromRefs(
  refs: readonly SelectedEventRef[],
  beat: number,
  chartSeconds: number,
): ContextMenuTarget | undefined {
  if (!refs.length) {
    return undefined;
  }
  return { surface: "events", refs: [...refs], beat, chartSeconds };
}

/**
 * Target for a right press on a marker.
 *
 * The marker surface is always reported; `markerId` is the marker's persistent
 * id and is absent only when the pointer did not resolve to a marker row or the
 * marker carries no id. The target's beat is the marker's own chart position.
 */
export function markerTargetFromMarker(
  marker: { id?: string; beat: number; name: string } | undefined,
): ContextMenuTarget {
  const markerId = typeof marker?.id === "string" ? marker.id.trim() : "";
  const beat = Number(marker?.beat);
  return {
    surface: "marker",
    ...(markerId ? { markerId } : {}),
    beat: Number.isFinite(beat) && beat >= 0 ? beat : 0,
  };
}

/** Run one action with the menu target; its return value is not part of the menu contract. */
export function runContextMenuTarget(
  run: ToolbarActionRunner | undefined,
  target?: ContextMenuTarget,
): void {
  run?.(target);
}
