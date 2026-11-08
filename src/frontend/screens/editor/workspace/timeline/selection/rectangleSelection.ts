/**
 * Rectangle (marquee) selection for the note and event fields: resolves the active
 * drag, projects its corners, updates the rectangle, and commits the selection.
 *
 * It owns the timeline-facing wrapper; coordinate and selection rules live in core.
 */
import * as coreGeometry from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import { beatValue } from "../../../../../../core/global/chart/timing/beat.ts";
import {
  selectEventsInRectangle,
  selectNotesInRectangle,
  selectEventsAlongSegment,
  selectNotesAlongSegment,
  shouldSuppressTimelineContextMenu,
  timelineSweepMoved,
  type SelectionGestureResult,
  type SelectionSweep,
} from "../../../../../../core/edit/timeline/selection.ts";
import { eventList } from "../../../../../../core/edit/events/eventTracks.ts";
import type {
  TimelineArea,
  TimelinePoint,
  RectangleDrag,
  SweepDrag,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineSelectionReceiver } from "../drawing/timelineReceiver.ts";

/** Returns whether the requested timeline area still contains a selection. */
function hasAreaSelection(
  session: ReturnType<TimelineSelectionReceiver["getSession"]>,
  area: TimelineArea,
): boolean {
  return area === "notes"
    ? Boolean(
        session.selection.size ||
        [...session.multiLineSelection.values()].some((selection) => selection.size),
      )
    : Boolean(
        session.eventSelection.size ||
        [...session.multiEventSelection.values()].some((selection) => selection.size),
      );
}

/**
 * The selection a Shift/Ctrl marquee must preserve. Captured once when the
 * gesture starts; the live rectangle is always combined with this baseline, so
 * an object that leaves the rectangle is deselected again.
 */
export function captureNoteBaseline(
  session: ReturnType<TimelineSelectionReceiver["getSession"]>,
  append: boolean,
): Pick<RectangleDrag, "baselineNotes"> {
  if (!append) {
    return {};
  }
  const multi = session.multiLineActive && session.multiLineMode === "notes";
  return {
    baselineNotes: multi
      ? new Map([...session.multiLineSelection].map(([line, indices]) => [line, new Set(indices)]))
      : new Map([[session.lineIndex, new Set(session.selection)]]),
  };
}

/** Selection to preserve for an appending event marquee; empty when not appending. */
export function captureEventBaseline(
  session: ReturnType<TimelineSelectionReceiver["getSession"]>,
  append: boolean,
): Pick<RectangleDrag, "baselineEvents"> {
  if (!append) {
    return {};
  }
  const multi = session.multiLineActive && session.multiLineMode === "events";
  return {
    baselineEvents: multi
      ? new Map([...session.multiEventSelection].map(([line, keys]) => [line, new Set(keys)]))
      : new Map([[session.lineIndex, new Set(session.eventSelection)]]),
  };
}

/** The active notes or events marquee and the canvas it belongs to. */
export function rectangleSelection(this: TimelineSelectionReceiver): {
  drag: RectangleDrag;
  canvas: HTMLCanvasElement;
  area: TimelineArea;
} | null {
  if (this.gestures.drag?.kind === "rectangle") {
    return { drag: this.gestures.drag, canvas: this.notesCanvas, area: "notes" };
  }
  if (this.gestures.eventInteraction.drag?.kind === "rectangle") {
    return { drag: this.gestures.eventInteraction.drag, canvas: this.eventsCanvas, area: "events" };
  }
  return null;
}

/** The active freehand selection and its canvas, if any. */
export function sweepSelection(this: TimelineSelectionReceiver): {
  drag: SweepDrag;
  canvas: HTMLCanvasElement;
  area: TimelineArea;
} | null {
  if (this.gestures.drag?.kind === "sweep") {
    return { drag: this.gestures.drag, canvas: this.notesCanvas, area: "notes" };
  }
  if (this.gestures.eventInteraction.drag?.kind === "sweep") {
    return { drag: this.gestures.eventInteraction.drag, canvas: this.eventsCanvas, area: "events" };
  }
  return null;
}

