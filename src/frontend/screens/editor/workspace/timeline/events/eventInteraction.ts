/**
 * Pointer interaction for the event field: hit testing, placement, selection,
 * and rectangle selection.
 *
 * Direct drags on an event bar are deliberately absent: moving or resizing an
 * event goes through the batch shortcuts. Gestures are translated into core
 * event commands; chart data is never stored here.
 */
import type { TimelineRuntimeSurface } from "../drawing/timelineReceiver.ts";
import {
  selectEventsInRectangle,
  shiftSelectedEvents,
} from "../../../../../../core/edit/timeline/selection.ts";
import { eventDragDelta } from "../../../../../../core/edit/timeline/dragPreview.ts";
import {
  beatValue,
  compareBeats,
  formatBeat,
  type Beat,
} from "../../../../../../core/global/chart/timing/beat.ts";
import { t } from "../../../../../../i18n/index.ts";
import { EVENT_TYPES } from "../../../../../../core/global/chart/chart.ts";
import { eventColumnBounds } from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import { trackLabels } from "../drawing/canvas.ts";
import { eventTypeAt, SPECIAL_TRACKS, specialTrackLabel } from "../drawing/tracks.ts";
import { eventColumnForTrack } from "./eventColumns.ts";
import {
  eventKey,
  eventListAt,
  eventList,
  NOISE_ACTIVE_EVENTS,
} from "../../../../../../core/edit/events/eventTracks.ts";
import {
  placedEvent,
  placeEventAtTarget,
} from "../../../../../../core/edit/events/eventCommands.ts";
import type { EventInteractionHandle } from "../drawing/canvas.ts";
import type {
  TimelineEventDrag,
  TimelinePoint,
} from "../../../../../../core/edit/timeline/types.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { captureEventBaseline, marqueeHistoryKey } from "../selection/rectangleSelection.ts";
import {
  openOverlapMenu,
  type OverlapMenuAction,
} from "../../../../../overlays/overlap/overlapMenu.ts";
import { lockSweepArea, timelineSweepMode } from "../selection/sweepSelection.ts";

type EventTimeline = Pick<
  TimelineRuntimeSurface,
  | "cache"
  | "eventsCanvas"
  | "getSession"
  | "eventTypes"
  | "changed"
  | "finishRectangle"
  | "rectangleTimes"
  | "updateSweep"
> & {
  gestures: Pick<
    TimelineRuntimeSurface["gestures"],
    | "eventRects"
    | "eventRectsForLine"
    | "eventCursor"
    | "layer"
    | "notify"
    | "hoverArea"
    | "clipboardPointer"
    | "tool"
    | "previewPick"
  >;
  viewport: Pick<
    TimelineRuntimeSurface["viewport"],
    | "eventTypesForLine"
    | "eventBarWidth"
    | "factorForLine"
    | "lineIndexAt"
    | "panelWidth"
    | "panelIndex"
    | "panelStride"
    | "multiLineViewportOffset"
    | "panMultiLine"
    | "eventBeatAt"
    | "gridCount"
    | "point"
    | "panelCount"
    | "timeAt"
    | "tempo"
    | "origin"
    | "viewHeight"
    | "judgementOffset"
    | "scale"
    | "scaleForArea"
    | "multiLineScroll"
    | "eventColumnBounds"
    | "eventInset"
    | "verticalForLine"
    | "eventVertical"
    | "division"
  >;
};

/** Event hit rectangle, matching an element of `timeline.eventRects`. */
interface EventRect {
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  index: number;
  lineIndex?: number;
}

/** Localized display label for an event track type. */
function eventTypeLabel(type: string): string {
  if (type === NOISE_ACTIVE_EVENTS) {
    return t("editorPanels.linePanel.noiseActive");
  }
  const base = EVENT_TYPES.indexOf(type as (typeof EVENT_TYPES)[number]);
  if (base >= 0) {
    return trackLabels()[base] ?? type;
  }
  const special = SPECIAL_TRACKS.find((track) => track.key === type);
  return special ? specialTrackLabel(special) : type;
}

