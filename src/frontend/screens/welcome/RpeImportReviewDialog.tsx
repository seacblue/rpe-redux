/**
 * The RPE import review dialog.
 *
 * A native RPE installation carries settings and many chart folders. This
 * surface shows both lists with a checkbox per row and one checkbox for each
 * group, so an import can carry only what the person approves.
 */
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { RpeImportSelection } from "../../../core/migration/rpe.ts";
import {
  answerRpeImportReview,
  getRpeImportReview,
  subscribeRpeImportReview,
  type RpeImportReviewRequest,
  type RpeReviewChart,
  type RpeReviewSetting,
} from "./rpeImportReview.ts";

/** Mount point for the pending review; retains the last one while it closes. */
export function RpeImportReviewDialog() {
  const request = useSyncExternalStore(
    subscribeRpeImportReview,
    getRpeImportReview,
    getRpeImportReview,
  );
  const [last, setLast] = useState(request);
  if (request && request !== last) {
    setLast(request);
  }
  const shown = request ?? last;
  if (!shown) {
    return null;
  }
  return <ReviewBody key={shown.id} open={Boolean(request)} request={shown} />;
}

/** Selection state and layout for one scan. */
function ReviewBody({ request, open }: { request: RpeImportReviewRequest; open: boolean }) {
  const { t } = useTranslation();
  const settingsHeading = useId();
  const chartsHeading = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        ...request.settings.map((row) => row.id),
        ...request.charts.map((chart) => chart.path),
      ]),
  );
  const settingIds = request.settings.map((row) => row.id);
  const chartIds = request.charts.map((chart) => chart.path);
  const settingState = groupState(settingIds, selected);
  const chartState = groupState(chartIds, selected);
  const total = settingState.count + chartState.count;

  /** Toggle one row without mutating the published selection. */
  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  /** Toggle every row in one group. */
  const toggleGroup = (ids: readonly string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  /** Split the row selection back into the plan settings and chart paths. */
  const confirm = () => {
    const selection: RpeImportSelection = {
      settingKeys: request.settings
        .filter((row) => row.kind === "setting" && selected.has(row.id))
        .map((row) => row.id),
      applyShortcuts: request.settings.some(
        (row) => row.kind === "shortcuts" && selected.has(row.id),
      ),
      applyLanguage: request.settings.some(
        (row) => row.kind === "language" && selected.has(row.id),
      ),
      chartPaths: request.charts
        .filter((chart) => selected.has(chart.path))
        .map((chart) => chart.path),
    };
    answerRpeImportReview(selection);
  };

  const rootName = request.scan.root.split(/[\\/]/u).filter(Boolean).pop() ?? request.scan.root;

  return (
    <Modal
      open={open}
      onClose={() => answerRpeImportReview(null)}
      label={t("workspace.welcome.rpe.review.title")}
      description={t("workspace.welcome.rpe.review.description", {
        charts: request.charts.length,
        settings: request.settings.length,
      })}
      className="rpe-review-dialog"
      actions={
        <>
          <Button variant="outlined" onClick={() => answerRpeImportReview(null)}>
            {t("common.action.cancel")}
          </Button>
          <Button variant="solid" disabled={total === 0} onClick={confirm}>
            {t("workspace.welcome.rpe.review.apply")}
          </Button>
        </>
      }
    >
      <div className="rpe-review-root">
        <span className="rpe-review-root-icon" aria-hidden="true">
          <Icon name="folder" size={16} />
        </span>
        <strong>{rootName}</strong>
        <span className="rpe-review-root-path">{request.scan.root}</span>
      </div>

      <div className="rpe-review-grid">
        <section className="rpe-review-group" aria-labelledby={settingsHeading}>
          <GroupHead
            id={settingsHeading}
            title={t("workspace.welcome.rpe.review.settings")}
            state={settingState}
            onToggle={(checked) => toggleGroup(settingIds, checked)}
          />
          {request.settings.length ? (
            <div className="rpe-review-rows">
              {request.settings.map((row) => (
                <SettingRow
                  key={row.id}
                  row={row}
                  checked={selected.has(row.id)}
                  onToggle={(checked) => toggle(row.id, checked)}
                />
              ))}
            </div>
          ) : (
            <p className="rpe-review-empty">{t("workspace.welcome.rpe.review.settingsEmpty")}</p>
          )}
        </section>

        <section className="rpe-review-group" aria-labelledby={chartsHeading}>
          <GroupHead
            id={chartsHeading}
            title={t("workspace.welcome.rpe.review.charts")}
            state={chartState}
            onToggle={(checked) => toggleGroup(chartIds, checked)}
          />
          {request.charts.length ? (
            <div className="rpe-review-rows">
              {request.charts.map((chart) => (
                <ChartRow
                  key={chart.path}
                  chart={chart}
                  checked={selected.has(chart.path)}
                  onToggle={(checked) => toggle(chart.path, checked)}
                />
              ))}
            </div>
          ) : (
            <p className="rpe-review-empty">{t("workspace.welcome.rpe.review.chartsEmpty")}</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Group header with the select-all checkbox on the trailing edge. */
function GroupHead({
  id,
  title,
  state,
  onToggle,
}: {
  id: string;
  title: string;
  state: { all: boolean; some: boolean; total: number };
  onToggle(checked: boolean): void;
}) {
  return (
    <div className="rpe-review-group-head">
      <label className="rpe-review-group-check">
        <span className="rpe-review-group-title" id={id}>
          {title}
        </span>
        <Input
          type="checkbox"
          checked={state.all}
          indeterminate={state.some}
          disabled={state.total === 0}
          onChange={(event) => onToggle(event.currentTarget.checked)}
        />
      </label>
    </div>
  );
}

/** One setting row: label, current value, and the value the import writes. */
function SettingRow({
  row,
  checked,
  onToggle,
}: {
  row: RpeReviewSetting;
  checked: boolean;
  onToggle(checked: boolean): void;
}) {
  return (
    <label className="rpe-review-row">
      <span className="rpe-review-row-label">{row.label}</span>
      <span className="rpe-review-row-value">
        {row.swatch && (
          <span
            className="rpe-review-swatch"
            style={{ backgroundColor: row.swatch }}
            aria-hidden="true"
          />
        )}
        <span>{row.value}</span>
      </span>
      <Input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
    </label>
  );
}

/** One chart row: song title, composer, charter, and the source group. */
function ChartRow({
  chart,
  checked,
  onToggle,
}: {
  chart: RpeReviewChart;
  checked: boolean;
  onToggle(checked: boolean): void;
}) {
  const { t } = useTranslation();
  return (
    <label className="rpe-review-row rpe-review-chart">
      <span className="rpe-review-row-copy">
        <span className="rpe-review-chart-title">{chart.title}</span>
        <span className="rpe-review-chart-meta">
          <span>{t("workspace.welcome.rpe.review.composer", { name: chart.composer })}</span>
          <span className="rpe-review-chart-separator" aria-hidden="true">
            /
          </span>
          <span>{t("workspace.welcome.rpe.review.charter", { name: chart.charter })}</span>
        </span>
      </span>
      <span className="rpe-review-chart-group">{chart.group}</span>
      <Input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
    </label>
  );
}

/** Count a group and decide whether its header checkbox is on, off, or mixed. */
function groupState(ids: readonly string[], selected: ReadonlySet<string>) {
  const count = ids.reduce((total, id) => total + (selected.has(id) ? 1 : 0), 0);
  return {
    all: ids.length > 0 && count === ids.length,
    some: count > 0 && count < ids.length,
    count,
    total: ids.length,
  };
}
