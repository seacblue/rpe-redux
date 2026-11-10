/**
 * Pointer interaction for the note field: hover and click hit testing, note dragging
 * and multi-pan, placement, and rectangle selection.
 *
 * Gesture state is translated into core selection and drag operations; chart data is
 * not owned here.
 */
import {
  selectNotesInRectangle,
  commitNoteDrag,
} from "../../../../../../core/edit/timeline/selection.ts";
import { moveTimelineNote } from "../../../../../../core/edit/timeline/dragPreview.ts";
import { t } from "../../../../../../i18n/index.ts";
import type {
  TimelineNote,
  TimelineNoteEntry,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineNoteInteractionReceiver } from "../drawing/timelineReceiver.ts";
import { captureNoteBaseline, marqueeHistoryKey } from "../selection/rectangleSelection.ts";
import { hits } from "./noteHitTest.ts";
import {
  openOverlapMenu,
  type OverlapMenuAction,
} from "../../../../../overlays/overlap/overlapMenu.ts";
import { selectOverlappingNote } from "./noteSelectionDrawing.ts";
import { lockSweepArea, timelineSweepMode } from "../selection/sweepSelection.ts";

/** The note with the active drag applied, for drawing and commit. */
export function movedNote(this: TimelineNoteInteractionReceiver, note: TimelineNote): TimelineNote {
  const panelWidth = this.viewport.panelWidth(this.notesCanvas.clientWidth, "notes");
  return moveTimelineNote(note, this.gestures.drag, this.getSession(), {
    tempo: this.viewport.tempo,
    origin: this.viewport.origin,
    scale: this.viewport.scaleForArea("notes"),
    division: this.viewport.division,
    panelWidth,
    inset: this.viewport.noteInset(panelWidth),
    gridCount: this.viewport.gridCount,
    snapX: this.viewport.snapX,
    factor: this.viewport.noteFactorForLine(
      this.gestures.drag?.lineIndex ?? this.getSession().lineIndex,
    ),
  });
}

/** Track the note cursor and advance the active note drag or pan. */
export function move(this: TimelineNoteInteractionReceiver, event: PointerEvent): void {
  this.gestures.cursor = this.viewport.point(event);
  this.gestures.cursorLineIndex = this.viewport.lineIndexAt(
    this.gestures.cursor.x,
    this.notesCanvas.clientWidth,
    "notes",
  );
  this.gestures.clipboardPointer = this.gestures.cursor;
  this.gestures.hoverArea = "notes";
  // A pan belongs to the pointer that started it; another pointer moving over
  // the canvas must not steal it or corrupt the drag's previous sample.
  if (
    this.gestures.drag?.kind === "multi-pan" &&
    this.gestures.drag.pointerId !== undefined &&
    this.gestures.drag.pointerId !== event.pointerId
  ) {
    return;
  }
  if (this.gestures.drag) {
    const previous = this.gestures.drag.current;
    this.gestures.drag.current = this.gestures.cursor;
    this.gestures.drag.currentWorldX =
      this.gestures.cursor.x +
      this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes");
    if (this.gestures.drag.startFactor !== undefined) {
      this.gestures.drag.currentSeconds =
        this.viewport.tempo.seconds(this.viewport.origin, this.gestures.drag.startFactor) +
        (this.viewport.viewHeight() -
          this.viewport.judgementOffset -
          this.gestures.drag.current.y) /
          this.viewport.scaleForArea("notes");
    }
    if (this.gestures.drag.kind === "multi-pan") {
      // Pan through the clamped viewport seam so the note and event fields
      // share one scroll bound.
      const deltaX = this.gestures.cursor.x - previous.x;
      if (deltaX !== 0) {
        this.viewport.panMultiLine(this.notesCanvas.clientWidth, deltaX, "notes");
        this.changed();
      }
      return;
    }
  }
  const hover = !this.gestures.drag ? this.hit(this.gestures.cursor) : null;
  this.gestures.onNoteHover?.(hover);
  this.changed();
  if (this.notesCanvas.style) {
    // Notes are dragged rather than clicked; placement tools keep the
    // crosshair.
    this.notesCanvas.style.cursor = this.gestures.drag
      ? "move"
      : hover
        ? "move"
        : this.gestures.tool || this.gestures.pendingHold
          ? "crosshair"
          : "default";
  }
}

