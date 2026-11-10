/**
 * Leases empty judge lines for script parameters and releases unused scratches.
 *
 * The parameter dialog may append a line when no line is free. That line is
 * kept for the run because the script may write to it; a cancelled dialog
 * removes it again, and later dialogs reuse it while it stays empty.
 */
import { createLine } from "../../../../../core/global/chart/chart.ts";
import { deleteLine } from "../../../../../core/global/chart/line/lineEdits.ts";
import { findFreeJudgeLine, isFreeJudgeLine } from "../../../../../core/edit/line/freeLine.ts";
import { getSelectionSession } from "../../../../../core/edit/selection/api.ts";
import { t } from "../../../../../i18n/index.ts";

export interface ScriptJudgeLineAllocation {
  readonly id: string;
  readonly index: number;
  readonly created: boolean;
  /** Undo entry for an appended line, so a cancel can roll it back cleanly. */
  readonly historyEntryId?: number;
}

/**
 * Pick an empty line, appending a scratch line only when every candidate is
 * occupied. `exclude` carries the current line and other fields' targets so two
 * parameters do not silently share one line.
 */
export function allocateScriptJudgeLine(options: {
  readonly exclude?: readonly number[];
  readonly name: string;
}): ScriptJudgeLineAllocation | null {
  const session = getSelectionSession();
  if (!session || !session.editable) {
    return null;
  }
  const lines = session.chart.judgeLineList ?? [];
  const free = findFreeJudgeLine(session.chart, {
    exclude: [...(options.exclude ?? []), session.lineIndex],
    preferredName: options.name,
  });
  if (free !== null) {
    return { index: free, id: lines[free].id ?? "", created: false };
  }
  const line = createLine(options.name);
  const committed = session.commitChart(
    t("editor.session.addLine"),
    { ...session.chart, judgeLineList: [...lines, line] },
    session.selectionState(),
  );
  if (!committed) {
    return null;
  }
  return {
    index: lines.length,
    id: line.id ?? "",
    created: true,
    historyEntryId: session.history.undoStack.at(-1)?.id,
  };
}

/** Delete scratch lines that are still empty, highest index first. */
export function releaseScriptJudgeLines(allocations: readonly ScriptJudgeLineAllocation[]): void {
  const session = getSelectionSession();
  if (!session || !session.editable) {
    return;
  }
  const unique = new Map<string, ScriptJudgeLineAllocation>();
  for (const allocation of allocations) {
    if (allocation.created) {
      unique.set(allocation.id, allocation);
    }
  }
  const entries = [...unique.values()]
    .map((allocation) => ({
      allocation,
      index: (session.chart.judgeLineList ?? []).findIndex((line) => line.id === allocation.id),
    }))
    .filter(({ index }) => index >= 0 && isFreeJudgeLine(session.chart, index))
    .sort((left, right) => right.index - left.index);
  for (const { allocation } of entries) {
    const latest = session.history.undoStack.at(-1);
    if (allocation.historyEntryId !== undefined && latest?.id === allocation.historyEntryId) {
      session.travel("undo");
      continue;
    }
    const currentIndex = (session.chart.judgeLineList ?? []).findIndex(
      (line) => line.id === allocation.id,
    );
    if (currentIndex < 0 || !isFreeJudgeLine(session.chart, currentIndex)) {
      continue;
    }
    session.commitChart(
      t("workspace.scripts.parameters.judgeLine.remove"),
      deleteLine(session.chart, currentIndex),
      session.selectionState(),
    );
  }
}
