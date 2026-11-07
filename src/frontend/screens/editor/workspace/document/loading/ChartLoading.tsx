/**
 * The chart-loading overlay: progress and stage text, or the error that stopped
 * the load. It subscribes to the core loading snapshot; the document lifecycle
 * decides when a load starts and ends.
 */
import { useEffect, useSyncExternalStore } from "react";
import { loadingProgress } from "../../../../../../core/global/document/loading.ts";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { Modal } from "../../../../../../design/components/modal/Modal.tsx";
import { Progress } from "../../../../../../design/components/progress/Progress.tsx";
import { useTranslation } from "../../../../../../i18n/react.ts";

/**
 * The chart-loading modal.
 *
 * A persistent modal instance rather than a queued request, because an import
 * may still enqueue a resource choice while its progress is visible.
 */
export function ChartLoading() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(loadingProgress.subscribe, loadingProgress.getSnapshot);
  const shown = state;
  // A completed load stays on screen briefly, so the bar is seen landing.
  const id = state?.id;
  const status = state?.status;
  useEffect(() => {
    if (status !== "complete" || id === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      const current = loadingProgress.getSnapshot();
      if (current?.id === id && current.status === "complete") {
        loadingProgress.dismiss();
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [id, status]);
  const failed = shown?.status === "error";
  return (
    <Modal
      open={Boolean(state)}
      instanceKey={id === undefined ? undefined : String(id)}
      onClose={() => loadingProgress.dismiss()}
      label={t(shown?.status === "error" ? "workspace.loading.failed" : "workspace.loading.title")}
      closeButton={failed}
      className="redux-chart-loading"
      onCancel={(event) => {
        if (!failed) {
          event.preventDefault();
        }
      }}
      actions={
        failed ? (
          <Button type="button" variant="outlined" onClick={() => loadingProgress.dismiss()}>
            {t("common.action.close")}
          </Button>
        ) : undefined
      }
    >
      <div role="status" data-state={shown?.status}>
        {/* A failed load is a message box: the stage that failed is not a heading
            for the error, so the body only reports the problem. */}
        {!failed && (
          <p className="redux-loading-stage" aria-live="polite">
            {t(`workspace.loading.${shown?.stage ?? "read"}`)}
          </p>
        )}
        {/* A failed load keeps the modal focused on the error, without a
          progress bar and percentage beside it. */}
        {failed ? (
          <div className="redux-loading-error" role="alert">
            <p className="redux-loading-error-message">{shown.error}</p>
            {shown.errorSolution && (
              <p className="redux-loading-error-solution">
                <span className="redux-loading-error-label">
                  {t("workspace.loading.solution")}:
                </span>{" "}
                {shown.errorSolution}
              </p>
            )}
            {shown.errorCode && (
              <p className="redux-loading-error-code">
                ({t("workspace.loading.errorCode")}: {shown.errorCode})
              </p>
            )}
          </div>
        ) : (
          <>
            <Progress
              max={100}
              value={shown?.percent ?? 0}
              label={t("workspace.loading.progress")}
              valueText={`${Math.floor(shown?.percent ?? 0)}%`}
            />
            <p className="redux-loading-percent">{Math.floor(shown?.percent ?? 0)}%</p>
          </>
        )}
      </div>
    </Modal>
  );
}