/** Start corner in the canvas's current scrolled coordinates. */
export function rectangleStart(
  this: TimelineSelectionReceiver,
  drag: RectangleDrag,
): TimelinePoint {
  const scroll =
    drag.startWorldX === undefined
      ? 0
      : this.viewport.multiLineViewportOffset(
          (drag.area === "events" ? this.eventsCanvas : this.notesCanvas).clientWidth,
          drag.area ?? "notes",
        );
  const height = (drag.area === "events" ? this.eventsCanvas : this.notesCanvas).clientHeight;
  const factor = drag.startFactor ?? this.viewport.factor;
  return coreGeometry.rectangleStartPoint(
    drag.start.x,
    drag.start.y,
    drag.startWorldX,
    drag.startSeconds,
    scroll,
    height,
    {
      ...this.viewport.scaleConfig(factor),
      scale: this.viewport.scaleForArea(drag.area ?? "notes"),
    },
    this.viewport.tempo,
  );
}

/** The marquee's beat range as `[bottom, top]`. */
export function rectangleTimes(
  this: TimelineSelectionReceiver,
  drag: RectangleDrag,
): [number, number] {
  return coreGeometry.rectangleBeatRange(
    drag.startSeconds,
    drag.currentSeconds,
    drag.start.y,
    drag.current.y,
    this.viewport.viewHeight(),
    {
      ...this.viewport.scaleConfig(drag.startFactor ?? this.viewport.factor),
      scale: this.viewport.scaleForArea(drag.area ?? "notes"),
    },
    this.viewport.tempo,
  );
}

/** Advance the active marquee to the pointer and redraw. */
export function updateRectangle(this: TimelineSelectionReceiver, event: PointerEvent): void {
  const selection = this.rectangleSelection();
  if (!selection) {
    return;
  }
  if (selection.drag.pointerId !== undefined && selection.drag.pointerId !== event.pointerId) {
    return;
  }
  selection.drag.current = this.viewport.point(event, selection.canvas);
  selection.drag.currentWorldX =
    selection.drag.current.x +
    this.viewport.multiLineViewportOffset(selection.canvas.clientWidth, selection.area);
  if (selection.drag.startFactor !== undefined) {
    updateRectangleSeconds(this, selection.drag);
  }
  this.changed();
}

/** Advance the active freehand gesture and apply only the newly swept segment. */
export function updateSweep(this: TimelineSelectionReceiver, event: PointerEvent): void {
  const selection = this.sweepSelection();
  if (!selection) {
    return;
  }
  if (selection.drag.pointerId !== undefined && selection.drag.pointerId !== event.pointerId) {
    return;
  }
  const current = this.viewport.point(event, selection.canvas);
  const currentWorldX =
    current.x + this.viewport.multiLineViewportOffset(selection.canvas.clientWidth, selection.area);
  const previous = selection.drag.lastSweepPoint ?? selection.drag.start;
  const previousWorldX = selection.drag.lastSweepWorldX ?? selection.drag.startWorldX ?? previous.x;
  if (current.x === previous.x && current.y === previous.y && currentWorldX === previousWorldX) {
    return;
  }
  selection.drag.current = current;
  selection.drag.currentWorldX = currentWorldX;
  selection.drag.sweepPoints ??= [selection.drag.start];
  selection.drag.sweepPoints.push(current);
  const moved = timelineSweepMoved(selection.drag.start, current);
  if (selection.drag.button === 2 && !moved) {
    this.changed();
    return;
  }
  if (!selection.drag.sweepMoved) {
    selection.drag.sweepMoved = moved;
    if (shouldSuppressTimelineContextMenu({ button: selection.drag.button ?? -1, moved })) {
      this.gestures.suppressNextContextMenu();
    }
  }
  const sweep: SelectionSweep = {
    startX: previousWorldX,
    startY: previous.y,
    endX: currentWorldX,
    endY: current.y,
    padding: 4,
    remove: selection.drag.remove,
  };
  const session = this.getSession();
  let result: SelectionGestureResult;
  if (selection.area === "notes") {
    result = selectNotesAlongSegment(session, sweep, {
      indexForLine: (lineIndex) => {
        this.refreshIndex(lineIndex);
        return this.cache.noteIndex(lineIndex);
      },
      bounds: (note, lineIndex) => {
        const x =
          this.viewport.noteHorizontal(note.positionX, lineIndex) +
          this.viewport.multiLineViewportOffset(this.notesCanvas.clientWidth, "notes");
        const start = this.viewport.noteVerticalForLine(
          beatValue(note.startTime),
          lineIndex,
          this.notesCanvas.clientHeight,
          "notes",
        );
        const end = this.viewport.noteVerticalForLine(
          beatValue(note.endTime),
          lineIndex,
          this.notesCanvas.clientHeight,
          "notes",
        );
        const halfWidth = this.viewport.noteWidth(note) / 2;
        return {
          left: x - halfWidth,
          right: x + halfWidth,
          top: Math.min(start, end) - 4,
          bottom: Math.max(start, end) + 4,
        };
      },
    });
  } else {
    result = selectEventsAlongSegment(session, sweep, {
      rectangles: this.gestures.eventRects,
      scroll: this.viewport.multiLineViewportOffset(this.eventsCanvas.clientWidth, "events"),
    });
  }
  if (result.changed || result.matched) {
    session.selectionMode = hasAreaSelection(session, selection.area) ? "multi" : "none";
  }
  selection.drag.lastSweepPoint = current;
  selection.drag.lastSweepWorldX = currentWorldX;
  this.changed();
}

