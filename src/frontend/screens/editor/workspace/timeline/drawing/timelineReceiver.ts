/**
 * Structural seam shared by the Timeline class and its drawing/interaction
 * satellite modules; the runtime supplies these fields to every method.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TimelineAppearance } from "./timelineAppearance.ts";
import type { TimelineCache } from "./timelineCache.ts";
import type { TimelineGestures } from "../interaction/timelineGestures.ts";
import type { TimelineViewport } from "../viewport/timelineViewport.ts";
import type { TimelineMethodSurface } from "./timelineMethods.ts";
import type { TimelineEventBatch } from "../events/timelineEventBatch.ts";
import type { NoteBatch } from "../../../canvas/noteBatch.ts";

/**
 * Structural seam shared by the Timeline class and its independently
 * importable drawing/interaction modules.
 *
 * The drawing and interaction methods arrive through `TimelineMethodSurface`,
 * which derives them from the satellite implementations themselves. Restating
 * them here would be a second copy of that surface, free to drift.
 */
export interface TimelineRuntimeSurface extends TimelineMethodSurface {
  readonly viewport: TimelineViewport;
  readonly gestures: TimelineGestures;
  readonly appearance: TimelineAppearance;
  readonly cache: TimelineCache;
  notesBackdrop: HTMLCanvasElement;
  notesPlayhead: HTMLCanvasElement;
  notesCanvas: HTMLCanvasElement;
  noteBatch: NoteBatch;
  eventsBackdrop: HTMLCanvasElement;
  eventsPlayhead: HTMLCanvasElement;
  eventsCanvas: HTMLCanvasElement;
  eventBatch: TimelineEventBatch;
  getSession: () => EditorSession;
  getPreviewSession(): EditorSession | null;
  /** Note ids another room member selected, drawn with the collaboration tint. */
  readonly remoteSelectedNoteIds: ReadonlySet<string>;
  /** Event ids another room member selected, drawn with the collaboration tint. */
  readonly remoteSelectedEventIds: ReadonlySet<string>;
  changed: () => void;
  eventTypes: string[];
}

/** The shared state needed by pointer-driven timeline gestures. */
export type TimelineGestureReceiver = Pick<
  TimelineRuntimeSurface,
  "gestures" | "viewport" | "changed"
>;

/** The drawing contract for the shared grid and multi-line grid labels. */
export type TimelineGridReceiver = Pick<
  TimelineRuntimeSurface,
  "appearance" | "cache" | "getSession" | "gridForLine" | "gestures" | "viewport"
>;

/** The contract used while resolving a rectangle selection. */
export type TimelineSelectionReceiver = Pick<
  TimelineRuntimeSurface,
  | "changed"
  | "cache"
  | "eventTypes"
  | "eventsCanvas"
  | "finishRectangle"
  | "getSession"
  | "gestures"
  | "notesCanvas"
  | "refreshIndex"
  | "rectangleSelection"
  | "sweepSelection"
  | "updateSweep"
  | "up"
  | "viewport"
>;

/** The note hit-test contract; it cannot see event drawing or placement commands. */
export type TimelineNoteHitTestReceiver = Pick<
  TimelineRuntimeSurface,
  "appearance" | "cache" | "getSession" | "notesCanvas" | "refreshIndex" | "visible" | "viewport"
>;

/** The note insertion contract used by keyboard/menu placement. */
export type TimelineNoteInsertionReceiver = Pick<
  TimelineRuntimeSurface,
  "changed" | "gestures" | "getSession" | "notesCanvas" | "viewport"
>;

/** The note pointer interaction contract. */
export type TimelineNoteInteractionReceiver = Pick<
  TimelineRuntimeSurface,
  | "addAtCursor"
  | "appearance"
  | "cache"
  | "changed"
  | "finishRectangle"
  | "gestures"
  | "getSession"
  | "hit"
  | "movedNote"
  | "notesCanvas"
  | "rectangleTimes"
  | "refreshIndex"
  | "updateSweep"
  | "viewport"
  | "visible"
>;

/** The note canvas drawing contract. */
export type TimelineNoteDrawingReceiver = Pick<
  TimelineRuntimeSurface,
  | "appearance"
  | "cache"
  | "drawCurveGhost"
  | "drawEvents"
  | "drawMultiLineBeatLabels"
  | "drawMultiLinePanelLabels"
  | "drawMultiLineGrid"
  | "drawMultiLineNotes"
  | "eventTypes"
  | "getSession"
  | "gestures"
  | "grid"
  | "movedNote"
  | "noteBatch"
  | "notesBackdrop"
  | "notesCanvas"
  | "remoteSelectedNoteIds"
  | "rectangleStart"
  | "viewport"
  | "visible"
>;

/** The minimal contract for rendering curve ghosts above notes. */
export type TimelineCurveGhostReceiver = Pick<
  TimelineRuntimeSurface,
  "appearance" | "cache" | "gestures" | "viewport"
>;

/** The lightweight moving overlay shared by notes and events timelines. */
export type TimelinePlayheadDrawingReceiver = Pick<
  TimelineRuntimeSurface,
  "drawMultiLineGrid" | "eventsPlayhead" | "getSession" | "grid" | "notesPlayhead" | "viewport"
>;

/** The event canvas drawing contract. */
export type TimelineEventDrawingReceiver = Pick<
  TimelineRuntimeSurface,
  | "appearance"
  | "cache"
  | "drawMultiLineBeatLabels"
  | "drawMultiLinePanelLabels"
  | "drawMultiLineEvents"
  | "drawMultiLineGrid"
  | "drawShaderEvents"
  | "drawTrajectoryEvent"
  | "eventTypes"
  | "eventBatch"
  | "eventsBackdrop"
  | "eventsCanvas"
  | "getSession"
  | "gestures"
  | "grid"
  | "rectangleStart"
  | "remoteSelectedEventIds"
  | "viewport"
>;

/** The event overlay contract, without event-canvas pointer interaction. */
export type TimelineEventOverlayReceiver = Pick<
  TimelineRuntimeSurface,
  "appearance" | "cache" | "getSession" | "gestures" | "remoteSelectedEventIds" | "viewport"
>;

/** The pending event preview contract: placement geometry plus the shared event-bar resources. */
export type TimelinePendingEventReceiver = Pick<
  TimelineRuntimeSurface,
  "appearance" | "eventBatch" | "getSession"
> & {
  readonly gestures: Pick<TimelineGestures, "eventCursor">;
  readonly viewport: Pick<
    TimelineViewport,
    | "eventBarWidth"
    | "eventBeatAt"
    | "eventInset"
    | "eventTypesForLine"
    | "eventVertical"
    | "multiLineViewportOffset"
    | "panelIndex"
    | "panelStride"
    | "panelWidth"
    | "verticalForLine"
    | "viewHeight"
  >;
};

/** The event-layer status contract used by the layer-button surface. */
export type TimelineLayerReceiver = Pick<
  TimelineRuntimeSurface,
  "cache" | "cancelPlacement" | "eventTypes" | "gestures" | "notesCanvas" | "viewport"
>;

/** The viewport-only contract used by the multi-line scroll control. */
export type TimelineScrollReceiver = Pick<TimelineRuntimeSurface, "viewport">;