/** Pointer interaction for event bars: hit testing, selection, placement, and marquee drags. */
export class EventInteraction implements EventInteractionHandle {
  timeline: EventTimeline;
  canvas: HTMLCanvasElement;
  reportError: (error: unknown) => void;
  drag: TimelineEventDrag | null;
  pending: EventInteractionHandle["pending"];

  /** Bind the interaction to the event canvas and its error reporter. */
  constructor(timeline: EventTimeline, reportError: (error: unknown) => void) {
    this.timeline = timeline;
    this.canvas = timeline.eventsCanvas;
    this.reportError = reportError;
    this.drag = null;
    this.pending = null;
  }

  /** Event rectangles containing `point`, topmost first. */
  hits(point: TimelinePoint): EventRect[] {
    const session = this.timeline.getSession();
    const lineIndex = this.timeline.viewport.lineIndexAt(
      point.x,
      this.canvas.clientWidth,
      "events",
    );
    const rectangles = this.timeline.gestures.eventRectsForLine(lineIndex, session.multiLineActive);
    return rectangles
      .filter(
        (rectangle: EventRect) =>
          point.x >= rectangle.x &&
          point.x < rectangle.x + rectangle.width &&
          point.y >= rectangle.y &&
          point.y < rectangle.y + rectangle.height,
      )
      .reverse();
  }

  /** Topmost event rectangle under `point`. */
  hit(point: TimelinePoint): EventRect | undefined {
    return this.hits(point)[0];
  }

  /** Menu actions that select one event from an overlapping stack. */
  overlapActions(rectangles: readonly EventRect[]): OverlapMenuAction[] {
    const session = this.timeline.getSession();
    const before = session.selectionState();
    const lineIndex = this.timeline.viewport.lineIndexAt(
      rectangles[0] ? (rectangles[0].x + rectangles[0].width) / 2 : 0,
      this.canvas.clientWidth,
      "events",
    );
    return rectangles.map((rectangle) => {
      const targetLine = rectangle.lineIndex ?? lineIndex;
      const event = eventListAt(session, targetLine, rectangle.type, this.timeline.gestures.layer)[
        rectangle.index
      ];
      return {
        id: `event:${targetLine}:${rectangle.type}:${rectangle.index}`,
        label: `${eventTypeLabel(rectangle.type)}, ${
          session.chart.judgeLineList?.[targetLine]?.Name ??
          t("editorPanels.overlap.line", { index: targetLine })
        }`,
        detail: `${t("editorPanels.overlap.layer", {
          value: this.timeline.gestures.layer,
        })}, ${t("editorPanels.overlap.beat", {
          value: event ? `${formatBeat(event.startTime)} – ${formatBeat(event.endTime)}` : "—",
        })}, #${rectangle.index}`,
        run: () => {
          session.focus = "events";
          session.marqueeSelection = null;
          session.selectionMode = "single";
          session.lineIndex = targetLine;
          session.eventSelection = new Set([eventKey(rectangle.type, rectangle.index)]);
          session.multiEventSelection.clear();
          session.multiLineEnabled = false;
          session.multiLineIndices = [];
          session.normalizeMultiLine();
          session.selectionRevision += 1;
          session.recordSelection(undefined, before, true);
        },
      };
    });
  }
  /**
   * The drag displacement as a beat, for the commit path.
   *
   * Keeping the beat triple lets a snapped drag land on an exact division while
   * the canvas preview keeps converting the same displacement to pixels.
   */
  beatDelta(): Beat {
    return eventDragDelta(
      this.drag,
      this.timeline.viewport,
      this.timeline.viewport.factorForLine(
        this.drag?.lineIndex ?? this.timeline.getSession().lineIndex,
      ),
    );
  }

  /** The drag displacement as a number, for drawing. */
  delta(): number {
    return beatValue(this.beatDelta());
  }

