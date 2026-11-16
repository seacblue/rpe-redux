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
import {
  PreviewGuideTextAtlas,
  type GuideAtlasGlyph,
  type GuideLabelBounds,
} from "./previewGuideAtlas.ts";

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

export type GuideLabel = GuideLabelBounds;

/** One visible label retained for the current preview frame. */
export interface GuideRenderGlyph {
  x: number;
  y: number;
  rotation: number;
  label: GuideLabel;
  atlasGlyph: GuideAtlasGlyph | null;
  color: string;
}

/** One selected arrow retained separately from the line-number glyphs. */
export interface GuideRenderArrow {
  x: number;
  y: number;
  rotation: number;
  size: number;
  color: string;
  source: CanvasImageSource | null;
}

/** Backend-neutral guide packet produced after viewport culling. */
export interface GuideRenderPacket {
  readonly atlas: PreviewGuideTextAtlas;
  readonly glyphs: readonly GuideRenderGlyph[];
  readonly arrows: readonly GuideRenderArrow[];
  readonly groupCount: number;
  readonly visibleGroupCount: number;
  readonly textCacheHits: number;
  readonly textCacheMisses: number;
}

/** Low-cost diagnostics returned by one guide overlay submission. */
export interface GuideDrawStats {
  readonly durationMs: number;
  readonly groupCount: number;
  readonly visibleGroupCount: number;
  readonly textCacheHits: number;
  readonly textCacheMisses: number;
  readonly drawCalls: number;
  readonly renderPath: "webgl_atlas" | "canvas_atlas" | "canvas_fallback";
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
  readonly atlas: PreviewGuideTextAtlas;
  readonly glyphs: GuideRenderGlyph[];
  readonly arrows: GuideRenderArrow[];
  readonly labelKeys: Map<LineGuideGroup, string>;
  readonly atlasGlyphs: Map<string, GuideAtlasGlyph | null>;
  atlasGeneration: number;
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

/** Paint one retained label glyph on the Canvas2D fallback path. */
function paintGuideGlyph(
  context: CanvasRenderingContext2D,
  glyph: GuideRenderGlyph,
  scale: number,
  atlas: HTMLCanvasElement | null,
): void {
  context.save();
  context.translate(glyph.x, glyph.y);
  context.rotate((glyph.rotation * Math.PI) / 180);
  context.fillStyle = glyph.color;
  if (glyph.atlasGlyph && atlas) {
    const entry = glyph.atlasGlyph;
    context.drawImage(
      atlas,
      entry.sourceX,
      entry.sourceY,
      entry.sourceWidth,
      entry.sourceHeight,
      glyph.label.left,
      glyph.label.top,
      entry.width,
      entry.height,
    );
  } else {
    context.fillText(glyph.label.text, 0, 4 * scale);
  }
  context.restore();
}

/** Paint one retained selected arrow independently from line-number labels. */
function paintGuideArrow(context: CanvasRenderingContext2D, arrow: GuideRenderArrow): void {
  context.save();
  context.translate(arrow.x, arrow.y);
  context.rotate((arrow.rotation * Math.PI) / 180);
  context.fillStyle = arrow.color;
  if (arrow.source) {
    context.rotate(Math.PI);
    context.drawImage(arrow.source, -arrow.size, -arrow.size, arrow.size * 2, arrow.size * 2);
  } else {
    context.beginPath();
    context.moveTo(0, -arrow.size * 0.96);
    context.lineTo(-arrow.size * 0.48, -arrow.size * 0.32);
    context.lineTo(arrow.size * 0.48, -arrow.size * 0.32);
    context.closePath();
    context.fill();
  }
  context.restore();
}

/** Build a retained guide packet, culling before any atlas rasterization. */
export function buildGuidePacket(
  surface: PreviewGuideSurface,
  context: CanvasRenderingContext2D,
  scale: number,
  selectedLine: number,
): GuideRenderPacket {
  const empty = (): GuideRenderPacket => ({
    atlas: new PreviewGuideTextAtlas(),
    glyphs: [],
    arrows: [],
    groupCount: 0,
    visibleGroupCount: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
  });
  if (!surface.lineNumbers && !surface.lineArrows) {
    return empty();
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
  const revision = surface.guideRevision;
  let cache = guideSurfaceCaches.get(surface);
  if (!cache) {
    cache = {
      guides: EMPTY_GUIDES,
      scale: Number.NaN,
      enabled: false,
      revision: Number.NaN,
      groups: [],
      atlas: new PreviewGuideTextAtlas(),
      glyphs: [],
      arrows: [],
      labelKeys: new Map(),
      atlasGlyphs: new Map(),
      atlasGeneration: 0,
    };
    guideSurfaceCaches.set(surface, cache);
  }
  const mergeEnabled = surface.mergeLineNumbers ?? true;
  let groups: LineGuideGroup[];
  const sameSurface =
    cache.guides === guides && cache.scale === scale && cache.enabled === mergeEnabled;
  if (revision !== undefined && sameSurface && cache.revision === revision) {
    groups = cache.groups;
  } else {
    mergeGuidesInto(guides, scale, mergeEnabled, cache.groups);
    cache.labelKeys.clear();
    groups = cache.groups;
    if (revision !== undefined) {
      cache.guides = guides;
      cache.scale = scale;
      cache.enabled = mergeEnabled;
      cache.revision = revision;
    }
  }
  const arrowImage = surface.lineArrows ? surface.skin?.images?.get("Arrow2") : undefined;
  const atlasGeneration = cache.atlas.getGeneration();
  if (cache.atlasGeneration !== atlasGeneration) {
    cache.atlasGlyphs.clear();
    cache.atlasGeneration = atlasGeneration;
  }
  const glyphs = cache.glyphs;
  const arrows = cache.arrows;
  let glyphWrite = 0;
  let arrowWrite = 0;
  let visibleGroupCount = 0;
  let textCacheHits = 0;
  let textCacheMisses = 0;
  for (const group of groups) {
    const selected = group.indices.includes(selectedLine);
    if (!surface.lineNumbers && !(surface.lineArrows && selected)) {
      continue;
    }
    const angle = (group.rotation * Math.PI) / 180;
    const color = selected ? palette.previewLineSelected : palette.previewLine;
    const arrow = surface.lineArrows && selected ? 30 * scale : 0;
    const labelKey =
      cache.labelKeys.get(group) ??
      (() => {
        const key = group.indices.join(",");
        cache.labelKeys.set(group, key);
        return key;
      })();
    // A conservative bound lets off-screen groups skip text measurement and
    // atlas lookup. If a label was measured already, use its exact bounds.
    const measured = surface.lineNumbers ? labels.get(labelKey) : null;
    const cullHalfWidth = measured
      ? Math.max(Math.abs(measured.left), measured.right)
      : 160 * scale;
    const cullTop = measured ? measured.top : -64 * scale;
    const cullBottom = measured ? measured.bottom : 72 * scale;
    if (bounded) {
      const left = Math.min(-cullHalfWidth, -arrow);
      const right = Math.max(cullHalfWidth, arrow);
      const top = Math.min(cullTop, -arrow);
      const bottom = Math.max(cullBottom, arrow);
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
    visibleGroupCount += 1;
    const label = surface.lineNumbers
      ? labelFor(
          context,
          labels,
          labelKey,
          group.indices,
          surface.chart?.judgeLineList ?? null,
          scale,
        )
      : null;
    if (label) {
      const atlasKey = `${context.font}|${color}|${scale}|${label.text}`;
      const cachedAtlasGlyph = cache.atlasGlyphs.get(atlasKey);
      let atlasGlyph: GuideAtlasGlyph | null;
      let atlasHit = cachedAtlasGlyph !== undefined;
      if (atlasHit) {
        atlasGlyph = cachedAtlasGlyph ?? null;
      } else {
        const lookup = cache.atlas.lookup(context, label, color, scale);
        atlasGlyph = lookup.glyph;
        cache.atlasGlyphs.set(atlasKey, atlasGlyph);
        atlasHit = lookup.hit;
      }
      if (atlasHit) {
        textCacheHits += 1;
      } else {
        textCacheMisses += 1;
      }
      const glyph = glyphs[glyphWrite] ?? {
        x: 0,
        y: 0,
        rotation: 0,
        label,
        atlasGlyph: null,
        color,
      };
      glyph.x = group.x;
      glyph.y = group.y;
      glyph.rotation = group.rotation;
      glyph.label = label;
      glyph.atlasGlyph = atlasGlyph;
      glyph.color = color;
      glyphs[glyphWrite++] = glyph;
    }
    if (surface.lineArrows === true && selected) {
      const guideArrow = arrows[arrowWrite] ?? {
        x: 0,
        y: 0,
        rotation: 0,
        size: 0,
        color: "",
        source: null,
      };
      guideArrow.x = group.x;
      guideArrow.y = group.y;
      guideArrow.rotation = group.rotation;
      guideArrow.size = 30 * scale;
      guideArrow.color = color;
      guideArrow.source = arrowImage ?? null;
      arrows[arrowWrite++] = guideArrow;
    }
  }
  glyphs.length = glyphWrite;
  arrows.length = arrowWrite;
  context.restore();
  return {
    atlas: cache.atlas,
    glyphs,
    arrows,
    groupCount: groups.length,
    visibleGroupCount,
    textCacheHits,
    textCacheMisses,
  };
}

/** Draw a retained guide packet through Canvas2D when WebGL is unavailable. */
export function drawGuides(
  surface: PreviewGuideSurface,
  context: CanvasRenderingContext2D,
  scale: number,
  selectedLine: number,
): GuideDrawStats {
  const started = performance.now();
  const packet = buildGuidePacket(surface, context, scale, selectedLine);
  const atlas = packet.atlas.getCanvas();
  context.save();
  if (surface.lineNumbers) {
    context.font = `${30 * scale}px Saira, 'Source Han Sans CN', sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
  }
  for (const glyph of packet.glyphs) {
    paintGuideGlyph(context, glyph, scale, atlas);
  }
  for (const arrow of packet.arrows) {
    paintGuideArrow(context, arrow);
  }
  context.restore();
  return {
    durationMs: performance.now() - started,
    groupCount: packet.groupCount,
    visibleGroupCount: packet.visibleGroupCount,
    textCacheHits: packet.textCacheHits,
    textCacheMisses: packet.textCacheMisses,
    drawCalls: packet.glyphs.length + packet.arrows.length,
    renderPath: atlas ? "canvas_atlas" : "canvas_fallback",
  };
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
