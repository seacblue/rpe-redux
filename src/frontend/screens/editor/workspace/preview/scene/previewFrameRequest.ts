/** Identity of one preview paint request and the comparison used to reuse it. */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import type { PreviewNoteSelection } from "./previewTypes.ts";

/** The inputs that identify one painted preview frame. */
export interface PreviewFrameRequest {
  readonly chart: Chart;
  readonly tempo: TempoSource;
  readonly seconds: number;
  readonly selectedLine: number;
  readonly selectedNotes: PreviewNoteSelection;
}

/** Compare a multi-line selection without allocating a Set per frame. */
export function sameLineSelection(left: readonly number[], right: readonly number[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/** Whether two note selections contain the same lines and indices. */
export function samePreviewSelection(
  left: PreviewNoteSelection,
  right: PreviewNoteSelection,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const [line, selected] of left) {
    const other = right.get(line);
    if (!other || other.size !== selected.size) {
      return false;
    }
    for (const index of selected) {
      if (!other.has(index)) {
        return false;
      }
    }
  }
  return true;
}

/** Whether the previous paint used the same chart, tempo, time, and selection. */
export function samePreviewFrameRequest(
  previous: PreviewFrameRequest | null,
  chart: Chart,
  tempo: TempoSource,
  seconds: number,
  selectedLine: number,
  selectedNotes: PreviewNoteSelection,
): boolean {
  return (
    previous?.chart === chart &&
    previous.tempo === tempo &&
    previous.seconds === seconds &&
    previous.selectedLine === selectedLine &&
    samePreviewSelection(previous.selectedNotes, selectedNotes)
  );
}

/** Whether a preview frame may be reused without advancing a live effect. */
export function canReusePreviewFrame(
  previous: PreviewFrameRequest | null,
  chart: Chart,
  tempo: TempoSource,
  seconds: number,
  selectedLine: number,
  selectedNotes: PreviewNoteSelection,
  hitEffectsActive: boolean,
): boolean {
  return (
    !hitEffectsActive &&
    samePreviewFrameRequest(previous, chart, tempo, seconds, selectedLine, selectedNotes)
  );
}
