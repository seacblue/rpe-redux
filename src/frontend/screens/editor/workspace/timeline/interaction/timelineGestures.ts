/**
 * Mutable gesture state for the timeline: active tool, cursor and hover
 * positions, drags, pending placement, clipboard targeting, event rectangles, and the
 * transient drag-preview session.
 *
 * It owns no behavior; the interaction modules read and advance these fields.
 * The active event layer and extended mode are derived from the live session, so
 * there is one layer authority and no second value to synchronize.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { SelectionState } from "../../../../../../core/edit/session/selectionHistory.ts";
import { EXTENDED_EVENT_LAYER } from "../drawing/tracks.ts";
import type {
  TimelinePoint,
  TimelineArea,
  TimelineDrag,
  TimelineNote,
  TimelineNoteEntry,
  TimelineEventRect,
  PendingHold,
} from "../../../../../../core/edit/timeline/types.ts";
import type { EventInteractionHandle } from "../drawing/canvas.ts";

const EMPTY_EVENT_RECTS: readonly TimelineEventRect[] = [];

/** The note or event row under the pointer in an open overlap picker. */
export interface TimelineOverlapHover {
  kind: "notes" | "events";
  lineIndex: number;
  index: number;
  /** Event track key; absent for notes. */
  eventType?: string;
}

/** Current editing mode and transient gestures; reset together when a document changes. */
export class TimelineGestures {
  readonly eventInteraction: EventInteractionHandle;
  tool = 0;
  cursor: TimelinePoint | null = null;
  eventCursor: TimelinePoint | null = null;
  drag: TimelineDrag | null = null;
  pendingHold: PendingHold | null = null;
  /**
   * The document a bulk drag is proposing, or null when no drag is previewing.
   *
   * A real `EditorSession` over the chart the drag would commit; its truthiness
   * means "a drag is previewing".
   */
  preview: EditorSession | null = null;
  clipboardPointer: TimelinePoint | null = null;
  hoverArea?: TimelineArea;
  cursorLineIndex?: number;
  previewMarquee: { start: TimelinePoint; current: TimelinePoint } | null = null;
  /** Apply the latest preview marquee sample at the workspace frame boundary. */
  previewRefresh?: () => void;
  /** Transient selection-colour highlight for the overlap picker's hovered row. */
  overlapHover: TimelineOverlapHover | null = null;
  /** True while the overlap picker is open; selection paint is suppressed. */
  overlapMenuOpen = false;
  eventRects: TimelineEventRect[] = [];
  eventPlacementType?: string;
  clipboardMode: { mirror?: boolean; keepTime?: boolean } = {};
  scaleAxis: number | null = null;
  scaleAxisLine: number | null = null;
  curvePick: ((note: TimelineNote, index: number, lineIndex: number) => unknown) | null = null;
  curvePickPoint?: ((beat: number, positionX: number) => unknown) | null;
  curveQuickPick: ((note: TimelineNote, index: number, lineIndex: number) => boolean) | null = null;
  curveGhost?: () => TimelineNote[];
  previewPick?: (event: PointerEvent) => unknown;
  previewCancel?: () => void;
  onDragScroll?: (seconds: number) => void;
  onWheel: (event: WheelEvent) => boolean = () => false;
  onNoteHover?: (entry: TimelineNoteEntry | null | undefined) => void;
  onEvent: (type: string, index: number, beat?: number) => void = () => {};
  onContextMenu: (event: MouseEvent, canvas: HTMLCanvasElement) => void = () => {};
  notify?: (message: string, level?: string) => void;
  private suppressContextMenu = false;

  private readonly getSession: () => EditorSession;
  private selectionHistoryBaseline: SelectionState | null = null;
  private selectionHistorySession: EditorSession | null = null;
  private selectionHistoryChart: EditorSession["chart"] | null = null;
  private eventRectIndexSource: TimelineEventRect[] | null = null;
  private readonly eventRectIndex = new Map<number, TimelineEventRect[]>();

  /** The active event layer; the live session is its only owner. */
  get layer(): number {
    return this.getSession().eventLayer;
  }
  set layer(value: number) {
    const session = this.getSession();
    if (session.eventLayer !== value) {
      session.eventLayer = value;
    }
  }

  /** True when the session layer selects the synthetic extended event map. */
  get extended(): boolean {
    return this.layer === EXTENDED_EVENT_LAYER;
  }

  /** Whether one note is the row the open overlap picker is hovering. */
  isNoteOverlapHovered(lineIndex: number, index: number): boolean {
    return (
      this.overlapHover?.kind === "notes" &&
      this.overlapHover.lineIndex === lineIndex &&
      this.overlapHover.index === index
    );
  }

  /** Whether one event is the row the open overlap picker is hovering. */
  isEventOverlapHovered(lineIndex: number, type: string, index: number): boolean {
    return (
      this.overlapHover?.kind === "events" &&
      this.overlapHover.lineIndex === lineIndex &&
      this.overlapHover.eventType === type &&
      this.overlapHover.index === index
    );
  }

