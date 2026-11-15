/**
 * Canvas renderer for the chart's `attachUI` game HUD: score, combo, judgement,
 * and the corner labels. Layout and bindings come from `drawing/gameUi.ts`; this
 * module only draws the resolved elements.
 */
import { gameUiLayout, gameUiBindings, type GameUiItem } from "../drawing/gameUi.ts";
import { scoreAt } from "../../../../../../core/global/chart/runtime/gameScoring.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import type { LineState } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { PreviewViewport } from "../scene/viewport.ts";

/** Screen-space camera projection used to place the HUD inside the chart frame. */
export interface GameUiView {
  centerX: number;
  centerY: number;
  scale: number;
}

/** Chart fields used by the game UI. */
export interface GameUiChart {
  META: { offset?: number; name?: string; level?: string };
  judgeLineList?: { attachUI?: string }[];
}

/**
 * The skin only needs to provide a tinted pause icon.
 *
 * A structural type keeps the preview from depending on the full `RpeSkin`.
 */
export interface GameUiSkin {
  tinted(name: string, color: number[]): CanvasImageSource | null;
}

/** Return the horizontal scale needed to keep one corner label inside its slot. */
export function gameUiTextScale(
  textWidth: number,
  availableWidth: number,
  enabled: boolean,
): number {
  if (!enabled || textWidth <= 0 || !Number.isFinite(textWidth)) {
    return 1;
  }
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return 0.1;
  }
  return Math.min(1, Math.max(0.1, availableWidth / textWidth));
}

/**
 * The central combo number is the moving boundary for the two bottom labels.
 * Positions are in device pixels, so this remains correct for aspect ratios and
 * preview scales without knowing anything about the chart coordinate system.
 */
export function gameUiCornerAvailableWidth(
  side: "left" | "right",
  cornerX: number,
  centerX: number,
  centerTextWidth: number,
  gap: number,
): number {
  const centerEdge = centerX + (side === "left" ? -1 : 1) * (centerTextWidth / 2 + gap);
  return side === "left" ? centerEdge - cornerX : cornerX - centerEdge;
}

/** Screen x of an overlay item, including its animated binding offset. */
function itemScreenX(
  item: GameUiItem,
  binding: { x?: number } | undefined,
  centerX: number,
  baseScale: number,
  viewScale: number,
): number {
  return centerX + item.x * baseScale + (binding?.x ?? 0) * viewScale;
}

