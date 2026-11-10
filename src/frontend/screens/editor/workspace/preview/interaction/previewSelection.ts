/**
 * Preview-side pointer selection: hit testing, drag-select, and the selection
 * changes applied to the editor session. Preview owns only uncovered stage
 * clicks; timeline and preview geometry supply the hit areas.
 */
/* eslint-disable max-lines -- marquee sampling, time sweep, and pointer state share one gesture lifecycle. */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { SelectionState } from "../../../../../../core/edit/session/selectionHistory.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { drawMarqueeRectangle } from "../../timeline/selection/selectionOverlayDrawing.ts";
import type { Preview } from "../scene/preview.ts";
import type {
  HitTestNoteGeometry,
  HitTestPreviewGeometry,
} from "../../../../../../core/edit/hitTest/api.ts";
import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import { holdUsefulInterval as getHoldUsefulInterval } from "../../../canvas/noteGeometry.ts";
import { distanceSquaredToSegment, previewNoteGrid } from "./previewSpatialIndex.ts";
import { previewNoteContains } from "./previewHitGeometry.ts";
import { t } from "../../../../../../i18n/index.ts";
import { formatBeat } from "../../../../../../core/global/chart/timing/beat.ts";
import {
  openOverlapMenu,
  type OverlapMenuAction,
} from "../../../../../overlays/overlap/overlapMenu.ts";
import { applySelection, cloneSelection } from "./previewNoteSelection.ts";
import { previewPointerMoved } from "./previewSelectionPolicy.ts";

/** A CSS-pixel point in the preview canvas. */
export interface PreviewPoint {
  x: number;
  y: number;
}

/** Preview owns only uncovered stage clicks; timeline canvases are a hard input boundary. */
export function previewOwnsPointer(target: EventTarget | null, stage: HTMLElement): boolean {
  if (target === stage) {
    return true;
  }
  // With both authoring regions hidden the stage's editor layer has no
  // interactive canvas left above the preview, so it becomes the preview
  // surface. A visible timeline canvas never matches this branch.
  const element = target as HTMLElement | null;
  return element?.classList?.contains("editor") === true && stage.contains(element);
}

type Point = PreviewPoint;

/** The hold's head-to-tail anchor span used by picking. */
export function holdUsefulInterval(area: HitTestNoteGeometry): {
  head: Point;
  tail: Point;
} {
  return getHoldUsefulInterval(area);
}

/** Live marquee and click state for one pointer sequence. */
interface PreviewSelectionGesture {
  pointerId: number;
  start: Point;
  current: Point;
  baseline: Map<number, Set<number>>;
  baselineState: SelectionState;
  append: boolean;
  remove: boolean;
  moved: boolean;
  /** Cheap key for the last applied rectangle/history state. */
  lastKey?: string;
  /** History stack signature when the gesture or its baseline was captured. */
  historyKey?: string;
  /** Notes seen inside the rectangle while playback advanced. */
  swept: Map<number, Set<number>>;
  /** Hits sampled at the current preview time, held until time advances. */
  pendingHits: Map<number, Set<number>>;
  /** Last preview time whose geometry was sampled. */
  sweptSeconds?: number;
  /** Preview time when the first corner was placed. */
  startSeconds?: number;
  /** Preview time at the latest sampled frame. */
  endSeconds?: number;
}

/** Collaborators the preview selection binding needs from the editor. */
interface PreviewSelectionBindingOptions {
  stage: HTMLElement;
  preview: Preview;
  timeline: Timeline;
  getSession(): EditorSession;
  /** Preview owns pointer selection only when no authoring canvas is visible above it. */
  canSelectPreview?(): boolean;
  scope: ResourceScope;
}

/** Whether two points are within `tolerance` pixels of each other. */
function samePoint(left: Point, right: Point, tolerance = 8): boolean {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy <= tolerance * tolerance;
}

/** Converts a pointer event into canvas-local CSS pixels. */
function localPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

/** Cheap identity for undo/redo while a marquee is open. */
function historyKey(session: EditorSession): string {
  const entries = session.history.entries();
  return `${entries.undo.length}:${entries.redo.length}:${session.chart.judgeLineList?.length ?? 0}`;
}

