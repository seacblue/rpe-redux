/**
 * Inspector control surface for curve trajectory generation.
 *
 * Draw and equation are sibling authoring modes with independent cached paths.
 * The panel owns the generation range, sampling settings, the live equation
 * editor, and generation. The pane session borrows the stage camera for the whole
 * visit, the canvas overlay owns pointer selection, and the global transport owns
 * playback.
 */
import { useState, useSyncExternalStore } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { EasingField } from "../../../../design/components/easing/EasingField.tsx";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { FieldReset } from "../../../../design/components/field/FieldReset.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Segmented } from "../../../../design/components/segmented/Segmented.tsx";
import { SectionHeading } from "../../../../design/components/section/Section.tsx";
import { Slider } from "../../../../design/components/slider/Slider.tsx";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../workspace/runtime/composition/EditorRuntime.tsx";
import { BeatField } from "../inspector/beat/BeatField.tsx";
import { t, type MessageKey } from "../../../../i18n/index.ts";
import { beatValue, nudgeBeat } from "../../../../core/global/chart/timing/beat.ts";
import { EquationEditor } from "./EquationEditor.tsx";
import { EquationEditorModal } from "./EquationEditorModal.tsx";
import { generateCurveEvents } from "./generation.ts";
import {
  curveActiveComponents,
  curveActiveTarget,
  curvePreviewState,
  cancelCurveGestures,
  flushCurveDraft,
  updateCurveEquation,
  updateCurvePreview,
  CURVE_PREVIEW_RESET_DEFAULTS,
  type CurveEditMode,
} from "./store.ts";

const MODE_OPTIONS = [
  { value: "draw", label: "editorPanels.curvePreview.mode.draw" },
  { value: "equation", label: "editorPanels.curvePreview.mode.equation" },
] as const;