/** Localized label for a note type. */
function noteTypeLabel(type: unknown): string {
  switch (type) {
    case 1:
      return t("editorPanels.inspector.noteType.tap");
    case 2:
      return t("editorPanels.inspector.noteType.hold");
    case 3:
      return t("editorPanels.inspector.noteType.flick");
    case 4:
      return t("editorPanels.inspector.noteType.drag");
    default:
      return String(type ?? "Note");
  }
}

/** Menu actions that select one note from an overlapping stack. */
export function overlapActions(
  receiver: TimelineNoteInteractionReceiver,
  entries: readonly TimelineNoteEntry[],
): OverlapMenuAction[] {
  const session = receiver.getSession();
  return entries.map((entry) => {
    const line = session.chart.judgeLineList?.[entry.lineIndex];
    const end = entry.item.type === 2 ? ` – ${entry.end.toFixed(3)}` : "";
    return {
      id: `note:${entry.lineIndex}:${entry.index}`,
      label: `${noteTypeLabel(entry.item.type)}, ${
        line?.Name ?? t("editorPanels.overlap.line", { index: entry.lineIndex })
      }`,
      detail: `${t("editorPanels.overlap.beat", {
        value: `${entry.start.toFixed(3)}${end}`,
      })}, X ${Number(entry.item.positionX).toFixed(2)}, #${entry.index}`,
      run: () => {
        selectOverlappingNote(session, entry, receiver.changed);
      },
    };
  });
}

