/**
 * Writes session-derived values into the shared toolbar and statusbar cells.
 * The session stays the source of truth; this module owns only the publication
 * order those surfaces expect.
 */
import { lineDisplayLabel, lineDisplayName, lineGroupLabels } from "../../lineLabels.ts";
import { lineGroupIndex } from "../../../../../../core/global/chart/line/lineGroups.ts";
import {
  editorLine,
  editorLineGroups,
  editorLineLabels,
  editorLineNavigationDisabled,
  editorLineOptions,
  editorLineSelection,
  editorLineTokens,
  editorParentLine,
  editorMultiLineEnabled,
  editorOffset,
  type EditorLineOption,
} from "../../../../../../core/edit/state/publishedValues.ts";
import { setEditorHistorySnapshot } from "../../../../../../core/edit/session/history.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** Publishes the session-derived toolbar and statusbar values. */
let labelsSession: EditorSession | null = null;
let labelsRevision = -1;
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
  // A paged ChartDocument keeps one chart facade and mutates its line slots in
  // place. The session content revision is therefore the source of truth for
  // labels, not chart object identity; otherwise toolbar menus retain removed,
  // added, or renamed lines until the next selection change.
  if (session !== labelsSession || session.contentRevision !== labelsRevision) {
    labelsSession = session;
    labelsRevision = session.contentRevision;
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
    // Empty folders have no line option to carry their name, so the selector
    // reads the folder list separately and still shows a newly added group.
    editorLineGroups.set(groupNames);
  }
  editorLineLabels.set(labels);
  editorLine.set(String(session.lineIndex));
  const parent = session.multiLineActive ? -1 : Number(session.line?.father ?? -1);
  editorParentLine.set(Number.isInteger(parent) && parent >= 0 ? String(parent) : "");
  editorLineNavigationDisabled.set(totalLines < 1);
  const nextSelectionKey = `${session.multiLineIndices.join(",")}|${JSON.stringify(session.multiLineTokens)}`;
  if (nextSelectionKey !== selectionKey) {
    selectionKey = nextSelectionKey;
    // Tokens first: the selection subscriber reads them as the authored form of
    // the line list it is about to install.
    editorLineTokens.set(session.multiLineTokens.map((token) => ({ ...token })));
    editorLineSelection.set([...session.multiLineIndices]);
  }
  editorMultiLineEnabled.set(session.multiLineEnabled);
}
