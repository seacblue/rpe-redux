/**
 * Shared value shapes for the preview's scene, drawing, and surface seams. They
 * stay private to the preview feature; core owns the chart runtime types and
 * each draw step declares only the fields it reads.
 */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type {
  NoteEntry,
  SampledLineState,
  SceneRuntime,
} from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import type { PreviewViewport } from "./viewport.ts";
import type { TextureImage } from "../render/background.ts";
import type { ShaderPass } from "../render/shaderPipeline.ts";
import type { NoteBatchSkin } from "../../../canvas/noteBatch.ts";
import type { NoteColor } from "../../../canvas/noteSpriteGroups.ts";
import type { PreviewDisplayAdapter } from "../surface/previewDisplay.ts";

/** Which host mounts the preview: the workspace underlay or a dedicated surface. */
export type PreviewSurfaceKind = "workspace-underlay" | "dedicated";

/** Canvas layers handed to a preview at construction. */
export interface PreviewCanvasLayers {
  noteBatch?: HTMLCanvasElement;
  shader: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  display?: PreviewDisplayAdapter;
}

/**
 * Shared types internal to the preview.
 *
 * Collaborators appear only through their preview-facing surfaces, each draw
 * step declares its own reads, and frame geometry and data travel together as
 * `PreviewFrame`. These types therefore stay private to preview.
 */

/** Preview texture record; decoded images have naturalWidth, raw bitmaps may have only width. */
export interface PreviewImage {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
  source?: CanvasImageSource;
}

/** The `ProjectImages` surface read by preview after image loading completes. */
export interface PreviewImages {
  background?: TextureImage | null;
  backgroundName?: string;
  backgroundAnimated?: boolean;
  images?: Map<string, PreviewImage>;
  texture(name: string, scale?: number): TextureImage | null;
  describe(name: string): PreviewImage | undefined;
  trim(): void;
}

/** The `RpeSkin` surface read by preview. */
export interface PreviewSkin extends NoteBatchSkin {
  images?: Map<string, CanvasImageSource>;
  particleFrameCount?: number;
  tinted(name: string, color: unknown): CanvasImageSource | null;
  tintedSource(name: string, source: unknown, color: unknown): CanvasImageSource | null;
  prewarmHitEffects?(color: number[]): void;
  drawAligned(
    context: CanvasRenderingContext2D,
    name: string,
    source: CanvasImageSource,
    centerX: number,
    centerY: number,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean;
  head(
    context: CanvasRenderingContext2D,
    type: number,
    horizontal: number,
    vertical: number,
    width: number,
    highlight: boolean,
    color?: NoteColor | null,
  ): boolean;
  hold(
    context: CanvasRenderingContext2D,
    horizontal: number,
    head: number,
    tail: number,
    width: number,
    highlight: boolean,
    showHead: boolean,
    color?: NoteColor | null,
    rotation?: number,
    capScale?: number,
  ): boolean;
  noteTexture(
    type: number,
    highlight: boolean,
  ): {
    source: HTMLImageElement;
    useful: { x: number; y: number; width: number; height: number };
  } | null;
  holdBodyTexture(highlight: boolean): {
    source: HTMLImageElement;
    useful: { x: number; y: number; width: number; height: number };
  } | null;
  holdHeadTexture(highlight: boolean): {
    source: HTMLImageElement;
    useful: { x: number; y: number; width: number; height: number };
  } | null;
  holdEndTexture(highlight: boolean): {
    source: HTMLImageElement;
    useful: { x: number; y: number; width: number; height: number };
  } | null;
}

/** `ShaderRuntime.active` item; preview reads shader name, source, and global flag. */
export interface PreviewShaderEffect extends ShaderPass {
  sourceName?: string;
  global?: boolean;
}

/** Judge-line screen position and texture name for canvas picking and diagnostics. */
export interface PreviewLineFrame {
  lineIndex: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  corners: readonly { x: number; y: number }[];
  texture: string;
}

/** Note hit area tested by distance to its line segment. */
export interface PreviewHitArea {
  noteIndex?: number;
  lineIndex: number;
  kind?: "note" | "hold";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  width?: number;
  height?: number;
  /** Useful longitudinal size of the Hold head/tail cap in CSS pixels. */
  headLength?: number;
  tailLength?: number;
  /** Whether the painted Hold includes its head cap. */
  showHead?: boolean;
  rotation?: number;
}

/** Note indices grouped by judge line, shared by preview and timeline rendering. */
export type PreviewNoteSelection = ReadonlyMap<number, ReadonlySet<number>>;

/** The note or judge line under the pointer in the preview overlap picker. */
export interface PreviewOverlapHighlight {
  note?: { lineIndex: number; noteIndex: number };
  line?: number;
}

/** Geometry and data shared by one frame's four draw steps. */
export interface PreviewFrame {
  context: CanvasRenderingContext2D;
  chart: Chart;
  tempo: TempoSource;
  scene: SceneRuntime;
  states: SampledLineState[];
  order: number[];
  visibleNotes: readonly NoteEntry[][];
  visibleHolds: readonly NoteEntry[][];
  seconds: number;
  selectedLine: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** Uniform reference scale for aspect-preserving strokes, text and sprites. */
  scale: number;
  /** Independent axis mapping from the 1350×900 logical box to the frame. */
  scaleX: number;
  scaleY: number;
  /** Uniform fitted scale for screen-anchored HUD; the free camera never changes it. */
  screenScale: number;
  viewport: PreviewViewport;
  /** Shader effects sampled once for this frame and shared by composition passes. */
  shaderEffects: readonly PreviewShaderEffect[];
  /** Changes only when the primary canvas pixels can change. */
  shaderSourceRevision: number;
}

/** Texture and skin surface read by draw steps. */
export interface PreviewTextureSurface {
  images?: PreviewImages | null;
  skin?: PreviewSkin | null;
  lineScale: number;
}

/** User-facing fallback colours supplied by the settings/runtime adapter. */
export interface PreviewColorSettings {
  defaultLineColor: readonly number[];
  defaultParticleColor: readonly number[];
  selectedLineColor: readonly number[];
}