/** One scratch array per gesture keeps pointer moves allocation-light. */
const queryScratch: HitTestNoteGeometry[] = [];

/** The session's note selection as a fresh map for preview rendering. */
export function selectionMapForSession(session: EditorSession): Map<number, Set<number>> {
  return cloneSelection(session);
}

/** Whether `point` lies inside the inclusive rectangle. */
function pointInRectangle(point: Point, left: number, right: number, top: number, bottom: number) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

/** Whether a segment overlaps the rectangle, including fully contained ends. */
function segmentIntersectsRectangle(
  start: Point,
  end: Point,
  left: number,
  right: number,
  top: number,
  bottom: number,
): boolean {
  if (pointInRectangle(start, left, right, top, bottom)) {
    return true;
  }
  if (pointInRectangle(end, left, right, top, bottom)) {
    return true;
  }
  const edges: [Point, Point][] = [
    [
      { x: left, y: top },
      { x: right, y: top },
    ],
    [
      { x: right, y: top },
      { x: right, y: bottom },
    ],
    [
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    [
      { x: left, y: bottom },
      { x: left, y: top },
    ],
  ];
  return edges.some(
    ([edgeStart, edgeEnd]) => segmentDistanceSquared(start, end, edgeStart, edgeEnd) === 0,
  );
}

/** Squared distance between two segments; zero when they intersect. */
function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (denominator === 0) {
    return Math.min(
      distanceSquaredToSegment(a, c, d),
      distanceSquaredToSegment(b, c, d),
      distanceSquaredToSegment(c, a, b),
      distanceSquaredToSegment(d, a, b),
    );
  }
  const first = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const second = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  return first >= 0 && first <= 1 && second >= 0 && second <= 1 ? 0 : Infinity;
}

