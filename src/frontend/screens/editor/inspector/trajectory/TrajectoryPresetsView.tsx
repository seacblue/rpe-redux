/**
 * Preset browser for the trajectory pane: built-in categories, custom entries,
 * and hover previews drawn on a scratch canvas.
 *
 * Selecting a preset reports it and its options upward; nothing is applied from
 * this view.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Disclosure } from "../../../../../design/components/disclosure/Disclosure.tsx";
import { SchemaControl } from "../../../../../design/components/field/SchemaControl.tsx";
import { Textarea } from "../../../../../design/components/input/Textarea.tsx";
import {
  CURVE_PRESETS,
  PRESET_CATEGORIES,
  sampleCurveTrajectory,
  type CurvePreset,
  type EditableTrajectoryOptions,
  type TrajectorySample,
  type ValidatedCurvePreset,
} from "../../../../../core/global/chart/trajectory/curveTrajectory.ts";
import { secureRandomIntInclusive } from "../../../../../core/utils/random.ts";
import {
  COMMON_FIELDS,
  drawPath,
  errorMessage,
  optionsForPreset,
} from "./trajectoryPanelControls.ts";
import { t } from "../../../../../i18n/index.ts";

/** A built-in or custom trajectory preset. */
export type TrajectoryPreset = CurvePreset | ValidatedCurvePreset;

/** Edited preview of one preset, shared with the main pane. */
export interface PresetPreviewDraft {
  preset: TrajectoryPreset;
  options: EditableTrajectoryOptions;
  points: TrajectorySample[];
  canvas: HTMLCanvasElement;
}

/** Preset state and callbacks supplied by the trajectory panel. */
export interface TrajectoryPresetsViewProps {
  custom: ValidatedCurvePreset[];
  customSource: string;
  customEditingName: string | null;
  customMessage: string;
  customHasError: boolean;
  customCopyVisible: boolean;
  customActionsDisabled: boolean;
  customOpen: boolean;
  customScrollRevision: number;
  openCategory: string | null;
  openCategoryRevision: number;
  onTogglePreset: (preset: TrajectoryPreset | null) => void;
  onPresetDraft: (draft: PresetPreviewDraft) => void;
  onPresetError: (error: unknown) => void;
  onFillPreset: (options: EditableTrajectoryOptions) => void;
  onDeletePreset: (preset: ValidatedCurvePreset) => void;
  onEditCustom: (preset: ValidatedCurvePreset) => void;
  onCustomOpenChange: (open: boolean) => void;
  onCustomSource: (source: string) => void;
  onLoadCurrent: () => void;
  onSaveCustom: () => void;
  onCopyCustom: () => void;
  onExportCustom: () => void;
  onImportCustom: (file: File) => void;
  onCustomError: (error: unknown) => void;
}

/** Draws a preset's unedited path as its card thumbnail. */
function PresetCardPreview({ preset }: { preset: TrajectoryPreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const options = useMemo(() => optionsForPreset(preset), [preset]);
  const points = useMemo(() => sampleCurveTrajectory(options, 129), [options]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        drawPath(canvas, points);
      } catch {
        drawPath(canvas, null);
      }
    }
  }, [points]);

  return <canvas ref={canvasRef} width={150} height={90} aria-hidden="true" />;
}

/** One labeled preset parameter input, optionally with a randomize action. */
function PresetField({
  label,
  value,
  type = "text",
  minimum,
  maximum,
  step,
  onValue,
  randomize,
}: {
  label: string;
  value: unknown;
  type?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  onValue: (value: unknown) => void;
  randomize?: () => void;
}) {
  const input = (id?: string) => (
    <SchemaControl
      id={id ?? `trajectory-preset-${label}`}
      kind={type === "checkbox" ? "toggle" : type === "number" ? "number" : "text"}
      min={minimum}
      max={maximum}
      step={step}
      value={type === "checkbox" ? Boolean(value) : String(value ?? "")}
      onChange={(next) => {
        onValue(
          type === "checkbox"
            ? Boolean(next)
            : type === "number"
              ? String(next).trim()
                ? Number(next)
                : Number.NaN
              : String(next),
        );
      }}
    />
  );

  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={label}
      control={(id) =>
        randomize ? (
          <span className="trajectory-seed">
            {input(id)}
            <Button
              type="button"
              variant="ghost"
              aria-label={t("editorPanels.trajectory.randomize")}
              data-tip-title={t("editorPanels.trajectory.randomize")}
              onClick={randomize}
            >
              ⚄
            </Button>
          </span>
        ) : (
          input(id)
        )
      }
    />
  );
}

