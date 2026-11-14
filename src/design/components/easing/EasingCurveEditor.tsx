/**
 * The shared curve editor for an event or a sampling draft.
 *
 * It owns the easing/Bezier mode switch, the preset and range controls, the
 * control-point editor, and the preview. The owning surface supplies the stored
 * values, one patch callback, its feature gates, and the two layout choices that
 * differ between the inspector and the floating sampling panel.
 */
import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import { FieldRow } from "../field/FieldRow.tsx";
import { Segmented, type SegmentedOption } from "../segmented/Segmented.tsx";
import { SliderField } from "../slider/SliderField.tsx";
import { BezierEditor } from "./BezierEditor.tsx";
import { EasingField } from "./EasingField.tsx";
import { EasingPreview } from "./EasingPreview.tsx";

/** The curve source the chart reads. */
export type EasingCurveMode = "easing" | "bezier";

/** A partial curve write from one control in the editor. */
export interface EasingCurvePatch {
  easingType?: number;
  bezier?: boolean;
  bezierPoints?: number[];
  easingLeft?: number;
  easingRight?: number;
}

/** One of the two easing sub-range bounds. */
export type EasingRangeFieldName = "easingLeft" | "easingRight";

/** The values and write channel one range row receives. */
export interface EasingRangeRow {
  id: string;
  label: string;
  value: number;
  onChange(value: number): void;
}

export interface EasingCurveEditorProps {
  mode: EasingCurveMode;
  /** The stored preset index. */
  easingType: number;
  /** Whether the stored curve selects the control points. */
  bezier: boolean;
  /** Already normalized control points from the owning curve model. */
  bezierPoints: readonly number[];
  easingLeft: number;
  easingRight: number;
  /** Optional numeric event endpoints used to orient the value axis. */
  startValue?: number;
  endValue?: number;
  /** Apply one control's change to the owning domain. */
  onChange(patch: EasingCurvePatch): void;
  /** Publish a transient control change without committing the owning domain. */
  onPreview?(patch: EasingCurvePatch | null): void;
  /** Visible label for the preset easing field. */
  easingLabel: string;
  /** Element ids for the two default range sliders. */
  rangeIds: { left: string; right: string };
  /** Extra class on the mode switch; surface spacing stays on the surface. */
  modeClassName?: string;
  /** Key for the control-point editor when a surface opens a fresh draft per target. */
  bezierKey?: string;
  /**
   * Where the easing preview draws. Bezier mode uses its own interactive canvas
   * and never renders this duplicate preview.
   */
  previewPlacement?: "easing" | "after-controls";
  /**
   * Where the range rows draw: inside the easing branch (inspector surfaces) or
   * after the preview, including Bezier mode (the floating sampling panel).
   */
  rangePlacement?: "easing" | "after-preview";
  /** Capability gate for the Bezier mode; omitted means enabled. */
  bezierEnabled?: () => boolean;
  /** Capability gate for range rows at their default values; omitted means enabled. */
  easingRangeEnabled?: () => boolean;
  /** Force range-row visibility for a surface that has its own raw visibility rule. */
  showRange?: boolean;
  /**
   * Draw one range row instead of the default slider. The event form uses this
   * to keep its live-edit focus handling and field marker.
   */
  renderRangeField?: (field: EasingRangeFieldName, row: EasingRangeRow) => ReactNode;
}

/** The default 0..1 slider row used by sampling surfaces. */
function defaultRangeRow(label: string, row: EasingRangeRow): ReactNode {
  return (
    <FieldRow
      layout="inline"
      density="compact"
      htmlFor={row.id}
      label={label}
      control={
        <SliderField
          id={row.id}
          min={0}
          max={1}
          step={0.01}
          value={row.value}
          aria-label={label}
          onChange={(event) => row.onChange(Number(event.currentTarget.value))}
        />
      }
    />
  );
}

/** Labelled easing and Bézier controls for one event or sampling draft. */
export function EasingCurveEditor({
  mode,
  easingType,
  bezier,
  bezierPoints,
  easingLeft,
  easingRight,
  startValue,
  endValue,
  onChange,
  onPreview,
  easingLabel,
  rangeIds,
  modeClassName,
  bezierKey,
  previewPlacement = "easing",
  rangePlacement = "easing",
  bezierEnabled,
  easingRangeEnabled,
  showRange,
  renderRangeField,
}: EasingCurveEditorProps) {
  const { t } = useTranslation();
  const bezierGate = bezierEnabled?.() ?? true;
  const rangeGate = easingRangeEnabled?.() ?? true;
  const rangeVisible = showRange ?? (rangeGate || easingLeft !== 0 || easingRight !== 1);
  const modeOptions: readonly SegmentedOption<EasingCurveMode>[] = [
    { value: "easing", label: t("editorPanels.inspector.event.easing") },
    { value: "bezier", label: t("editorPanels.inspector.event.modeBezier") },
  ];
  const previewEvent = {
    bezier: bezier ? 1 : 0,
    bezierPoints,
    easingType,
    easingLeft,
    easingRight,
    startValue,
    endValue,
  };
  // BezierEditor owns the interactive curve in Bezier mode. Rendering the
  // generic preview as well duplicated the curve and made the lower canvas
  // look like a stretched second editor.
  const preview = mode === "easing" ? <EasingPreview event={previewEvent} /> : null;
  const rangeRow = (field: EasingRangeFieldName, label: string, row: EasingRangeRow) =>
    renderRangeField ? renderRangeField(field, row) : defaultRangeRow(label, row);
  const rows = rangeVisible ? (
    <>
      {rangeRow("easingLeft", t("editorPanels.inspector.event.easingLeft"), {
        id: rangeIds.left,
        label: t("editorPanels.inspector.event.easingLeft"),
        value: easingLeft,
        onChange: (value) => onChange({ easingLeft: value }),
      })}
      {rangeRow("easingRight", t("editorPanels.inspector.event.easingRight"), {
        id: rangeIds.right,
        label: t("editorPanels.inspector.event.easingRight"),
        value: easingRight,
        onChange: (value) => onChange({ easingRight: value }),
      })}
    </>
  ) : null;

  return (
    <>
      {bezierGate && (
        <Segmented
          className={modeClassName}
          ariaLabel={t("editorPanels.inspector.event.easingMode")}
          value={mode}
          options={modeOptions}
          onChange={(next) =>
            onChange({
              bezier: next === "bezier",
              ...(next === "bezier" ? { bezierPoints: [...bezierPoints] } : {}),
            })
          }
        />
      )}
      {!bezierGate && bezier ? (
        <p className="hint">{t("editorPanels.inspector.event.bezierDisabled")}</p>
      ) : mode === "bezier" ? (
        <BezierEditor
          key={bezierKey}
          points={[...bezierPoints]}
          commit={(points) => onChange({ bezierPoints: points })}
          preview={(points) => onPreview?.(points ? { bezierPoints: [...points] } : null)}
          label={t("editorPanels.inspector.event.bezierPoints")}
        />
      ) : (
        <>
          <EasingField
            label={easingLabel}
            value={easingType}
            onChange={(value) => onChange({ easingType: value })}
          />
          {previewPlacement === "easing" && preview}
          {rangePlacement === "easing" && rows}
        </>
      )}
      {previewPlacement === "after-controls" && preview}
      {rangePlacement === "after-preview" && rows}
    </>
  );
}