  /** Arm placement of a new event, or commit it when placement is already pending. */
  place(type?: string | null, beat?: number, easingType?: number | null, inst = false): boolean {
    const session = this.timeline.getSession();
    if (!session.line) {
      return false;
    }
    const point = this.timeline.gestures.eventCursor;
    if (beat === undefined && !point) {
      return false;
    }
    const lineIndex = this.timeline.viewport.lineIndexAt(
      point?.x ?? 0,
      this.canvas.clientWidth,
      "events",
    );
    const panelWidth = this.timeline.viewport.panelWidth(this.canvas.clientWidth, "events");
    const eventInset = this.timeline.viewport.eventInset(panelWidth);
    const contentWidth = Math.max(1, panelWidth - eventInset * 2);
    const panelOffset =
      this.timeline.viewport.panelIndex(lineIndex, "events") *
        this.timeline.viewport.panelStride(this.canvas.clientWidth, "events") -
      this.timeline.viewport.multiLineViewportOffset(this.canvas.clientWidth, "events");
    const eventTypes = this.timeline.viewport.eventTypesForLine(lineIndex);
    const eventType =
      this.pending?.type ??
      type ??
      eventTypeAt(eventTypes, (point?.x ?? 0) - panelOffset - eventInset, contentWidth);
    if (!eventType || eventColumnForTrack(eventTypes, eventType) < 0) {
      return false;
    }
    const at =
      beat ?? (point ? this.timeline.viewport.eventBeatAt(point.y, eventType, true) : undefined);
    if (at === undefined) {
      return false;
    }
    session.focus = "events";
    session.selection.clear();
    if (!this.pending) {
      this.pending = { type: eventType, beat: at, lineIndex, inst };
      session.notify();
    } else {
      const result = placeEventAtTarget(session, {
        target: {
          lineIndex: this.pending.lineIndex ?? lineIndex,
          layer: session.eventLayer,
          eventType: this.pending.type,
          from: { beat: this.pending.beat, positionX: 0 },
          to: { beat: at, positionX: 0 },
        },
        payload: { easingType: easingType ?? undefined, instant: this.pending.inst },
      });
      if (result.status === "rejected") {
        const issue = result.issues?.[0];
        this.timeline.gestures.notify?.(
          issue === "event.overlap"
            ? t("editor.commands.eventCommands.error.overlap")
            : t("editor.commands.eventCommands.error.invalidTarget"),
          "error",
        );
        return false;
      }
      this.pending = null;
    }
    this.timeline.changed();
    return true;
  }

