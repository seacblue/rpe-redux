/**
 * The drag control over a captured selection: what a move, a scale or a line
 * shift does to it. It plans through `edits.ts` and never writes the session.
 */

import { t } from "../../../i18n/index.ts";
import { verticalGrid } from "../../global/chart/editing/editGrid.ts";
import { compareBeats, type Beat } from "../../global/chart/timing/beat.ts";
import type { EditorShortcutDefinition } from "../shortcuts/declarations.ts";
import type { EditorSession } from "../session/session.ts";
import {
  commitSelectionEdit,
  editCapturedSelection,
  shiftedTime,
  type SelectionEditResult,
} from "./edits.ts";
import { captureSelection } from "./snapshot.ts";
import type { SelectionSnapshot } from "./snapshot.ts";

export interface ControlSelectionOptions {
  /** A beat increment: exact when the caller has one, converted once when not. */
  deltaBeat?: number | Beat;
  deltaBeatByLine?: ReadonlyMap<number, number | Beat> | null;
  deltaX?: number;
  dragX?: number;
  anchorMode?: number;
  snapX?: boolean;
  gridCount?: number;
}

/** Converts a horizontal drag distance into a whole-line offset with a dead zone. */
export function controlLineOffset(delta: number, events = false): number {
  const threshold = events ? 75 : 50;
  return Math.abs(delta) < threshold
    ? 0
    : Math.sign(delta) * (1 + Math.floor((Math.abs(delta) - threshold) / 50));
}

/** X anchor for scaling: earliest, latest, or the selection's centre. */
export function selectionScaleAnchor(snapshot: SelectionSnapshot, anchorMode = 0): number | null {
  const ordered = snapshot.notes.toSorted((left, right) =>
    compareBeats(left.note.startTime, right.note.startTime),
  );
  if (!ordered.length) {
    return null;
  }
  if (anchorMode === 1) {
    return Number(ordered[0].note.positionX);
  }
  if (anchorMode === 2) {
    return Number(ordered[ordered.length - 1].note.positionX);
  }
  const minimum = ordered.reduce(
    (value, entry) => Math.min(value, Number(entry.note.positionX)),
    Infinity,
  );
  const maximum = ordered.reduce(
    (value, entry) => Math.max(value, Number(entry.note.positionX)),
    -Infinity,
  );
  return (minimum + maximum) / 2;
}

/** Plans one move, scale, or line-shift gesture over a captured selection. */
export function controlSelection(
  snapshot: SelectionSnapshot,
  kind: string,
  {
    deltaBeat = 0,
    deltaBeatByLine = null,
    deltaX = 0,
    dragX = 0,
    anchorMode = 0,
    snapX = false,
    gridCount = 11,
  }: ControlSelectionOptions = {},
): SelectionEditResult {
  /** Per-line beat increment, falling back to the shared delta. */
  const beatDelta = (entry: { lineIndex: number }): number | Beat =>
    deltaBeatByLine?.get(entry.lineIndex) ?? deltaBeat;
  if (kind === "note-move") {
    const minimum = snapshot.notes.reduce(
      (value, entry) => Math.min(value, Number(entry.note.positionX)),
      Infinity,
    );
    const maximum = snapshot.notes.reduce(
      (value, entry) => Math.max(value, Number(entry.note.positionX)),
      -Infinity,
    );
    const spacing = verticalGrid(gridCount).spacing;
    if (snapX && Number.isFinite(spacing) && spacing > 0) {
      deltaX = Math.round(deltaX / spacing) * spacing;
    }
    let lower = -675 - minimum;
    let upper = 675 - maximum;
    if (snapX && Number.isFinite(spacing) && spacing > 0) {
      lower = Math.ceil(lower / spacing) * spacing;
      upper = Math.floor(upper / spacing) * spacing;
    }
    deltaX = Math.max(lower, Math.min(upper, deltaX));
    return editCapturedSelection(snapshot, {
      note: (item, entry) => ({
        ...shiftedTime(item, beatDelta(entry)),
        positionX: Number(item.positionX) + deltaX,
      }),
    });
  }
  if (kind === "note-scale") {
    const ordered = snapshot.notes.toSorted((left, right) =>
      compareBeats(left.note.startTime, right.note.startTime),
    );
    const minimum = ordered.reduce(
      (value, entry) => Math.min(value, Number(entry.note.positionX)),
      Infinity,
    );
    const maximum = ordered.reduce(
      (value, entry) => Math.max(value, Number(entry.note.positionX)),
      -Infinity,
    );
    const anchor = selectionScaleAnchor(snapshot, anchorMode) ?? 0;
    let rate = 1 + (dragX / 300) * (anchorMode === 2 ? -1 : 1);
    if (minimum >= -675 && maximum <= 675) {
      let lower = -Infinity;
      let upper = Infinity;
      for (const position of [minimum, maximum]) {
        const offset = position - anchor;
        if (!offset) {
          continue;
        }
        const bounds = [(-675 - anchor) / offset, (675 - anchor) / offset];
        lower = Math.max(lower, Math.min(...bounds));
        upper = Math.min(upper, Math.max(...bounds));
      }
      rate = Math.max(lower, Math.min(upper, rate));
    }
    return editCapturedSelection(snapshot, {
      note: (item) => ({ ...item, positionX: anchor + (Number(item.positionX) - anchor) * rate }),
    });
  }
  if (kind === "note-line") {
    return editCapturedSelection(snapshot, { lineOffset: controlLineOffset(dragX) });
  }
  if (kind === "event-move") {
    return editCapturedSelection(snapshot, {
      event: (item, unusedType, entry) => shiftedTime(item, beatDelta(entry)),
      lineOffset: controlLineOffset(dragX, true),
    });
  }
  return editCapturedSelection(snapshot, {
    event: (item, unusedType, entry) =>
      shiftedTime(item, beatDelta(entry), kind === "event-start" ? "start" : "end"),
  });
}

