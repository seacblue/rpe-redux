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
  timelineEmptyPanPress,
  timelineSweepEnabled,
} from "../../../../../../core/edit/timeline/selection.ts";
import {
  moveTimelineNote,
  previewChartForNoteDrag,
} from "../../../../../../core/edit/timeline/dragPreview.ts";
import { setTimelineDragPreview } from "../../../../../../core/edit/timeline/dragPreviewState.ts";
import {
  canOpenOverlapMenu,
  updateOverlapPress,
} from "../../../../../../core/edit/timeline/overlapPress.ts";
import {
  dragPrekeyHeld,
  selectedHoldTarget,
} from "../../../../../../core/edit/timeline/dragPrekey.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { compareBeats } from "../../../../../../core/global/chart/timing/beat.ts";
import { t } from "../../../../../../i18n/index.ts";
import type {
  TimelineNote,
  TimelineNoteEntry,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineNoteInteractionReceiver } from "../drawing/timelineReceiver.ts";
import { captureNoteBaseline, marqueeHistoryKey } from "../selection/rectangleSelection.ts";
import { holdPart, hits } from "./noteHitTest.ts";
import {
  openOverlapMenu,
  type OverlapMenuAction,
} from "../../../../../overlays/overlap/overlapMenu.ts";
import { selectOverlappingNote } from "./noteSelectionDrawing.ts";
import { lockSweepArea, timelineSweepMode } from "../selection/sweepSelection.ts";
import { pointerTimingEnd, pointerTimingStart } from "../interaction/timelineGestures.ts";
import { SELECTION_SHORTCUT_IDS } from "../../../../../../core/edit/selection/control.ts";
import { matchesSelectionShortcut } from "../selection/selectionShortcuts.ts";

/** Publish the live edge of a prekey Hold drag for the inspector. */
function syncNoteDragPreview(
  receiver: TimelineNoteInteractionReceiver,
  session: EditorSession,
): boolean {
  const drag = receiver.gestures.drag;
  const entry = drag?.prekey ? session.selectedNoteEntries()[0] : undefined;
  if (!entry) {
    return false;
  }
  return setTimelineDragPreview({
    kind: "note",
    lineIndex: entry.lineIndex,
    index: entry.index,
    // A prekey drag previews both the Hold edge time and its horizontal move.
    note: receiver.movedNote(entry.note as TimelineNote),
  });
}

/** Publish the live chart proposal used by the realtime preview during a note drag. */
function syncNoteDragPreviewChart(
  receiver: TimelineNoteInteractionReceiver,
  session: EditorSession,
): void {
  const drag = receiver.gestures.drag;
  if (!drag || !["move", "startTime", "endTime"].includes(drag.kind)) {
    receiver.setPreviewChart(null);
    return;
  }
  receiver.setPreviewChart(previewChartForNoteDrag(session, (note) => receiver.movedNote(note)));
}

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
  if (!this.gestures.drag) {
    this.setPreviewChart(null);
  }
  if (this.gestures.overlapPress) {
    this.gestures.overlapPress = updateOverlapPress(
      this.gestures.overlapPress,
      this.gestures.cursor,
    );
  }
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
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() -
          this.viewport.judgementOffset -
          this.gestures.drag.current.y) /
          this.viewport.scaleForArea("notes");
    }
    const session = this.getSession();
    syncNoteDragPreviewChart(this, session);
    if (syncNoteDragPreview(this, session)) {
      session.notify("selection");
    }
    if (this.gestures.drag.kind === "multi-pan") {
      // Pan through the clamped viewport seam so the note and event fields
      // share one scroll bound.
      const deltaX = this.gestures.cursor.x - previous.x;
      if (this.notesCanvas.style) {
        this.notesCanvas.style.cursor = "grabbing";
      }
      if (deltaX !== 0) {
        this.viewport.panMultiLine(this.notesCanvas.clientWidth, deltaX, "notes");
        this.changed();
      }
      return;
    }
    // Rectangle geometry is painted by the selection overlay. Sweep selection
    // already invalidates the timeline from updateSweep; neither gesture needs
    // a second full content redraw from the canvas pointer handler.
    if (this.gestures.drag.kind === "rectangle" || this.gestures.drag.kind === "sweep") {
      if (this.notesCanvas.style) {
        this.notesCanvas.style.cursor = "move";
      }
      return;
    }
  }
  const hover = !this.gestures.drag ? this.hit(this.gestures.cursor) : null;
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
  return entries.map((entry) => ({
    id: `note:${entry.lineIndex}:${entry.index}`,
    label: noteTypeLabel(entry.item.type),
    detail: `${t("editorPanels.overlap.line", { index: entry.lineIndex })} · #${entry.index}`,
    onHover: () => {
      receiver.gestures.overlapHover = {
        kind: "notes",
        lineIndex: entry.lineIndex,
        index: entry.index,
      };
      receiver.changed();
    },
    onLeave: () => {
      if (!receiver.gestures.isNoteOverlapHovered(entry.lineIndex, entry.index)) {
        return;
      }
      receiver.gestures.overlapHover = null;
      receiver.changed();
    },
    run: () => {
      selectOverlappingNote(session, entry, receiver.changed);
    },
  }));
}

