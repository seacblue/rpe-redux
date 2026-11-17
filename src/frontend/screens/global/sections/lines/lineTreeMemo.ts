/** Compares the structural inputs that can change the judge-line tree. */
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import { lineGroupLabels, lineNameLabel } from "../../../editor/workspace/lineLabels.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { GlobalView } from "../../globalView.ts";

/** Props whose values affect mounted line-tree rows and folder labels. */
export interface LineTreeMemoProps {
  session: Pick<EditorSession, "lineIndex">;
  chart: Chart;
  /** Snapshot revision; unlike the chart facade, this changes on paged commits. */
  contentRevision: number;
  showGroups: boolean;
  selectedLineIds: ReadonlySet<string>;
  folderGroup: number | null;
  collapsedGroups: ReadonlySet<string>;
  treeLayout: GlobalView;
}

/** Compare set contents without allocating a copy for a memoized tree render. */
function sameSet(previous: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  return previous.size === next.size && [...previous].every((value) => next.has(value));
}

/** Compare only chart fields that can change the visible line tree. */
function sameTreeChart(previous: Chart, next: Chart): boolean {
  const previousGroups = previous.judgeLineGroup ?? [];
  const nextGroups = next.judgeLineGroup ?? [];
  const previousLines = previous.judgeLineList ?? [];
  const nextLines = next.judgeLineList ?? [];
  const previousLabels = lineGroupLabels(previous);
  const nextLabels = lineGroupLabels(next);
  return (
    previousGroups.length === nextGroups.length &&
    previousGroups.every((name, index) => name === nextGroups[index]) &&
    previousLabels.length === nextLabels.length &&
    previousLabels.every((label, index) => label === nextLabels[index]) &&
    previousLines.length === nextLines.length &&
    previousLines.every((line, index) => {
      const candidate = nextLines[index];
      return (
        String(line.id ?? index) === String(candidate?.id ?? index) &&
        line.Name === candidate?.Name &&
        line.Group === candidate?.Group &&
        lineNameLabel(line, index) === lineNameLabel(candidate, index)
      );
    })
  );
}

/** Skip the line tree when an edit changed only notes or event data. */
export function lineTreePropsEqual(previous: LineTreeMemoProps, next: LineTreeMemoProps): boolean {
  return (
    previous.session === next.session &&
    previous.session.lineIndex === next.session.lineIndex &&
    previous.contentRevision === next.contentRevision &&
    previous.showGroups === next.showGroups &&
    sameTreeChart(previous.chart, next.chart) &&
    sameSet(previous.selectedLineIds, next.selectedLineIds) &&
    previous.folderGroup === next.folderGroup &&
    sameSet(previous.collapsedGroups, next.collapsedGroups) &&
    previous.treeLayout === next.treeLayout
  );
}
