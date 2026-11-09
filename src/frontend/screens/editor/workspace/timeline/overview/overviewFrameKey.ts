/**
 * Identity of one timeline overview paint.
 *
 * The strip caches static chart/history pixels separately from the moving
 * marker, and a frame is skipped when every input that can change those pixels
 * still matches. History changes arrive as a revision counter instead of a
 * per-frame serialization.
 */

/** Inputs that rebuild the cached density and history strip canvases. */
export interface OverviewStripKey {
  readonly chart: unknown;
  readonly line: number;
  readonly layer: number;
  readonly extended: boolean;
  readonly duration: number;
  readonly width: number;
  readonly historyWidth: number;
  readonly height: number;
  readonly historyRevision: number;
  readonly palette: unknown;
}

/** Inputs that decide whether a complete overview frame can be reused. */
export interface OverviewFrameKey extends OverviewStripKey {
  readonly markerY: number;
  /** Whether clipboard and paste range overlays are painted. */
  readonly rangeBarsEnabled?: boolean;
  /** Fill opacity shared by both range overlays. */
  readonly rangeBarOpacity?: number;
  /** Clipboard and paste spans, encoded so equality compares the visible state. */
  readonly clipboardRangeKey?: string;
  readonly pasteRangeKey?: string;
  readonly clipboardColor?: string;
  readonly pasteColor?: string;
}

/** True when both keys describe the same cached strip pixels. */
export function sameOverviewStripKey(
  left: OverviewStripKey | null,
  right: OverviewStripKey,
): boolean {
  return (
    left !== null &&
    left.chart === right.chart &&
    left.line === right.line &&
    left.layer === right.layer &&
    left.extended === right.extended &&
    left.duration === right.duration &&
    left.width === right.width &&
    left.historyWidth === right.historyWidth &&
    left.height === right.height &&
    left.historyRevision === right.historyRevision &&
    left.palette === right.palette
  );
}

/** True when the last painted overview frame already shows this state. */
export function sameOverviewFrame(left: OverviewFrameKey | null, right: OverviewFrameKey): boolean {
  return (
    sameOverviewStripKey(left, right) &&
    left?.markerY === right.markerY &&
    (left?.rangeBarsEnabled ?? false) === (right.rangeBarsEnabled ?? false) &&
    (left?.rangeBarOpacity ?? 0) === (right.rangeBarOpacity ?? 0) &&
    (left?.clipboardRangeKey ?? "") === (right.clipboardRangeKey ?? "") &&
    (left?.pasteRangeKey ?? "") === (right.pasteRangeKey ?? "") &&
    (left?.clipboardColor ?? "") === (right.clipboardColor ?? "") &&
    (left?.pasteColor ?? "") === (right.pasteColor ?? "")
  );
}
