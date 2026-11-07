/**
 * Structural contract for the geometry helpers: the host fields and methods a timeline
 * exposes for pointer projection, panel layout, and scrolling.
 *
 * It keeps geometry testable without importing the `Timeline` class.
 */
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type {
  TimelinePanelLayout,
  TimelineScale,
} from "../../../../../../core/edit/timeline/timelineCoordinates.ts";
import type {
  MultiLineScroll,
  MultiLineZoom,
  TimelineArea,
  TimelineNote,
  TimelinePoint,
} from "../../../../../../core/edit/timeline/types.ts";
import type { TimelineGeometryModule } from "./timelineGeometry.ts";
import type { MultiLineScrollState } from "../multiLine/multiLineScrollBinding.ts";

/** Structural seam for geometry functions that need a viewport receiver. */
type TimelineViewportMethodSurface = {
  [K in keyof TimelineGeometryModule]: OmitThisParameter<TimelineGeometryModule[K]>;
};

export interface TimelineViewportReceiver extends TimelineViewportMethodSurface {
  notesCanvas: HTMLCanvasElement;
  eventsCanvas: HTMLCanvasElement;
  getSession: () => EditorSession;
  getTempo: () => TempoMap;
  multiLineScrollState: MultiLineScrollState;
  tempo: TempoMap;
  eventTypes: string[];
  noteScale: number;
  eventBarWidth: number | undefined;
  renderNoteScale: number;
  origin: number;
  scale: number;
  division: number;
  snapX: boolean;
  gridCount: number;
  originalPanelWidth: number;
  multiLineEventWindowCount: number;
  multiLineZoom: MultiLineZoom;
  multiLineScroll: number | MultiLineScroll;
  cameraX?: number;
  judgementOffset: number;
  panelLayout(area: TimelineArea): TimelinePanelLayout;
  scaleConfig(factor?: number): TimelineScale;
  factor: number;
  viewHeight(): number;
  isExclusive(): boolean;
  panelCount(area?: TimelineArea): number;
  panelIndex(lineIndex: number, area?: TimelineArea): number;
  panelWidth(width: number, area?: TimelineArea): number;
  panelGap(width: number, area?: TimelineArea): number;
  panelStride(width: number, area?: TimelineArea): number;
  visiblePanelRange(width: number, area?: TimelineArea): [number, number];
  multiLineViewportOffset(width: number, area?: TimelineArea): number;
  lineIndexAt(horizontal: number, width: number, area?: TimelineArea): number;
  noteInset(width: number): number;
  noteWidth(note: TimelineNote): number;
  noteHorizontal(position: number, lineIndex?: number): number;
  clampNoteHorizontal(
    horizontal: number,
    width: number,
    canvasWidth?: number,
    lineIndex?: number,
  ): number | null;
  point(event: PointerEvent, canvas?: HTMLCanvasElement): TimelinePoint;
  syncMultiLineChrome(area: TimelineArea, width: number): void;
  setMultiLineZoom(area: TimelineArea, zoom: number): void;
  getMultiLineZoom(area: TimelineArea): number;
  scaleForArea(area: TimelineArea): number;
}