/** Scale selected notes around their shared X centre. */
export function scaleSelection(session: EditorSession, factor: number): boolean {
  if (!Number.isFinite(factor) || factor <= 0) {
    return false;
  }
  const snapshot = captureSelection(session);
  if (!snapshot.notes.length) {
    return false;
  }
  const anchor = selectionScaleAnchor(snapshot, 0) ?? 0;
  return commitSelectionEdit(
    session,
    editCapturedSelection(snapshot, {
      note: (item) => ({
        ...item,
        positionX: Math.max(
          -675,
          Math.min(675, anchor + (Number(item.positionX) - anchor) * factor),
        ),
      }),
    }),
    t("editor.commands.batchEdit.scaleLabel"),
  );
}

/** Move every selected note or event by whole judgement-line offsets. */
export function shiftSelectionLine(session: EditorSession, direction: number): boolean {
  const snapshot = captureSelection(session);
  if (
    (!snapshot.notes.length && !snapshot.events.length) ||
    !Number.isInteger(direction) ||
    (session.chart.judgeLineList?.length ?? 0) < 2
  ) {
    return false;
  }
  return commitSelectionEdit(
    session,
    editCapturedSelection(snapshot, { lineOffset: direction }),
    t("editor.commands.batchEdit.lineLabel"),
  );
}

/** Move one edge of every selected event by a grid division. */
export function shiftEventEdge(
  session: EditorSession,
  part: "start" | "end",
  direction: number,
  division: number,
): boolean {
  if (!Number.isFinite(division) || division < 1 || (direction !== 1 && direction !== -1)) {
    return false;
  }
  const snapshot = captureSelection(session);
  if (!snapshot.events.length) {
    return false;
  }
  return commitSelectionEdit(
    session,
    editCapturedSelection(snapshot, {
      event: (item) => shiftedTime(item, direction / division, part),
    }),
    t(
      part === "start"
        ? "editor.commands.batchEdit.eventStartLabel"
        : "editor.commands.batchEdit.eventEndLabel",
    ),
  );
}

/** Clear every selected note and event, including selections on other lines. */
export function clearSelection(session: EditorSession): boolean {
  const changed = Boolean(
    session.selection.size ||
    session.eventSelection.size ||
    [...session.multiLineSelection.values()].some((selection) => selection.size) ||
    [...session.multiEventSelection.values()].some((selection) => selection.size),
  );
  if (!changed) {
    return false;
  }
  session.selection.clear();
  session.eventSelection.clear();
  session.multiLineSelection.clear();
  session.multiEventSelection.clear();
  session.multiSelectionIntent = null;
  return true;
}

/**
 * Select-all and the page keys move the selection this module edits.
 *
 * `nudgeSelection` is the implementation, and the arrow keys it uses are absent
 * whenever nothing is selected — that is where the two contexts come from.
 */
