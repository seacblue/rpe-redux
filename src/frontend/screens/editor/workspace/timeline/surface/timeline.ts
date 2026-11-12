/**
 * Assembles the timeline editing engine from its viewport, gestures, cache,
 * appearance, canvas batches, and the method surface installed from satellite
 * modules.
 *
 * It owns wiring and the public seams; drawing, hit testing, selection, and chart
 * rules stay in their own modules.
 */
import { TimelineViewport } from "../viewport/timelineViewport.ts";
import { TimelineGestures } from "../interaction/timelineGestures.ts";
import { TimelineAppearance } from "../drawing/timelineAppearance.ts";
import { TimelineCache } from "../drawing/timelineCache.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { EventInteraction } from "../events/eventInteraction.ts";
import { TimelineEventBatch } from "../events/timelineEventBatch.ts";
import { NoteBatch } from "../../../canvas/noteBatch.ts";

import { eventColumnsForLine, visibleEventTypesForLine } from "../events/eventColumns.ts";

import {
  type TimelineBindingsState,
  type TimelineCanvasBindingSnapshot,
} from "./timelineBindings.ts";
import type { MultiLineScrollState } from "../multiLine/multiLineScrollBinding.ts";

import { timelineMethods } from "../drawing/timelineMethods.ts";
import type { TimelineRuntimeSurface } from "../drawing/timelineReceiver.ts";

/**
 * Timeline's public editing and drawing methods are supplied by the
 * independently testable satellite modules in `timelineMethods.ts`.
 */
export class Timeline {
  readonly viewport: TimelineViewport;
  readonly gestures: TimelineGestures;
  readonly appearance = new TimelineAppearance();
  readonly cache = new TimelineCache();
  /** The layer that draws the beat grid, playhead and lane separators. */
  notesBackdrop: HTMLCanvasElement;
  notesPlayhead: HTMLCanvasElement;
  notesCanvas: HTMLCanvasElement;
  readonly noteBatch: NoteBatch;
  /** The event field's own backdrop layer; see `notesBackdrop`. */
  eventsBackdrop: HTMLCanvasElement;
  eventsPlayhead: HTMLCanvasElement;
  eventsCanvas: HTMLCanvasElement;
  readonly eventBatch: TimelineEventBatch;
  /**
   * The document to draw and hit-test: the live session, or — while a bulk drag is in
   * progress — the proposal that drag would commit. Every drawing function, hit test and
   * overlay reads this, so there is one answer to "which chart is on screen" while a drag is
   * previewing. The proposal is published through `setPreview`; nothing mutates the live
   * session to fake one.
   */
  getSession: () => EditorSession;

  /**
   * Note ids selected by other room members, rendered with the collaboration tint.
   *
   * Presence owns the set; the timeline only reads it while drawing so remote
   * selection never enters document history.
   */
  remoteSelectedNoteIds: ReadonlySet<string> = new Set();

  /** Event ids selected by other room members, rendered with the collaboration tint. */
  remoteSelectedEventIds: ReadonlySet<string> = new Set();