/** Whether a note's painted area intersects the drag rectangle. */
export function previewRectangleHits(
  area: HitTestNoteGeometry,
  start: Point,
  current: Point,
): boolean {
  const left = Math.min(start.x, current.x);
  const right = Math.max(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const bottom = Math.max(start.y, current.y);
  if (area.kind !== "hold") {
    return pointInRectangle(area.head, left, right, top, bottom);
  }
  const interval = holdUsefulInterval(area);
  return segmentIntersectsRectangle(interval.head, interval.tail, left, right, top, bottom);
}

/** Adds every entry of `source` into `target`, creating line sets as needed. */
function mergeNoteMap(
  target: Map<number, Set<number>>,
  source: ReadonlyMap<number, ReadonlySet<number>>,
): void {
  for (const [lineIndex, indices] of source) {
    let selected = target.get(lineIndex);
    if (!selected) {
      selected = new Set();
      target.set(lineIndex, selected);
    }
    for (const index of indices) {
      selected.add(index);
    }
  }
}

/** Samples the notes inside the gesture rectangle at the painted preview time. */
function sampleRectangle(
  active: PreviewSelectionGesture,
  geometry: HitTestPreviewGeometry,
): Map<number, Set<number>> {
  const hits = new Map<number, Set<number>>();
  const left = Math.min(active.start.x, active.current.x);
  const right = Math.max(active.start.x, active.current.x);
  const top = Math.min(active.start.y, active.current.y);
  const bottom = Math.max(active.start.y, active.current.y);
  for (const area of previewNoteGrid(geometry).queryBounds(
    { left, right, top, bottom },
    queryScratch,
  )) {
    if (area.noteIndex === undefined || !previewRectangleHits(area, active.start, active.current)) {
      continue;
    }
    let selected = hits.get(area.lineIndex);
    if (!selected) {
      selected = new Set();
      hits.set(area.lineIndex, selected);
    }
    selected.add(area.noteIndex);
  }
  return hits;
}

/**
 * Fold one painted preview frame into the gesture's swept volume.
 *
 * A preview marquee records a screen rectangle and the time during which it is
 * alive. Sampling the already-painted frame keeps the cost proportional to the
 * notes under the rectangle; it never renders another preview frame.
 */
function accumulateSwept(active: PreviewSelectionGesture, geometry: HitTestPreviewGeometry): void {
  active.endSeconds = geometry.seconds;
  if (active.sweptSeconds === geometry.seconds) {
    // The rectangle may have changed while paused. Keep the sample current but
    // do not promote it into the swept volume until playback advances.
    active.pendingHits = sampleRectangle(active, geometry);
    return;
  }
  if (active.sweptSeconds === undefined) {
    active.sweptSeconds = geometry.seconds;
    active.pendingHits = sampleRectangle(active, geometry);
    return;
  }
  // Include the previous time before moving the window; that is what makes the
  // first corner's frame part of the selected time range.
  mergeNoteMap(active.swept, active.pendingHits);
  active.sweptSeconds = geometry.seconds;
  active.pendingHits = sampleRectangle(active, geometry);
}

/** Builds the selection this gesture paints, merging its swept hits with the rectangle. */
function selectionFromGesture(
  preview: Preview,
  gesture: PreviewSelectionGesture,
): Map<number, Set<number>> {
  const next = gesture.append || gesture.remove ? cloneMap(gesture.baseline) : new Map();
  if (gesture.remove) {
    for (const [lineIndex, indices] of gesture.swept) {
      const selected = next.get(lineIndex);
      if (!selected) {
        continue;
      }
      for (const index of indices) {
        selected.delete(index);
      }
      if (!selected.size) {
        next.delete(lineIndex);
      }
    }
  } else {
    mergeNoteMap(next, gesture.swept);
  }
  const geometry = preview.getCollisionGeometry();
  if (!geometry) {
    return next;
  }
  const left = Math.min(gesture.start.x, gesture.current.x);
  const right = Math.max(gesture.start.x, gesture.current.x);
  const top = Math.min(gesture.start.y, gesture.current.y);
  const bottom = Math.max(gesture.start.y, gesture.current.y);
  const candidates = previewNoteGrid(geometry).queryBounds(
    { left, right, top, bottom },
    queryScratch,
  );
  const currentHits = new Map<number, Set<number>>();
  for (const area of candidates) {
    if (
      !previewRectangleHits(area, gesture.start, gesture.current) ||
      area.noteIndex === undefined
    ) {
      continue;
    }
    const selected = next.get(area.lineIndex) ?? new Set<number>();
    if (gesture.remove) {
      selected.delete(area.noteIndex);
    } else {
      selected.add(area.noteIndex);
    }
    if (selected.size) {
      next.set(area.lineIndex, selected);
    } else {
      next.delete(area.lineIndex);
    }
    if (!gesture.remove) {
      let hits = currentHits.get(area.lineIndex);
      if (!hits) {
        hits = new Set();
        currentHits.set(area.lineIndex, hits);
      }
      hits.add(area.noteIndex);
    }
  }
  // While paused, the latest rectangle sample is what a later seek must sweep.
  // Updating it here keeps that promise without building a second spatial query.
  if (gesture.sweptSeconds === geometry.seconds) {
    gesture.pendingHits = currentHits;
  }
  return next;
}

/** Builds the selection for a single click at `point`. */
function selectionAtPoint(
  preview: Preview,
  point: Point,
  gesture: PreviewSelectionGesture,
): Map<number, Set<number>> {
  const next = gesture.append || gesture.remove ? cloneMap(gesture.baseline) : new Map();
  const hit = noteAtPoint(preview, point);
  if (!hit || hit.noteIndex === undefined) {
    return gesture.append || gesture.remove ? next : new Map();
  }
  const selected = next.get(hit.lineIndex) ?? new Set<number>();
  if (gesture.remove) {
    selected.delete(hit.noteIndex);
  } else {
    selected.add(hit.noteIndex);
  }
  if (selected.size) {
    next.set(hit.lineIndex, selected);
  } else {
    next.delete(hit.lineIndex);
  }
  return next;
}

/** Notes whose hit radius reaches `point`, nearest first and holds last. */
function noteCandidates(preview: Preview, point: Point): HitTestNoteGeometry[] {
  const geometry = preview.getCollisionGeometry();
  return (geometry ? previewNoteGrid(geometry).queryPoint(point) : [])
    .filter(
      (area) =>
        area.noteIndex !== undefined &&
        distanceSquaredToSegment(
          point,
          area.kind === "hold" ? holdUsefulInterval(area).head : area.head,
          area.kind === "hold" ? holdUsefulInterval(area).tail : area.tail,
        ) <=
          area.radius * area.radius,
    )
    .sort(
      (left, right) =>
        Number(left.kind === "hold") - Number(right.kind === "hold") ||
        Math.abs(left.head.x - point.x) - Math.abs(right.head.x - point.x),
    );
}

/** The note painted under `point`, preferring an exact painted hit. */
function noteAtPoint(preview: Preview, point: Point): HitTestNoteGeometry | null {
  const candidates = noteCandidates(preview, point);
  return (
    candidates.find((candidate) => previewNoteContains(candidate, point)) ?? candidates[0] ?? null
  );
}

/** Localised display name for a note type, used by the overlap menu. */
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

/** Builds "select this note" entries for the overlap menu. */
function noteMenuActions(
  preview: Preview,
  session: EditorSession,
  candidates: readonly HitTestNoteGeometry[],
): OverlapMenuAction[] {
  const chart = preview.chart;
  return candidates.map((candidate) => {
    const line = chart?.judgeLineList?.[candidate.lineIndex];
    const note = line?.notes?.[candidate.noteIndex ?? -1];
    const type = noteTypeLabel(note?.type);
    const start = note ? formatBeat(note.startTime) : "—";
    const end = note?.type === 2 ? ` – ${formatBeat(note.endTime)}` : "";
    const position = note ? Number(note.positionX).toFixed(2) : "—";
    return {
      id: `note:${candidate.lineIndex}:${candidate.noteIndex ?? -1}`,
      label: `${type}, ${
        line?.Name ?? t("editorPanels.overlap.line", { index: candidate.lineIndex })
      }`,
      detail: `${t("editorPanels.overlap.beat", {
        value: `${start}${end}`,
      })}, X ${position}, #${candidate.noteIndex ?? -1}`,
      run: () => {
        const before = session.selectionState();
        applySelection(
          session,
          new Map([[candidate.lineIndex, new Set([candidate.noteIndex ?? -1])]]),
          false,
        );
        session.selectionRevision += 1;
        session.recordSelection(undefined, before, true);
      },
    };
  });
}

/** Builds "select this line" entries for the overlap menu. */
function lineMenuActions(
  preview: Preview,
  session: EditorSession,
  candidates: readonly number[],
): OverlapMenuAction[] {
  const chart = preview.chart;
  const before = session.selectionState();
  return candidates.map((lineIndex) => {
    const line = chart?.judgeLineList?.[lineIndex];
    return {
      id: `line:${lineIndex}`,
      label: line?.Name ?? t("editorPanels.overlap.line", { index: lineIndex }),
      detail: `${t("editorPanels.overlap.line", { index: lineIndex })}, ${line?.Group ?? 0}`,
      run: () => {
        session.selectLine(lineIndex);
        session.recordSelection(undefined, before, true);
      },
    };
  });
}

/** Deep-copies a line-indexed note selection. */
function cloneMap(source: Map<number, Set<number>>): Map<number, Set<number>> {
  return new Map([...source].map(([lineIndex, indices]) => [lineIndex, new Set(indices)]));
}

/** Line indices whose painted quad is within 12 px of `point`, or on it when `precise`. */
function lineCandidates(preview: Preview, point: Point, precise = false): number[] {
  const geometry = preview.getCollisionGeometry();
  return (geometry?.lines ?? [])
    .map((line) => ({
      lineIndex: line.lineIndex,
      distanceSquared:
        line.corners.length >= 3 ? lineDistanceSquared(point, line.corners) : Infinity,
    }))
    .filter(({ distanceSquared }) => distanceSquared <= (precise ? 0 : 12 * 12))
    .sort((left, right) => left.lineIndex - right.lineIndex)
    .map(({ lineIndex }) => lineIndex);
}

/** Distance from `point` to a line quad; zero when the point is inside it. */
function lineDistanceSquared(point: Point, corners: readonly Point[]): number {
  let inside = false;
  let distance = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index];
    const end = corners[(index + 1) % corners.length];
    distance = Math.min(distance, distanceSquaredToSegment(point, start, end));
    if (start.y > point.y !== end.y > point.y) {
      const crossing = ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
      if (point.x < crossing) {
        inside = !inside;
      }
    }
  }
  return inside ? 0 : distance;
}