export const selectionShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "selection.clear",
    category: "editor.selection",
    title: "shortcuts.editor.clearSelection",
    scope: "editor",
    defaults: [{ key: "ESCAPE" }],
    shared: true,
    enabledFor: (context) =>
      context.hasSelection && context.samplingActive !== true && context.curveMode !== true,
  },
  {
    id: "edit.selectAll",
    category: "editor.editing",
    title: "shortcuts.editor.selectAll",
    scope: "editor",
    defaults: [{ key: "A", modifiers: ["CTRL"] }],
  },
  {
    id: "selection.sweep.add",
    category: "editor.selection",
    title: "shortcuts.editor.sweepSelect",
    scope: "editor",
    defaults: [{ key: "MOUSE0" }],
    surface: "timeline",
    passive: true,
  },
  {
    id: "selection.sweep.remove",
    category: "editor.selection",
    title: "shortcuts.editor.sweepDeselect",
    scope: "editor",
    defaults: [{ key: "MOUSE2" }],
    surface: "timeline",
    passive: true,
  },
  {
    id: "selection.nudge.left",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageLeft",
    scope: "editor",
    // Z/X/T/B form a left-hand movement cluster: horizontal on the bottom row,
    // time on the upper/lower pair. The arrows stay as the familiar binding.
    defaults: [{ key: "Z" }, { key: "LEFTARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.nudge.right",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageRight",
    scope: "editor",
    defaults: [{ key: "X" }, { key: "RIGHTARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.nudge.up",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageUp",
    scope: "editor",
    defaults: [{ key: "T" }, { key: "UPARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.nudge.down",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageDown",
    scope: "editor",
    defaults: [{ key: "B" }, { key: "DOWNARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.scale.narrower",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.scaleNarrower",
    scope: "editor",
    // Alt+Z/X mirror the unmodified Z/X nudge pair; the arrows remain the
    // familiar alternative for a right hand that is not on the mouse.
    defaults: [
      { key: "Z", modifiers: ["ALT"] },
      { key: "LEFTARROW", modifiers: ["ALT"] },
    ],
    enabledFor: (context) => context.hasSelection && context.area === "notes",
  },
  {
    id: "selection.scale.wider",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.scaleWider",
    scope: "editor",
    defaults: [
      { key: "X", modifiers: ["ALT"] },
      { key: "RIGHTARROW", modifiers: ["ALT"] },
    ],
    enabledFor: (context) => context.hasSelection && context.area === "notes",
  },
  {
    id: "selection.line.previous",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.linePrevious",
    scope: "editor",
    // Shift moves the selection between lines; the arrow chord stays available.
    defaults: [
      { key: "Z", modifiers: ["ALT", "SHIFT"] },
      { key: "UPARROW", modifiers: ["ALT"] },
    ],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.line.next",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.lineNext",
    scope: "editor",
    defaults: [
      { key: "X", modifiers: ["ALT", "SHIFT"] },
      { key: "DOWNARROW", modifiers: ["ALT"] },
    ],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.event.start.earlier",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.eventStartEarlier",
    scope: "editor",
    // B/T move the selection in time; Alt moves an event edge.
    defaults: [{ key: "B", modifiers: ["ALT"] }, { key: "LEFTBRACKET" }],
    enabledFor: (context) => context.hasSelection && context.area === "events",
  },
  {
    id: "selection.event.start.later",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.eventStartLater",
    scope: "editor",
    defaults: [{ key: "T", modifiers: ["ALT"] }, { key: "RIGHTBRACKET" }],
    enabledFor: (context) => context.hasSelection && context.area === "events",
  },
  {
    id: "selection.event.end.earlier",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.eventEndEarlier",
    scope: "editor",
    defaults: [
      { key: "B", modifiers: ["ALT", "SHIFT"] },
      { key: "LEFTBRACKET", modifiers: ["SHIFT"] },
    ],
    enabledFor: (context) => context.hasSelection && context.area === "events",
  },
  {
    id: "selection.event.end.later",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.eventEndLater",
    scope: "editor",
    defaults: [
      { key: "T", modifiers: ["ALT", "SHIFT"] },
      { key: "RIGHTBRACKET", modifiers: ["SHIFT"] },
    ],
    enabledFor: (context) => context.hasSelection && context.area === "events",
  },
];
