/**
 * Shader effect definitions and the runtime that activates them for a judge line.
 *
 * Owns the built-in shader names, canonicalisation, shader and line identity,
 * uniform defaults, and the source-loader seam; compiling GLSL and drawing passes
 * belong to the renderer.
 */
import type { Chart } from "../chart.ts";
import { isRecord } from "../../../utils/guards.ts";
import { IntervalIndex } from "../../../utils/intervalIndex.ts";
import { beatNumber, sampleValue, normalizeVars } from "./sampling.ts";
import type { ShaderVars, ShaderTempo } from "./sampling.ts";

/** Built-in shader names in index order; `_2` variants clone a base shader. */
export const SHADER_NAMES = [
  "chromatic",
  "circle_blur",
  "fisheye",
  "glitch",
  "grayscale",
  "noise",
  "pixel",
  "radial_blur",
  "shockwave",
  "vignette",
  "chromatic_2",
  "circle_blur_2",
  "fisheye_2",
  "glitch_2",
  "grayscale_2",
  "noise_2",
  "pixel_2",
  "radial_blur_2",
  "shockwave_2",
  "vignette_2",
  "liquid",
  "flowing",
  "image_noise",
  "snow",
  "glow_effect",
  "flip",
  "night_vision",
  "scanline",
  "rain",
  "rainbow",
  "flare",
  "underwater",
  "fog",
  "kaleidoscope",
  "emboss",
  "sobel",
  "oil_painting",
  "distortion",
  "hologram",
  "burn",
  "camera",
  "lightning",
  "old_tv",
  "bokeh",
  "neon",
  "heat_distortion",
  "rays",
  "color_shift",
  "wave",
  "two_tone",
];

/** Alternate spellings accepted by `canonicalShaderName`, keyed without underscores. */
const aliases = new Map([
  ["radialblur", "radial_blur"],
  ["circleblur", "circle_blur"],
  ["grayscale", "grayscale"],
  ["oldtv", "old_tv"],
  ["oilpainting", "oil_painting"],
  ["heateffect", "heat_distortion"],
]);

/** Resolve a chart or Phira-root GLSL asset path without accepting traversal. */
export function shaderAssetPath(value: unknown): string | null {
  const input = String(value ?? "")
    .trim()
    .replaceAll("\\", "/");
  if (/^[a-zA-Z]:/.test(input)) {
    return null;
  }
  const raw = input.replace(/^\/+/, "");
  if (!raw || !/\.(glsl|frag|vert|vsh|fsh|shader)$/i.test(raw)) {
    return null;
  }
  const parts = raw.split("/");
  return parts.some((part) => !part || part === "." || part === "..") ? null : raw;
}

/**
 * The permissive shape accepted for a shader event.
 *
 * Callers pass either a complete `JudgeLineEvent` or a lightweight object with
 * only a name and line index, so this type declares only fields that are read.
 */
export interface ShaderEventLike {
  shader?: unknown;
  shaderType?: unknown;
  name?: unknown;
  clone?: unknown;
  line?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  global?: unknown;
  order?: unknown;
  vars?: unknown;
  [extra: string]: unknown;
}

/** `shaderLine` only needs the number of judge lines. */
export interface ShaderLineChart {
  judgeLineList?: readonly unknown[];
}

/** Resolve a shader name, path, file name or index to a known built-in name. */
export function canonicalShaderName(value: unknown): string | null {
  if (Number.isInteger(value)) {
    return SHADER_NAMES[Number(value)] ?? null;
  }
  let name = (
    String(value ?? "")
      .trim()
      .replace(/^[/\\]+/, "")
      .split("/")
      .at(-1) ?? ""
  )
    .replace(/\.(glsl|frag)$/i, "")
    .replace(/_pr$/i, "");
  name = name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replaceAll("-", "_");
  name = aliases.get(name.replaceAll("_", "")) ?? name;
  return SHADER_NAMES.includes(name) ? name : null;
}

/** Tell built-in shader references apart from user asset paths. */
export function builtinShaderReference(value: unknown): boolean {
  const name = canonicalShaderName(value);
  if (!name) {
    return false;
  }
  if (typeof value !== "string") {
    return true;
  }
  const reference = value.replaceAll("\\", "/");
  // A bare name is a built-in selector. A filename is a library reference,
  // except for the legacy Phira `/name_pr.glsl` spelling.
  return (
    (!reference.includes("/") && !/\.(?:glsl|frag|vert|vsh|fsh|shader)$/i.test(reference)) ||
    /^\/?(?:pr\/)?[^/]+_pr\.glsl$/i.test(reference)
  );
}

