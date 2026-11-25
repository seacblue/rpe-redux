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
  session.selectionMode = "none";
  return true;
}

/** Stable ids for the pointer selection gestures shared by the editor surfaces. */
export const SELECTION_SHORTCUT_IDS = Object.freeze({
  note: "selection.note",
  event: "selection.event",
  line: "selection.line",
  sweepAdd: "selection.sweep.add",
  sweepRemove: "selection.sweep.remove",
  toggle: "selection.toggle",
  marquee: "selection.marquee",
  marqueeRemove: "selection.marquee.remove",
});

/**
 * Select-all and the movement/stick keys act on the selection this module edits.
 *
 * `nudgeSelection` is the implementation of the arrow keys, and `stickSelectedEvents`
 * is what the G/B pair runs; the hook toggle follows the same selected-event
 * context. These event actions are absent whenever nothing is selected.
 */
export const selectionShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "edit.selectAll",
    category: "editor.editing",
    title: "shortcuts.editor.selectAll",
    scope: "editor",
    defaults: [{ key: "A", modifiers: ["CTRL"] }],
  },
  {
    id: SELECTION_SHORTCUT_IDS.note,
    category: "editor.selection",
    title: "shortcuts.editor.selectNote",
    scope: "editor",
    defaults: [{ key: "MOUSE0" }],
    shared: true,
    passive: true,
    enabledFor: (context) => context.area === "notes",
  },
  {
    id: SELECTION_SHORTCUT_IDS.event,
    category: "editor.selection",
    title: "shortcuts.editor.selectEvent",
    scope: "editor",
    defaults: [{ key: "MOUSE0" }],
    shared: true,
    passive: true,
    enabledFor: (context) => context.area === "events",
  },
  {
    id: SELECTION_SHORTCUT_IDS.line,
    category: "editor.selection",
    title: "shortcuts.editor.selectLine",
    scope: "editor",
    defaults: [{ key: "MOUSE0" }],
    shared: true,
    passive: true,
    enabledFor: (context) => context.surface === "preview",
  },
  {
    id: SELECTION_SHORTCUT_IDS.sweepAdd,
    category: "editor.selection",
    title: "shortcuts.editor.sweepSelect",
    scope: "editor",
    defaults: [{ key: "MOUSE0" }],
    shared: true,
    surface: "timeline",
    passive: true,
  },
  {
    id: SELECTION_SHORTCUT_IDS.sweepRemove,
    category: "editor.selection",
    title: "shortcuts.editor.sweepDeselect",
    scope: "editor",
    defaults: [{ key: "MOUSE2" }],
    shared: true,
    surface: "timeline",
    passive: true,
  },
  {
    id: SELECTION_SHORTCUT_IDS.toggle,
    category: "editor.selection",
    title: "shortcuts.editor.toggleSelectionItem",
    scope: "editor",
    defaults: [{ key: "MOUSE0", modifiers: ["CTRL"] }],
    shared: true,
    passive: true,
  },
  {
    id: SELECTION_SHORTCUT_IDS.marquee,
    category: "editor.selection",
    title: "shortcuts.editor.marqueeSelect",
    scope: "editor",
    defaults: [{ key: "MOUSE0", modifiers: ["SHIFT"] }],
    shared: true,
    passive: true,
  },
  {
    id: SELECTION_SHORTCUT_IDS.marqueeRemove,
    category: "editor.selection",
    title: "shortcuts.editor.marqueeDeselect",
    scope: "editor",
    defaults: [{ key: "MOUSE0", modifiers: ["ALT", "SHIFT"] }],
    shared: true,
    passive: true,
  },
  {
    id: "selection.nudge.left",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageLeft",
    scope: "editor",
    // Z/X nudge a selection horizontally; the arrows stay as the familiar binding.
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
    // The arrow pair moves a selection in time. G and B belong to the event
    // stick commands instead of duplicating the arrows.
    defaults: [{ key: "UPARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.nudge.down",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.pageDown",
    scope: "editor",
    defaults: [{ key: "DOWNARROW" }],
    enabledFor: (context) => context.hasSelection,
  },
  {
    id: "selection.event.stick.next",
    category: "editor.selection",
    title: "shortcuts.editor.stickNext",
    scope: "editor",
    // G joins the selected events' end values to the next event's start, the
    // stick direction RPE puts on G.
    defaults: [{ key: "G" }],
    enabledFor: (context) => context.hasEventSelection === true,
  },
  {
    id: "selection.event.stick.previous",
    category: "editor.selection",
    title: "shortcuts.editor.stickPrevious",
    scope: "editor",
    // B joins the selected events' start values to the previous event's end.
    defaults: [{ key: "B" }],
    enabledFor: (context) => context.hasEventSelection === true,
  },
  {
    id: "selection.event.toggleHooked",
    shared: true,
    category: "editor.selection",
    title: "shortcuts.editor.toggleHooked",
    scope: "editor",
    // F is also the sampler's apply key; the sampler owns it while open.
    defaults: [{ key: "F" }],
    enabledFor: (context) =>
      context.area === "events" && context.hasEventSelection === true && !context.samplingActive,
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
