/**
 * The trajectory pane's layout: start and end beats, segment count, preview
 * canvas, apply/edit actions, and the presets section.
 *
 * Options arrive already parsed and changes leave as callbacks, so the view owns
 * no chart edit and no event construction.
 */
import type { RefCallback } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { t } from "../../../../../i18n/index.ts";
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";
import type { TrajectorySplitSettings } from "../../../../../core/global/chart/trajectory/trajectorySimplify.ts";
import { TrajectoryFieldsView } from "./TrajectoryFieldsView.tsx";
import {
  TrajectoryPresetsView,
  type TrajectoryPresetsViewProps,
} from "./TrajectoryPresetsView.tsx";
import type { TrajectoryOptionBag } from "./trajectoryPanelControls.ts";

/** Props the trajectory pane model supplies to its view. */
export interface TrajectoryPanelViewProps {
  startTime: Beat;
  endTime: Beat;
  options: TrajectoryOptionBag;
  segments: number;
  splitSettings: TrajectorySplitSettings;
  replace?: boolean;
  enabled: boolean;
  animate: boolean;
  editing: boolean;
  status: string;
  statusError: boolean;
  applyDisabled: boolean;
  previewCanvasRef: RefCallback<HTMLCanvasElement>;
  statusRef: RefCallback<HTMLParagraphElement>;
  fieldsRevision: number;
  optionsRevision: number;
  onFieldsChange(values: Record<string, unknown>): void;
  onEnabledChange(value: boolean): void;
  onAnimateChange(value: boolean): void;
  onApply(): void;
  onSplit(): void;
  presets: TrajectoryPresetsViewProps;
}

/** Renders the trajectory form, preview canvas, presets, and footer actions. */
export function TrajectoryPanelView({
  startTime,
  endTime,
  options,
  segments,
  splitSettings,
  replace,
  enabled,
  animate,
  editing,
  status,
  statusError,
  applyDisabled,
  previewCanvasRef,
  statusRef,
  fieldsRevision,
  optionsRevision,
  onFieldsChange,
  onEnabledChange,
  onAnimateChange,
  onApply,
  onSplit,
  presets,
}: TrajectoryPanelViewProps) {
  return (
    <>
      <div className="trajectory-scroll">
        <TrajectoryFieldsView
          startTime={startTime}
          endTime={endTime}
          options={options}
          segments={segments}
          splitSettings={splitSettings}
          replace={replace}
          fieldsRevision={fieldsRevision}
          optionsRevision={optionsRevision}
          onChange={onFieldsChange}
        />
        <FieldRows>
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.trajectory.field.enabled")}
            control={(id) => (
              <Input
                id={id}
                data-key="enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) => onEnabledChange(event.currentTarget.checked)}
              />
            )}
          />
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.trajectory.field.animate")}
            control={(id) => (
              <Input
                id={id}
                data-key="animate"
                type="checkbox"
                checked={animate}
                onChange={(event) => onAnimateChange(event.currentTarget.checked)}
              />
            )}
          />
        </FieldRows>
        <canvas
          ref={previewCanvasRef}
          width={500}
          height={240}
          className="trajectory-preview"
          role="img"
          aria-label={t("editorPanels.trajectory.previewLabel")}
        />
        <p ref={statusRef} className={`hint${statusError ? " error" : ""}`} role="status">
          {status}
        </p>
        <TrajectoryPresetsView {...presets} />
      </div>
      <div className="trajectory-footer redux-footer-bar">
        <div className="redux-footer-actions">
          <Button
            type="button"
            variant="outlined"
            data-tip-desc={t("editorPanels.trajectory.splitHint")}
            hidden={!editing}
            onClick={onSplit}
          >
            {t("editorPanels.trajectory.split")}
          </Button>
          <Button
            type="button"
            variant="solid"
            data-tip-desc={t("editorPanels.trajectory.applyHint")}
            disabled={applyDisabled}
            onClick={onApply}
          >
            {editing
              ? t("editorPanels.trajectory.applyEdit")
              : t("editorPanels.trajectory.applyCreate")}
          </Button>
        </div>
      </div>
    </>
  );
}
