/**
 * Frame-local broad phase for preview note picking. Pure geometry at CSS-pixel
 * scale; gesture handling and session selection live in `previewSelection`.
 */
import type { HitTestNoteGeometry, HitTestPoint } from "../../../../../../core/edit/hitTest/api.ts";

const DEFAULT_CELL_SIZE = 64;
const MAX_CELLS_PER_NOTE = 128;
const LARGE_CELL_FACTOR = 4;
const MAX_CELLS_PER_LARGE_NOTE = 256;

/** Axis-aligned bounds in the same CSS-pixel space as the note geometry. */
export interface PreviewBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * A frame-local 2-D broad phase for preview note picking.
 *
 * Preview geometry is already in CSS pixels, so a uniform grid is cheaper than
 * a tree here: pointer queries touch only a handful of cells, and a new grid is
 * built only when the cached geometry object changes.
 */
export class PreviewNoteSpatialIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly largeCells = new Map<string, number[]>();
  private readonly hugeNotes: number[] = [];
  private readonly cellSize: number;
  private readonly largeCellSize: number;
  private readonly notes: readonly HitTestNoteGeometry[];
  private readonly bounds: PreviewBounds[];
  private readonly queryStamps: Uint32Array;
  private queryVersion = 0;
  private readonly maxRadius: number;

  /**
   * Builds the grid for one geometry snapshot; oversized notes fall back to a
   * coarser grid or a linear list.
   */
  constructor(notes: readonly HitTestNoteGeometry[], cellSize = DEFAULT_CELL_SIZE) {
    this.notes = notes;
    this.cellSize = Math.max(16, cellSize);
    this.largeCellSize = this.cellSize * LARGE_CELL_FACTOR;
    this.bounds = notes.map(noteBounds);
    this.queryStamps = new Uint32Array(notes.length);
    this.maxRadius = notes.reduce((maximum, note) => Math.max(maximum, note.radius), 0);
    this.bounds.forEach((bounds, index) => this.add(bounds, index));
  }

  /** Largest note radius in the index; the default query distance for a point. */
  get maxQueryRadius(): number {
    return this.maxRadius;
  }

  /** Fill `result` with candidates whose broad-phase bounds touch a rectangle. */
  queryBounds(bounds: PreviewBounds, result: HitTestNoteGeometry[] = []): HitTestNoteGeometry[] {
    result.length = 0;
    this.queryVersion = this.queryVersion === 0xffffffff ? 1 : this.queryVersion + 1;
    const version = this.queryVersion;
    /** Appends the notes in one cell that overlap the query rectangle. */
    const collect = (cells: Map<string, number[]>, cell: string): void => {
      for (const index of cells.get(cell) ?? []) {
        if (this.queryStamps[index] === version) {
          continue;
        }
        this.queryStamps[index] = version;
        const note = this.notes[index];
        if (note && boundsOverlap(this.bounds[index], bounds)) {
          result.push(note);
        }
      }
    };
    this.forEachCell(bounds, (cell) => collect(this.cells, cell), this.cellSize);
    this.forEachCell(bounds, (cell) => collect(this.largeCells, cell), this.largeCellSize);
    for (const index of this.hugeNotes) {
      if (this.queryStamps[index] === version) {
        continue;
      }
      this.queryStamps[index] = version;
      const note = this.notes[index];
      if (note && boundsOverlap(this.bounds[index], bounds)) {
        result.push(note);
      }
    }
    return result;
  }

  /** Fill `result` with candidates that can be within a radius of a point. */
  queryPoint(
    point: HitTestPoint,
    radius = this.maxRadius,
    result: HitTestNoteGeometry[] = [],
  ): HitTestNoteGeometry[] {
    const distance = Math.max(0, radius);
    return this.queryBounds(
      {
        left: point.x - distance,
        right: point.x + distance,
        top: point.y - distance,
        bottom: point.y + distance,
      },
      result,
    );
  }

  /** Adds a note to the uniform grid, demoting it when it would span too many cells. */
  private add(bounds: PreviewBounds, index: number): void {
    const [left, right, top, bottom] = this.cellRange(bounds, this.cellSize);
    if ((right - left + 1) * (bottom - top + 1) > MAX_CELLS_PER_NOTE) {
      this.addLarge(bounds, index);
      return;
    }
    this.insert(this.cells, bounds, index, this.cellSize);
  }

  /** Adds an oversized note to the coarse grid or the linear huge-note list. */
  private addLarge(bounds: PreviewBounds, index: number): void {
    const [left, right, top, bottom] = this.cellRange(bounds, this.largeCellSize);
    if ((right - left + 1) * (bottom - top + 1) > MAX_CELLS_PER_LARGE_NOTE) {
      this.hugeNotes.push(index);
      return;
    }
    this.insert(this.largeCells, bounds, index, this.largeCellSize);
  }

  /** Registers one note index in every cell its bounds touch. */
  private insert(
    cells: Map<string, number[]>,
    bounds: PreviewBounds,
    index: number,
    cellSize: number,
  ): void {
    this.forEachCell(
      bounds,
      (cell) => {
        const entries = cells.get(cell);
        if (entries) {
          entries.push(index);
        } else {
          cells.set(cell, [index]);
        }
      },
      cellSize,
    );
  }

  /** Inclusive cell range covered by `bounds` at `cellSize`. */
  private cellRange(bounds: PreviewBounds, cellSize: number): [number, number, number, number] {
    return [
      Math.floor(bounds.left / cellSize),
      Math.floor(bounds.right / cellSize),
      Math.floor(bounds.top / cellSize),
      Math.floor(bounds.bottom / cellSize),
    ];
  }

  /** Visits every cell key covered by `bounds`. */
  private forEachCell(
    bounds: PreviewBounds,
    visitor: (cell: string) => void,
    cellSize: number,
  ): void {
    const [left, right, top, bottom] = this.cellRange(bounds, cellSize);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        visitor(`${x}:${y}`);
      }
    }
  }
}

/** Broad-phase bounds for one note, padded by its hit radius. */
function noteBounds(note: HitTestNoteGeometry): PreviewBounds {
  const padding = Math.max(0, note.radius);
  return {
    left: Math.min(note.head.x, note.tail.x) - padding,
    right: Math.max(note.head.x, note.tail.x) + padding,
    top: Math.min(note.head.y, note.tail.y) - padding,
    bottom: Math.max(note.head.y, note.tail.y) + padding,
  };
}

/** Whether two axis-aligned bounds intersect, edges included. */
function boundsOverlap(left: PreviewBounds, right: PreviewBounds): boolean {
  return (
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top
  );
}

/** Squared distance from `point` to the segment `start`–`end`. */
export function distanceSquaredToSegment(
  point: HitTestPoint,
  start: HitTestPoint,
  end: HitTestPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) {
    const x = point.x - start.x;
    const y = point.y - start.y;
    return x * x + y * y;
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const x = point.x - (start.x + projection * dx);
  const y = point.y - (start.y + projection * dy);
  return x * x + y * y;
}

/** Returns the cached grid for one geometry snapshot, building it on first use. */
export function previewNoteGrid(geometry: {
  readonly notes: readonly HitTestNoteGeometry[];
}): PreviewNoteSpatialIndex {
  const key = geometry as object;
  const cached = gridCache.get(key);
  if (cached) {
    return cached;
  }
  const grid = new PreviewNoteSpatialIndex(geometry.notes);
  gridCache.set(key, grid);
  return grid;
}

const gridCache = new WeakMap<object, PreviewNoteSpatialIndex>();