/** Select the old or portable branch of an embedded built-in shader source. */
export function builtinShaderSource(source: string, legacy = false): string {
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = normalized.match(
    /#ifdef RPEN_LEGACY_SOURCE\n([\s\S]*?)\n#else\n([\s\S]*)\n#endif\s*$/,
  );
  return `// @rpen-builtin\n${match ? `#version 100\n${legacy ? match[1] : match[2]}` : normalized}`;
}

/** Whether a built-in name should use its legacy source variant. */
export function legacyShaderSource(name: string, sourceName = ""): boolean {
  return SHADER_NAMES.indexOf(name) >= 10 && !/(?:_pr\.glsl|\/pr\/)/i.test(sourceName);
}

/** Resolve the shader name an event uses, applying its clone suffix. */
export function shaderIdentity(event: ShaderEventLike): string {
  const value = event.shader ?? event.shaderType ?? event.name;
  const custom = !builtinShaderReference(value) ? shaderAssetPath(value) : null;
  if (custom) {
    return custom;
  }
  const name = canonicalShaderName(value);
  if (!name) {
    return "chromatic";
  }
  return event.clone && SHADER_NAMES.indexOf(name) < 10 ? `${name}_2` : name;
}

/** The event's judge-line index, wrapped into the chart's line range. */
export function shaderLine(event: ShaderEventLike, chart: ShaderLineChart): number {
  const count = chart.judgeLineList?.length ?? 0;
  const index = Number.isInteger(event.line)
    ? Number(event.line)
    : Math.max(0, SHADER_NAMES.indexOf(shaderIdentity(event)));
  return count ? ((index % count) + count) % count : 0;
}

/** One effect with its compiled time interval and stable index. */
interface TimedShaderEffect {
  effect: ShaderEffectDefinition;
  index: number;
  start: number;
  end: number;
}

/** A normalized shader effect: name, judge line, beat interval and variable tracks. */
export interface ShaderEffectDefinition {
  shader: string;
  line: number;
  startBeat: number;
  endBeat: number;
  global: boolean;
  order: number;
  vars: ShaderVars;
  sourceName: string;
  [extra: string]: unknown;
}

/** Normalize unvalidated effect data, or null when it names no known shader. */
function normalizeEffect(effect: unknown, lineIndex = -1): ShaderEffectDefinition | null {
  if (!isRecord(effect) && !Array.isArray(effect)) {
    return null;
  }
  // Arrays are accepted as record-like input alongside plain objects.
  const effectRecord = effect as Record<string, unknown>;
  const sourceValue = effectRecord.shader ?? effectRecord.shaderType ?? effectRecord.name;
  let shader =
    (!builtinShaderReference(sourceValue) ? shaderAssetPath(sourceValue) : null) ??
    canonicalShaderName(sourceValue);
  if (!shader) {
    return null;
  }
  if (effectRecord.clone && SHADER_NAMES.indexOf(shader) < 10) {
    shader += "_2";
  }
  const start = effectRecord.startTime ?? effectRecord.start ?? effectRecord.time1 ?? [0, 0, 1];
  const end = effectRecord.endTime ?? effectRecord.end ?? effectRecord.time2 ?? start;
  return {
    shader,
    line: Number.isInteger(effectRecord.line) ? Number(effectRecord.line) : lineIndex,
    startBeat: beatNumber(start),
    endBeat: beatNumber(end, beatNumber(start)),
    global: Boolean(effectRecord.global),
    order: Number(effectRecord.order ?? 0),
    vars: normalizeVars(effectRecord.vars),
    sourceName: String(effectRecord.shader ?? effectRecord.name ?? ""),
  };
}