/** Draws the chart's `attachUI` HUD elements for the current frame. */
export function drawGameUi(
  context: CanvasRenderingContext2D,
  chart: GameUiChart,
  states: readonly (LineState | undefined)[],
  completionTimes: number[],
  seconds: number,
  selectedLine: number,
  viewport: PreviewViewport,
  view: GameUiView,
  skin: GameUiSkin | null,
  duration: number,
  cornerCompression = true,
): void {
  const { combo, score } = scoreAt(completionTimes, seconds);
  const progress = clamp01((seconds + (chart.META.offset ?? 0) / 1000) / Math.max(0.001, duration));
  const bindings = gameUiBindings(chart, states);
  const texts: Record<string, string> = {
    combonumber: String(combo),
    combo: "combo",
    score: String(score).padStart(7, "0"),
    name: chart.META.name ?? "",
    level: chart.META.level ?? "",
  };
  const { centerX, centerY, scale: viewScale } = view;
  const baseScale = viewScale;
  // The HUD follows the projected chart frame, not the fixed preview viewport. The
  // logical layout still comes from the viewport's fitted dimensions, while the
  // camera-projected centre and scale carry every item with pan and zoom.
  const frameLogicalWidth = viewport.width / Math.max(viewport.scale, Number.EPSILON);
  const frameLogicalHeight = viewport.height / Math.max(viewport.scale, Number.EPSILON);
  const items = gameUiLayout(frameLogicalWidth, frameLogicalHeight);
  const centerItem = items.find((item) => item.key === "combonumber");
  const centerBinding = centerItem ? bindings.get(centerItem.key) : undefined;
  // Budget the corner labels from the authored layout, not the animated
  // binding, so their available width stays stable while the combo moves.
  const centerBudgetX = centerItem
    ? itemScreenX(centerItem, undefined, centerX, baseScale, viewScale)
    : centerX;
  const centerFont = centerItem
    ? `${(centerItem.fontSize ?? 0) * baseScale}px Saira, 'Source Han Sans CN', sans-serif`
    : "0px sans-serif";
  context.save();
  context.font = centerFont;
  // Reserve a stable six-digit width so the corner labels keep a fixed budget
  // as the combo count changes.
  const centerTextWidth = centerItem
    ? Math.max(context.measureText(texts.combonumber).width, context.measureText("000000").width) *
      Math.abs(centerBinding?.scaleX ?? 1)
    : 0;
  context.restore();
  for (const item of items) {
    const binding = bindings.get(item.key);
    const alpha = binding
      ? clamp01(binding.alpha / 255)
      : ["combo", "combonumber"].includes(item.key) && combo < 3
        ? 0
        : 1;
    if (alpha === 0) {
      continue;
    }
    const color = binding
      ? chart.judgeLineList?.[selectedLine]?.attachUI === item.key
        ? [0, 200, 0]
        : binding.color
      : item.key === "bar"
        ? [125, 125, 125]
        : [255, 255, 255];
    context.save();
    context.translate(
      centerX + item.x * baseScale + (binding?.x ?? 0) * viewScale,
      centerY - item.y * baseScale - (binding?.y ?? 0) * viewScale,
    );
    context.rotate(((binding?.rotation ?? 0) * Math.PI) / 180);
    context.scale(binding?.scaleX ?? 1, binding?.scaleY ?? 1);
    context.globalAlpha = alpha;
    context.fillStyle = `rgb(${color.join(",")})`;
    if (item.key === "pause") {
      const picture = skin?.tinted("Pause", color);
      if (picture) {
        // The layout fixes pause at 42×42; `?? 0` satisfies optional fields only.
        context.drawImage(
          picture,
          0,
          0,
          (item.width ?? 0) * baseScale,
          (item.height ?? 0) * baseScale,
        );
      } else {
        // Packages without a Pause texture fall back to drawn bars in the
        // binding colour.
        const width = (item.width ?? 0) * baseScale;
        const height = (item.height ?? 0) * baseScale;
        context.fillRect(width * 0.16, height * 0.12, width * 0.23, height * 0.76);
        context.fillRect(width * 0.61, height * 0.12, width * 0.23, height * 0.76);
      }
    } else if (item.key === "bar") {
      context.fillRect(
        0,
        (-(item.height ?? 0) * baseScale) / 2,
        (viewport.width / viewport.scale) * baseScale * progress,
        (item.height ?? 0) * baseScale,
      );
    } else {
      context.font = `${(item.fontSize ?? 0) * baseScale}px Saira, 'Source Han Sans CN', sans-serif`;
      context.textAlign = item.anchorX === 1 ? "right" : item.anchorX === 0 ? "left" : "center";
      context.textBaseline = item.anchorY === 1 ? "top" : item.anchorY === 0 ? "bottom" : "middle";
      if (item.key === "name" || item.key === "level") {
        const text = texts[item.key];
        const textWidth = context.measureText(text).width;
        const cornerX = itemScreenX(item, undefined, centerX, baseScale, viewScale);
        const availableWidth = gameUiCornerAvailableWidth(
          item.key === "name" ? "left" : "right",
          cornerX,
          centerBudgetX,
          centerTextWidth,
          16 * baseScale,
        );
        context.scale(gameUiTextScale(textWidth, availableWidth, cornerCompression), 1);
      }
      context.fillText(texts[item.key], 0, 0);
    }
    context.restore();
  }
}