/** Handle a note-field press: selection, drag start, placement, or marquee. */
export function down(this: TimelineNoteInteractionReceiver, event: PointerEvent): void {
  if (![0, 1, 2].includes(event.button)) {
    return;
  }
  event.preventDefault?.();
  if (this.finishRectangle(event)) {
    return;
  }
  this.notesCanvas.focus();
  this.notesCanvas.setPointerCapture(event.pointerId);
  const position = this.viewport.point(event);
  this.gestures.cursor = position;
  this.gestures.cursorLineIndex = this.viewport.lineIndexAt(
    position.x,
    this.notesCanvas.clientWidth,
    "notes",
  );
  this.gestures.clipboardPointer = position;
  this.gestures.hoverArea = "notes";
  const hit = this.hit(position);
  const session = this.getSession();
  const sweepMode = timelineSweepMode(session, event, "notes");
  if (
    sweepMode &&
    (event.button === 2 ||
      (sweepMode === "add" && !hit && !this.gestures.tool && !this.gestures.pendingHold))
  ) {
    lockSweepArea(session, "notes");
    this.gestures.drag = {
      kind: "sweep",
      area: "notes",
      button: event.button,
      remove: sweepMode === "remove",
      pointerId: event.pointerId,
      start: position,
      current: position,
      startWorldX:
        position.x + this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes"),
      lastSweepPoint: position,
      lastSweepWorldX:
        position.x + this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes"),
      sweepPoints: [position],
    };
    this.notesCanvas.setPointerCapture(event.pointerId);
    session.notify();
    this.changed();
    return;
  }
  if (event.button === 2) {
    return;
  }
  if (event.button === 0 && !event.ctrlKey && !event.shiftKey) {
    session.marqueeSelection = null;
  }
  if (event.ctrlKey || event.shiftKey || event.button === 1) {
    session.multiSelectionIntent = "notes";
  } else {
    session.multiSelectionIntent = null;
  }
  if (event.button === 0 && hit && this.gestures.curvePick?.(hit.item, hit.index)) {
    return;
  }
  if (
    event.button === 0 &&
    !hit &&
    this.gestures.curvePickPoint?.(
      this.viewport.snappedBeat(position.y),
      this.viewport.positionAt(position.x),
    )
  ) {
    return;
  }
  if (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !this.gestures.tool &&
    !this.gestures.pendingHold
  ) {
    const overlapping = hits.call(this, position);
    if (overlapping.length > 1) {
      // Open after the click that follows this press. A native popover opened
      // during pointerdown reads that same click as an outside click and
      // closes immediately, so let the click finish and defer once more.
      const canvas = this.notesCanvas;
      const actions = overlapActions(this, overlapping);
      canvas.addEventListener(
        "click",
        () => {
          openOverlapMenu(canvas, event.clientX, event.clientY, t("editor.overlap.title"), actions);
        },
        { once: true },
      );
      return;
    }
  }
  if (event.button === 0) {
    session.selectionRevision += 1;
  }
  if (
    !session.multiLineActive &&
    hit?.lineIndex !== undefined &&
    hit.lineIndex !== session.lineIndex
  ) {
    session.selectLine(hit.lineIndex);
  }
  session.focus = "notes";
  if (!event.ctrlKey && !event.shiftKey && event.button !== 1) {
    session.eventSelection.clear();
  }
  const multiMode = session.multiLineActive;
  const multiPanel = multiMode && this.viewport.panelCount("notes") > 1;
  const panBlank = multiPanel && !hit && !this.gestures.tool && !this.gestures.pendingHold;
  if (
    event.button === 0 &&
    !hit &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !this.gestures.tool &&
    !this.gestures.pendingHold
  ) {
    session.selection.clear();
    session.multiLineSelection.clear();
    session.multiSelectionIntent = null;
    session.selectionMode = "none";
  }
  if (
    event.button === 0 &&
    (this.gestures.pendingHold || (this.gestures.tool && !event.shiftKey && !event.ctrlKey)) &&
    !panBlank
  ) {
    this.addAtCursor(this.gestures.pendingHold ? 2 : this.gestures.tool);
    return;
  }
  if (multiMode && (event.shiftKey || event.button === 1)) {
    const worldX =
      position.x + this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes");
    this.gestures.drag = {
      kind: "rectangle",
      area: "notes",
      pointerId: event.pointerId,
      start: position,
      startWorldX: worldX,
      startFactor: this.viewport.noteFactorForLine(
        this.gestures.cursorLineIndex ?? session.lineIndex,
      ),
      startSeconds:
        this.viewport.tempo.seconds(
          this.viewport.origin,
          this.viewport.noteFactorForLine(this.gestures.cursorLineIndex ?? session.lineIndex),
        ) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      current: position,
      currentWorldX: worldX,
      append: true,
      remove: event.altKey,
      historyKey: marqueeHistoryKey(session),
      ...captureNoteBaseline(session, true),
    };
  } else if (multiPanel && panBlank) {
    this.gestures.drag = {
      kind: "multi-pan",
      pointerId: event.pointerId,
      start: position,
      current: position,
    };
  } else if (!multiMode && (event.shiftKey || event.button === 1)) {
    this.gestures.drag = {
      kind: "rectangle",
      area: "notes",
      pointerId: event.pointerId,
      start: position,
      startFactor: this.viewport.noteFactorForLine(
        this.gestures.cursorLineIndex ?? session.lineIndex,
      ),
      startSeconds:
        this.viewport.tempo.seconds(
          this.viewport.origin,
          this.viewport.noteFactorForLine(this.gestures.cursorLineIndex ?? session.lineIndex),
        ) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      current: position,
      append: true,
      remove: event.altKey,
      historyKey: marqueeHistoryKey(session),
      ...captureNoteBaseline(session, true),
    };
  } else if (hit && event.button === 0) {
    const lineSelection = session.multiLineActive
      ? new Set(session.multiLineSelection?.get(hit.lineIndex) ?? [])
      : session.selection;
    const wasSelected = lineSelection.has(hit.index);
    if (event.ctrlKey) {
      if (lineSelection.has(hit.index)) {
        lineSelection.delete(hit.index);
      } else {
        lineSelection.add(hit.index);
      }
    } else if (!lineSelection.has(hit.index)) {
      (lineSelection.clear(), lineSelection.add(hit.index));
    }
    // A plain click on an unselected object starts a new selection. In
    // multi-line mode clear selections belonging to other panels as well;
    // otherwise clicking a single Hold can accidentally turn into a
    // multi-selection drag.
    if (session.multiLineActive && !event.ctrlKey && !wasSelected) {
      session.multiLineSelection?.clear();
      lineSelection.clear();
      lineSelection.add(hit.index);
    }
    session.selection = lineSelection;
    if (session.multiLineActive && session.multiLineSelection) {
      session.multiLineSelection.set(hit.lineIndex, lineSelection);
    }
    const hasSelection =
      session.selection.size > 0 ||
      [...session.multiLineSelection.values()].some((selection) => selection.size > 0);
    session.selectionMode = !hasSelection ? "none" : event.ctrlKey ? "multi" : "single";
    if (!session.editable) {
      session.notify();
      this.changed();
      return;
    }
    const hitVertical = (beat: number) =>
      session.multiLineActive
        ? this.viewport.noteVerticalForLine(beat, hit.lineIndex, this.notesCanvas.clientHeight)
        : this.viewport.vertical(beat);
    const kind =
      hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.end)) <= 8
        ? "endTime"
        : hit.item.type === 2 && Math.abs(position.y - hitVertical(hit.start)) <= 8
          ? "startTime"
          : "move";
    this.gestures.drag = {
      kind,
      start: position,
      current: position,
      anchor: hit.index,
      lineIndex: hit.lineIndex,
      originSeconds: this.viewport.tempo.seconds(
        this.viewport.origin,
        this.viewport.noteFactorForLine(hit.lineIndex ?? session.lineIndex),
      ),
    };
    session.notify();
  }
  this.changed();
}

