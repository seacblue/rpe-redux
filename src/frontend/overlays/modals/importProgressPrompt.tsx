/**
 * Progress dialog for a reviewed batch import.
 *
 * A reviewed import (currently the PhiEditer installation) can hold dozens of
 * charts, so its long task gets a visible bar here instead of only the title-bar
 * task row. Closing the dialog leaves the task running; the task itself owns the
 * work and the completion notice.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { Progress } from "../../../design/components/progress/Progress.tsx";
import { getLongTasks, subscribeLongTasks } from "../../../core/state/longTasks.ts";
import { t } from "../../../i18n/index.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { importProgressSnapshot } from "./importProgressModel.ts";
import { dismissModal, presentModal } from "./modalQueue.ts";

/** How long the settled bar stays visible before the dialog closes itself. */
const SETTLED_VISIBLE_MS = 700;

interface ImportProgressProps {
  readonly modalId: string;
  readonly taskId: string;
  readonly total: number;
}

/** Bar, percentage, and the current chart name of one import task. */
function ImportProgress({ modalId, taskId, total }: ImportProgressProps) {
  const { t, tRaw } = useTranslation();
  const tasks = useSyncExternalStore(subscribeLongTasks, getLongTasks, getLongTasks);
  const task = tasks.find((candidate) => candidate.id === taskId);
  const progress = task?.progress ?? null;
  const status = task?.status ?? "completed";
  const snapshot = importProgressSnapshot(progress, total, status);
  const running = snapshot.running;
  const stage = task?.stage ? tRaw(task.stage) : t("workspace.welcome.pe.importing");
  const { percent, done } = snapshot;

  useEffect(() => {
    if (running) {
      return undefined;
    }
    const timer = setTimeout(() => dismissModal(modalId), SETTLED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [modalId, running, status]);

  return (
    <div className="import-progress">
      <p className="import-progress-stage">{stage}</p>
      <Progress
        max={1}
        value={running ? (progress ?? undefined) : 1}
        label={t("workspace.welcome.pe.progressLabel")}
        valueText={snapshot.valueText}
        className="import-progress-bar"
      />
      <p className="import-progress-count">
        {t("workspace.welcome.pe.progressCount", { done, total })}
        {percent === null ? null : <span className="import-progress-percent">{percent}%</span>}
      </p>
    </div>
  );
}

/**
 * Show the import progress dialog for one long task.
 *
 * The caller keeps ownership of the task: dismissing this dialog only removes
 * the progress view, and the task's own completion notice still appears.
 */
export function showImportProgress(taskId: string, total: number): void {
  const modalId = `import-progress:${taskId}`;
  presentModal(modalId, {
    label: t("workspace.welcome.pe.progressTitle"),
    className: "redux-prompt-dialog import-progress-dialog",
    onClose: () => dismissModal(modalId),
    actions: (
      <Button variant="outlined" onClick={() => dismissModal(modalId)}>
        {t("workspace.welcome.pe.progressBackground")}
      </Button>
    ),
    children: <ImportProgress modalId={modalId} taskId={taskId} total={total} />,
  });
}
