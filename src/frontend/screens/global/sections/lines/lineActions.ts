/**
 * Direct actions for the selected judgement line: duplicate and delete.
 *
 * Each action owns its run callback and commits through the line panel's host,
 * so the panel selection and the chart cannot disagree about which line moved.
 */
import { deleteLine, duplicateLine } from "../../../../../core/global/chart/line/lineEdits.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { toolbar } from "../../../../../core/shell/registries/toolbar.ts";
import { t } from "../../../../../i18n/index.ts";

/** Session access and commit hook supplied by the mounted line panel. */
interface LineActionHost {
  getSession(): EditorSession;
  hasDocument(): boolean;
  commit(label: string, chart: Chart, index?: number): void;
}

/** Registers duplicate and delete actions for the selected judge line; returns their disposer. */
export function registerLineActions(host: LineActionHost): () => void {
  const lines = () => host.getSession().chart.judgeLineList ?? [];
  const enabled = () => host.hasDocument() && host.getSession().editable && lines().length > 0;
  const disposers = [
    toolbar.register({
      kind: "action",
      id: "line.duplicate",
      group: "editor",
      order: 240,
      icon: "copy",
      label: "editorPanels.linePanel.duplicateLabel",
      tooltip: "editorPanels.linePanel.duplicateLabel",
      toolbar: false,
      enabled,
      run() {
        const session = host.getSession();
        const index = session.lineIndex;
        host.commit(
          t("editorPanels.linePanel.duplicateLabel"),
          duplicateLine(session.chart, index),
          lines().length,
        );
      },
    }),
    toolbar.register({
      kind: "action",
      id: "line.delete",
      group: "editor",
      order: 241,
      icon: "trash",
      label: "editorPanels.linePanel.deleteLabel",
      tooltip: "editorPanels.linePanel.deleteLabel",
      toolbar: false,
      enabled: () => enabled() && lines().length > 1,
      run() {
        const session = host.getSession();
        const index = session.lineIndex;
        host.commit(
          t("editorPanels.linePanel.deleteLabel"),
          deleteLine(session.chart, index),
          Math.max(0, index - 1),
        );
      },
    }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