/** Finish the active note drag or marquee and commit it. */
export function up(this: TimelineNoteInteractionReceiver, event: PointerEvent): void {
  if (!this.gestures.drag) {
    if (event.button === 0) {
      this.gestures.previewPick?.(event);
    }
    return;
  }
  if (this.gestures.drag.kind === "multi-pan") {
    if (
      this.gestures.drag.pointerId !== undefined &&
      this.gestures.drag.pointerId !== event.pointerId
    ) {
      return;
    }
    this.gestures.drag = null;
    this.notesCanvas.releasePointerCapture?.(event.pointerId);
    this.changed();
    return;
  }
  if (this.gestures.drag.kind === "sweep") {
    if (!this.gestures.drag.finished) {
      this.updateSweep(event);
      this.changed();
      return;
    }
    this.gestures.drag = null;
    this.notesCanvas.releasePointerCapture?.(event.pointerId);
    this.changed();
    return;
  }
  const drag = this.gestures.drag;
  drag.current = this.viewport.point(event);
  drag.currentWorldX =
    drag.current.x + this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes");
  if (drag.startFactor !== undefined) {
    drag.currentSeconds =
      this.viewport.tempo.seconds(this.viewport.origin, drag.startFactor) +
      (this.viewport.viewHeight() - this.viewport.judgementOffset - drag.current.y) /
        this.viewport.scaleForArea("notes");
  }
  const session = this.getSession();
  if (drag.kind === "rectangle") {
    if (!drag.finished) {
      this.changed();
      return;
    }
    const left = Math.min(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
    const right = Math.max(drag.startWorldX ?? drag.start.x, drag.currentWorldX ?? drag.current.x);
    const [bottom, top] = this.rectangleTimes(drag);
    selectNotesInRectangle(
      session,
      {
        left,
        right,
        bottom,
        top,
        append: drag.append,
        remove: drag.remove,
        baseNotes: drag.baselineNotes,
        baseEvents: drag.baselineEvents,
      },
      (lineIndex) => {
        this.refreshIndex(lineIndex);
        return this.cache.noteIndex(lineIndex);
      },
      (note, lineIndex) =>
        this.viewport.noteHorizontal(note.positionX, lineIndex) +
        this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes"),
    );
  } else if (
    ["move", "startTime", "endTime"].includes(drag.kind) &&
    (drag.scrolled || Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 4)
  ) {
    commitNoteDrag(
      session,
      (note) => this.movedNote(note),
      drag.kind === "move"
        ? t("editorPanels.timeline.moveNote")
        : t("editorPanels.timeline.resizeHold"),
      () => {
        this.gestures.drag = null;
      },
    );
  }
  this.gestures.drag = null;
  this.changed();
}
