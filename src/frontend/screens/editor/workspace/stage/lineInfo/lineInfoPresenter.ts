/** Builds the line-info readout from sampled chart state for the stage overlay. */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { t } from "../../../../../../i18n/index.ts";

/** Formats one numeric readout, falling back to zero for non-finite values. */
const format = (value: unknown, digits = 2, maxWidth = Number.POSITIVE_INFINITY): string => {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  const numeric = Number(value);
  let precision = digits;
  let text = numeric.toFixed(precision);
  while (precision > 0 && readoutWidth(text) > maxWidth) {
    precision -= 1;
    text = numeric.toFixed(precision);
  }
  return text;
};

/** Estimates proportional-font width in `ch` units for a numeric readout. */
function readoutWidth(text: string): number {
  return [...text].reduce(
    (width, character) => width + (character === "." ? 0.35 : character === "-" ? 0.55 : 1),
    0,
  );
}

/** Classifies a rendered token so CSS can reserve a real width for numbers. */
export type LineInfoTokenKind = "text" | "coordinate" | "angle" | "speed" | "velocity" | "alpha";

/** A piece of the readout with semantic styling information. */
export interface LineInfoToken {
  readonly text: string;
  readonly kind: LineInfoTokenKind;
}

/** The two rows rendered by the line-info overlay. */
export interface LineInfoLayout {
  readonly rows: readonly (readonly LineInfoToken[])[];
}

/** Text plus structured rows for stable numeric layout. */
export interface LineInfoPresentation {
  readonly text: string;
  readonly layout: LineInfoLayout;
}

/**
 * Builds the line-info text for the selected line at chart time `seconds`.
 *
 * `previousSeconds` is the chart time from the previous rendered frame. The
 * velocity row intentionally reports the authored value delta between those
 * two frames, not a per-second derivative.
 */
export function buildLineInfoPresentation(
  scene: SceneRuntime,
  chart: Chart,
  lineIndex: number,
  seconds: number,
  tempo: TempoMap,
  previousSeconds?: number,
): LineInfoPresentation {
  scene.compile(chart, tempo);
  const state = scene.sampler(seconds)(lineIndex) ?? {
    x: 0,
    y: 0,
    rotation: 0,
    alpha: 255,
  };
  const runtime = scene.lines[lineIndex];
  const speed = runtime?.speeds?.reduce((sum, track) => sum + (track.value(seconds) || 0), 0) ?? 0;
  const previous =
    Number.isFinite(previousSeconds) && previousSeconds !== undefined
      ? (scene.sampler(previousSeconds)(lineIndex) ?? state)
      : state;
  // The sampler is evaluated in chart seconds and returns the line's authored
  // world state. These are frame deltas, so no preview camera scale, playback
  // rate, or per-second conversion belongs here.
  const xRate = state.x - previous.x;
  const yRate = state.y - previous.y;
  const rotationRate = state.rotation - previous.rotation;
  const rows: readonly (readonly LineInfoToken[])[] = [
    [
      { text: t("editorPanels.lineInfo.positionLabel"), kind: "text" },
      { text: " (", kind: "text" },
      { text: format(state.x, 2, 6), kind: "coordinate" },
      { text: ", ", kind: "text" },
      { text: format(state.y, 2, 6), kind: "coordinate" },
      { text: ") ", kind: "text" },
      { text: t("editorPanels.lineInfo.directionLabel"), kind: "text" },
      { text: " ", kind: "text" },
      { text: format(state.rotation, 2, 5), kind: "angle" },
      { text: " ", kind: "text" },
      { text: t("editorPanels.lineInfo.alphaLabel"), kind: "text" },
      { text: " ", kind: "text" },
      { text: format(state.alpha, 0), kind: "alpha" },
      { text: " ", kind: "text" },
      { text: t("editorPanels.lineInfo.speedLabel"), kind: "text" },
      { text: " ", kind: "text" },
      { text: format(speed, 2, 3), kind: "speed" },
    ],
    [
      { text: t("editorPanels.lineInfo.velocityLabel"), kind: "text" },
      { text: " ", kind: "text" },
      { text: format(xRate, 2, 3.5), kind: "velocity" },
      { text: ", ", kind: "text" },
      { text: format(yRate, 2, 3.5), kind: "velocity" },
      { text: ", ", kind: "text" },
      { text: format(rotationRate, 2, 3.5), kind: "velocity" },
    ],
  ];
  return {
    text: rows.map((row) => row.map((token) => token.text).join("")).join("\n"),
    layout: { rows },
  };
}

/** Builds the legacy plain-text form used by non-visual callers and tests. */
export function buildLineInfoText(
  scene: SceneRuntime,
  chart: Chart,
  lineIndex: number,
  seconds: number,
  tempo: TempoMap,
  previousSeconds?: number,
): string {
  return buildLineInfoPresentation(scene, chart, lineIndex, seconds, tempo, previousSeconds).text;
}