  /** Handle an event-field press: selection, marquee start, placement, or pan. */
  down(event: PointerEvent): void {
    if (![0, 1, 2].includes(event.button)) {
      return;
    }
    event.preventDefault?.();
    if (this.timeline.finishRectangle(event)) {
      return;
    }
    const session = this.timeline.getSession();
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey) {
      session.marqueeSelection = null;
    }
    if (event.button === 0) {
      session.selectionRevision += 1;
    }
    const point = this.timeline.viewport.point(event, this.canvas);
    const rectangle = this.hit(point);
    const sweepMode = timelineSweepMode(session, event, "events");
    if (
      sweepMode &&
      (event.button === 2 ||
        (sweepMode === "add" && !rectangle && !this.timeline.gestures.tool && !this.pending))
    ) {
      lockSweepArea(session, "events");
      const worldX =
        point.x + this.timeline.viewport.multiLineViewportOffset(this.canvas.clientWidth, "events");
      this.drag = {
        kind: "sweep",
        area: "events",
        button: event.button,
        remove: sweepMode === "remove",
        pointerId: event.pointerId,
        start: point,
        current: point,
        startWorldX: worldX,
        lastSweepPoint: point,
        lastSweepWorldX: worldX,
        sweepPoints: [point],
      };
      this.canvas.setPointerCapture(event.pointerId);
      session.notify();
      this.timeline.changed();
      return;
    }
    if (event.button === 2) {
      return;
    }
    if (event.ctrlKey || event.shiftKey || event.button === 1) {
      session.multiSelectionIntent = "events";
    } else {
      session.multiSelectionIntent = null;
    }
    this.timeline.gestures.eventCursor = point;
    this.timeline.gestures.hoverArea = "events";
    this.timeline.gestures.clipboardPointer = point;
    if (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !this.timeline.gestures.tool &&
      !this.pending
    ) {
      const overlapping = this.hits(point);
      if (overlapping.length > 1) {
        const canvas = this.canvas;
        const actions = this.overlapActions(overlapping);
        // Let the click that follows this press finish before the native
        // popover opens, otherwise light dismiss closes it immediately.
        canvas.addEventListener(
          "click",
          () => {
            openOverlapMenu(
              canvas,
              event.clientX,
              event.clientY,
              t("editor.overlap.title"),
              actions,
            );
          },
          { once: true },
        );
        return;
      }
    }
    const panelLineIndex =
      session.multiLineActive && session.multiLineMode === "events"
        ? this.timeline.viewport.lineIndexAt(point.x, this.canvas.clientWidth, "events")
        : session.lineIndex;
    if (
      event.button === 0 &&
      this.timeline.gestures.tool &&
      !rectangle &&
      !event.shiftKey &&
      !event.ctrlKey
    ) {
      try {
        this.place(null);
      } catch (error) {
        this.timeline.gestures.notify?.(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
      return;
    }
    if (this.pending) {
      try {
        this.place();
      } catch (error) {
        this.timeline.gestures.notify?.(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
      return;
    }
    session.focus = "events";
    if (!event.ctrlKey && !event.shiftKey && event.button !== 1) {
      session.selection.clear();
      if (session.multiLineActive && session.multiLineMode === "events") {
        session.multiEventSelection.clear();
      }
      if (!rectangle) {
        session.eventSelection.clear();
      }
      session.selectionMode = "none";
    }
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
    const multiMode = session.multiLineActive;
    const multiPanel = multiMode && this.timeline.viewport.panelCount("events") > 1;
    if (multiMode && (event.shiftKey || event.button === 1)) {
      const worldX =
        point.x + this.timeline.viewport.multiLineViewportOffset(this.canvas.clientWidth, "events");
      this.drag = {
        kind: "rectangle",
        area: "events",
        pointerId: event.pointerId,
        start: point,
        startWorldX: worldX,
        current: point,
        currentWorldX: worldX,
        startFactor: this.timeline.viewport.factorForLine(panelLineIndex),
        startSeconds:
          this.timeline.viewport.tempo.seconds(
            this.timeline.viewport.origin,
            this.timeline.viewport.factorForLine(panelLineIndex),
          ) +
          (this.timeline.viewport.viewHeight() - this.timeline.viewport.judgementOffset - point.y) /
            this.timeline.viewport.scaleForArea("events"),
        append: true,
        remove: event.altKey,
        historyKey: marqueeHistoryKey(session),
        ...captureEventBaseline(session, true),
      };
    } else if (multiPanel && !rectangle && !this.timeline.gestures.tool) {
      this.drag = {
        kind: "multi-pan",
        pointerId: event.pointerId,
        start: point,
        current: point,
      };
    } else if (!multiMode && (event.shiftKey || event.button === 1)) {
      this.drag = {
        kind: "rectangle",
        area: "events",
        pointerId: event.pointerId,
        start: point,
        startFactor: this.timeline.viewport.factorForLine(session.lineIndex),
        startSeconds:
          this.timeline.viewport.tempo.seconds(
            this.timeline.viewport.origin,
            this.timeline.viewport.factorForLine(session.lineIndex),
          ) +
          (this.timeline.viewport.viewHeight() - this.timeline.viewport.judgementOffset - point.y) /
            this.timeline.viewport.scaleForArea("events"),
        current: point,
        append: true,
        remove: event.altKey,
        historyKey: marqueeHistoryKey(session),
        ...captureEventBaseline(session, true),
      };
    } else if (rectangle && event.button === 0) {
      const key = eventKey(rectangle.type, rectangle.index);
      if (
        session.multiLineActive &&
        session.multiLineMode === "events" &&
        session.multiEventSelection
      ) {
        const selected = new Set<string>(
          session.multiEventSelection.get(rectangle.lineIndex ?? session.lineIndex) ?? [],
        );
        if (event.ctrlKey) {
          if (selected.has(key)) {
            selected.delete(key);
          } else {
            selected.add(key);
          }
        } else if (!selected.has(key)) {
          selected.clear();
          selected.add(key);
        }
        session.multiEventSelection.set(rectangle.lineIndex ?? session.lineIndex, selected);
        if (rectangle.lineIndex === session.lineIndex) {
          session.eventSelection = new Set(selected);
        }
      } else {
        if (event.ctrlKey) {
          if (session.eventSelection.has(key)) {
            session.eventSelection.delete(key);
          } else {
            session.eventSelection.add(key);
          }
        } else if (!session.eventSelection.has(key)) {
          session.eventSelection = new Set([key]);
        }
      }
      const hasSelection =
        session.eventSelection.size > 0 ||
        [...session.multiEventSelection.values()].some((selection) => selection.size > 0);
      session.selectionMode = !hasSelection ? "none" : event.ctrlKey ? "multi" : "single";
      // An event is selected here, never dragged: body, start, and end moves all
      // go through the batch shortcuts so a click cannot reshape it by accident.
    }
    session.notify();
  }

  /** Track the hover cursor and advance the active event drag. */
  move(event: PointerEvent): void {
    const point = this.timeline.viewport.point(event, this.canvas);
    this.timeline.gestures.eventCursor = point;
    this.timeline.gestures.clipboardPointer = point;
    this.timeline.gestures.hoverArea = "events";
    const drag = this.drag;
    if (drag?.kind === "multi-pan" && drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag) {
      const previous = drag.current;
      drag.current = point;
      drag.currentWorldX =
        point.x + this.timeline.viewport.multiLineViewportOffset(this.canvas.clientWidth, "events");
      if (drag.startFactor !== undefined) {
        drag.currentSeconds =
          this.timeline.viewport.tempo.seconds(this.timeline.viewport.origin, drag.startFactor) +
          (this.timeline.viewport.viewHeight() -
            (this.timeline.viewport.judgementOffset ?? 42) -
            drag.current.y) /
            this.timeline.viewport.scaleForArea("events");
      }
      if (drag.kind === "multi-pan") {
        const deltaX = point.x - previous.x;
        if (deltaX !== 0) {
          this.timeline.viewport.panMultiLine(this.canvas.clientWidth, deltaX, "events");
          this.timeline.changed();
        }
        return;
      }
      if (drag.kind === "sweep") {
        this.timeline.updateSweep(event);
        return;
      }
    }
    // Only a live gesture (a marquee or a multi-line pan) keeps the move cursor.
    // An event bar itself is a selection target, so it must not imply a drag.
    this.canvas.style.cursor = drag ? "move" : "default";
    this.timeline.changed();
  }

  /** Finish the active event drag and commit its selection or time shift. */
  up(event: PointerEvent): void {
    const current = this.drag;
    if (!current) {
      // A plain click on empty space asks the preview surface which line is
      // under the pointer.
      if (event.button === 0 && !this.hit(this.timeline.viewport.point(event, this.canvas))) {
        this.timeline.gestures.previewPick?.(event);
      }
      return;
    }
    if (current.kind === "multi-pan") {
      if (current.pointerId !== undefined && current.pointerId !== event.pointerId) {
        return;
      }
      this.drag = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.timeline.changed();
      return;
    }
    if (current.kind === "sweep") {
      if (!current.finished) {
        this.timeline.changed();
        return;
      }
      this.drag = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.timeline.changed();
      return;
    }
    current.current = this.timeline.viewport.point(event, this.canvas);
    current.currentWorldX =
      current.current.x +
      this.timeline.viewport.multiLineViewportOffset(this.canvas.clientWidth, "events");
    if (current.startFactor !== undefined) {
      current.currentSeconds =
        this.timeline.viewport.tempo.seconds(this.timeline.viewport.origin, current.startFactor) +
        (this.timeline.viewport.viewHeight() -
          (this.timeline.viewport.judgementOffset ?? 42) -
          current.current.y) /
          this.timeline.viewport.scaleForArea("events");
    }
    if (current.kind === "rectangle" && !current.finished) {
      this.timeline.changed();
      return;
    }
    const drag = current;
    const delta = this.beatDelta();
    this.drag = null;
    const session = this.timeline.getSession();
    try {
      if (drag.kind === "rectangle") {
        const [bottom, top] = this.timeline.rectangleTimes(drag);
        const left = Math.min(
          drag.startWorldX ?? drag.start.x,
          drag.currentWorldX ?? drag.current.x,
        );
        const right = Math.max(
          drag.startWorldX ?? drag.start.x,
          drag.currentWorldX ?? drag.current.x,
        );
        selectEventsInRectangle(
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
          {
            rectangles: this.timeline.gestures.eventRects,
            scroll: this.timeline.viewport.multiLineViewportOffset(
              this.canvas.clientWidth,
              "events",
            ),
            eventTypes: this.timeline.eventTypes,
            columnBounds: (channel) =>
              this.timeline.viewport.eventColumnBounds(channel, this.canvas.clientWidth),
            eventsInRange: (type, start, end) => {
              const session = this.timeline.getSession();
              return this.timeline.cache.eventEntries(
                session.chart,
                eventList(session, type),
                start,
                end,
                this.timeline.viewport.gridCount,
              );
            },
          },
        );
      } else if (
        compareBeats(delta, [0, 0, 1]) !== 0 &&
        Math.abs(drag.current.y - drag.start.y) > 5
      ) {
        shiftSelectedEvents(
          session,
          drag.kind,
          delta,
          drag.kind === "move"
            ? t("editorPanels.inspector.eventInteraction.move")
            : t("editorPanels.inspector.eventInteraction.resize"),
        );
      }
    } catch (error) {
      this.reportError(error);
    }
    this.timeline.changed();
  }

  /** Draw the pending event placement preview. */
  draw(context: CanvasRenderingContext2D, width: number): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    const session = this.timeline.getSession();
    const pendingLineIndex = pending.lineIndex ?? session.lineIndex;
    const eventTypes = this.timeline.viewport.eventTypesForLine(pendingLineIndex);
    const channel = eventColumnForTrack(eventTypes, pending.type);
    if (channel < 0) {
      return;
    }
    const cursorBeat = this.timeline.gestures.eventCursor
      ? this.timeline.viewport.eventBeatAt(this.timeline.gestures.eventCursor.y, pending.type, true)
      : pending.beat;
    // The endpoint may be earlier than the start. Order the two anchors here
    // so the preview and the committed event share one span.
    const startBeat = Math.min(pending.beat, cursorBeat);
    const endBeat = Math.max(pending.beat, cursorBeat);
    let valid = true;
    try {
      placedEvent(
        this.timeline.getSession(),
        pending.type,
        startBeat,
        endBeat,
        undefined,
        pending.lineIndex,
      );
    } catch {
      valid = false;
    }
    const lineIndex = pendingLineIndex;
    const vertical =
      session.multiLineActive && session.multiLineMode === "events"
        ? (beat: number) =>
            this.timeline.viewport.verticalForLine(beat, lineIndex, this.canvas.clientHeight)
        : (beat: number) => this.timeline.viewport.eventVertical(beat, pending.type);
    const top = Math.min(vertical(startBeat), vertical(endBeat));
    const height = Math.max(2, Math.abs(vertical(startBeat) - vertical(endBeat)));
    const panelWidth = this.timeline.viewport.panelWidth(width, "events");
    const panelOffset =
      this.timeline.viewport.panelIndex(lineIndex, "events") *
        this.timeline.viewport.panelStride(width, "events") -
      this.timeline.viewport.multiLineViewportOffset(width, "events");
    const column = eventColumnBounds(
      channel,
      panelWidth,
      eventTypes.length,
      this.timeline.viewport.eventBarWidth ?? 0.82,
      this.timeline.viewport.eventInset(panelWidth),
    );
    const barX = panelOffset + column.x;
    const palette = readCanvasPalette();
    context.fillStyle = valid ? palette.overlayValidFill : palette.overlayInvalidFill;
    context.strokeStyle = valid ? palette.overlayValidStroke : palette.overlayInvalidStroke;
    context.fillRect(barX, top, column.width, height);
    context.strokeRect(barX, top, column.width, height);
  }
}
