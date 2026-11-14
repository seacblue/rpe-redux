/**
 * Title-bar background-task menu.
 *
 * Tasks are window-wide work, not a sidebar section: pinning the trigger beside
 * the update badge keeps it reachable across the window and lets the
 * panel animate from a stable anchor.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { EmptyState } from "../../../design/components/empty-state/EmptyState.tsx";
import { Progress } from "../../../design/components/progress/Progress.tsx";
import { useAnchoredPopover } from "../../../design/patterns/useAnchoredPopover.ts";
import {
  dismissLongTask,
  getLongTasks,
  removeLongTask,
  subscribeLongTasks,
} from "../../../core/state/longTasks.ts";
import { playTaskCompletionChime } from "../../platform/taskCompletionSound.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";

const PANEL_GAP = 6;
const COMPLETED_VISIBLE_MS = 5000;

/** Shows all long-running operations without blocking the editor. */
export function LongTaskControl() {
  const { t, tRaw } = useTranslation();
  const tasks = useSyncExternalStore(subscribeLongTasks, getLongTasks, getLongTasks);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const pendingRemovals = useRef(new Map<string, { label: string; detail?: string }>());
  const active = tasks.filter(
    (task) => task.status === "running" || task.status === "cancelling",
  ).length;
  const lastStatuses = useRef(new Map<string, string>());
  const activeBatch = useRef(false);
  const batchCompleted = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const task of tasks) {
      if (task.status === "completed" && task.finishedAt !== null) {
        const remaining = task.finishedAt + COMPLETED_VISIBLE_MS - Date.now();
        timers.push(setTimeout(() => dismissLongTask(task.id), Math.max(0, remaining)));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [tasks]);

  useEffect(() => {
    for (const [id, pending] of pendingRemovals.current) {
      if (tasks.some((task) => task.id === id)) {
        continue;
      }
      pendingRemovals.current.delete(id);
      showToast(
        t("chrome.tasks.removedToast", {
          name: tRaw(pending.label, pending.detail ? { name: pending.detail } : undefined),
        }),
        "info",
      );
    }
  }, [tasks, t, tRaw]);

  // A batch rings once, when its last active task settles. Statuses are
  // compared here so a panel reopened on old task history never replays the
  // notification, and one completed chart cannot chime ahead of its siblings.
  useEffect(() => {
    const hasActiveTasks = active > 0;
    if (hasActiveTasks && !activeBatch.current) {
      activeBatch.current = true;
      batchCompleted.current = false;
    }
    const seen = new Set<string>();
    for (const task of tasks) {
      seen.add(task.id);
      const previous = lastStatuses.current.get(task.id);
      if (task.status === "completed" && (previous === undefined || previous !== "completed")) {
        activeBatch.current = true;
        batchCompleted.current = true;
      }
      lastStatuses.current.set(task.id, task.status);
    }
    for (const id of lastStatuses.current.keys()) {
      if (!seen.has(id)) {
        lastStatuses.current.delete(id);
      }
    }
    if (hasActiveTasks || !activeBatch.current) {
      return;
    }
    const completed = batchCompleted.current;
    activeBatch.current = false;
    batchCompleted.current = false;
    if (!completed) {
      return;
    }
    playTaskCompletionChime();
    const button = trigger.current;
    if (button && !globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      button.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.18)", offset: 0.35 },
          { transform: "scale(0.96)", offset: 0.65 },
          { transform: "scale(1.04)", offset: 0.85 },
          { transform: "scale(1)" },
        ],
        { duration: 420, easing: "ease-out" },
      );
    }
  }, [active, tasks]);

  const popover = useAnchoredPopover({
    open,
    anchor: trigger,
    panel,
    onClose: () => setOpen(false),
    align: "end",
    gap: PANEL_GAP,
  });

  return (
    <div className="redux-long-task">
      <IconButton
        ref={trigger}
        icon="list"
        size="md"
        label={t("chrome.tasks.title")}
        className="redux-long-task-button"
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {active > 0 && (
          <span className="redux-long-task-count" aria-hidden="true">
            {active}
          </span>
        )}
      </IconButton>
      <section
        ref={panel}
        className={`long-task-popover${open ? " is-open" : ""}`}
        role="dialog"
        aria-label={t("chrome.tasks.title")}
        aria-hidden={!open}
        inert={!open}
        data-placement={popover.side}
        style={popover.style}
      >
        <div className="long-task-popover-list">
          {tasks.length === 0 && <EmptyState icon="list" title={t("chrome.tasks.empty")} />}
          {tasks.map((task) => {
            const working = task.status === "running" || task.status === "cancelling";
            const label = tRaw(task.label, task.detail ? { name: task.detail } : undefined);
            const status = tRaw(`chrome.tasks.status.${task.status}`);
            const stage = working && task.stage ? tRaw(task.stage) : status;
            return (
              <article className="long-task-row" key={task.id} data-status={task.status}>
                <div className="long-task-row-header">
                  <strong className="long-task-row-title">{label}</strong>
                  <IconButton
                    icon="trash"
                    size="small"
                    variant="plain"
                    className="long-task-row-remove"
                    label={t(working ? "chrome.tasks.cancelAndDismiss" : "chrome.tasks.dismiss")}
                    disabled={task.status === "cancelling"}
                    onClick={() => {
                      pendingRemovals.current.set(task.id, {
                        label: task.label,
                        ...(task.detail ? { detail: task.detail } : {}),
                      });
                      removeLongTask(task.id);
                      trigger.current?.focus();
                    }}
                  />
                </div>
                <p className="long-task-progress-line">
                  {working && task.progress !== null
                    ? `${Math.round(task.progress * 100)}%, ${stage}`
                    : stage}
                </p>
                {working && (
                  <Progress
                    max={1}
                    value={task.progress ?? undefined}
                    label={label}
                    size="compact"
                    className="long-task-progress"
                  />
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
