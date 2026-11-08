/** Builds a detached timeline session for the event inspector's Bézier draft. */
import { editCapturedSelection } from "../../../../../core/edit/selection/edits.ts";
import { captureSelection } from "../../../../../core/edit/selection/snapshot.ts";
import { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { JudgeLineEvent } from "../../../../../core/global/chart/chart.ts";

/** Copy one multi-line selection map into the mutable shape a session expects. */
function copySelectionMap<T>(source: ReadonlyMap<number, Iterable<T>>): Map<number, Set<T>> {
  return new Map([...source].map(([lineIndex, values]) => [lineIndex, new Set(values)]));
}

/**
 * Create the session shown by the timeline while Bézier points are being dragged.
 *
 * The edit planner is pure, so the live history and document stay untouched. A
 * detached session gives the timeline its normal chart/selection contract and
 * lets the final pointer-up path commit exactly one real edit.
 */
export function eventCurvePreviewSession(
  live: EditorSession,
  bezierPoints: readonly number[],
): EditorSession {
  const result = editCapturedSelection(captureSelection(live), {
    event: (event: JudgeLineEvent) => ({
      ...event,
      bezierPoints: [...bezierPoints],
    }),
  });
  const preview = new EditorSession(result.chart, live.readOnly);
  const hasMultiLineEvents = (result.multiEventSelection?.size ?? 0) > 0;

  preview.lineIndex =
    live.multiLineActive && hasMultiLineEvents ? live.lineIndex : result.lineIndex;
  preview.eventLayer = result.eventLayer;
  preview.focus = live.focus;
  preview.selectionMode = live.selectionMode;
  preview.selection = new Set(live.selection);
  preview.eventSelection = new Set(result.eventSelection);
  preview.multiLineEnabled = live.multiLineEnabled;
  preview.multiLineMode = live.multiLineMode;
  preview.multiLineMerge = live.multiLineMerge;
  preview.multiLineIndices = [...live.multiLineIndices];
  preview.multiLineSelection = result.multiLineSelection
    ? copySelectionMap(result.multiLineSelection)
    : copySelectionMap(live.multiLineSelection);
  preview.multiEventSelection = result.multiEventSelection
    ? copySelectionMap(result.multiEventSelection)
    : copySelectionMap(live.multiEventSelection);
  preview.multiSelectionIntent = live.multiSelectionIntent;
  preview.division = live.division;
  preview.shaderAutoAlign = live.shaderAutoAlign;
  preview.visibleTimeUnit = live.visibleTimeUnit;
  return preview;
}