/** Inspector panel for curve generation: mode, range, sampling, preview, and commit. */
export function CurveEventsInspector() {
  const runtime = useEditorRuntime();
  const activePane = useEditorRuntimeValue((current) => current.ui.activeInspector, "");
  const active = activePane === "curve-preview";
  const [equationEditorAxis, setEquationEditorAxis] = useState<"x" | "y" | null>(null);
  const session = runtime?.session;
  const state = useSyncExternalStore(
    curvePreviewState.subscribe,
    curvePreviewState.get,
    curvePreviewState.get,
  );
  const division = runtime?.timeline.viewport.division ?? 4;
  const activeComponents = curveActiveComponents(state);
  const connectionWarning =
    activeComponents.length > 1
      ? t("editorPanels.curvePreview.connectionWarning", {
          count: activeComponents.length,
        })
      : activeComponents.length === 0
        ? t("editorPanels.curvePreview.authoring.noPath")
        : "";
  const equationInvalid = state.editMode === "equation" && state.equationInvalid;
  const canGenerate = activeComponents.length === 1 && Boolean(session) && !equationInvalid;

  /** Switch authoring modes after cancelling any gesture owned by the old mode. */
  const setMode = (mode: CurveEditMode) => {
    if (mode === state.editMode) {
      return;
    }
    cancelCurveGestures();
    updateCurvePreview({
      editMode: mode,
      status:
        mode === "draw"
          ? t("editorPanels.curvePreview.hint.select")
          : t("editorPanels.curvePreview.equationHint"),
    });
    flushCurveDraft();
  };

  /** Patch an equation field and resample its draft path. */
  const updateEquation = (patch: Partial<Omit<typeof state.equation, "component">>) => {
    updateCurveEquation(patch);
  };

  /** Validate the range and settings, then commit the active path as events. */
  const generate = () => {
    if (!session || activeComponents.length !== 1) {
      return;
    }
    const start = beatValue(state.startBeat);
    const end = beatValue(state.endBeat);
    if (start < 0 || !(end > start)) {
      showToast(t("editorPanels.curvePreview.authoring.error.range"), "warning");
      return;
    }
    const cutDensity = Number(state.cutDensity);
    if (!Number.isInteger(cutDensity) || cutDensity < 1 || cutDensity > 16) {
      showToast(t("editorPanels.curvePreview.cutInvalid"), "warning");
      return;
    }
    const fitTolerance = Number(state.fitPrecision);
    if (state.fitEnabled && (!Number.isFinite(fitTolerance) || fitTolerance <= 0)) {
      showToast(t("editorPanels.curvePreview.fitInvalid"), "warning");
      return;
    }
    const target = curveActiveTarget(state);
    if (!target) {
      showToast(
        t(
          activeComponents.length
            ? "editorPanels.curvePreview.authoring.multiPath"
            : "editorPanels.curvePreview.authoring.noPath",
        ),
        "warning",
      );
      return;
    }
    try {
      const result = generateCurveEvents(session, {
        component: target,
        startBeat: start,
        endBeat: end,
        layer: session.eventLayer,
        cutStepBeats: 1 / (cutDensity * division),
        tEasing: state.tEasing,
        fit: state.fitEnabled,
        fitTolerance,
        replace: true,
      });
      updateCurvePreview({
        status: t("editorPanels.curvePreview.authoring.generated", { count: result.count }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const keys: Record<string, MessageKey> = {
        "curve.range.invalid": "editorPanels.curvePreview.authoring.error.range",
        "curve.range.occupied": "editorPanels.curvePreview.authoring.error.occupied",
        "curve.layer.invalid": "editorPanels.curvePreview.authoring.error.layer",
        "curve.line.missing": "editorPanels.curvePreview.authoring.error.line",
        "curve.readonly": "editorPanels.curvePreview.authoring.error.readonly",
        "curve.path.empty": "editorPanels.curvePreview.authoring.noPath",
        "curve.cut.invalid": "editorPanels.curvePreview.cutInvalid",
        "curve.cut.tooFine": "editorPanels.curvePreview.cutTooFine",
        "curve.fit.invalid": "editorPanels.curvePreview.fitInvalid",
      };
      showToast(keys[message] ? t(keys[message]) : message, "warning");
    }
  };

  return (
    <>
      <div
        className="curve-inspector"
        data-mode={state.editMode}
        data-cut-density={state.cutDensity}
        data-division={division}
      >
        <Segmented
          className="is-block curve-mode-toggle"
          ariaLabel={t("editorPanels.curvePreview.editMode")}
          value={state.editMode}
          options={MODE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.label as MessageKey),
          }))}
          onChange={setMode}
        />
        <p className="hint curve-status" role="status" aria-live="polite">
          {state.status}
        </p>
        {equationInvalid ? (
          <p className="hint curve-equation-warning" role="alert">
            {t("editorPanels.curvePreview.equationInvalid")}
          </p>
        ) : null}
        <section className="curve-inspector-section">
          <SectionHeading as="strong" className="curve-section-head">
            {t("editorPanels.curvePreview.range")}
          </SectionHeading>
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.authoring.start")}
            control={(id) => (
              <BeatField
                id={id}
                className="curve-start-beat"
                value={state.startBeat}
                dataField="curveStartBeat"
                onCommit={(beat) => {
                  updateCurvePreview({ startBeat: beat });
                  return true;
                }}
                onNudge={(beat, direction) => nudgeBeat(beat, direction, division)}
              />
            )}
          />
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.authoring.end")}
            control={(id) => (
              <BeatField
                id={id}
                className="curve-end-beat"
                value={state.endBeat}
                dataField="curveEndBeat"
                onCommit={(beat) => {
                  updateCurvePreview({ endBeat: beat });
                  return true;
                }}
                onNudge={(beat, direction) => nudgeBeat(beat, direction, division)}
              />
            )}
          />
        </section>
        {state.editMode === "draw" ? (
          <section className="curve-inspector-section">
            <SectionHeading as="strong" className="curve-section-head">
              {t("editorPanels.curvePreview.section.canvas")}
            </SectionHeading>
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.gridEnabled")}
              idPrefix="curve-grid-enabled"
              reset={
                <FieldReset
                  field="show-grid"
                  label={t("editorPanels.curvePreview.gridEnabled")}
                  dirty={state.gridEnabled !== CURVE_PREVIEW_RESET_DEFAULTS.gridEnabled}
                  onReset={() =>
                    updateCurvePreview({ gridEnabled: CURVE_PREVIEW_RESET_DEFAULTS.gridEnabled })
                  }
                />
              }
              control={(id) => (
                <Input
                  id={id}
                  className="curve-grid-enabled"
                  type="checkbox"
                  checked={state.gridEnabled}
                  onChange={(event) =>
                    updateCurvePreview({ gridEnabled: event.currentTarget.checked })
                  }
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.gridDistance")}
              reset={
                <FieldReset
                  field="grid-distance"
                  label={t("editorPanels.curvePreview.gridDistance")}
                  dirty={state.gridDistance !== CURVE_PREVIEW_RESET_DEFAULTS.gridDistance}
                  onReset={() =>
                    updateCurvePreview({ gridDistance: CURVE_PREVIEW_RESET_DEFAULTS.gridDistance })
                  }
                  disabled={!state.gridEnabled}
                />
              }
              control={(id) => (
                <Slider
                  id={id}
                  className="curve-grid-distance"
                  min="10"
                  max="200"
                  step="5"
                  disabled={!state.gridEnabled}
                  value={state.gridDistance}
                  onChange={(event) =>
                    updateCurvePreview({ gridDistance: event.currentTarget.value })
                  }
                />
              )}
            />
          </section>
        ) : (
          <section className="curve-inspector-section">
            <SectionHeading as="strong" className="curve-section-head">
              {t("editorPanels.curvePreview.section.equation")}
            </SectionHeading>
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.equation.xLabel")}
              control={(id) => (
                <EquationEditor
                  inputId={id}
                  className="curve-equation-x"
                  ariaLabel={t("editorPanels.curvePreview.equation.xLabel")}
                  placeholder={t("editorPanels.curvePreview.equation.xPlaceholder")}
                  value={state.equation.xExpression}
                  onChange={(value) => updateEquation({ xExpression: value })}
                  onOpenEditor={() => setEquationEditorAxis("x")}
                  actionLabel={t("editorPanels.curvePreview.equationModal.open")}
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.equation.yLabel")}
              control={(id) => (
                <EquationEditor
                  inputId={id}
                  className="curve-equation-y"
                  ariaLabel={t("editorPanels.curvePreview.equation.yLabel")}
                  placeholder={t("editorPanels.curvePreview.equation.yPlaceholder")}
                  value={state.equation.yExpression}
                  onChange={(value) => updateEquation({ yExpression: value })}
                  onOpenEditor={() => setEquationEditorAxis("y")}
                  actionLabel={t("editorPanels.curvePreview.equationModal.open")}
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.equation.tStart")}
              control={(id) => (
                <Input
                  id={id}
                  type="number"
                  step="0.1"
                  value={state.equation.parameterStart}
                  onChange={(event) =>
                    updateEquation({ parameterStart: event.currentTarget.value })
                  }
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.curvePreview.equation.tEnd")}
              control={(id) => (
                <Input
                  id={id}
                  type="number"
                  step="0.1"
                  value={state.equation.parameterEnd}
                  onChange={(event) => updateEquation({ parameterEnd: event.currentTarget.value })}
                />
              )}
            />
            <p className="hint">{t("editorPanels.curvePreview.equationHint")}</p>
          </section>
        )}
        <section className="curve-inspector-section">
          <SectionHeading as="strong" className="curve-section-head">
            {t("editorPanels.curvePreview.section.sampling")}
          </SectionHeading>
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.cutDensity")}
            reset={
              <FieldReset
                field="cut-density"
                label={t("editorPanels.curvePreview.cutDensity")}
                dirty={state.cutDensity !== CURVE_PREVIEW_RESET_DEFAULTS.cutDensity}
                onReset={() =>
                  updateCurvePreview({ cutDensity: CURVE_PREVIEW_RESET_DEFAULTS.cutDensity })
                }
              />
            }
            control={(id) => (
              <Input
                id={id}
                className="curve-cut-density"
                type="number"
                min="1"
                max="16"
                step="1"
                value={state.cutDensity}
                onChange={(event) => updateCurvePreview({ cutDensity: event.currentTarget.value })}
              />
            )}
          />
          <EasingField
            label={t("editorPanels.curvePreview.tEasing")}
            value={state.tEasing}
            onChange={(tEasing) => updateCurvePreview({ tEasing })}
          />
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.fitEnabled")}
            reset={
              <FieldReset
                field="fit"
                label={t("editorPanels.curvePreview.fitEnabled")}
                dirty={state.fitEnabled !== CURVE_PREVIEW_RESET_DEFAULTS.fitEnabled}
                onReset={() =>
                  updateCurvePreview({ fitEnabled: CURVE_PREVIEW_RESET_DEFAULTS.fitEnabled })
                }
              />
            }
            control={(id) => (
              <Input
                id={id}
                className="curve-fit-enabled"
                type="checkbox"
                checked={state.fitEnabled}
                onChange={(event) =>
                  updateCurvePreview({ fitEnabled: event.currentTarget.checked })
                }
              />
            )}
          />
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.fitPrecision")}
            reset={
              <FieldReset
                field="fit-precision"
                label={t("editorPanels.curvePreview.fitPrecision")}
                dirty={state.fitPrecision !== CURVE_PREVIEW_RESET_DEFAULTS.fitPrecision}
                onReset={() =>
                  updateCurvePreview({ fitPrecision: CURVE_PREVIEW_RESET_DEFAULTS.fitPrecision })
                }
                disabled={!state.fitEnabled}
              />
            }
            control={(id) => (
              <Input
                id={id}
                className="curve-fit-precision"
                type="number"
                min="0.01"
                step="0.1"
                disabled={!state.fitEnabled}
                value={state.fitPrecision}
                onChange={(event) =>
                  updateCurvePreview({ fitPrecision: event.currentTarget.value })
                }
              />
            )}
          />
        </section>
        <section className="curve-inspector-section">
          <SectionHeading as="strong" className="curve-section-head">
            {t("editorPanels.curvePreview.section.preview")}
          </SectionHeading>
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.previewLineOnly")}
            reset={
              <FieldReset
                field="preview-line-only"
                label={t("editorPanels.curvePreview.previewLineOnly")}
                dirty={state.previewLineOnly !== CURVE_PREVIEW_RESET_DEFAULTS.previewLineOnly}
                onReset={() =>
                  updateCurvePreview({
                    previewLineOnly: CURVE_PREVIEW_RESET_DEFAULTS.previewLineOnly,
                  })
                }
              />
            }
            control={(id) => (
              <Input
                id={id}
                className="curve-preview-line-only"
                type="checkbox"
                checked={state.previewLineOnly}
                onChange={(event) =>
                  updateCurvePreview({ previewLineOnly: event.currentTarget.checked })
                }
              />
            )}
          />
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.curvePreview.loopEnabled")}
            idPrefix="curve-loop-enabled"
            reset={
              <FieldReset
                field="loop-ab"
                label={t("editorPanels.curvePreview.loopEnabled")}
                dirty={state.loopEnabled !== CURVE_PREVIEW_RESET_DEFAULTS.loopEnabled}
                onReset={() =>
                  updateCurvePreview({ loopEnabled: CURVE_PREVIEW_RESET_DEFAULTS.loopEnabled })
                }
              />
            }
            control={(id, describedBy) => (
              <Input
                id={id}
                className="curve-loop-enabled"
                type="checkbox"
                aria-describedby={describedBy}
                checked={state.loopEnabled}
                onChange={(event) =>
                  updateCurvePreview({ loopEnabled: event.currentTarget.checked })
                }
              />
            )}
          />
        </section>
        <div className="curve-actions redux-footer-bar">
          <div className="redux-footer-actions">
            <Button
              type="button"
              variant="solid"
              className="curve-generate"
              title={connectionWarning || undefined}
              disabled={!canGenerate}
              onClick={generate}
            >
              {t("editorPanels.curvePreview.generateCurve")}
            </Button>
          </div>
        </div>
      </div>
      {active && equationEditorAxis ? (
        <EquationEditorModal
          open
          axis={equationEditorAxis}
          value={
            equationEditorAxis === "x" ? state.equation.xExpression : state.equation.yExpression
          }
          onChange={(value) =>
            updateEquation(
              equationEditorAxis === "x" ? { xExpression: value } : { yExpression: value },
            )
          }
          onClose={() => setEquationEditorAxis(null)}
        />
      ) : null}
    </>
  );
}
