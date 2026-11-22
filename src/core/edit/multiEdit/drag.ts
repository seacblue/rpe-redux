/**
 * Geometry for dragging the batch-edit panel over the selection.
 *
 * Panel bounds are the union of every selected line, and the selection
 * signature lets a drag restart only when the underlying selection or focus
 * actually changed.
 */
import { beatValue } from "../../global/chart/timing/beat.ts";
import { snapTime, type TempoGrid } from "../../global/chart/editing/editGrid.ts";
import type { EditorSession } from "../session/session.ts";
import type { SelectionSnapshot } from "../selection/snapshot.ts";

export interface PanelBounds {
  left: number;
  right: number;
  width: number;
}

export function batchSelectionSignature(area: string, session: EditorSession): string {
  const map = area === "notes" ? session.multiLineSelection : session.multiEventSelection;
  const multi = [...map]
    .map(([line, values]) => `${line}:${[...values].sort().join(",")}`)
    .sort()
    .join("|");
  return `${session.lineIndex}:${session.eventLayer}:${[...(area === "notes" ? session.selection : session.eventSelection)].join(",")}:${multi}`;
}

export function selectionPanelBounds(
  area: string,
  snapshot: SelectionSnapshot,
  boundsOf: (lineIndex: number) => PanelBounds,
): PanelBounds {
  const entries = area === "notes" ? snapshot.notes : snapshot.events;
  const indices = [
    ...new Set(
      entries.map((entry) =>
        Number.isInteger(entry.lineIndex) ? entry.lineIndex : snapshot.lineIndex,
      ),
    ),
  ];
  if (!indices.length) {
    return boundsOf(snapshot.lineIndex);
  }
  const bounds = indices.map(boundsOf);
  const left = Math.min(...bounds.map((value) => value.left));
  const right = Math.max(...bounds.map((value) => value.right));
  return { left, right, width: right - left };
}

export interface BatchDragGeometry {
  tempo: TempoGrid;
  origin: number;
  scale: number;
  judgementOffset: number;
  division: number;
  height: number;
  start: { x: number; y: number };
  point: { x: number; y: number };
  factor: number;
  factorForLine(lineIndex: number): number;
  startBeat: number;
  lineIndices: readonly number[];
  panelWidth: number;
  inset: number;
  unit: number;
  notes: boolean;
}

/** Convert pointer coordinates to edit deltas; the browser supplies viewport measurements. */
export function batchDragDeltas(input: BatchDragGeometry): {
  deltaBeat: number;
  deltaBeatByLine: Map<number, number>;
  deltaX: number;
  dragX: number;
} {
  const secondsAt = (y: number, factor: number) =>
    input.tempo.seconds(input.origin) + (input.height - input.judgementOffset - y) / input.scale;
  const beatAt = (y: number, factor: number) =>
    beatValue(snapTime(secondsAt(y, factor), input.division, input.tempo));
  const deltaX = input.point.x - input.start.x;
  return {
    deltaBeat: beatAt(input.point.y, input.factor) - input.startBeat,
    deltaBeatByLine: new Map(
      [...new Set(input.lineIndices)].map((lineIndex) => {
        const factor = input.factorForLine(lineIndex);
        return [lineIndex, beatAt(input.point.y, factor) - beatAt(input.start.y, factor)];
      }),
    ),
    deltaX: input.notes ? (deltaX / Math.max(1, input.panelWidth - input.inset * 2)) * 1350 : 0,
    dragX: deltaX / input.unit,
  };
}