/** Edits a preset's parameters and previews the result live. */
function PresetEditor({
  preset,
  isCustom,
  onDraft,
  onError,
  onFill,
  onEditCustom,
  onDeletePreset,
}: {
  preset: TrajectoryPreset;
  isCustom: boolean;
  onDraft: (draft: PresetPreviewDraft) => void;
  onError: (error: unknown) => void;
  onFill: (options: EditableTrajectoryOptions) => void;
  onEditCustom: (preset: ValidatedCurvePreset) => void;
  onDeletePreset: (preset: ValidatedCurvePreset) => void;
}) {
  const base = useMemo(() => optionsForPreset(preset), [preset]);
  const [parameters, setParameters] = useState<Record<string, unknown>>(() => ({
    ...base.parameters,
  }));
  const [common, setCommon] = useState<Record<string, unknown>>(() => ({ ...base }));
  const [status, setStatus] = useState(t("editorPanels.trajectory.draftPreview"));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const result = useMemo(() => {
    try {
      const options = {
        ...base,
        ...common,
        parameters: { ...base.parameters, ...parameters },
      } as EditableTrajectoryOptions;
      return { options, points: sampleCurveTrajectory(options, 257), error: null };
    } catch (error) {
      return { options: null, points: null, error };
    }
  }, [base, common, parameters]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      drawPath(canvas, result.points);
      if (result.options && result.points) {
        onDraft({ preset, options: result.options, points: result.points, canvas });
      } else if (result.error) {
        onError(result.error);
      }
    }
  }, [onDraft, onError, preset, result]);

  const changeParameter = (key: string, value: unknown) => {
    setParameters((current) => ({ ...current, [key]: value }));
    setStatus(t("editorPanels.trajectory.draftPreview"));
  };
  const changeCommon = (key: string, value: unknown) => {
    setCommon((current) => ({ ...current, [key]: value }));
    setStatus(t("editorPanels.trajectory.draftPreview"));
  };
  const fill = () => {
    if (!result.options) {
      return;
    }
    onFill(result.options);
    setStatus(t("editorPanels.trajectory.filled"));
  };

  return (
    <div className="trajectory-preset-editor">
      <strong>{t("editorPanels.trajectory.presetAdjust", { name: preset.name })}</strong>
      {isCustom && (
        <div className="trajectory-preset-actions">
          <Button
            type="button"
            variant="outlined"
            onClick={() => onEditCustom(preset as ValidatedCurvePreset)}
          >
            {t("editorPanels.trajectory.editPreset")}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => onDeletePreset(preset as ValidatedCurvePreset)}
          >
            {t("editorPanels.trajectory.deletePreset")}
          </Button>
        </div>
      )}
      <FieldRows>
        {preset.parameters.map((entry) => (
          <PresetField
            key={entry.key}
            label={entry.label ?? entry.key}
            value={parameters[entry.key] ?? entry.value}
            type="number"
            minimum={entry.min}
            maximum={entry.max}
            step={entry.step ?? 1}
            onValue={(value) => changeParameter(entry.key, value)}
          />
        ))}
      </FieldRows>
      <FieldRows>
        {COMMON_FIELDS.map(([key, label, type, minimum, maximum, step]) => (
          <PresetField
            key={key}
            label={t(label)}
            value={common[key]}
            type={type ?? "text"}
            minimum={minimum}
            maximum={maximum}
            step={step}
            randomize={
              key === "seed"
                ? () => {
                    const previous = Number(common.seed ?? 0);
                    const next = (previous + 1 + secureRandomIntInclusive(0, 100000)) % 100001;
                    changeCommon("seed", next);
                  }
                : undefined
            }
            onValue={(value) => changeCommon(key, value)}
          />
        ))}
      </FieldRows>
      <canvas
        ref={canvasRef}
        width={500}
        height={220}
        className="trajectory-preview"
        role="img"
        aria-label={t("editorPanels.trajectory.previewLabel")}
      />
      <p className={`hint${result.error ? " error" : ""}`}>
        {result.error ? errorMessage(result.error) : status}
      </p>
      <Button type="button" variant="outlined" disabled={!result.options} onClick={fill}>
        {t("editorPanels.trajectory.fillParameters")}
      </Button>
    </div>
  );
}