/** Recompute the drag's current chart time from its pointer sample. */
function updateRectangleSeconds(receiver: TimelineSelectionReceiver, drag: RectangleDrag): void {
  if (drag.startFactor === undefined) {
    return;
  }
  drag.currentSeconds =
    receiver.viewport.tempo.seconds(receiver.viewport.origin, drag.startFactor) +
    (receiver.viewport.viewHeight() - receiver.viewport.judgementOffset - drag.current.y) /
      receiver.viewport.scaleForArea(drag.area ?? "notes");
}

/** Re-evaluate a live marquee even when the pointer itself has not moved. */
export function refreshRectangleSelection(this: TimelineSelectionReceiver): void {
  const selection = this.rectangleSelection();
  if (!selection) {
    return;
  }
  updateRectangleSeconds(this, selection.drag);
  const width = selection.canvas.clientWidth;
  const left = Math.min(
    selection.drag.startWorldX ?? selection.drag.start.x,
    selection.drag.currentWorldX ?? selection.drag.current.x,
  );
  const right = Math.max(
    selection.drag.startWorldX ?? selection.drag.start.x,
    selection.drag.currentWorldX ?? selection.drag.current.x,
  );
  const [bottom, top] = coreGeometry.rectangleBeatRange(
    selection.drag.startSeconds,
    selection.drag.currentSeconds,
    selection.drag.start.y,
    selection.drag.current.y,
    this.viewport.viewHeight(),
    {
      ...this.viewport.scaleConfig(selection.drag.startFactor ?? this.viewport.factor),
      scale: this.viewport.scaleForArea(selection.area),
    },
    this.viewport.tempo,
  );
  const history = marqueeHistoryKey(this.getSession());
  if (selection.drag.historyKey !== history) {
    // A chart/undo change invalidates the selection captured when the marquee
    // began. Re-evaluate from the rectangle alone so stale indices cannot stay
    // selected while the pointer is still down.
    selection.drag.historyKey = history;
    selection.drag.baselineNotes = undefined;
    selection.drag.baselineEvents = undefined;
    selection.drag.append = false;
    selection.drag.remove = false;
  }
  const key = `${selection.area}|${left.toFixed(5)}|${right.toFixed(5)}|${bottom.toFixed(5)}|${top.toFixed(5)}|${this.viewport.origin.toFixed(5)}|${history}`;
  if (selection.drag.lastSelectionKey === key) {
    return;
  }
  selection.drag.lastSelectionKey = key;
  const session = this.getSession();
  const intentChanged = session.marqueeSelection !== selection.area;
  session.marqueeSelection = selection.area;
  if (intentChanged) {
    session.selectionRevision += 1;
  }
  let result: SelectionGestureResult;
  if (selection.area === "notes") {
    result = selectNotesInRectangle(
      this.getSession(),
      {
        left,
        right,
        bottom,
        top,
        append: selection.drag.append,
        remove: selection.drag.remove,
        baseNotes: selection.drag.baselineNotes,
        baseEvents: selection.drag.baselineEvents,
      },
      (lineIndex) => {
        this.refreshIndex(lineIndex);
        return this.cache.noteIndex(lineIndex);
      },
      (note, lineIndex) =>
        this.viewport.noteHorizontal(note.positionX, lineIndex) +
        this.viewport.multiLineViewportOffset(width, "notes"),
    );
  } else {
    result = selectEventsInRectangle(
      this.getSession(),
      {
        left,
        right,
        bottom,
        top,
        append: selection.drag.append,
        remove: selection.drag.remove,
        baseNotes: selection.drag.baselineNotes,
        baseEvents: selection.drag.baselineEvents,
      },
      {
        rectangles: this.gestures.eventRects,
        scroll: this.viewport.multiLineViewportOffset(width, "events"),
        eventTypes: this.eventTypes,
        columnBounds: (channel) => this.viewport.eventColumnBounds(channel, width),
        eventsInRange: (type, start, end) => {
          const session = this.getSession();
          return this.cache.eventEntries(
            session.chart,
            eventList(session, type),
            start,
            end,
            this.viewport.gridCount,
          );
        },
      },
    );
  }
  if (result.changed || result.matched) {
    session.selectionMode = hasAreaSelection(session, selection.area) ? "multi" : "none";
  }
  if (intentChanged) {
    session.notify();
  }
}

