/**
 * Paints judge-line bodies and the optional line-number or arrow guides over the
 * preview. Guide geometry comes from `guides.ts`; this module owns only the
 * canvas drawing and the texture surface it reads.
 */
import { DEFAULT_LINE_HEIGHT, DEFAULT_LINE_WIDTH } from "../scene/constants.ts";
import {
  formatLineNumbers,
  mergeGuidesInto,
  type LineGuide,
  type LineGuideGroup,
} from "./guides.ts";
import { viewportTextureScale } from "../../../../../../core/media/images.ts";
import { clamp01 } from "../../../../../../core/utils/numbers.ts";
import type { Chart, JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import type { LineState } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { PreviewImage, PreviewTextureSurface } from "../scene/previewTypes.ts";
import { canvasPixelRatio } from "../../../canvas/canvas2d.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";

/**
 * Draws guide overlays and judge lines.
 *
 * Both read skin textures, so they share `PreviewTextureSurface`; each module declares
 * only the fields it reads and a `Preview` instance naturally satisfies the surface.
 */
export interface PreviewGuideSurface extends PreviewTextureSurface {
  chart: Chart | null;
  guides: LineGuide[] | null;
  /** Changes only when guide geometry is recomputed; overlay grouping may reuse it. */
  guideRevision?: number;
  lineNumbers?: boolean;
  lineArrows?: boolean;
  mergeLineNumbers?: boolean;
}

/** Cached ink bounds for one line-number label. */
interface GuideLabel {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Label bounds and the scale they were measured at, per chart. */
interface GuideLabelCache {
  scale: number;
  labels: Map<string, GuideLabel>;
}

/** Everything one guide surface retains between frames: its merged groups. */
interface GuideSurfaceCache {
  guides: readonly LineGuide[];
  scale: number;
  enabled: boolean;
  revision: number;
  groups: LineGuideGroup[];
}

const guideLabelCaches = new WeakMap<object, GuideLabelCache>();
const fallbackGuideLabelCache: GuideLabelCache = { scale: Number.NaN, labels: new Map() };
const guideSurfaceCaches = new WeakMap<object, GuideSurfaceCache>();
const EMPTY_GUIDES: readonly LineGuide[] = [];

/** Keep measured label bounds for one chart/scale; indices only change with the chart. */
function guideLabels(chart: Chart | null, scale: number): Map<string, GuideLabel> {
  let cache: GuideLabelCache;
  if (chart) {
    const existing = guideLabelCaches.get(chart);
    cache = existing ?? { scale: Number.NaN, labels: new Map() };
    if (!existing) {
      guideLabelCaches.set(chart, cache);
    }
  } else {
    cache = fallbackGuideLabelCache;
  }
  if (cache.scale !== scale) {
    cache.scale = scale;
    cache.labels.clear();
  }
  return cache.labels;
}

/** Measures a label once per text and scale, evicting the oldest entry past the cap. */
function labelFor(
  context: CanvasRenderingContext2D,
  cache: Map<string, GuideLabel>,
  key: string,
  indices: readonly number[],
  lines: readonly JudgeLine[] | null,
  scale: number,
): GuideLabel {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const text = formatLineNumbers(indices, lines);
  const metrics = context.measureText(text);
  const fontSize = 30 * scale;
  const label: GuideLabel = {
    text,
    left: -Math.max(metrics.width / 2, metrics.actualBoundingBoxLeft) - 2,
    right: Math.max(metrics.width / 2, metrics.actualBoundingBoxRight) + 2,
    top: 4 * scale - Math.max(fontSize, metrics.actualBoundingBoxAscent) - 2,
    bottom: 4 * scale + Math.max(fontSize * 2, metrics.actualBoundingBoxDescent) + 2,
  };
  if (cache.size >= 2048) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, label);
  return label;
}

/**
 * Paint one anchored guide marker: its merged line-number label when `label` is
 * set and, when `drawArrow` is true, the selected line's arrow (`arrow` null
 * draws the vector fallback).
 */
function paintGuideMarker(
  context: CanvasRenderingContext2D,
  group: LineGuideGroup,
  color: string,
  scale: number,
  label: GuideLabel | null,
  arrow: CanvasImageSource | null | undefined,
  drawArrow: boolean,
): void {
  context.save();
  context.translate(group.x, group.y);
  context.rotate((group.rotation * Math.PI) / 180);
  context.fillStyle = color;
  if (label) {
    context.fillText(label.text, 0, 4 * scale);
  }
  if (drawArrow) {
    if (arrow) {
      context.save();
      context.rotate(Math.PI);
      context.drawImage(arrow, -25 * scale, -25 * scale, 50 * scale, 50 * scale);
      context.restore();
    } else {
      context.beginPath();
      context.moveTo(0, -24 * scale);
      context.lineTo(-12 * scale, -8 * scale);
      context.lineTo(12 * scale, -8 * scale);
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}

/** Draws line numbers and the selected arrow when either option is enabled. */
export function drawGuides(
  surface: PreviewGuideSurface,
  context: CanvasRenderingContext2D,
  scale: number,
  selectedLine: number,
): void {
  if (!surface.lineNumbers && !surface.lineArrows) {
    return;
  }
  const palette = readCanvasPalette();
  const labels = guideLabels(surface.chart, scale);
  const matrix = context.getTransform();
  const bounded =
    Number.isFinite(matrix.a) &&
    Number.isFinite(matrix.b) &&
    Number.isFinite(matrix.c) &&
    Number.isFinite(matrix.d) &&
    context.canvas.width > 0 &&
    context.canvas.height > 0 &&
    !context.shadowBlur &&
    !context.shadowOffsetX &&
    !context.shadowOffsetY &&
    (!context.filter || context.filter === "none");
  context.save();
  if (surface.lineNumbers) {
    context.font = `${30 * scale}px Saira, 'Source Han Sans CN', sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
  }
  const guides = surface.guides ?? EMPTY_GUIDES;
  const mergeEnabled = surface.mergeLineNumbers ?? true;
  const revision = surface.guideRevision;
  let cache = guideSurfaceCaches.get(surface);
  if (!cache) {
    cache = {
      guides: EMPTY_GUIDES,
      scale: Number.NaN,
      enabled: false,
      revision: Number.NaN,
      groups: [],
    };
    guideSurfaceCaches.set(surface, cache);
  }
  let groups: LineGuideGroup[];
  if (
    revision !== undefined &&
    cache.guides === guides &&
    cache.scale === scale &&
    cache.enabled === mergeEnabled &&
    cache.revision === revision
  ) {
    groups = cache.groups;
  } else {
    mergeGuidesInto(guides, scale, mergeEnabled, cache.groups);
    groups = cache.groups;
    if (revision !== undefined) {
      cache.guides = guides;
      cache.scale = scale;
      cache.enabled = mergeEnabled;
      cache.revision = revision;
    }
  }
  const arrowImage = surface.lineArrows ? surface.skin?.images?.get("Arrow2") : undefined;
  for (const group of groups) {
    const selected = group.indices.includes(selectedLine);
    if (!surface.lineNumbers && !(surface.lineArrows && selected)) {
      continue;
    }
    const angle = (group.rotation * Math.PI) / 180;
    let label: GuideLabel | null = null;
    if (surface.lineNumbers) {
      label = labelFor(
        context,
        labels,
        group.indices.join(","),
        group.indices,
        surface.chart?.judgeLineList ?? null,
        scale,
      );
    }
    const color = selected ? palette.previewLineSelected : palette.previewLine;
    if (bounded) {
      const arrow = surface.lineArrows && selected ? 30 * scale : 0;
      const left = Math.min(label?.left ?? 0, -arrow);
      const right = Math.max(label?.right ?? 0, arrow);
      const top = Math.min(label?.top ?? 0, -arrow);
      const bottom = Math.max(label?.bottom ?? 0, arrow);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const a = matrix.a * cosine + matrix.c * sine;
      const b = matrix.b * cosine + matrix.d * sine;
      const c = matrix.c * cosine - matrix.a * sine;
      const d = matrix.d * cosine - matrix.b * sine;
      const x = matrix.a * group.x + matrix.c * group.y + matrix.e;
      const y = matrix.b * group.x + matrix.d * group.y + matrix.f;
      if (
        x + Math.max(left * a, right * a) + Math.max(top * c, bottom * c) < -1 ||
        x + Math.min(left * a, right * a) + Math.min(top * c, bottom * c) >
          context.canvas.width + 1 ||
        y + Math.max(left * b, right * b) + Math.max(top * d, bottom * d) < -1 ||
        y + Math.min(left * b, right * b) + Math.min(top * d, bottom * d) >
          context.canvas.height + 1
      ) {
        continue;
      }
    }
    const drawArrow = surface.lineArrows === true && selected;
    paintGuideMarker(context, group, color, scale, label, arrowImage, drawArrow);
  }
  context.restore();
}

const lineColorCss = new WeakMap<number[], { r: number; g: number; b: number; css: string }>();

/** Formats a line colour as CSS, reusing the last string when the channels are unchanged. */
function lineColor(color: number[]): string {
  const r = Math.round(Math.max(0, Math.min(255, color[0] ?? 0)));
  const g = Math.round(Math.max(0, Math.min(255, color[1] ?? 0)));
  const b = Math.round(Math.max(0, Math.min(255, color[2] ?? 0)));
  const cached = lineColorCss.get(color);
  if (cached && cached.r === r && cached.g === g && cached.b === b) {
    return cached.css;
  }
  const css = `rgb(${r},${g},${b})`;
  lineColorCss.set(color, { r, g, b, css });
  return css;
}

/** Draws one judge line, falling back to a solid rectangle when its texture fails. */
export function drawLine(
  surface: PreviewTextureSurface,
  context: CanvasRenderingContext2D,
  line: JudgeLine,
  state: LineState,
  scale: number,
  opacity = 1,
): void {
  context.save();
  context.scale(state.scaleX, state.scaleY);
  context.globalAlpha =
    clamp01(state.alpha / 255) * clamp01(state.color[3] ?? 1) * clamp01(opacity);
  context.fillStyle = lineColor(state.color);
  if (line.extended?.textEvents?.length) {
    context.font = `${52 * scale}px Saira, 'Source Han Sans CN', sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(state.text, 0, 0);
  } else {
    const defaultLine = !line.Texture || line.Texture === "line.png";
    const descriptor = !defaultLine ? surface.images?.describe?.(line.Texture ?? "") : null;
    const stateScale =
      scale * Math.max(Math.abs(state.scaleX), Math.abs(state.scaleY)) * canvasPixelRatio();
    const viewportScale = viewportTextureScale(
      stateScale,
      descriptor?.naturalWidth ?? 0,
      descriptor?.naturalHeight ?? 0,
    );
    const rawTexture: PreviewImage | null = defaultLine
      ? null
      : surface.images?.texture
        ? surface.images.texture(line.Texture ?? "", viewportScale)
        : (surface.images?.images?.get(line.Texture ?? "") ?? null);
    const source = rawTexture?.source ?? (rawTexture as CanvasImageSource | null);
    const texture = defaultLine
      ? surface.skin?.tinted("line", state.color)
      : (surface.skin?.tintedSource(`line:${line.Texture}`, source, state.color) ?? source);
    if (defaultLine) {
      const width = DEFAULT_LINE_WIDTH * scale;
      const height = DEFAULT_LINE_HEIGHT * surface.lineScale * scale;
      const drawn = texture
        ? Boolean(surface.skin?.drawAligned(context, "line", texture, 0, 0, width, height))
        : false;
      if (!drawn) {
        context.fillRect(-width / 2, -height / 2, width, height);
      }
    } else if (texture && rawTexture) {
      const anchor = line.anchor ?? [0.5, 0.5];
      // Decoded records expose intrinsic dimensions; raw bitmaps may expose only width/height.
      const width = rawTexture.naturalWidth ?? rawTexture.width ?? 0;
      const height = rawTexture.naturalHeight ?? rawTexture.height ?? 0;
      context.drawImage(
        texture,
        -width * anchor[0] * scale,
        -height * (1 - anchor[1]) * scale,
        width * scale,
        height * scale,
      );
    }
  }
  context.restore();
}