/** Renders built-in categories and the custom preset editor. */
export function TrajectoryPresetsView({
  custom,
  customSource,
  customEditingName,
  customMessage,
  customHasError,
  customCopyVisible,
  customActionsDisabled,
  customOpen,
  customScrollRevision,
  openCategory,
  openCategoryRevision,
  onTogglePreset,
  onPresetDraft,
  onPresetError,
  onFillPreset,
  onDeletePreset,
  onEditCustom,
  onCustomOpenChange,
  onCustomSource,
  onLoadCurrent,
  onSaveCustom,
  onCopyCustom,
  onExportCustom,
  onImportCustom,
  onCustomError,
}: TrajectoryPresetsViewProps) {
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set());
  const [expandedPreset, setExpandedPreset] = useState<string | null>(null);
  const customGroupRef = useRef<HTMLDetailsElement>(null);
  const categoryRefs = useRef(new Map<string, HTMLDetailsElement>());
  const customCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const customPoints = useMemo(() => {
    try {
      return sampleCurveTrajectory(optionsForPreset(JSON.parse(customSource)), 257);
    } catch {
      return null;
    }
  }, [customSource]);
  const presets: TrajectoryPreset[] = useMemo(() => [...CURVE_PRESETS, ...custom], [custom]);

  useEffect(() => {
    const canvas = customCanvasRef.current;
    if (canvas) {
      drawPath(canvas, customPoints);
    }
  }, [customPoints]);

  useEffect(() => {
    if (customScrollRevision) {
      customGroupRef.current?.scrollIntoView({ block: "start" });
    }
  }, [customScrollRevision]);

  useEffect(() => {
    if (openCategory) {
      const category = categoryRefs.current.get(openCategory);
      if (category) {
        category.open = true;
      }
    }
  }, [openCategory, openCategoryRevision]);

  /** Records which preset category is expanded. */
  const toggleCategory = (category: string, open: boolean) => {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (open) {
        next.add(category);
      } else {
        next.delete(category);
      }
      return next;
    });
  };

  /** Expands one preset at a time and reports it to the panel. */
  const togglePreset = (preset: TrajectoryPreset) => {
    const key = `${preset.category}:${preset.name}`;
    const next = expandedPreset === key ? null : key;
    setExpandedPreset(next);
    onTogglePreset(next ? preset : null);
  };

  /** Imports one bounded preset file and clears the file input. */
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      if (file.size > 65536) {
        throw new Error(t("editorPanels.trajectory.fileTooLarge"));
      }
      await onImportCustom(file);
    } catch (error) {
      onCustomError(error);
    } finally {
      input.value = "";
    }
  };

  return (
    <>
      {Object.values(PRESET_CATEGORIES).map((category) => (
        <Disclosure
          key={category}
          ref={(element) => {
            if (element) {
              categoryRefs.current.set(category, element);
            } else {
              categoryRefs.current.delete(category);
            }
          }}
          data-category={category}
          open={openCategories.has(category)}
          onOpenChange={(open) => toggleCategory(category, open)}
          summary={t(category)}
        >
          <div className="trajectory-preset-grid">
            {presets
              .filter((preset) => preset.category === category)
              .map((preset) => {
                const key = `${preset.category}:${preset.name}`;
                const isCustom = custom.includes(preset as ValidatedCurvePreset);
                const isExpanded = expandedPreset === key;
                return (
                  <Fragment key={key}>
                    <Button
                      type="button"
                      variant="plain"
                      aria-expanded={isExpanded}
                      onClick={() => togglePreset(preset)}
                    >
                      <PresetCardPreview preset={preset} />
                      {preset.name}
                    </Button>
                    {isExpanded && (
                      <PresetEditor
                        key={key}
                        preset={preset}
                        onDraft={onPresetDraft}
                        onError={onPresetError}
                        onFill={onFillPreset}
                        isCustom={isCustom}
                        onEditCustom={onEditCustom}
                        onDeletePreset={onDeletePreset}
                      />
                    )}
                  </Fragment>
                );
              })}
          </div>
        </Disclosure>
      ))}
      <Disclosure
        ref={customGroupRef}
        open={customOpen}
        onOpenChange={onCustomOpenChange}
        summary={t("editorPanels.trajectory.customEditor")}
      >
        <Button
          type="button"
          variant="outlined"
          data-tip-desc={t("editorPanels.trajectory.fillJsonHint")}
          onClick={onLoadCurrent}
        >
          {t("editorPanels.trajectory.fillJson")}
        </Button>
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.trajectory.customJson")}
          control={(id) => (
            <Textarea
              id={id}
              className="trajectory-preset-source"
              aria-invalid={customHasError || undefined}
              value={customSource}
              autoComplete="off"
              onChange={(event) => onCustomSource(event.currentTarget.value)}
            />
          )}
        />
        <p className={`hint${customHasError ? " error" : ""}`} role="status">
          {customMessage}
        </p>
        <canvas
          ref={customCanvasRef}
          width={500}
          height={180}
          className="trajectory-preview"
          role="img"
          aria-label={t("editorPanels.trajectory.previewLabel")}
        />
        <div className="trajectory-custom-actions redux-footer-bar">
          <div className="redux-footer-actions">
            {customCopyVisible && (
              <Button
                type="button"
                variant="outlined"
                disabled={customActionsDisabled}
                onClick={onCopyCustom}
              >
                {t("editorPanels.trajectory.saveAsNew")}
              </Button>
            )}
            <Button
              type="button"
              variant="outlined"
              disabled={customActionsDisabled}
              onClick={onExportCustom}
            >
              {t("editorPanels.trajectory.exportPreset")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              hidden={true}
              onChange={importFile}
            />
            <Button type="button" variant="outlined" onClick={() => fileInputRef.current?.click()}>
              {t("editorPanels.trajectory.importPreset")}
            </Button>
            <Button
              type="button"
              variant="solid"
              disabled={customActionsDisabled}
              onClick={onSaveCustom}
            >
              {customEditingName
                ? t("editorPanels.trajectory.saveChanges")
                : t("editorPanels.trajectory.addCustom")}
            </Button>
          </div>
        </div>
      </Disclosure>
    </>
  );
}