/** One repeated click on overlapping lines: where and which candidate is current. */
export interface PreviewLineCycle {
  point: Point;
  candidates: readonly number[];
  index: number;
}

/** Advances the line pick at a repeated click, wrapping to the first candidate. */
export function cyclePreviewLine(
  candidates: readonly number[],
  point: Point,
  previous: PreviewLineCycle | null,
): PreviewLineCycle | null {
  if (!candidates.length) {
    return null;
  }
  const sameCandidates =
    previous &&
    samePoint(previous.point, point) &&
    previous.candidates.length === candidates.length &&
    previous.candidates.every((candidate, index) => candidate === candidates[index]);
  const index = sameCandidates ? (previous.index + 1) % candidates.length : 0;
  return { point, candidates: [...candidates], index };
}

/**
 * Binds preview pointer selection for one stage.
 *
 * Returns a disposer that removes the listeners and clears any gesture in
 * flight. Drag and shift-click gestures write note selections into the session.
 */
export function bindPreviewSelection(options: PreviewSelectionBindingOptions): () => void {
  let gesture: PreviewSelectionGesture | null = null;
  /** The first Shift/Ctrl click waits here for the second click. */
  let clickMarquee: PreviewSelectionGesture | null = null;
  let lastLineCycle: PreviewLineCycle | null = null;
  let geometryDispose: (() => void) | null = null;

  const liveGesture = (): PreviewSelectionGesture | null => gesture ?? clickMarquee;

  const marqueeKey = (active: PreviewSelectionGesture): string =>
    `${active.current.x.toFixed(3)}:${active.current.y.toFixed(3)}:${active.historyKey ?? ""}:${active.sweptSeconds ?? ""}`;

  /** Republishes the live rectangle when its key or the document history moved. */
  const refreshLive = (): void => {
    const active = liveGesture();
    if (!active) {
      return;
    }
    const session = options.getSession();
    const history = historyKey(session);
    if (active.historyKey !== history) {
      active.historyKey = history;
      // A chart/undo change invalidates everything captured for the previous
      // document. Rebuild from the live rectangle only.
      active.baseline.clear();
      active.swept.clear();
      active.pendingHits.clear();
      active.append = false;
      active.remove = false;
      active.sweptSeconds = undefined;
      active.lastKey = undefined;
    }
    const key = marqueeKey(active);
    if (key === active.lastKey) {
      return;
    }
    active.lastKey = key;
    applySelection(session, selectionFromGesture(options.preview, active), true, true);
  };

  /** Subscribes to painted geometry so playback sweeps extend the gesture. */
  const startGeometryObserver = (): void => {
    if (geometryDispose) {
      return;
    }
    geometryDispose = options.preview.observeGeometry((geometry) => {
      const active = liveGesture();
      if (!active || !geometry) {
        return;
      }
      accumulateSwept(active, geometry);
    });
  };

  /** Releases the geometry subscription while keeping the gesture data. */
  const stopGeometryObserver = (): void => {
    geometryDispose?.();
    geometryDispose = null;
  };

  /** Applies a finished gesture and records it as one undo step. */
  const commit = (active: PreviewSelectionGesture): void => {
    const session = options.getSession();
    applySelection(session, selectionFromGesture(options.preview, active), false, true);
    session.recordSelection(undefined, active.baselineState);
    clickMarquee = null;
    options.timeline.gestures.previewMarquee = null;
    stopGeometryObserver();
    options.timeline.changed();
  };

  /** Ends the active drag: commits a marquee, arms a shift-click, or picks a note or line. */
  const finish = (event: PointerEvent): void => {
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    const active = gesture;
    gesture = null;
    if (options.stage.hasPointerCapture(active.pointerId)) {
      options.stage.releasePointerCapture(active.pointerId);
    }
    if (active.moved) {
      commit(active);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (active.append) {
      // Shift/Ctrl click is the first corner. Keep the rectangle alive until
      // the second click, without requiring the button to stay down.
      clickMarquee = active;
      active.lastKey = undefined;
      active.historyKey = historyKey(options.getSession());
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    options.timeline.gestures.previewMarquee = null;
    stopGeometryObserver();
    const point = active.start;
    const session = options.getSession();
    const notes = noteCandidates(options.preview, point);
    const exactNotes = notes.filter((note) => previewNoteContains(note, point));
    if (exactNotes.length > 1) {
      openOverlapMenu(
        options.stage,
        event.clientX,
        event.clientY,
        t("editor.overlap.title"),
        noteMenuActions(options.preview, session, exactNotes),
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const lines = lineCandidates(options.preview, point);
    const exactLines = lineCandidates(options.preview, point, true);
    if (!notes.length && exactLines.length > 1) {
      openOverlapMenu(
        options.stage,
        event.clientX,
        event.clientY,
        t("editor.overlap.title"),
        lineMenuActions(options.preview, session, exactLines),
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!notes.length && lines.length) {
      pick(event, active.baselineState);
      return;
    }
    // The click finishes a pointer selection even when the selection itself is
    // unchanged; routing uses this marker to leave an open curve pane.
    session.selectionRevision += 1;
    applySelection(session, selectionAtPoint(options.preview, point, active), false);
    session.recordSelection(undefined, active.baselineState);
    event.preventDefault();
    event.stopPropagation();
    options.timeline.changed();
  };

  /** Starts a marquee or shift-click gesture on the stage. */
  const onDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (
      pointer.button !== 0 ||
      !options.preview.visible ||
      (options.canSelectPreview && !options.canSelectPreview())
    ) {
      return;
    }
    // Preview is an underlay. Only a pointer whose hit target is the stage
    // itself may start a preview gesture; every element above it owns the
    // event and must not leak through to preview selection.
    if (!previewOwnsPointer(pointer.target, options.stage)) {
      return;
    }
    const point = localPoint(pointer, options.preview.canvas);
    const geometry = options.preview.getCollisionGeometry();
    if (
      !geometry ||
      !pointInRectangle(
        point,
        geometry.viewport.left,
        geometry.viewport.left + geometry.viewport.width,
        geometry.viewport.top,
        geometry.viewport.top + geometry.viewport.height,
      )
    ) {
      return;
    }
    if (clickMarquee) {
      // The second click completes the first corner's rectangle.
      clickMarquee.current = point;
      clickMarquee.lastKey = undefined;
      commit(clickMarquee);
      pointer.preventDefault();
      pointer.stopPropagation();
      return;
    }
    const session = options.getSession();
    gesture = {
      pointerId: pointer.pointerId,
      start: point,
      current: point,
      baseline: cloneSelection(session),
      baselineState: session.selectionState(),
      append: pointer.shiftKey || pointer.ctrlKey,
      remove: pointer.altKey,
      moved: false,
      historyKey: historyKey(session),
      swept: new Map(),
      pendingHits: new Map(),
      startSeconds: geometry.seconds,
      endSeconds: geometry.seconds,
    };
    startGeometryObserver();
    // Keep the gesture alive when the pointer crosses the preview edge. This
    // also makes the initial drag threshold reliable on dense overlay stacks.
    options.stage.setPointerCapture(pointer.pointerId);
    options.timeline.gestures.previewMarquee = { start: point, current: point };
    pointer.preventDefault();
    pointer.stopPropagation();
    options.timeline.changed();
  };

  /** Tracks the pointer for an active drag or a waiting first corner. */
  const onMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (!gesture || gesture.pointerId !== pointer.pointerId) {
      if (!clickMarquee) {
        return;
      }
      const point = localPoint(pointer, options.preview.canvas);
      clickMarquee.current = point;
      options.timeline.gestures.previewMarquee = { start: clickMarquee.start, current: point };
      pointer.preventDefault();
      pointer.stopPropagation();
      options.timeline.changed();
      return;
    }
    const point = localPoint(pointer, options.preview.canvas);
    gesture.current = point;
    gesture.moved = gesture.moved || previewPointerMoved(gesture.start, point);
    options.timeline.gestures.previewMarquee = { start: gesture.start, current: point };
    pointer.preventDefault();
    pointer.stopPropagation();
    options.timeline.changed();
  };

  /** Finishes or cancels the gesture for the released pointer. */
  const onUp = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.type === "pointercancel") {
      if (clickMarquee) {
        clickMarquee = null;
        options.timeline.gestures.previewMarquee = null;
        options.timeline.changed();
      }
    }
    if (gesture && gesture.pointerId === pointer.pointerId) {
      finish(pointer);
      return;
    }
  };

  /** A click outside preview abandons a waiting first corner. */
  const onOutsideDown = (event: Event): void => {
    if (!clickMarquee) {
      return;
    }
    if (previewOwnsPointer(event.target, options.stage)) {
      return;
    }
    clickMarquee = null;
    stopGeometryObserver();
    options.timeline.gestures.previewMarquee = null;
    options.timeline.changed();
  };

  /** Selects the line under a click, cycling through overlapping candidates. */
  const pick = (event: PointerEvent, beforeSelection?: SelectionState): boolean => {
    if (!options.preview.visible || (options.canSelectPreview && !options.canSelectPreview())) {
      return false;
    }
    const point = localPoint(event, options.preview.canvas);
    const candidates = lineCandidates(options.preview, point);
    if (!candidates.length) {
      return false;
    }
    const nextCycle = cyclePreviewLine(candidates, point, lastLineCycle);
    if (!nextCycle) {
      return false;
    }
    lastLineCycle = nextCycle;
    const session = options.getSession();
    const before = beforeSelection ?? session.selectionState();
    session.selectLine(candidates[nextCycle.index]);
    session.recordSelection(t("editor.session.selectionChanged"), before, false);
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  options.timeline.gestures.previewPick = pick;
  /** Re-applies the live rectangle when the timeline requests a preview refresh. */
  const refreshPreviewMarquee = () => {
    if (clickMarquee || gesture?.moved) {
      refreshLive();
    }
  };
  options.timeline.gestures.previewRefresh = refreshPreviewMarquee;
  /** Abandons any gesture and clears the timeline's marquee preview. */
  const cancelPreview = () => {
    if (gesture && options.stage.hasPointerCapture(gesture.pointerId)) {
      options.stage.releasePointerCapture(gesture.pointerId);
    }
    gesture = null;
    clickMarquee = null;
    stopGeometryObserver();
    options.timeline.gestures.previewMarquee = null;
  };
  options.timeline.gestures.previewCancel = cancelPreview;
  options.scope.listen(options.stage, "pointerdown", onDown, true);
  options.scope.listen(window, "pointerdown", onOutsideDown, true);
  options.scope.listen(window, "pointermove", onMove, true);
  options.scope.listen(window, "pointerup", onUp, true);
  options.scope.listen(window, "pointercancel", onUp, true);
  return () => {
    if (options.timeline.gestures.previewPick === pick) {
      options.timeline.gestures.previewPick = undefined;
    }
    if (options.timeline.gestures.previewCancel === cancelPreview) {
      options.timeline.gestures.previewCancel = undefined;
    }
    if (options.timeline.gestures.previewRefresh === refreshPreviewMarquee) {
      options.timeline.gestures.previewRefresh = undefined;
    }
    stopGeometryObserver();
    options.timeline.gestures.previewMarquee = null;
    gesture = null;
    clickMarquee = null;
  };
}

/** Draws the dashed drag rectangle in canvas-local coordinates. */
export function drawPreviewMarquee(
  context: CanvasRenderingContext2D,
  start: Point,
  current: Point,
): void {
  const origin = { left: 0, top: 0 };
  drawMarqueeRectangle(context, origin, origin, start, current, "notes", readCanvasPalette(), true);
}