  /** Return only the event rectangles in the panel under the pointer. */
  eventRectsForLine(lineIndex: number, multiLine: boolean): readonly TimelineEventRect[] {
    if (this.eventRectIndexSource !== this.eventRects) {
      this.eventRectIndexSource = this.eventRects;
      this.eventRectIndex.clear();
      for (const rectangle of this.eventRects) {
        const key = rectangle.lineIndex ?? -1;
        const bucket = this.eventRectIndex.get(key);
        if (bucket) {
          bucket.push(rectangle);
        } else {
          this.eventRectIndex.set(key, [rectangle]);
        }
      }
    }
    return this.eventRectIndex.get(multiLine ? lineIndex : -1) ?? EMPTY_EVENT_RECTS;
  }

  /** Create gestures around the active event-interaction handle and live session. */
  constructor(eventInteraction: EventInteractionHandle, getSession: () => EditorSession) {
    this.eventInteraction = eventInteraction;
    this.getSession = getSession;
  }

  /** Clear a previous drag's one-shot context-menu suppression before a new press. */
  clearContextMenuSuppression(): void {
    this.suppressContextMenu = false;
  }

  /** Suppress the context menu generated by the right-button sweep that just moved. */
  suppressNextContextMenu(): void {
    this.suppressContextMenu = true;
  }

  /** Consume and return the one-shot suppression state for the current context-menu event. */
  consumeContextMenuSuppression(): boolean {
    const suppressed = this.suppressContextMenu;
    this.suppressContextMenu = false;
    return suppressed;
  }

  /** Capture the selection baseline a drag will restore on commit. */
  beginSelectionHistory(session: EditorSession): void {
    this.selectionHistoryBaseline = session.selectionState();
    this.selectionHistorySession = session;
    this.selectionHistoryChart = session.chart;
  }

  /** Record one selection-history entry when the session and chart are unchanged. */
  finishSelectionHistory(session: EditorSession): void {
    const baseline = this.selectionHistoryBaseline;
    const trackedSession = this.selectionHistorySession;
    const trackedChart = this.selectionHistoryChart;
    this.selectionHistoryBaseline = null;
    this.selectionHistorySession = null;
    this.selectionHistoryChart = null;
    if (baseline && trackedSession === session && trackedChart === session.chart) {
      session.recordSelection(undefined, baseline);
    }
  }

  /**
   * Cancel only a pending selection gesture while preserving placement state.
   *
   * A Shift/Ctrl click without movement intentionally survives pointerup as the
   * first corner of a two-click marquee. An outside click must be able to drop
   * that corner without also cancelling a pending Hold or event placement.
   */
  cancelSelectionGesture(): boolean {
    const noteDrag = this.drag;
    const eventDrag = this.eventInteraction.drag;
    const hasSelectionGesture =
      noteDrag?.kind === "rectangle" ||
      noteDrag?.kind === "sweep" ||
      eventDrag?.kind === "rectangle" ||
      eventDrag?.kind === "sweep";
    if (!hasSelectionGesture) {
      return false;
    }
    if (noteDrag?.kind === "rectangle" || noteDrag?.kind === "sweep") {
      this.drag = null;
    }
    if (eventDrag?.kind === "rectangle" || eventDrag?.kind === "sweep") {
      this.eventInteraction.drag = null;
    }
    this.selectionHistoryBaseline = null;
    this.selectionHistorySession = null;
    this.selectionHistoryChart = null;
    this.suppressContextMenu = false;
    return true;
  }

  /** Drop pending placement, drags, and preview state. */
  cancelPlacement(): void {
    this.pendingHold = null;
    this.eventInteraction.pending = null;
    this.drag = null;
    this.eventInteraction.drag = null;
    this.previewCancel?.();
    this.previewMarquee = null;
    this.selectionHistoryBaseline = null;
    this.selectionHistorySession = null;
    this.selectionHistoryChart = null;
    this.suppressContextMenu = false;
  }

  /** Clear pointer routing state without resetting the selected document. */
  resetModeState(): void {
    this.cancelPlacement();
    this.cursor = null;
    this.eventCursor = null;
    this.clipboardPointer = null;
    this.hoverArea = undefined;
    this.cursorLineIndex = undefined;
    this.eventRects = [];
    this.eventRectIndexSource = null;
    this.eventRectIndex.clear();
  }

  /** Reset every gesture field that belongs to the previous document. */
  resetDocument(): void {
    this.cancelPlacement();
    this.getSession().eventLayer = 0;
    this.cursor = null;
    this.eventCursor = null;
    this.clipboardPointer = null;
    this.cursorLineIndex = undefined;
    this.eventRects = [];
    this.eventRectIndexSource = null;
    this.eventRectIndex.clear();
    this.preview = null;
    this.previewMarquee = null;
    this.previewCancel?.();
    this.previewCancel = undefined;
    this.scaleAxis = null;
    this.scaleAxisLine = null;
    this.clipboardMode = {};
    this.overlapHover = null;
    this.overlapMenuOpen = false;
  }
}
