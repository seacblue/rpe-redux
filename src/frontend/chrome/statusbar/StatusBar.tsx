/**
 * The bottom status bar.
 *
 * It shows the always-open chart-info readouts at the leading edge and the
 * feedback link at the trailing edge. Chart readouts are published by
 * `chartInfoPresenter.ts`, so the bar only lays them out.
 */
import { useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { HELP_SURVEY_URL } from "../../../core/platform/desktop/helpLinks.ts";
import { openExternalUrl } from "../../../core/platform/desktop/openExternal.ts";
import { ChartInfoView } from "./ChartInfoView.tsx";
import { getChartInfoRows, subscribeChartInfoRows } from "./chartInfoPresenter.ts";

/** Bottom status bar showing chart-info rows and the feedback link; modes may hide it. */
export function StatusBar({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation();
  const chartInfoRows = useSyncExternalStore(
    subscribeChartInfoRows,
    getChartInfoRows,
    getChartInfoRows,
  );
  const feedbackLabel = t("chrome.statusBar.bugReport");

  return (
    <footer hidden={hidden}>
      <div id="chart-info" className="chart-info">
        <ChartInfoView rows={chartInfoRows} />
      </div>
      <Button
        className="status-bar-bug-report"
        variant="ghost"
        onClick={() => {
          void openExternalUrl(HELP_SURVEY_URL).catch((reason: unknown) => {
            showToast({
              message: t("settings.action.openLinkFailed", {
                message: reason instanceof Error ? reason.message : String(reason),
              }),
              level: "error",
              source: feedbackLabel,
            });
          });
        }}
      >
        {feedbackLabel}
      </Button>
    </footer>
  );
}