/** Collects `effects`, `shaderEvents`, `META.effects` and line paint events. */
function chartEffects(chart: Chart): ShaderEffectDefinition[] {
  const effects: ShaderEffectDefinition[] = [];
  const roots: unknown[] = [chart.effects, chart.shaderEvents, chart.META?.effects]
    .filter(Array.isArray)
    .flat();
  for (const effect of roots) {
    // `normalizeEffect` already stores the resolved line, so it is not reassigned here.
    const normalized = normalizeEffect(
      effect,
      isRecord(effect) || Array.isArray(effect)
        ? shaderLine(effect as Record<string, unknown>, chart)
        : -1,
    );
    if (normalized) {
      effects.push(normalized);
    }
  }
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    for (const event of line.extended?.paintEvents ?? []) {
      const normalized = normalizeEffect(event, lineIndex);
      if (normalized) {
        effects.push(normalized);
      }
    }
  }
  return effects.sort(
    (left, right) => left.order - right.order || left.startBeat - right.startBeat,
  );
}

/** An active effect: normalized definition plus uniforms interpolated for this frame. */
export interface ActiveShaderEffect extends ShaderEffectDefinition {
  /** Interpolated uniform values: scalars are numbers and vectors are number arrays. */
  values: Record<string, unknown>;
}

/**
 * Host-owned shader source loader.
 *
 * The host resolves `redux/shaders/...` paths and returns their text; `null`
 * means the source is unavailable and the renderer shows the unprocessed frame.
 */
export type ShaderSourceLoader = (path: string, chartName?: string) => Promise<string | null>;

/** Resolve the source key used by both asynchronous loading and frame reads. */
function shaderSourceKey(name: string, sourceName: string): string {
  const custom = shaderAssetPath(sourceName) ?? shaderAssetPath(name);
  if (custom) {
    return custom;
  }
  const builtin = canonicalShaderName(name) ?? canonicalShaderName(sourceName) ?? name;
  return /(?:_pr\.glsl|\/pr\/)/i.test(sourceName) ? `${builtin}:pr` : builtin;
}

/** Loads shader sources and reports the effects active at a chart time. */
export class ShaderRuntime {
  declare invalidate: () => void;
  declare loadSource: ShaderSourceLoader;
  declare chart: Chart | null;
  declare chartName: string;
  declare tempo: ShaderTempo | null;
  declare effects: ShaderEffectDefinition[];
  declare activeIndex: IntervalIndex<TimedShaderEffect>;
  declare sources: Map<string, string>;
  declare loading: Set<string>;

  /** Create a runtime; `invalidate` is called when loaded sources change. */
  constructor(invalidate: () => void = () => {}, loadSource: ShaderSourceLoader) {
    this.invalidate = invalidate;
    this.loadSource = loadSource;
    this.chart = null;
    this.chartName = "";
    this.tempo = null;
    this.effects = [];
    this.activeIndex = new IntervalIndex<TimedShaderEffect>(
      [],
      (entry) => entry.start,
      (entry) => entry.end,
    );
    this.sources = new Map();
    this.loading = new Set();
  }

  /** Update the chart path used to resolve relative shader assets. */
  setChartName(chartName: string): void {
    const next = String(chartName ?? "");
    if (next === this.chartName) {
      return;
    }
    this.chartName = next;
    this.chart = null;
    this.sources.clear();
    this.loading.clear();
    this.invalidate();
  }

  /** Rebuild active intervals when the chart or tempo source changes. */
  compile(chart: Chart, tempo: ShaderTempo | null): void {
    if (this.chart === chart && this.tempo === tempo) {
      return;
    }
    this.chart = chart;
    this.tempo = tempo;
    this.effects = chartEffects(chart);
    const timed = this.effects.map((effect, index) => {
      const factor = chart.judgeLineList?.[effect.line]?.bpmfactor ?? 1;
      return {
        effect,
        index,
        start: tempo?.seconds(effect.startBeat, factor) ?? effect.startBeat,
        end: tempo?.seconds(effect.endBeat, factor) ?? effect.endBeat,
      };
    });
    this.activeIndex = new IntervalIndex(
      timed,
      (entry) => entry.start,
      (entry) => entry.end,
    );
    for (const effect of this.effects) {
      this.load(effect.shader, effect.sourceName);
    }
  }

