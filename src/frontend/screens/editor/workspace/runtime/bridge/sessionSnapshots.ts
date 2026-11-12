/**
 * Writes session-derived values into the shared toolbar and statusbar cells.
 * The session stays the source of truth; this module owns only the publication
 * order those surfaces expect.
 */
import { lineDisplayLabel, lineDisplayName, lineGroupLabels } from "../../lineLabels.ts";
import { lineGroupIndex } from "../../../../../../core/global/chart/line/lineGroups.ts";
import {
  editorLine,
  editorLineLabels,
  editorLineNavigationDisabled,
  editorLineOptions,
  editorLineSelection,
  editorParentLine,
  editorMultiLineEnabled,
  editorOffset,
  type EditorLineOption,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { setEditorHistorySnapshot } from "../../../../../../core/edit/session/history.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** Publishes the session-derived toolbar and statusbar values. */
let labelsChart: EditorSession["chart"] | null = null;
let labels: string[] = [];
let lineOptions: readonly EditorLineOption[] = [];
let selectionKey = "";

/** Writes line labels, history flags, and line navigation into their shared cells. */
export function publishEditorSessionSnapshots(session: EditorSession, totalLines: number): void {
  if (!session.liveBeatEdit) {
    editorOffset.set(String(session.chart.META.offset ?? 0));
  }
  setEditorHistorySnapshot({
    canUndo: session.history.undoStack.length > 0,
    canRedo: session.history.redoStack.length > 0,
  });
  if (session.chart !== labelsChart) {
    labelsChart = session.chart;
    const lines = session.chart.judgeLineList ?? [];
    const groupNames = lineGroupLabels(session.chart);
    labels = lines.map((_, index) => lineDisplayLabel(session.chart, index));
    lineOptions = lines.map((line, index) => ({
      index,
      label: labels[index] ?? `#${index}`,
      name: lineDisplayName(session.chart, index),
      group: groupNames[lineGroupIndex(line)] ?? "",
    }));
    editorLineOptions.set(lineOptions);
  }
  editorLineLabels.set(labels);
  editorLine.set(String(session.lineIndex));
  const parent = session.multiLineActive ? -1 : Number(session.line?.father ?? -1);
  editorParentLine.set(Number.isInteger(parent) && parent >= 0 ? String(parent) : "");
  editorLineNavigationDisabled.set(totalLines < 1);
  const nextSelectionKey = session.multiLineIndices.join(",");
  if (nextSelectionKey !== selectionKey) {
    selectionKey = nextSelectionKey;
    editorLineSelection.set([...session.multiLineIndices]);
  }
  editorMultiLineEnabled.set(session.multiLineEnabled);
}