/** Picks the note beneath the timeline cursor for a keyboard curve shortcut. */
export function quickPickAtCursor(this: TimelineNoteInteractionReceiver): boolean {
  const position = this.gestures.cursor;
  if (!position || this.gestures.hoverArea !== "notes") {
    return false;
  }
  const hit = this.hit(position);
  if (!hit || !this.gestures.curveQuickPick) {
    return false;
  }
  const session = this.getSession();
  if (hit.lineIndex !== session.lineIndex) {
    session.selectLine(hit.lineIndex);
  }
  if (!this.gestures.curveQuickPick(hit.item, hit.index, hit.lineIndex)) {
    return false;
  }
  session.focus = "notes";
  this.changed();
  return true;
}

/** Handle a note-field press: selection, drag start, placement, or marquee. */
export function down(this: TimelineNoteInteractionReceiver, event: PointerEvent): void {
  if (![0, 2].includes(event.button)) {
    return;
  }
  event.preventDefault?.();
  this.setPreviewChart(null);
  if (this.finishRectangle(event)) {
    return;
  }
  if (document.activeElement !== this.notesCanvas) {
    this.notesCanvas.focus({ preventScroll: true });
  }
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
  this.gestures.overlapPress = null;
  // An armed offset pick owns the next left press before any note hit test runs:
  // it targets a grid line, so a note under the pointer must not be selected,
  // dragged, or treated as the pick target.
  if (
    event.button === 0 &&
    this.gestures.offsetPick?.(position.y, this.gestures.cursorLineIndex ?? null)
  ) {
    return;
  }
  const session = this.getSession();
  const selectNote = matchesSelectionShortcut(
    SELECTION_SHORTCUT_IDS.note,
    event,
    "notes",
    "timeline",
    event.target,
  );
  const toggleSelection = matchesSelectionShortcut(
    SELECTION_SHORTCUT_IDS.toggle,
    event,
    "notes",
    "timeline",
    event.target,
  );
  const marqueeSelection = matchesSelectionShortcut(
    SELECTION_SHORTCUT_IDS.marquee,
    event,
    "notes",
    "timeline",
    event.target,
  );
  const marqueeRemove = matchesSelectionShortcut(
    SELECTION_SHORTCUT_IDS.marqueeRemove,
    event,
    "notes",
    "timeline",
    event.target,
  );
  let hit = this.hit(position);
  const dragPrekey = dragPrekeyHeld();
  const overlapEligible =
    selectNote && !dragPrekey && !this.gestures.tool && !this.gestures.pendingHold;
  const overlapping = overlapEligible ? hits.call(this, position) : [];
  if (overlapping.length > 1) {
    const selected = overlapping.find((entry) =>
      session
        .selectedNoteEntries()
        .some(
          (selectedEntry) =>
            selectedEntry.lineIndex === entry.lineIndex && selectedEntry.index === entry.index,
        ),
    );
    if (selected) {
      hit = selected;
    }
    this.gestures.overlapPress = { start: position, moved: false };
  }
  const multiMode = session.multiLineActive;
  const panelCount = this.viewport.panelCount("notes");
  const multiPanel = multiMode && panelCount > 1;
  // Multi-line editing with more than one panel reserves an empty primary-button
  // drag for panning, so that press must not start an additive sweep or clear
  // the selection it is navigating.
  const panBlank = timelineEmptyPanPress({
    multiLineActive: multiMode,
    panelCount,
    button: event.button,
    hit: Boolean(hit),
    tool: Boolean(this.gestures.tool),
    pending: Boolean(this.gestures.pendingHold),
  });
  // RPE's drag prekey trims the single selected Hold from anywhere in the
  // field. A press on a Hold without that selection still selects and trims it
  // below, and Ctrl keeps its edge-only gesture.
  const prekeyHold =
    dragPrekey && !this.gestures.pendingHold && session.focus === "notes"
      ? selectedHoldTarget(session.selectedNoteEntries())
      : null;
  if (prekeyHold && (event.button === 0 || event.button === 2)) {
    const lineIndex = prekeyHold.lineIndex;
    const factor = this.viewport.noteFactorForLine(lineIndex);
    const originSeconds = this.viewport.tempo.seconds(this.viewport.origin);
    session.focus = "notes";
    session.selectionMode = "single";
    this.gestures.drag = {
      kind: event.button === 0 ? "startTime" : "endTime",
      prekey: true,
      start: position,
      current: position,
      anchor: prekeyHold.index,
      lineIndex,
      startFactor: factor,
      currentSeconds:
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      originSeconds,
    };
    syncNoteDragPreview(this, session);
    this.notesCanvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      this.gestures.suppressNextContextMenu();
    }
    session.notify();
    this.changed();
    return;
  }
  // RPE drag prekey: Z or Ctrl + right drag edits a Hold tail, even when the
  // pointer is not within the ordinary edge handle.
  if ((dragPrekey || event.ctrlKey) && hit?.item.type === 2 && event.button === 2) {
    const lineIndex = hit.lineIndex ?? session.lineIndex;
    if (lineIndex !== session.lineIndex) {
      session.selectLine(lineIndex);
    }
    session.selection.clear();
    session.selection.add(hit.index);
    session.selectionMode = "single";
    session.focus = "notes";
    this.gestures.drag = {
      kind: "endTime",
      prekey: dragPrekey,
      start: position,
      current: position,
      anchor: hit.index,
      lineIndex,
      startFactor: this.viewport.noteFactorForLine(lineIndex),
      currentSeconds:
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      originSeconds: this.viewport.tempo.seconds(this.viewport.origin),
    };
    this.notesCanvas.setPointerCapture(event.pointerId);
    this.gestures.suppressNextContextMenu();
    session.notify();
    this.changed();
    return;
  }
  // A split multi-line timeline owns every sweep-free press: the primary button
  // pans, and both sweep buttons stay off so the gesture cannot be reintroduced
  // on the secondary button or through a modifier.
  const sweepMode = timelineSweepEnabled({ multiLineActive: multiMode, panelCount })
    ? timelineSweepMode(session, event, "notes")
    : null;
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
  if (selectNote) {
    session.marqueeSelection = null;
  }
  if (toggleSelection || marqueeSelection || marqueeRemove) {
    session.multiSelectionIntent = "notes";
  } else {
    session.multiSelectionIntent = null;
  }
  if (event.button === 0 && hit && this.gestures.curvePick?.(hit.item, hit.index, hit.lineIndex)) {
    return;
  }
  // An armed offset pick owns the next left click: a note supplies its own start
  // beat, empty canvas supplies the snapped grid line under the pointer.
  if (
    event.button === 0 &&
    this.gestures.offsetPick?.(
      hit ? hit.start : this.viewport.snappedBeat(position.y),
      hit?.lineIndex ?? null,
    )
  ) {
    return;
  }
  if (
    event.button === 0 &&
    !hit &&
    this.gestures.curvePickPoint?.(
      this.viewport.snappedBeatTriple(position.y),
      this.viewport.positionAt(position.x),
    )
  ) {
    return;
  }
  if (overlapping.length > 1) {
    // Open after an in-place click. A native popover opened during pointerdown
    // reads that same click as an outside click and closes immediately, so let
    // the click finish and defer once more. A moved press continues through the
    // normal note-selection and drag path below.
    const canvas = this.notesCanvas;
    const actions = overlapActions(this, overlapping);
    canvas.addEventListener(
      "click",
      () => {
        const press = this.gestures.overlapPress;
        this.gestures.overlapPress = null;
        if (!canOpenOverlapMenu(press)) {
          return;
        }
        this.gestures.overlapMenuOpen = true;
        this.gestures.overlapHover = null;
        this.changed();
        openOverlapMenu(
          canvas,
          event.clientX,
          event.clientY,
          t("editor.overlap.title"),
          actions,
          () => {
            this.gestures.overlapMenuOpen = false;
            this.gestures.overlapHover = null;
            this.changed();
          },
        );
      },
      { once: true },
    );
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
  if (!panBlank && !toggleSelection && !marqueeSelection && !marqueeRemove) {
    session.eventSelection.clear();
  }
  if (
    !panBlank &&
    event.button === 0 &&
    !hit &&
    selectNote &&
    !this.gestures.tool &&
    !this.gestures.pendingHold
  ) {
    session.selection.clear();
    session.multiLineSelection.clear();
    session.multiSelectionIntent = null;
    session.selectionMode = "none";
  }
  if (selectNote && (this.gestures.pendingHold || this.gestures.tool) && !panBlank) {
    this.addAtCursor(this.gestures.pendingHold ? 2 : this.gestures.tool);
    return;
  }
  if (multiMode && (marqueeSelection || marqueeRemove)) {
    const worldX =
      position.x + this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes");
    const baselineStarted = pointerTimingStart();
    const baseline = captureNoteBaseline(session, true);
    pointerTimingEnd(baselineStarted, "noteBaselineCopy");
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
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      current: position,
      currentWorldX: worldX,
      append: true,
      remove: marqueeRemove,
      historyKey: marqueeHistoryKey(session),
      ...baseline,
    };
  } else if (multiPanel && panBlank) {
    this.gestures.drag = {
      kind: "multi-pan",
      pointerId: event.pointerId,
      start: position,
      current: position,
      clearOnClick: !toggleSelection && !marqueeSelection && !marqueeRemove,
    };
  } else if (!multiMode && (marqueeSelection || marqueeRemove)) {
    const baselineStarted = pointerTimingStart();
    const baseline = captureNoteBaseline(session, true);
    pointerTimingEnd(baselineStarted, "noteBaselineCopy");
    this.gestures.drag = {
      kind: "rectangle",
      area: "notes",
      pointerId: event.pointerId,
      start: position,
      startFactor: this.viewport.noteFactorForLine(
        this.gestures.cursorLineIndex ?? session.lineIndex,
      ),
      startSeconds:
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      current: position,
      append: true,
      remove: marqueeRemove,
      historyKey: marqueeHistoryKey(session),
      ...baseline,
    };
  } else if (hit && (selectNote || toggleSelection)) {
    const lineSelection = session.multiLineActive
      ? new Set(session.multiLineSelection?.get(hit.lineIndex) ?? [])
      : session.selection;
    const wasSelected = lineSelection.has(hit.index);
    if (toggleSelection) {
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
    if (session.multiLineActive && !toggleSelection && !wasSelected) {
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
    session.selectionMode = !hasSelection ? "none" : toggleSelection ? "multi" : "single";
    if (toggleSelection) {
      session.notify();
      this.changed();
      return;
    }
    if (!session.editable) {
      session.notify();
      this.changed();
      return;
    }
    const part = hit.item.type === 2 ? holdPart.call(this, hit, position) : null;
    const kind =
      dragPrekey && hit.item.type === 2
        ? "startTime"
        : part === "tail"
          ? "endTime"
          : part === "head"
            ? "startTime"
            : "move";
    this.gestures.drag = {
      kind,
      prekey: dragPrekey && kind !== "move",
      start: position,
      current: position,
      anchor: hit.index,
      lineIndex: hit.lineIndex,
      startFactor: this.viewport.noteFactorForLine(hit.lineIndex ?? session.lineIndex),
      currentSeconds:
        this.viewport.tempo.seconds(this.viewport.origin) +
        (this.viewport.viewHeight() - this.viewport.judgementOffset - position.y) /
          this.viewport.scaleForArea("notes"),
      originSeconds: this.viewport.tempo.seconds(this.viewport.origin),
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
    const drag = this.gestures.drag;
    const moved = Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 2;
    this.gestures.drag = null;
    this.notesCanvas.releasePointerCapture?.(event.pointerId);
    if (!moved && drag.clearOnClick) {
      // A pan that never moved is an empty-field click: it clears the selection
      // instead of leaving the pre-pan selection untouched.
      const session = this.getSession();
      session.eventSelection.clear();
      session.selection.clear();
      session.multiLineSelection.clear();
      session.multiSelectionIntent = null;
      session.selectionMode = "none";
    }
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
      this.viewport.tempo.seconds(this.viewport.origin) +
      (this.viewport.viewHeight() - this.viewport.judgementOffset - drag.current.y) /
        this.viewport.scaleForArea("notes");
  }
  const session = this.getSession();
  this.setPreviewChart(null);
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
        lineIndices: (() => {
          if (!session.multiLineActive) {
            return undefined;
          }
          const [firstPanel, lastPanel] = this.viewport.visiblePanelRange(
            this.notesCanvas.clientWidth,
            "notes",
          );
          return session.targetLineIndices.slice(firstPanel, lastPanel + 1);
        })(),
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
      (lineIndex, bottom, top) => this.cache.noteEntriesInRange(lineIndex, bottom, top),
    );
  } else if (["move", "startTime", "endTime"].includes(drag.kind)) {
    const startsAtPointer = drag.prekey === true;
    const moved =
      drag.scrolled || Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > 4;
    const changed =
      !startsAtPointer ||
      session.selectedNoteEntries().some(({ note }) => {
        // A prekey drag may move the Hold edge and the note horizontally.
        const next = this.movedNote(note as TimelineNote);
        return (
          next.positionX !== note.positionX ||
          compareBeats(next.startTime, note.startTime) !== 0 ||
          compareBeats(next.endTime, note.endTime) !== 0
        );
      });
    if ((moved || startsAtPointer) && changed) {
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
  }
  this.gestures.drag = null;
  if (setTimelineDragPreview(null)) {
    session.notify("selection");
  }
  this.changed();
}