  /** Replace the remote note-selection set and repaint when it changed. */
  setRemoteSelectedNoteIds(ids: ReadonlySet<string>): void {
    if (this.disposed) {
      this.remoteSelectedNoteIds = new Set();
      return;
    }
    const previous = this.remoteSelectedNoteIds;
    if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) {
      return;
    }
    this.remoteSelectedNoteIds = new Set(ids);
    this.changed();
  }

  /** Replace the remote event-selection set and repaint when it changed. */
  setRemoteSelectedEventIds(ids: ReadonlySet<string>): void {
    if (this.disposed) {
      this.remoteSelectedEventIds = new Set();
      return;
    }
    const previous = this.remoteSelectedEventIds;
    if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) {
      return;
    }
    this.remoteSelectedEventIds = new Set(ids);
    this.changed();
  }

  changed: () => void;

  /** The injected live session, kept apart so the preview cannot replace it. */
  private readonly liveSession: () => EditorSession;

  private readonly canvasBindings: TimelineCanvasBindingSnapshot;
  private readonly bindingState: TimelineBindingsState;
  private disposed = false;
  renderRevision = 0;

  /** Assemble the timeline engine over its canvases, session accessors, and bindings. */
  constructor(
    notesCanvas: HTMLCanvasElement,
    noteBatchCanvas: HTMLCanvasElement,
    eventsCanvas: HTMLCanvasElement,
    eventBatchCanvas: HTMLCanvasElement,
    getSession: () => EditorSession,
    getTempo: () => TempoMap,
    onEvent: (type: string, index: number, beat?: number) => void,
    changed: () => void,
    bindingState: TimelineBindingsState,
    multiLineScrollState: MultiLineScrollState,
    reportError: (error: unknown) => void = console.error,
    onContextMenu: (event: MouseEvent, canvas: HTMLCanvasElement) => void = () => {},
    notesBackdropCanvas: HTMLCanvasElement,
    eventsBackdropCanvas: HTMLCanvasElement,
    notesPlayheadCanvas: HTMLCanvasElement,
    eventsPlayheadCanvas: HTMLCanvasElement,
  ) {
    this.notesCanvas = notesCanvas;
    this.notesBackdrop = notesBackdropCanvas;
    this.notesPlayhead = notesPlayheadCanvas;
    this.noteBatch = new NoteBatch(noteBatchCanvas);
    this.eventsCanvas = eventsCanvas;
    this.eventsBackdrop = eventsBackdropCanvas;
    this.eventsPlayhead = eventsPlayheadCanvas;
    this.eventBatch = new TimelineEventBatch(eventBatchCanvas);
    this.liveSession = getSession;
    this.getSession = () => this.getPreviewSession() ?? this.liveSession();
    this.viewport = new TimelineViewport(
      notesCanvas,
      eventsCanvas,
      this.getSession,
      getTempo,
      (lineIndex) => {
        const session = this.getSession();
        return eventColumnsForLine(session, lineIndex ?? session.lineIndex, this.gestures.extended);
      },
      this.appearance,
      multiLineScrollState,
    );
    this.gestures = new TimelineGestures(new EventInteraction(this, reportError), () =>
      this.liveSession(),
    );
    this.gestures.onEvent = onEvent;
    this.changed = () => {
      this.renderRevision += 1;
      changed();
    };
    this.gestures.onContextMenu = onContextMenu;
    this.bindingState = bindingState;

    const canvasBindings = (canvas: HTMLCanvasElement) => ({
      wheel: (event: WheelEvent) => {
        if (this.disposed) {
          return false;
        }
        event.preventDefault();
        const changed = this.gestures.onWheel(event);
        if (changed) {
          this.changed();
        }
        return changed;
      },
      contextMenu: (event: MouseEvent) => {
        if (this.disposed) {
          return;
        }
        event.preventDefault();
        if (this.gestures.consumeContextMenuSuppression()) {
          return;
        }
        this.gestures.onContextMenu(event, canvas);
      },
    });
    const eventCanvasBindings = canvasBindings(eventsCanvas);
    this.canvasBindings = {
      notes: {
        ...canvasBindings(notesCanvas),
        pointerMove: (event) => {
          if (!this.disposed) {
            this.move(event);
          }
        },
        pointerLeave: () => {
          if (this.disposed) {
            return;
          }
          if (!this.gestures.drag) {
            this.gestures.cursor = null;
          }
          if (this.gestures.hoverArea === "notes") {
            this.gestures.hoverArea = undefined;
          }
          this.gestures.onNoteHover?.(null);
          this.changed();
        },
        pointerDown: (event) => {
          if (!this.disposed) {
            this.gestures.clearContextMenuSuppression();
            this.gestures.beginSelectionHistory(this.getSession());
            this.down(event);
          }
        },
        pointerUp: (event) => {
          if (!this.disposed) {
            this.up(event);
            this.gestures.finishSelectionHistory(this.getSession());
          }
        },
        pointerCancel: () => {
          if (this.disposed) {
            return;
          }
          this.gestures.drag = null;
          this.gestures.finishSelectionHistory(this.getSession());
          this.changed();
        },
      },
      events: {
        ...eventCanvasBindings,
        pointerDown: (event) => {
          if (!this.disposed) {
            this.gestures.clearContextMenuSuppression();
            this.gestures.beginSelectionHistory(this.getSession());
            this.gestures.eventInteraction.down(event);
          }
        },
        pointerMove: (event) => {
          if (!this.disposed) {
            this.gestures.eventInteraction.move(event);
          }
        },
        pointerUp: (event) => {
          if (!this.disposed) {
            this.gestures.eventInteraction.up(event);
            this.gestures.finishSelectionHistory(this.getSession());
          }
        },
        pointerCancel: () => {
          if (this.disposed) {
            return;
          }
          this.gestures.eventInteraction.drag = null;
          this.gestures.finishSelectionHistory(this.getSession());
          this.changed();
        },
        pointerLeave: () => {
          if (!this.disposed && !this.gestures.eventInteraction.drag) {
            this.gestures.eventCursor = null;
            if (this.gestures.hoverArea === "events") {
              this.gestures.hoverArea = undefined;
            }
            this.changed();
          }
        },
      },
    };
    bindingState.canvas.set(this.canvasBindings);
  }

  /** Release batches, caches, and the published canvas bindings. */
  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.noteBatch.dispose();
    this.eventBatch.dispose();
    this.gestures.resetDocument();
    if (this.bindingState.canvas.get() === this.canvasBindings) {
      this.bindingState.canvas.set(null);
    }
  }

  /** Drop preview, caches, viewport origin, and gestures for a new document. */
  resetDocument(): void {
    this.setPreview(null);
    this.cache.clear();
    this.viewport.reset();
    this.gestures.resetDocument();
    this.changed();
  }

  /** Reset transient routing and cached geometry when the visible timeline mode changes. */
  resetModeState(): void {
    this.gestures.resetModeState();
    this.cache.clear();
    this.viewport.resetModeState();
    this.changed();
  }

  /**
   * Publish (or clear) the proposal a bulk drag is showing.
   *
   * The session is real and self-contained, so callers can compare it by
   * identity. Passing `null` restores the live session as the drawing source.
   */
  setPreview(preview: EditorSession | null): void {
    this.gestures.preview = preview;
  }

  /**
   * Return the session currently proposed by a bulk drag, or null when the
   * timeline is live. Drawing and hit testing should use `getSession()`.
   */
  getPreviewSession(): EditorSession | null {
    return this.gestures.preview;
  }

  /** Selectable storage tracks for the active line and layer mode. */
  get eventTypes(): string[] {
    const session = this.getSession();
    return visibleEventTypesForLine(session, session.lineIndex, this.gestures.extended);
  }

  /** Painted display columns for the active line and layer mode. */
  get eventColumns(): string[] {
    const session = this.getSession();
    return eventColumnsForLine(session, session.lineIndex, this.gestures.extended);
  }
}

/** Satellite implementations remain visible on the public Timeline surface. */
export interface Timeline extends TimelineRuntimeSurface {}

Object.assign(Timeline.prototype, timelineMethods);