/** Cheap identity for a chart/undo change while a live marquee is open. */
export function marqueeHistoryKey(
  session: ReturnType<TimelineSelectionReceiver["getSession"]>,
): string {
  const entries = session.history.entries();
  return `${entries.undo.length}:${entries.redo.length}:${session.chart.judgeLineList?.length ?? 0}`;
}

/** Commit the marquee when the event ends it; false keeps the press live. */
export function finishRectangle(this: TimelineSelectionReceiver, event: PointerEvent): boolean {
  const selection = this.rectangleSelection();
  const sweep = this.sweepSelection();
  if (sweep) {
    if (
      (sweep.drag.pointerId !== undefined && sweep.drag.pointerId !== event.pointerId) ||
      (event.type !== "pointercancel" && ![0, 1, 2].includes(event.button))
    ) {
      return false;
    }
    this.updateSweep(event);
    const moved = timelineSweepMoved(sweep.drag.start, sweep.drag.current);
    if (!moved && event.type === "pointerup" && !sweep.drag.remove) {
      const session = this.getSession();
      if (sweep.area === "notes") {
        session.selection.clear();
        session.multiLineSelection.clear();
      } else {
        session.eventSelection.clear();
        session.multiEventSelection.clear();
      }
      session.selectionMode = "none";
      session.notify();
    }
    sweep.drag.finished = true;
    if (sweep.area === "notes") {
      this.up(event);
    } else {
      this.gestures.eventInteraction.up(event);
    }
    return true;
  }
  if (
    !selection ||
    (selection.drag.pointerId !== undefined && selection.drag.pointerId !== event.pointerId) ||
    (event.type !== "pointercancel" && ![0, 1, 2].includes(event.button))
  ) {
    return false;
  }
  // A Shift/Ctrl press that has not moved is the first corner of a two-click
  // marquee. Keep it alive across pointerup; the next press is the end point.
  const moved =
    Math.hypot(
      selection.drag.current.x - selection.drag.start.x,
      selection.drag.current.y - selection.drag.start.y,
    ) > 3;
  if (event.type === "pointerup" && selection.drag.append && !moved) {
    return false;
  }
  refreshRectangleSelection.call(this);
  selection.drag.finished = true;
  if (selection.area === "notes") {
    this.up(event);
  } else {
    this.gestures.eventInteraction.up(event);
  }
  return true;
}