  /** Fetch a shader source once, preferring the preview variant when requested. */
  async load(name: string, sourceName = ""): Promise<void> {
    const assetPath = shaderAssetPath(sourceName) ?? shaderAssetPath(name);
    const previewSource = /(?:_pr\.glsl|\/pr\/)/i.test(sourceName);
    const key = shaderSourceKey(name, sourceName);
    if (this.sources.has(key) || this.loading.has(key)) {
      return;
    }
    this.loading.add(key);
    if (assetPath) {
      try {
        const assetText = await this.loadSource(assetPath, this.chartName);
        if (assetText !== null) {
          this.sources.set(key, assetText);
          this.loading.delete(key);
          this.invalidate();
          return;
        }
      } catch {
        /* A missing document asset may still be a built-in reference. */
      }
      if (!builtinShaderReference(sourceName) && !builtinShaderReference(name)) {
        this.loading.delete(key);
        this.invalidate();
        return;
      }
    }
    const builtin = canonicalShaderName(name) ?? canonicalShaderName(sourceName) ?? name;
    const portable = `redux/shaders/pr/${builtin}_pr.glsl`;
    const plain = `redux/shaders/${builtin}.glsl`;
    try {
      for (const path of previewSource ? [portable, plain] : [plain, portable]) {
        const text = await this.loadSource(path, this.chartName);
        if (text !== null) {
          this.sources.set(key, builtinShaderSource(text, legacyShaderSource(builtin, sourceName)));
          break;
        }
      }
    } catch {
      /* WebGL gracefully falls back to the unprocessed preview. */
    }
    this.loading.delete(key);
    this.invalidate();
  }

  /** Effects active at `seconds`, with their uniforms sampled for this frame. */
  active(seconds: number): ActiveShaderEffect[] {
    const active: ActiveShaderEffect[] = [];
    const candidates = this.activeIndex.queryItems(seconds, seconds);
    candidates.sort((left, right) => left.index - right.index);
    for (const { effect } of candidates) {
      const factor = this.chart?.judgeLineList?.[effect.line]?.bpmfactor ?? 1;
      const beat = this.tempo?.beat?.(seconds, factor) ?? seconds;
      if (beat < effect.startBeat || beat >= effect.endBeat) {
        continue;
      }
      const values: Record<string, unknown> = {};
      for (const [name, events] of Object.entries(effect.vars)) {
        const value = sampleValue(events, seconds, this.tempo, factor, events[0]?.start);
        if (value !== undefined) {
          values[name] = value;
        }
      }
      active.push({ ...effect, values });
    }
    return active;
  }

  /** Loaded source text for `name`, or an empty string when it is not loaded. */
  source(name: string, sourceName = ""): string {
    const key = shaderSourceKey(name, sourceName);
    return this.sources.get(key) ?? "";
  }

  /** Drop one custom source so the next frame loads its externally edited text. */
  invalidateSource(path: string): void {
    const key = shaderAssetPath(path);
    if (key) {
      this.sources.delete(key);
      for (const effect of this.effects) {
        if (shaderAssetPath(effect.sourceName) === key || shaderAssetPath(effect.shader) === key) {
          void this.load(effect.shader, effect.sourceName);
        }
      }
    }
  }
}

/** Built-in uniform default for `name`, or undefined when the shader declares none. */
export function defaultShaderUniform(
  name: string,
  resolution: number[] = [1350, 900],
): number | number[] | undefined {
  const defaults: Record<string, number | number[]> = {
    sampleCount: 3,
    power: 0.03,
    size: 3,
    rate: 0.6,
    speed: 1,
    blockCount: 30.5,
    colorRate: 0.01,
    factor: 1,
    seed: 81,
    centerX: 0.5,
    centerY: 0.5,
    progress: 0.2,
    width: 0.1,
    distortion: 0.8,
    expand: 10,
    extend: 0.25,
    radius: 15,
    frequency: 10,
    amplitude: 0.02,
    speedx: 1,
    speedy: 1,
    snowCount: 100,
    direction: [1, 0],
    threshold: 0.5,
    intensity: 1,
    density: 1,
    lightpos: [0.5, 0.5],
    fogColor: [0.5, 0.5, 0.5, 1],
    fogStart: 0,
    fogEnd: 1,
    segments: 8,
    center: [0.5, 0.5],
    angle: 0,
    hologramColor: [0, 1, 1, 1],
    burnColor: [1, 0.2, 0, 1],
    zoom: 1,
    offset: 0,
    rotation: 0,
    numBolts: 5,
    flashDuration: 0.1,
    rainColor: [0.4, 0.6, 1, 1],
    height: 1,
    strength: 1,
    blurRadius: 1,
    exposure: 1,
    decay: 1,
    weight: 0.5,
    hueShift: 0,
    saturationShift: 0,
    valueShift: 0,
    color1: [0, 0, 0, 1],
    color2: [1, 1, 1, 1],
    resolution,
  };
  return defaults[name];
}
