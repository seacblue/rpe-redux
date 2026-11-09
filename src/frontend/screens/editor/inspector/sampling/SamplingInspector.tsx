/**
 * The sampling inspector pane.
 *
 * It shows the durable guide preferences and the full easing editor. The
 * workspace overlay owns pointer sampling; this pane edits the shared draft
 * and commits it.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";
import { EasingCurveEditor } from "../../../../../design/components/easing/EasingCurveEditor.tsx";
import { showToast } from "../../../../../design/patterns/ToastHost.tsx";
import {
  SAMPLING_ALPHA_MAX,
  SAMPLING_ALPHA_MIN,
  SAMPLING_ANGLE_MAX,
  SAMPLING_ANGLE_MIN,
  SAMPLING_GUIDE_MAX,
  SAMPLING_GUIDE_MIN,
  SAMPLING_GUIDE_OPACITY_MAX,
  SAMPLING_GUIDE_OPACITY_MIN,
  SAMPLING_SPEED_MAX,
  SAMPLING_SPEED_MIN,
  samplingSettings,
  updateSamplingSettings,
} from "../../../../../core/edit/sampling/sampling.ts";
import { SAMPLING_SHORTCUT_IDS } from "../../../../../core/edit/shortcuts/shortcutCatalog.ts";
import { matches } from "../../../../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../../../../core/shortcuts/registry.ts";
import { useTranslation } from "../../../../../i18n/react.ts";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import { useEditorRuntime } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { useSetting } from "../../../settings/useSetting.ts";
import { InspectorEmpty } from "../InspectorEmpty.tsx";
import {
  cancelSampling,
  commitSampling,
  samplingSession,
  setSamplingCurve,
} from "../../sampling/samplingSession.ts";
import { resolveCurveValues } from "../../sampling/samplingCurveModel.ts";

const EMPTY_BINDINGS: readonly never[] = [];

/** Renders the current sampling session and its commit controls. */
export function SamplingInspector() {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const session = useSyncExternalStore(
    samplingSession.subscribe,
    samplingSession.get,
    samplingSession.get,
  );
  const settings = useSyncExternalStore(
    samplingSettings.subscribe,
    samplingSettings.get,
    samplingSettings.get,
  );
  const shortcutViews = useSyncExternalStore(
    shortcutRegistry.subscribe,
    shortcutRegistry.getSnapshot,
    shortcutRegistry.getSnapshot,
  );
  const applyBindings =
    shortcutViews.find((view) => view.id === SAMPLING_SHORTCUT_IDS.apply)?.bindings ??
    EMPTY_BINDINGS;
  const cancelBindings =
    shortcutViews.find((view) => view.id === SAMPLING_SHORTCUT_IDS.cancel)?.bindings ??
    EMPTY_BINDINGS;
  const bezierEnabled = useEditingFeature("bezier");
  const easingRangeEnabled = useEditingFeature("easingRange");
  const globalXYBinding = useSetting("xy-binding", false);
  const target = session.target;
  const axis = target?.axis ?? null;
  const draft = session.draft;
  const curve = draft.curve;
  const easingType = curve.easingType ?? session.easingType;
  const curveValues = resolveCurveValues(curve);
  const curveMode = curveValues.bezier ? "bezier" : "easing";
  const canCommit = Boolean(draft.start && draft.end) && !session.dragging;

  /** Commits the draft, reporting a rejected edit without closing. */
  const commit = useCallback(() => {
    if (!runtime) {
      return;
    }
    const result = commitSampling(runtime.session);
    if (!result.ok && result.error) {
      showToast(
        result.error instanceof Error ? result.error.message : String(result.error),
        "error",
        5000,
      );
    }
  }, [runtime]);

  // Sampling keeps both ends of the loop under the left hand: the registered
  // cancel binding (Escape by default) cancels, the registered apply binding (F
  // by default) confirms, and Enter confirms from the workspace but keeps native
  // behavior on the pane's own controls. The editor dispatcher leaves these
  // passive bindings to this capture listener while sampling is active.
  useEffect(() => {
    if (!target) {
      return;
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (cancelBindings.some((binding) => matches(event, binding))) {
        event.preventDefault();
        event.stopPropagation();
        cancelSampling();
        return;
      }
      const targetElement = event.target instanceof Element ? event.target : null;
      const onControl = Boolean(
        targetElement?.closest("button, input, select, textarea, [contenteditable='true']"),
      );
      const applyKey = applyBindings.some((binding) => matches(event, binding));
      if (!applyKey && !(event.key === "Enter" && !onControl)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      commit();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [applyBindings, cancelBindings, commit, target]);

  if (!target || !axis) {
    return <InspectorEmpty>{t("editorPanels.sampling.empty")}</InspectorEmpty>;
  }

  return (
    <>
      <FieldRow
        layout="inline"
        density="compact"
        label={t("editorPanels.sampling.guides")}
        control={(id) => (
          <Input
            id={id}
            type="checkbox"
            checked={settings.guidesEnabled}
            onChange={(event) =>
              updateSamplingSettings({ guidesEnabled: event.currentTarget.checked })
            }
          />
        )}
      />
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor="sampling-guide-opacity"
        label={t("editorPanels.sampling.guideOpacity")}
        disabled={!settings.guidesEnabled}
        control={
          <SliderField
            id="sampling-guide-opacity"
            min={SAMPLING_GUIDE_OPACITY_MIN}
            max={SAMPLING_GUIDE_OPACITY_MAX}
            step={1}
            value={settings.guideOpacity}
            percentage
            disabled={!settings.guidesEnabled}
            aria-label={t("editorPanels.sampling.guideOpacity")}
            onChange={(event) =>
              updateSamplingSettings({ guideOpacity: Number(event.currentTarget.value) })
            }
          />
        }
      />
      {(axis === "x" || axis === "y") && (
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="sampling-guide-step"
          label={t("editorPanels.sampling.guideStep")}
          disabled={!settings.guidesEnabled}
          control={
            <SliderField
              id="sampling-guide-step"
              min={SAMPLING_GUIDE_MIN}
              max={SAMPLING_GUIDE_MAX}
              step={1}
              value={settings.guideStep}
              disabled={!settings.guidesEnabled}
              aria-label={t("editorPanels.sampling.guideStep")}
              onChange={(event) =>
                updateSamplingSettings({ guideStep: Number(event.currentTarget.value) })
              }
            />
          }
        />
      )}
      {axis === "rotation" && (
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="sampling-angle-guide"
          label={t("editorPanels.sampling.angleGuide")}
          disabled={!settings.guidesEnabled}
          control={
            <SliderField
              id="sampling-angle-guide"
              min={SAMPLING_ANGLE_MIN}
              max={SAMPLING_ANGLE_MAX}
              step={1}
              value={settings.angleGuideStep}
              disabled={!settings.guidesEnabled}
              aria-label={t("editorPanels.sampling.angleGuide")}
              onChange={(event) =>
                updateSamplingSettings({ angleGuideStep: Number(event.currentTarget.value) })
              }
            />
          }
        />
      )}
      {axis === "alpha" && (
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="sampling-alpha-guide"
          label={t("editorPanels.sampling.alphaGuide")}
          disabled={!settings.guidesEnabled}
          control={
            <SliderField
              id="sampling-alpha-guide"
              min={SAMPLING_ALPHA_MIN}
              max={SAMPLING_ALPHA_MAX}
              step={1}
              value={settings.alphaGuideStep}
              disabled={!settings.guidesEnabled}
              aria-label={t("editorPanels.sampling.alphaGuide")}
              onChange={(event) =>
                updateSamplingSettings({ alphaGuideStep: Number(event.currentTarget.value) })
              }
            />
          }
        />
      )}
      {axis === "speed" && (
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="sampling-speed-guide"
          label={t("editorPanels.sampling.speedGuide")}
          disabled={!settings.guidesEnabled}
          control={
            <SliderField
              id="sampling-speed-guide"
              min={SAMPLING_SPEED_MIN}
              max={SAMPLING_SPEED_MAX}
              step={0.1}
              value={settings.speedGuideStep}
              disabled={!settings.guidesEnabled}
              aria-label={t("editorPanels.sampling.speedGuide")}
              onChange={(event) =>
                updateSamplingSettings({ speedGuideStep: Number(event.currentTarget.value) })
              }
            />
          }
        />
      )}
      {(axis === "x" || axis === "y") && (
        <>
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.sampling.xyBinding")}
            description={t("editorPanels.sampling.xyBindingHint")}
            disabled={globalXYBinding}
            control={(id) => (
              <Input
                id={id}
                type="checkbox"
                checked={globalXYBinding || settings.xyBinding}
                disabled={globalXYBinding}
                onChange={(event) =>
                  updateSamplingSettings({ xyBinding: event.currentTarget.checked })
                }
              />
            )}
          />
        </>
      )}
      <EasingCurveEditor
        mode={curveMode}
        easingType={easingType}
        bezier={curveValues.bezier}
        bezierPoints={curveValues.bezierPoints}
        easingLeft={curveValues.easingLeft}
        easingRight={curveValues.easingRight}
        onChange={(patch) =>
          setSamplingCurve({
            ...patch,
            ...(patch.bezierPoints ? { bezier: true } : {}),
          })
        }
        easingLabel={t("editorPanels.sampling.easing")}
        rangeIds={{ left: "sampling-easing-left", right: "sampling-easing-right" }}
        modeClassName="is-block"
        previewPlacement="after-controls"
        bezierEnabled={() => bezierEnabled}
        easingRangeEnabled={() => easingRangeEnabled}
      />

      <div className="sampling-actions redux-footer-bar">
        <div className="redux-footer-actions">
          <Button
            type="button"
            variant="outlined"
            aria-keyshortcuts="Escape"
            onClick={cancelSampling}
          >
            {t("editorPanels.sampling.cancel")}
          </Button>
          <Button
            type="button"
            variant="solid"
            aria-keyshortcuts="F Enter"
            disabled={!canCommit}
            onClick={commit}
          >
            {t("editorPanels.sampling.confirm")}
          </Button>
        </div>
      </div>
    </>
  );
}
