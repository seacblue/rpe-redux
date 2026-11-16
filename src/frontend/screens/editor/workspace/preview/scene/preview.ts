/* eslint-disable max-lines -- preview lifecycle, sampling, painting, and hit geometry are one runtime. */
/**
 * The preview's imperative runtime: scene sampling, viewport fitting, painting,
 * shaders, and hit geometry for one frame. Core chart modules own evaluation.
 */
import { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { NoteChangeHint } from "../../../../../../core/global/chart/runtime/noteChangeHints.ts";
import { ShaderRuntime } from "../../../../../../core/global/chart/shader/shader.ts";
import { SimultaneousNotesCache } from "../../../../../../core/global/chart/line/simultaneousNotes.ts";
import {
  DEFAULT_PREVIEW_ASPECT_RATIO,
  previewViewport,
  previewViewportBounds,
} from "./viewport.ts";
import type { PreviewViewport } from "./viewport.ts";
import { PreviewCameraTracker, previewCameraView, type PreviewCamera } from "./previewCamera.ts";
import { linePasses, type RenderPass } from "../drawing/previewLines.ts";
import { PREVIEW_LOGICAL_SIZE } from "./constants.ts";
import { lineGuides, type LineGuide } from "../drawing/guides.ts";
import { readShaderSource } from "../../../../../platform/shaderSource.ts";
import {
  canvasPixelRatio,
  fallbackCanvasPixelRatio,
  measureCanvas,
  prepareCanvas,
} from "../../../canvas/canvas2d.ts";
import { drawComposite } from "./previewComposite.ts";
import type { GuideDrawStats } from "../drawing/previewGuides.ts";
import { drawHitEffects } from "../drawing/previewHitEffects.ts";

import { drawLinePasses } from "../drawing/previewLines.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { ShaderPipeline, type ShaderProgramSource } from "../render/shaderPipeline.ts";
import { ShaderCompositeRenderDevice } from "../render/shaderCompositeRenderDevice.ts";
import { PreviewGuideBatch } from "../render/previewGuideBatch.ts";
import { NoteBatch } from "../../../canvas/noteBatch.ts";
import type { NoteTextureTable } from "../../../canvas/noteBatch.ts";
import { PreviewBackground, type TextureImage } from "../render/background.ts";
import { NoiseAreaRenderer } from "../render/noiseAreaRenderer.ts";
import { detailedNoiseRendering } from "../../../../../../core/edit/state/noiseRendering.ts";
import { createPreviewDisplay, type PreviewDisplayAdapter } from "../surface/previewDisplay.ts";
import type { Chart, JudgeLineNote } from "../../../../../../core/global/chart/chart.ts";
import type { NoteEntry } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { SampledLineState } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import {
  eventTrackSamplingStats,
  resetEventTrackSamplingStats,
  setEventTrackSamplingStatsEnabled,
} from "../../../../../../core/global/chart/timing/events.ts";
import type {
  HitTestPreviewGeometry,
  HitTestPoint,
} from "../../../../../../core/edit/hitTest/api.ts";
import { PreviewGeometryCache, type PreviewGeometryKey } from "./previewGeometry.ts";
import {
  sameLineSelection,
  samePreviewFrameRequest,
  type PreviewFrameRequest,
} from "./previewFrameRequest.ts";
import { CompletionTimesCache } from "./completionTimes.ts";
import { reportPreviewTiming } from "./previewTiming.ts";
import { renderDetailedProfileEnabled } from "../../../../../../core/diagnostics/renderMetrics.ts";
import type {
  PreviewCanvasLayers,
  PreviewColorSettings,
  PreviewFrame,
  PreviewHitArea,
  PreviewImages,
  PreviewLineFrame,
  PreviewSkin,
  PreviewNoteSelection,
  PreviewOverlapHighlight,
  PreviewShaderEffect,
} from "./previewTypes.ts";

/** A shared empty texture table, used when the batch cannot paint. */
const EMPTY_TEXTURES: NoteTextureTable = Object.freeze([]);

interface RetainedLineBatchKey {
  readonly chart: Chart;
  readonly scene: SceneRuntime;
  readonly states: readonly SampledLineState[];
  readonly order: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly viewport: PreviewViewport;
  readonly centerX: number;
  readonly centerY: number;
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly lineScale: number;
  readonly selectedLineSet: ReadonlySet<number>;
  readonly selectedLineColor: readonly number[];
  readonly defaultLineColor: readonly number[];
  readonly skin: PreviewSkin | null | undefined;
  readonly skinRevision: number | undefined;
}

/** Compare the immutable inputs that affect a retained static judge-line layer. */
function sameRetainedLineBatchKey(
  previous: RetainedLineBatchKey | null,
  next: RetainedLineBatchKey,
): boolean {
  return (
    previous !== null &&
    previous.chart === next.chart &&
    previous.scene === next.scene &&
    previous.states === next.states &&
    previous.order === next.order &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.viewport.left === next.viewport.left &&
    previous.viewport.top === next.viewport.top &&
    previous.viewport.width === next.viewport.width &&
    previous.viewport.height === next.viewport.height &&
    previous.viewport.scale === next.viewport.scale &&
    previous.viewport.scaleX === next.viewport.scaleX &&
    previous.viewport.scaleY === next.viewport.scaleY &&
    previous.centerX === next.centerX &&
    previous.centerY === next.centerY &&
    previous.scale === next.scale &&
    previous.scaleX === next.scaleX &&
    previous.scaleY === next.scaleY &&
    previous.lineScale === next.lineScale &&
    previous.selectedLineSet === next.selectedLineSet &&
    previous.selectedLineColor === next.selectedLineColor &&
    previous.defaultLineColor === next.defaultLineColor &&
    previous.skin === next.skin &&
    previous.skinRevision === next.skinRevision
  );
}

/** Per-call switches for one preview paint. */
export interface PreviewDrawOptions {
  /** Build hit-test geometry only for an interaction or an explicit query. */
  readonly collectGeometry?: boolean;
  /** Let a large chart edit repaint after the interaction frame. */
  readonly deferHeavyFrame?: boolean;
  /** All judge lines in the current selection; falls back to selectedLine. */
  readonly selectedLines?: readonly number[];
  /** Line slots changed by the last session commit; used for incremental rebuilds. */
  readonly changedLineIndexes?: readonly number[];
  /** Exact note deltas used to preserve line-local derived collections. */
  readonly noteChangeHints?: readonly NoteChangeHint[];
}

/**
 * Real-time preview shared by the workspace and timeline thumbnail. It owns
 * lifecycle and per-frame orchestration; each drawing module paints from the
 * fields this instance exposes.
 */
export class Preview {
  lineFrames: PreviewLineFrame[] = [];
  lastFrame: {
    seconds: number;
    width: number;
    height: number;
    scale: number;
    scaleX: number;
    scaleY: number;
  } | null = null;
  private drawRevision = 0;
  private invalidationVersion = 0;
  private lastDrawRequest: PreviewFrameRequest | null = null;
  private previewNoteSources: readonly (readonly JudgeLineNote[] | undefined)[] = [];
  private previewZOrder: number[] = [];
  private pendingFrame: PreviewFrameRequest | null = null;
  private pendingFrameScheduled = false;
  private lastVisibleNoteCount = 0;
  /** Bumps whenever a paint can change the primary canvas pixels. */
  private shaderSourceRevision = 0;
  private lastCanvasClearRect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null = null;
  private readonly geometryCache = new PreviewGeometryCache();
  private readonly completionTimesCache = new CompletionTimesCache();
  private readonly geometryObservers = new Set<(geometry: HitTestPreviewGeometry | null) => void>();
  private drawCollectGeometry = false;
  // `declare` fields are assigned by the constructor or methods; this adds types only.
  declare canvas: HTMLCanvasElement;
  declare scene: SceneRuntime;
  declare shaderRuntime: ShaderRuntime;
  declare shaderPipeline: ShaderPipeline;
  declare shaderCompositeDevice: ShaderCompositeRenderDevice;
  declare noteBatch: NoteBatch;
  guideBatch: PreviewGuideBatch | null = null;
  /** Note heads by `type * 2 + highlight`, refreshed at the start of each paint. */
  noteTextures: NoteTextureTable = EMPTY_TEXTURES;
  private readonly noteBatchCanvas: HTMLCanvasElement;
  readonly sharedNoteBatch: boolean;
  private readonly noiseAreas: NoiseAreaRenderer;
  /** Host notification for an unavailable detailed noise renderer. */
  noiseError?: () => void;
  /** Host notification for a dense preview that cannot use GPU batching. */
  batchWarning?: () => void;
  private batchWarningShown = false;
  noiseComposited = false;
  declare display: PreviewDisplayAdapter;
  declare backgroundFrame: PreviewBackground;
  declare overlayCanvas: HTMLCanvasElement | null;
  declare shaderCanvas: HTMLCanvasElement | null;
  declare noteOpacity: number;
  declare visible: boolean;
  declare noteSize: number;
  hitEffectScale = 1;
  declare lineScale: number;
  declare defaultLineColor: number[];
  declare defaultParticleColor: number[];
  declare backgroundEnabled: boolean;
  declare backgroundAlpha: number;
  declare backgroundBlur: number;
  declare backgroundBrightness: number;
  declare effectsSince: number;
  declare applyShaders: boolean;
  declare opacity: number;
  /** Free camera is the only region on screen, so the underlay must be opaque. */
  declare forceOpaque: boolean;
  declare showHitEffects: boolean;
  /** Whether an authoring timeline is currently painted over this preview. */
  authoringRegionVisible = false;
  declare noteHitAreas: PreviewHitArea[];
  declare chart: Chart | null;
  declare simultaneous: Set<unknown> | null;
  declare simultaneousCache: SimultaneousNotesCache<JudgeLineNote>;
  declare completionTimes: number[];
  declare passes: RenderPass[];
  /** Whether every painted judge line shares the batched default line texture. */
  lineBatchable = false;
  /** Surface flag consumed by drawLinePasses for a retained static line layer. */
  skipStaticLinePass = false;
  /** Surface flag that routes world-static lines into the retained GPU layer. */
  retainStaticLineBatch = false;
  private lineBatchChart: Chart | null = null;
  private lineBatchSkin: PreviewSkin | null | undefined;
  private lineBatchRevision: number | undefined;
  private retainedLineBatchKey: RetainedLineBatchKey | null = null;
  declare guides: LineGuide[] | null;
  declare viewport: PreviewViewport | null;
  /** Chart-content camera; only notes, lines, guides, and hit effects follow it. */
  camera: PreviewCamera = { active: false, zoom: 1, panX: 0, panY: 0 };
  private readonly cameraTracker = new PreviewCameraTracker();
  declare selectedLine: number;
  /** Every line in the current multi-line selection, if any. */
  declare selectedLines: readonly number[];
  /** O(1) membership lookup for the current multi-line selection. */
  selectedLineSet: ReadonlySet<number> = new Set();
  /** The colour used to tint selected judge lines. */
  declare selectedLineColor: readonly number[];
  declare invalidate?: (() => void) | null;
  declare images?: PreviewImages | null;
  declare skin?: PreviewSkin | null;
  declare aspectRatio?: number;
  declare viewDivisor?: number;
  declare duration?: number | null;
  declare highlight?: boolean;
  declare showGameUI?: boolean;
  declare gameUiCornerCompression?: boolean;
  /** Override the workspace noise switch for a dedicated rendering surface. */
  detailedNoise?: boolean;
  /**
   * Fixed CSS-pixel frame size for a detached renderer, or null to follow the
   * canvas layout. Offscreen captures set this because a detached canvas has no
   * layout rectangle.
   */
  frameMeasurement: { width: number; height: number } | null = null;
  declare pickPreviewLines?: boolean;
  declare lineNumbers?: boolean;
  declare lineArrows?: boolean;
  declare mergeLineNumbers?: boolean;
  /**
   * Draw only this judge line and the notes and holds attached to it; a render
   * filter that never touches the chart or its selection.
   */
  declare soloLine: number | null;
  /** Draw this line in `focusLineColor`; the curve preview paints the edited line red. */
  declare focusLine: number | null;
  declare focusLineColor: readonly number[];
  /**
   * Workspace sampler focus: only this line takes the selected-line colour.
   * Other selected lines keep their normal paint while sampling.
   */
  samplingFocus: { lineIndex: number; color: readonly number[] } | null = null;
  /** Temporary opacity for the line under the alpha sampler. */
  samplingAlpha: { lineIndex: number; alpha: number } | null = null;
  declare selectedNotes: PreviewNoteSelection;
  /** Transient selection-colour highlight for the overlap picker's hovered row. */
  overlapHighlight: PreviewOverlapHighlight | null = null;
  /** True while the overlap picker is open; selection paint is suppressed. */
  overlapMenuOpen = false;
  private readonly visibleNoteBuckets: NoteEntry[][] = [];
  private readonly visibleHoldBuckets: NoteEntry[][] = [];
  private readonly sampledStates: SampledLineState[] = [];
  /** Chart and source revision already handed to the shader precompiler. */
  private shaderPrewarmChart: Chart | null = null;
  private shaderPrewarmRevision = -1;
  private readonly guideBuffer: NonNullable<Preview["guides"]> = [];
  /**
   * Monotonic identity for guide geometry changes consumed by the overlay cache.
   * It never resets while this instance lives: the guide caches are keyed by it,
   * and a reopened document must not collide with a cached overlay key.
   */
  guideRevision = 0;
  private staticGuideProjection: {
    chart: Chart;
    order: readonly number[];
    centerX: number;
    centerY: number;
    scaleX: number;
    scaleY: number;
  } | null = null;
  readonly hitStateCache = new Map<number, (index: number) => SampledLineState>();

  /** Resets all cached chart, frame, and geometry state for a closed document. */
  clearDocument(): void {
    this.noiseAreas.clear();
    this.noiseComposited = false;
    this.lineFrames.length = 0;
    this.lastFrame = null;
    this.staticGuideProjection = null;
    this.scene.clear();
    this.chart = null;
    this.samplingFocus = null;
    this.samplingAlpha = null;
    this.simultaneous = null;
    this.simultaneousCache.clear();
    this.completionTimes = [];
    this.completionTimesCache.clear();
    this.passes = [];
    this.lineBatchable = false;
    this.skipStaticLinePass = false;
    this.retainStaticLineBatch = false;
    this.retainedLineBatchKey = null;
    this.lineBatchChart = null;
    this.lineBatchSkin = undefined;
    this.lineBatchRevision = undefined;
    this.noteHitAreas.length = 0;
    this.selectedNotes = new Map();
    this.overlapHighlight = null;
    this.overlapMenuOpen = false;
    this.visibleNoteBuckets.length = 0;
    this.visibleHoldBuckets.length = 0;
    this.sampledStates.length = 0;
    this.guideBuffer.length = 0;
    this.previewNoteSources = [];
    this.previewZOrder = [];
    this.pendingFrame = null;
    this.lastVisibleNoteCount = 0;
    this.hitStateCache.clear();
    this.cameraTracker.reset();
    this.invalidateFrame();
    this.geometryCache.clear();
    if (this.sharedNoteBatch) {
      this.shaderPipeline.resetChartResources();
    } else {
      this.shaderCompositeDevice.dispose();
    }
    this.shaderPrewarmChart = null;
    this.shaderPrewarmRevision = -1;
    this.noteBatch.clear();
    this.shaderRuntime.chart = null;
    this.shaderRuntime.effects = [];
    this.shaderRuntime.sources?.clear();
    this.shaderRuntime.sourcesWanted?.clear();
    this.shaderRuntime.sourceRevision += 1;
    this.backgroundFrame.clear();
    this.notifyGeometry(null);
  }

  /** Suppress selection paint while the overlap picker is open. */
  setOverlapMenuOpen(open: boolean): void {
    if (this.overlapMenuOpen === open) {
      return;
    }
    this.overlapMenuOpen = open;
    this.invalidateFrame();
    this.invalidate?.();
  }

  /** Paint one overlap-picker row in the selection colour until it leaves. */
  setOverlapHighlight(highlight: PreviewOverlapHighlight | null): void {
    if (
      this.overlapHighlight?.line === highlight?.line &&
      this.overlapHighlight?.note?.lineIndex === highlight?.note?.lineIndex &&
      this.overlapHighlight?.note?.noteIndex === highlight?.note?.noteIndex
    ) {
      return;
    }
    this.overlapHighlight = highlight;
    this.invalidateFrame();
    this.invalidate?.();
  }

  /** Point the workspace sampler at one line and repaint its focus tint. */
  setSamplingFocus(focus: Preview["samplingFocus"]): void {
    this.samplingFocus = focus;
    this.invalidateFrame();
    this.invalidate?.();
  }

  /** Preview one sampled opacity without changing the chart, then repaint. */
  setSamplingAlpha(alpha: Preview["samplingAlpha"]): void {
    this.samplingAlpha = alpha;
    this.invalidateFrame();
    this.invalidate?.();
  }

  /** Drop the cached frame identity when an external display setting changes. */
  invalidateFrame(): void {
    this.lastDrawRequest = null;
    this.invalidationVersion += 1;
  }

  /** Changes whenever an external resource or document invalidates the preview. */
  get invalidationRevision(): number {
    return this.invalidationVersion;
  }

  /** Upload skin textures and pre-tint hit frames while the editor is idle. */
  prewarm(): void {
    const skin = this.skin;
    if (!skin) {
      return;
    }
    /** Uploads the skin textures and pre-tints effect frames. */
    const run = () => {
      this.noteBatch.prewarm(skin);
      skin.prewarmHitEffects?.(this.defaultParticleColor);
    };
    // Defer the upload until the editor is idle, with a bounded fallback delay.
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 50);
    }
  }

  /**
   * Compile every loaded shader in the chart away from the paint path.
   *
   * The source set follows the chart identity and `ShaderRuntime.sourceRevision`,
   * so new charts and reloaded files start a pass while an unchanged frame does
   * no work. Programs outside the current set are released at the same time;
   * GPU programs are not JavaScript objects and would otherwise accumulate for
   * the lifetime of the editor.
   */
  private prewarmShaderPrograms(): void {
    const chart = this.chart;
    const revision = this.shaderRuntime.sourceRevision;
    if (!this.applyShaders || !chart || !this.shaderCanvas) {
      if (this.shaderPipeline.programs.size || this.shaderPrewarmChart !== null) {
        this.shaderPipeline.retainSources([]);
        this.shaderPrewarmChart = null;
        this.shaderPrewarmRevision = -1;
      }
      return;
    }
    if (this.shaderPrewarmChart === chart && this.shaderPrewarmRevision === revision) {
      return;
    }
    this.shaderPrewarmChart = chart;
    this.shaderPrewarmRevision = revision;
    const entries: ShaderProgramSource[] = [];
    const seen = new Set<string>();
    for (const effect of this.shaderRuntime.effects) {
      const source = this.shaderRuntime.source(effect.shader, effect.sourceName);
      if (!source || seen.has(source)) {
        continue;
      }
      seen.add(source);
      entries.push({ name: effect.shader, source });
    }
    this.shaderPipeline.retainSources(seen);
    if (
      !entries.length ||
      entries.every((entry) => this.shaderPipeline.isSettled(entry.source)) ||
      !this.shaderPipeline.ensure(this.shaderCanvas)
    ) {
      return;
    }
    void this.shaderPipeline.precompile(entries).then(() => {
      // A pass skipped while its program was pending can now draw, so request
      // the frame that makes the compiled shader visible.
      this.invalidateFrame();
      this.invalidate?.();
    });
  }

  /** Prepare noise resources before a caller samples frames without a live clock. */
  prepareNoise(): Promise<boolean> {
    return this.noiseAreas.prepare();
  }

  /** Apply fallback colours without making the renderer know about settings storage. */
  setDefaultColors(colors: PreviewColorSettings): void {
    this.defaultLineColor = [...colors.defaultLineColor];
    this.defaultParticleColor = [...colors.defaultParticleColor];
    this.selectedLineColor = [...colors.selectedLineColor];
    this.invalidate?.();
  }

  /**
   * Observes each painted frame's geometry, or null when the document clears.
   * A subscription keeps collection enabled, so callbacks read the frame just
   * drawn; the returned disposer is idempotent.
   */
  observeGeometry(listener: (geometry: HitTestPreviewGeometry | null) => void): () => void {
    this.geometryObservers.add(listener);
    return () => {
      this.geometryObservers.delete(listener);
    };
  }

  /** Returns the current detailed geometry, rendering one extra frame only when necessary. */
  getCollisionGeometry(): HitTestPreviewGeometry | null {
    if (!this.lastFrame || !this.viewport || !this.lastDrawRequest || !this.visible) {
      return null;
    }
    const key = this.geometryKey();
    const cached = this.geometryCache.get(key);
    if (cached) {
      return cached;
    }
    this.draw(
      this.lastDrawRequest.chart,
      this.lastDrawRequest.tempo,
      this.lastDrawRequest.seconds,
      this.lastDrawRequest.selectedLine,
      this.lastDrawRequest.selectedNotes,
      { collectGeometry: true, selectedLines: this.selectedLines },
    );
    return this.geometryCache.get(this.geometryKey());
  }

  /** Builds the identity of the geometry the last painted frame produced. */
  private geometryKey(): PreviewGeometryKey {
    if (!this.lastFrame || !this.viewport || !this.chart) {
      throw new Error("Preview geometry is not available before the first frame");
    }
    return {
      chart: this.chart,
      revision: this.drawRevision,
      seconds: this.lastFrame.seconds,
      width: this.lastFrame.width,
      height: this.lastFrame.height,
      scale: this.lastFrame.scale,
      scaleX: this.lastFrame.scaleX,
      scaleY: this.lastFrame.scaleY,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      viewport: this.viewport,
    };
  }

  /** Delivers a geometry snapshot to every observer, isolating listener failures. */
  private notifyGeometry(geometry: HitTestPreviewGeometry | null): void {
    if (!this.geometryObservers.size) {
      return;
    }
    // Copy the set so an observer can unsubscribe from inside the loop.
    for (const listener of [...this.geometryObservers]) {
      try {
        listener(geometry);
      } catch (error) {
        console.error("Preview geometry observer failed", error);
      }
    }
  }

  /** Converts the last frame's hit areas and line frames into the hit-test contract. */
  private buildCollisionGeometry(): HitTestPreviewGeometry {
    if (!this.lastFrame || !this.viewport) {
      throw new Error("Preview geometry is not available before the first frame");
    }
    const point = (x: number, y: number): HitTestPoint => ({ x, y });
    return {
      surface: "preview",
      revision: this.drawRevision,
      seconds: this.lastFrame.seconds,
      width: this.lastFrame.width,
      height: this.lastFrame.height,
      scale: this.lastFrame.scale,
      scaleX: this.lastFrame.scaleX,
      scaleY: this.lastFrame.scaleY,
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      viewport: previewViewportBounds(this.viewport),
      notes: this.noteHitAreas.map((area) => ({
        lineIndex: area.lineIndex,
        noteIndex: area.noteIndex ?? -1,
        kind: area.kind ?? "note",
        head: point(area.x1, area.y1),
        tail: point(area.x2, area.y2),
        radius: area.radius,
        width: area.width ?? area.radius * 2,
        height: area.height,
        headLength: area.headLength,
        tailLength: area.tailLength,
        showHead: area.showHead,
        rotation: area.rotation ?? 0,
      })),
      lines: this.lineFrames.map((line) => ({
        lineIndex: line.lineIndex,
        center: point(line.x, line.y),
        rotation: line.rotation,
        scaleX: line.scaleX,
        scaleY: line.scaleY,
        width: line.width,
        height: line.height,
        corners: line.corners.map((corner) => point(corner.x, corner.y)),
        texture: line.texture,
      })),
    };
  }

  /** Whether the current paint is collecting hit-test geometry. */
  get collectGeometry(): boolean {
    return this.drawCollectGeometry;
  }

  /** Reload custom GLSL sources changed by an external editor. */
  reloadShaderSources(names: readonly string[]): void {
    for (const name of names) {
      this.shaderRuntime.invalidateSource(name);
    }
    if (names.length) {
      this.shaderSourceRevision += 1;
      this.invalidateFrame();
      this.invalidate?.();
    }
  }

  /** Set the chart path used when resolving relative shader assets. */
  setShaderChartName(chartName: string): void {
    this.shaderRuntime.setChartName(chartName);
    this.shaderSourceRevision += 1;
    this.invalidateFrame();
    this.invalidate?.();
  }
  /** Releases GPU, canvas, and noise resources owned by the preview. */
  dispose(): void {
    this.clearDocument();
    this.guideBatch?.dispose();
    this.shaderCompositeDevice.dispose();
    this.noiseAreas.dispose();
    this.noteBatch.dispose();
    this.display.dispose();
  }

  /** Creates the preview for `canvas`, optionally reusing caller-provided layers. */
  constructor(canvas: HTMLCanvasElement, layers: PreviewCanvasLayers | null = null) {
    this.canvas = canvas;
    this.shaderCanvas = layers?.shader ?? null;
    this.scene = new SceneRuntime();
    this.simultaneousCache = new SimultaneousNotesCache();
    this.shaderRuntime = new ShaderRuntime(() => this.invalidate?.(), readShaderSource);
    this.shaderPipeline = new ShaderPipeline(() => this.invalidate?.(), this.shaderCanvas);
    this.shaderCompositeDevice = new ShaderCompositeRenderDevice(this.shaderPipeline);
    const sharedBackend = this.shaderPipeline.sharedBackend();
    this.sharedNoteBatch = Boolean(
      this.shaderCanvas && sharedBackend && this.shaderPipeline.webgl2,
    );
    this.noteBatchCanvas =
      this.sharedNoteBatch && this.shaderCanvas
        ? this.shaderCanvas
        : (layers?.noteBatch ?? document.createElement("canvas"));
    this.noteBatch = new NoteBatch(
      this.noteBatchCanvas,
      "preview",
      this.sharedNoteBatch ? sharedBackend : null,
    );
    if (this.sharedNoteBatch && this.shaderCanvas && sharedBackend) {
      try {
        this.guideBatch = new PreviewGuideBatch(this.shaderCanvas, sharedBackend);
      } catch {
        this.guideBatch = null;
      }
    }
    this.noiseAreas = new NoiseAreaRenderer(
      () => {
        this.invalidateFrame();
        this.invalidate?.();
      },
      () => this.noiseError?.(),
    );
    this.backgroundFrame = new PreviewBackground();
    this.display =
      layers?.display ??
      createPreviewDisplay(
        {
          primary: () => this.canvas,
          noteBatch: () => layers?.noteBatch ?? null,
          shader: () => layers?.shader ?? null,
          overlay: () => layers?.overlay ?? null,
        },
        "dedicated",
      );
    this.noteOpacity = 180 / 255;
    this.visible = false;
    this.noteSize = 175;
    this.lineScale = 1.4;
    this.defaultLineColor = [237, 236, 176];
    this.defaultParticleColor = [237, 236, 176];
    this.selectedLineColor = [];
    this.selectedLines = [];
    this.backgroundEnabled = true;
    this.backgroundAlpha = 0.35;
    this.backgroundBlur = 10.5;
    this.backgroundBrightness = 1;
    this.effectsSince = Infinity;
    this.applyShaders = true;
    this.opacity = 1;
    this.forceOpaque = false;
    this.showHitEffects = true;
    this.noteHitAreas = [];
    this.selectedNotes = new Map();
    this.soloLine = null;
    this.focusLine = null;
    this.focusLineColor = [255, 64, 64];
    this.samplingFocus = null;
    this.samplingAlpha = null;
    this.overlayCanvas = layers?.overlay ?? null;
  }

  /** Queues one deferred paint for the next task turn. */
  private schedulePendingFrame(): void {
    if (this.pendingFrameScheduled) {
      return;
    }
    this.pendingFrameScheduled = true;
    /** Paints the deferred request if one is still pending. */
    const run = (): void => {
      this.pendingFrameScheduled = false;
      const pending = this.pendingFrame;
      if (!pending) {
        return;
      }
      this.pendingFrame = null;
      this.draw(
        pending.chart,
        pending.tempo,
        pending.seconds,
        pending.selectedLine,
        pending.selectedNotes,
        { selectedLines: this.selectedLines },
      );
    };
    // Run the deferred paint in the task queue after the edit frame.
    setTimeout(run, 0);
  }

  /** Whether the last painted frame can serve this request without repainting. */
  private frameReusable(
    chart: Chart,
    tempo: TempoSource,
    seconds: number,
    selectedLine: number,
    selectedNotes: PreviewNoteSelection,
    selectedLines: readonly number[],
    state: {
      chartChanged: boolean;
      lineColorChanged: boolean;
      selectionChanged: boolean;
      collectGeometry: boolean;
    },
    measurement: { readonly width: number; readonly height: number },
  ): boolean {
    if (
      this.lastFrame === null ||
      state.collectGeometry ||
      state.chartChanged ||
      state.lineColorChanged ||
      state.selectionChanged ||
      !this.cameraTracker.matches(this.camera) ||
      !samePreviewFrameRequest(
        this.lastDrawRequest,
        chart,
        tempo,
        seconds,
        selectedLine,
        selectedNotes,
      )
    ) {
      return false;
    }
    return (
      Math.abs(measurement.width - this.lastFrame.width) < 0.5 &&
      Math.abs(measurement.height - this.lastFrame.height) < 0.5
    );
  }

  /** Rebuilds note-derived caches only when notes, tempo, or z-order changed. */
  private updateSceneCollections(
    chart: Chart,
    tempo: TempoSource,
    tempoChanged: boolean,
    changedLineIndexes?: readonly number[],
    noteChangeHints?: readonly NoteChangeHint[],
  ): void {
    this.hitStateCache.clear();
    const sourceLines = chart.judgeLineList ?? [];
    const canPatch =
      changedLineIndexes !== undefined &&
      sourceLines.length === this.previewNoteSources.length &&
      sourceLines.length === this.previewZOrder.length;
    const noteSources = canPatch
      ? [...this.previewNoteSources]
      : sourceLines.map((line) => line.notes);
    const zOrder = canPatch
      ? [...this.previewZOrder]
      : sourceLines.map((line) => Number(line.zOrder ?? 0));
    if (canPatch) {
      for (const index of changedLineIndexes) {
        const line = sourceLines[index];
        if (line) {
          noteSources[index] = line.notes;
          zOrder[index] = Number(line.zOrder ?? 0);
        }
      }
    }
    const notesSame =
      !tempoChanged &&
      sourceLines.length === this.previewNoteSources.length &&
      (canPatch
        ? changedLineIndexes.every(
            (index) => sourceLines[index]?.notes === this.previewNoteSources[index],
          )
        : sourceLines.every((line, index) => line.notes === this.previewNoteSources[index]));
    const orderSame =
      sourceLines.length === this.previewZOrder.length &&
      (canPatch
        ? changedLineIndexes.every(
            (index) => Number(sourceLines[index]?.zOrder ?? 0) === this.previewZOrder[index],
          )
        : sourceLines.every(
            (line, index) => Number(line.zOrder ?? 0) === this.previewZOrder[index],
          ));
    const hintsByLine = new Map(
      (noteChangeHints ?? []).map((hint) => [hint.lineIndex, hint] as const),
    );
    const visualNoteArraysOnly =
      canPatch &&
      changedLineIndexes.length > 0 &&
      changedLineIndexes.every((index) => {
        const source = sourceLines[index]?.notes;
        return (
          source === this.previewNoteSources[index] || hintsByLine.get(index)?.kind === "visual"
        );
      });
    if (!notesSame && !visualNoteArraysOnly) {
      this.simultaneous = this.simultaneousCache.update(chart, tempo);
      this.completionTimes = this.completionTimesCache.update(this.scene.lines, noteSources, tempo);
    }
    if (!orderSame) {
      this.passes = linePasses(sourceLines, this.scene.order);
    }
    this.previewNoteSources = noteSources;
    this.previewZOrder = zOrder;
  }

  /**
   * Cache whether every painted line can share the default line texture batch.
   *
   * Custom textures and text lines keep the Canvas path so their relative paint
   * order is unchanged. The answer only changes with the chart or skin bitmap.
   */
  private updateLineBatch(chart: Chart): void {
    const skin = this.skin ?? null;
    const revision = skin?.textureRevision;
    if (
      this.lineBatchChart === chart &&
      this.lineBatchSkin === skin &&
      this.lineBatchRevision === revision
    ) {
      return;
    }
    const lineTexture = skin?.lineTexture?.() ?? null;
    if (!lineTexture) {
      // The base skin can finish decoding after the first frame; retry instead
      // of caching a missing texture as a permanent Canvas fallback.
      this.lineBatchable = false;
      this.lineBatchChart = null;
      this.lineBatchSkin = undefined;
      this.lineBatchRevision = undefined;
      return;
    }
    this.lineBatchChart = chart;
    this.lineBatchSkin = skin;
    this.lineBatchRevision = revision;
    const lines = chart.judgeLineList ?? [];
    this.lineBatchable = lines.every(
      (line) =>
        !line.extended?.textEvents?.length && (!line.Texture || line.Texture === "line.png"),
    );
  }

  /** Prepare the clipped preview canvas and paint its chart background. */
  private prepareCanvasFrame(
    measurement: { width: number; height: number },
    drawStarted: number,
  ): {
    context: CanvasRenderingContext2D;
    width: number;
    height: number;
    viewport: PreviewViewport;
    divisor: number;
    screenScale: number;
    contentFrame: ReturnType<typeof previewCameraView>;
    setupMs: number;
  } {
    const canvasFallback = !this.shaderPipeline.webgl2;
    const { context, width, height } = prepareCanvas(
      this.canvas,
      !canvasFallback,
      measurement,
      canvasFallback ? fallbackCanvasPixelRatio() : canvasPixelRatio(),
    );
    const viewport = previewViewport(
      width,
      height,
      this.aspectRatio ?? DEFAULT_PREVIEW_ASPECT_RATIO,
    );
    const divisor = Math.max(0.01, Number(this.viewDivisor) || 1);
    // The clip is screen-fixed; the camera moves only the chart content inside it.
    const screenScale = viewport.scale / divisor;
    const contentFrame = previewCameraView(viewport, this.camera, divisor);
    this.display.setViewportClip(viewport, divisor, contentFrame);
    if (canvasFallback) {
      const previous = this.lastCanvasClearRect;
      if (previous) {
        context.clearRect(previous.left, previous.top, previous.width, previous.height);
      }
      context.clearRect(viewport.left, viewport.top, viewport.width, viewport.height);
      this.lastCanvasClearRect = viewport;
    } else {
      this.lastCanvasClearRect = null;
    }
    const { scale } = contentFrame;
    context.save();
    context.beginPath();
    context.rect(viewport.left, viewport.top, viewport.width, viewport.height);
    context.clip();
    if (this.applyShaders) {
      context.fillStyle = readCanvasPalette().background;
      context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    }
    const images = this.images;
    let background: TextureImage | null = this.backgroundEnabled
      ? (images?.background ?? null)
      : null;
    if (background && images?.texture) {
      background =
        images.texture(
          images.backgroundName ?? "",
          Math.max(
            PREVIEW_LOGICAL_SIZE.width / (background.naturalWidth ?? 0),
            PREVIEW_LOGICAL_SIZE.height / (background.naturalHeight ?? 0),
          ) *
            scale *
            canvasPixelRatio(),
        ) ?? background;
    }
    if (background) {
      context.globalAlpha = this.backgroundAlpha;
      this.backgroundFrame.draw(
        context,
        background,
        contentFrame.width,
        contentFrame.height,
        // Background blur is user-visible; cached static images keep it cheap.
        this.backgroundBlur,
        this.backgroundBrightness,
        canvasPixelRatio(),
        images?.backgroundAnimated,
        contentFrame.left,
        contentFrame.top,
        viewport,
      );
      context.globalAlpha = 1;
    } else {
      this.backgroundFrame.clear();
    }
    return {
      context,
      width,
      height,
      viewport,
      divisor,
      screenScale,
      contentFrame,
      setupMs: performance.now() - drawStarted,
    };
  }

  /** Fill the reusable visible-note and Hold buckets for one sampled frame. */
  private collectVisibleNotes(
    seconds: number,
    states: SampledLineState[],
    order: readonly number[],
    divisor: number,
  ): {
    visibleNoteCount: number;
    visibleHoldCount: number;
    visibilityMs: number;
    visibilityIndexMs: number;
    visibilityCandidateCount: number;
  } {
    const visibilityStarted = performance.now();
    const lines = this.scene.lines;
    const visibleNotes = this.visibleNoteBuckets;
    const visibleHolds = this.visibleHoldBuckets;
    visibleNotes.length = lines.length;
    visibleHolds.length = lines.length;
    let visibleNoteCount = 0;
    let visibleHoldCount = 0;
    let visibilityIndexMs = 0;
    let visibilityCandidateCount = 0;
    const measureVisibilityIndex = renderDetailedProfileEnabled();
    for (const index of order) {
      const state = states[index];
      const runtime = lines[index];
      const bucket = visibleNotes[index] ?? (visibleNotes[index] = []);
      const holdBucket = visibleHolds[index] ?? (visibleHolds[index] = []);
      // Empty lines cannot contribute visible notes. Avoid entering the per-line
      // directory and timer path for the many structural lines in large charts.
      if (!runtime || runtime.notes.length === 0 || !state) {
        bucket.length = 0;
        holdBucket.length = 0;
        continue;
      }
      runtime.visibleNotes(
        seconds,
        state,
        1600 * divisor + Math.hypot(state.x, state.y),
        bucket,
        holdBucket,
        measureVisibilityIndex,
      );
      visibilityIndexMs += runtime.lastVisibilityStats.indexMs;
      visibilityCandidateCount += runtime.lastVisibilityStats.candidateCount;
      visibleNoteCount += bucket.length;
      visibleHoldCount += holdBucket.length;
    }
    return {
      visibleNoteCount,
      visibleHoldCount,
      visibilityMs: performance.now() - visibilityStarted,
      visibilityIndexMs,
      visibilityCandidateCount,
    };
  }

  /** Build the retained-line key when the current frame can reuse static GPU lines. */
  private retainedLineKey(frame: PreviewFrame): RetainedLineBatchKey | null {
    if (
      !this.lineBatchable ||
      this.drawCollectGeometry ||
      this.soloLine !== null ||
      this.focusLine !== null ||
      this.samplingFocus !== null ||
      this.samplingAlpha !== null ||
      this.overlapMenuOpen
    ) {
      return null;
    }
    return {
      chart: frame.chart,
      scene: frame.scene,
      states: frame.states,
      order: frame.order,
      width: frame.width,
      height: frame.height,
      viewport: frame.viewport,
      centerX: frame.centerX,
      centerY: frame.centerY,
      scale: frame.scale,
      scaleX: frame.scaleX,
      scaleY: frame.scaleY,
      lineScale: this.lineScale,
      selectedLineSet: this.selectedLineSet,
      selectedLineColor: this.selectedLineColor,
      defaultLineColor: this.defaultLineColor,
      skin: this.skin,
      skinRevision: this.lineBatchRevision,
    };
  }

  /** Draw note batches, hit effects, noise, shaders, and composited overlays. */
  private drawFrameLayers(
    frame: PreviewFrame,
    options: PreviewDrawOptions,
  ): {
    drawStats: ReturnType<typeof drawLinePasses>;
    notesMs: number;
    effectsMs: number;
    compositeMs: number;
    guide: GuideDrawStats | null;
    shaderSourceUploadMs: number;
    shaderOverlayUploadMs: number;
  } {
    this.noteHitAreas.length = 0;
    this.lineFrames.length = 0;
    const notesStarted = performance.now();
    const nextRetainedLineKey = this.retainedLineKey(frame);
    const retainStaticLines =
      nextRetainedLineKey !== null &&
      sameRetainedLineBatchKey(this.retainedLineBatchKey, nextRetainedLineKey);
    const retainedLines = this.noteBatch.begin(
      frame.width,
      frame.height,
      this.skin ?? null,
      frame.viewport,
      1,
      retainStaticLines,
    );
    this.skipStaticLinePass = retainedLines;
    this.retainStaticLineBatch = nextRetainedLineKey !== null;
    // Resolve every note texture once for this pass; the per-note path then reads a slot
    // instead of calling the skin. `null` means the batch is inactive, so no note is
    // submitted and an empty table is never read.
    this.noteTextures = this.noteBatch.prepareNoteTextures(this.skin ?? null) ?? EMPTY_TEXTURES;
    const drawStats = drawLinePasses(this, frame);
    if (nextRetainedLineKey !== null && !retainedLines && this.noteBatch.isActive()) {
      this.noteBatch.retainLineBatch();
      this.retainedLineBatchKey = this.noteBatch.isActive() ? nextRetainedLineKey : null;
    } else if (nextRetainedLineKey === null || !retainedLines) {
      this.retainedLineBatchKey = null;
    }
    this.skipStaticLinePass = false;
    this.retainStaticLineBatch = false;
    const drawnNotes = drawStats.notes + drawStats.holds;
    if (
      !this.batchWarningShown &&
      this.skin &&
      drawnNotes >= 512 &&
      !(this.noteBatch.isActive() && drawStats.batchFallbacks * 2 < drawnNotes)
    ) {
      this.batchWarningShown = true;
      this.batchWarning?.();
    }
    const notesMs = performance.now() - notesStarted;
    const effectsStarted = performance.now();
    if (this.showHitEffects) {
      drawHitEffects(this, frame);
    }
    const effectsMs = performance.now() - effectsStarted;
    const compositeStarted = performance.now();
    const shaderInputEligible =
      this.sharedNoteBatch && this.applyShaders && frame.shaderEffects.length > 0;
    if (!shaderInputEligible) {
      // The ordinary path owns the note canvas and needs one final submission.
      // When shaders are active, defer this submission to finishToFramebuffer so
      // notes enter the same WebGL texture as the shader source.
      this.noteBatch.finish();
    }
    this.noiseComposited =
      this.soloLine === null &&
      this.noiseAreas.draw(
        frame,
        this.canvas,
        shaderInputEligible ? null : this.noteBatch.isActive() ? this.noteBatchCanvas : null,
        this.detailedNoise ?? detailedNoiseRendering.get(),
        shaderInputEligible
          ? () => {
              this.noteBatch.finish();
              return this.noteBatchCanvas;
            }
          : undefined,
      );
    const shaderInput =
      !this.noiseComposited && shaderInputEligible && this.noteBatch.isActive()
        ? this.noteBatch
        : null;
    const shaderOverlay =
      !this.noiseComposited &&
      !this.sharedNoteBatch &&
      this.applyShaders &&
      frame.shaderEffects.length > 0 &&
      this.noteBatch.isActive()
        ? this.noteBatchCanvas
        : null;
    const guide = drawComposite(this, frame, shaderOverlay, shaderInput);
    this.images?.trim?.();
    return {
      drawStats,
      notesMs,
      effectsMs,
      compositeMs: performance.now() - compositeStarted,
      guide,
      shaderSourceUploadMs: this.shaderPipeline.lastFrameMetrics.sourceUploadMs,
      shaderOverlayUploadMs: this.shaderPipeline.lastFrameMetrics.overlayUploadMs,
    };
  }

  /**
   * Paints one preview frame, or returns early when the last frame matches.
   * `collectGeometry` forces hit geometry and `deferHeavyFrame` postpones
   * expensive repaints past the interaction frame.
   */
  draw(
    chart: Chart,
    tempo: TempoSource,
    seconds: number,
    selectedLine: number,
    selectedNotes: PreviewNoteSelection = new Map(),
    options: PreviewDrawOptions = {},
  ): void {
    if (!this.visible) {
      return;
    }
    const drawStarted = performance.now();
    const previousTempo = this.scene.tempo;
    const chartChanged = this.scene.chart !== chart || previousTempo !== tempo;
    const tempoChanged = previousTempo !== tempo;
    const lineColorChanged =
      this.scene.defaultLineColor.length !== this.defaultLineColor.length ||
      this.scene.defaultLineColor.some(
        (channel, index) => channel !== this.defaultLineColor[index],
      );
    const liveGeometry = this.geometryObservers.size > 0;
    const collectGeometry = options.collectGeometry === true || liveGeometry;
    const selectedLines =
      options.selectedLines && options.selectedLines.length
        ? options.selectedLines
        : [selectedLine];
    const selectionChanged = !sameLineSelection(this.selectedLines, selectedLines);
    // One cached layout read feeds both the reuse check and canvas preparation.
    const measurement =
      this.frameMeasurement ??
      (this.display.kind === "workspace-underlay"
        ? { width: this.canvas.clientWidth, height: this.canvas.clientHeight }
        : measureCanvas(this.canvas));
    if (
      this.frameReusable(
        chart,
        tempo,
        seconds,
        selectedLine,
        selectedNotes,
        selectedLines,
        {
          chartChanged,
          lineColorChanged,
          selectionChanged,
          collectGeometry,
        },
        measurement,
      )
    ) {
      return;
    }
    if (selectionChanged) {
      this.selectedLineSet = new Set(selectedLines);
    }
    this.selectedLines = selectedLines;
    const heavyFrame = chartChanged || this.lastVisibleNoteCount > 400;
    if (options.deferHeavyFrame && heavyFrame && !collectGeometry && this.lastFrame) {
      // Leave `lastDrawRequest` untouched so the scheduled paint is not skipped as reusable.
      this.pendingFrame = { chart, tempo, seconds, selectedLine, selectedNotes };
      this.schedulePendingFrame();
      return;
    }
    // A geometry-only repaint redraws the same pixels; keep the shader texture.
    const pixelsUnchanged =
      collectGeometry &&
      this.frameReusable(
        chart,
        tempo,
        seconds,
        selectedLine,
        selectedNotes,
        selectedLines,
        {
          chartChanged,
          lineColorChanged,
          selectionChanged,
          collectGeometry: false,
        },
        measurement,
      );
    if (!pixelsUnchanged) {
      this.shaderSourceRevision += 1;
    }
    this.pendingFrame = null;
    this.drawCollectGeometry = collectGeometry;
    this.lastDrawRequest = { chart, tempo, seconds, selectedLine, selectedNotes };
    this.chart = chart;
    this.updateLineBatch(chart);
    let sceneCompileMs = 0;
    let sceneCollectionsMs = 0;
    let shaderCompileMs = 0;
    if (chartChanged || lineColorChanged) {
      const started = performance.now();
      this.scene.compile(
        chart,
        tempo,
        this.defaultLineColor,
        chartChanged ? options.changedLineIndexes : undefined,
        chartChanged ? options.noteChangeHints : undefined,
      );
      sceneCompileMs = performance.now() - started;
    }
    if (chartChanged) {
      const started = performance.now();
      this.updateSceneCollections(
        chart,
        tempo,
        tempoChanged,
        options.changedLineIndexes,
        options.noteChangeHints,
      );
      sceneCollectionsMs = performance.now() - started;
    }
    // Start source loading and idle compilation before the composite pass can
    // request a program. A pending source is skipped for this frame instead of
    // linking synchronously while the transport is playing.
    if (this.applyShaders) {
      const started = performance.now();
      this.shaderRuntime.compile(chart, tempo);
      shaderCompileMs = performance.now() - started;
    }
    const prewarmStarted = performance.now();
    this.prewarmShaderPrograms();
    const shaderPrewarmMs = performance.now() - prewarmStarted;
    const shaderEffects: readonly PreviewShaderEffect[] = this.applyShaders
      ? this.shaderRuntime.activeInto(seconds)
      : [];
    const canvasPrepareStarted = performance.now();
    const prepared = this.prepareCanvasFrame(measurement, drawStarted);
    const canvasPrepareMs = performance.now() - canvasPrepareStarted;
    const { context, width, height, viewport, divisor, screenScale, contentFrame, setupMs } =
      prepared;
    const { scale, scaleX, scaleY, centerX, centerY } = contentFrame;
    // Each frame samples into a fresh state array.
    // Preview only needs floor distance on lines that own notes; structural lines still
    // need their transform and alpha, but integrating their speed layers is wasted work.
    const sampleStarted = performance.now();
    setEventTrackSamplingStatsEnabled(renderDetailedProfileEnabled());
    resetEventTrackSamplingStats();
    const states = this.scene.sampleInto(seconds, this.sampledStates, false);
    const sampleMs = performance.now() - sampleStarted;
    const eventCursorStats = eventTrackSamplingStats();
    const order = this.scene.order;
    const noteOrder = this.scene.noteOrder;
    this.viewport = viewport;
    this.selectedLine = selectedLine;
    this.selectedNotes = selectedNotes;
    const staticGuide = this.staticGuideProjection;
    const reuseStaticGuides =
      this.scene.allStatesStatic &&
      staticGuide !== null &&
      staticGuide.chart === chart &&
      staticGuide.order === order &&
      staticGuide.centerX === centerX &&
      staticGuide.centerY === centerY &&
      staticGuide.scaleX === scaleX &&
      staticGuide.scaleY === scaleY;
    if (!reuseStaticGuides) {
      this.guides = lineGuides(
        states,
        chart.judgeLineList ?? [],
        order,
        centerX,
        centerY,
        scaleX,
        scaleY,
        this.guideBuffer,
      );
      this.guideRevision += 1;
      this.staticGuideProjection = this.scene.allStatesStatic
        ? { chart, order, centerX, centerY, scaleX, scaleY }
        : null;
    }
    const {
      visibleNoteCount,
      visibleHoldCount,
      visibilityMs,
      visibilityIndexMs,
      visibilityCandidateCount,
    } = this.collectVisibleNotes(seconds, states, noteOrder, divisor);
    const lines = this.scene.lines;
    const visibleNotes = this.visibleNoteBuckets;
    const visibleHolds = this.visibleHoldBuckets;
    const frame: PreviewFrame = {
      context,
      chart,
      tempo,
      scene: this.scene,
      states,
      order,
      visibleNotes,
      visibleHolds,
      seconds,
      selectedLine,
      width,
      height,
      centerX,
      centerY,
      scale,
      scaleX,
      scaleY,
      screenScale,
      viewport,
      shaderEffects,
      shaderSourceRevision: this.shaderSourceRevision,
    };
    const {
      drawStats,
      notesMs,
      effectsMs,
      compositeMs,
      guide,
      shaderSourceUploadMs,
      shaderOverlayUploadMs,
    } = this.drawFrameLayers(frame, options);
    this.lastFrame = {
      seconds,
      width,
      height,
      scale,
      scaleX,
      scaleY,
    };
    this.cameraTracker.remember(this.camera);
    this.drawRevision += 1;
    if (this.drawCollectGeometry) {
      const geometry = this.buildCollisionGeometry();
      this.geometryCache.set(this.geometryKey(), geometry);
      this.drawCollectGeometry = false;
      this.notifyGeometry(geometry);
    } else {
      this.geometryCache.clear();
      this.drawCollectGeometry = false;
    }
    this.lastVisibleNoteCount = visibleNoteCount + visibleHoldCount;
    reportPreviewTiming({
      seconds,
      totalMs: performance.now() - drawStarted,
      sceneCompileMs,
      sceneCollectionsMs,
      shaderCompileMs,
      shaderPrewarmMs,
      canvasPrepareMs,
      setupMs,
      sampleMs,
      visibilityMs,
      visibilityIndexMs,
      visibilityCandidateCount,
      notesMs,
      effectsMs,
      compositeMs,
      shaderSourceUploadMs,
      shaderOverlayUploadMs,
      guideDrawMs: guide?.durationMs ?? 0,
      guideGroupCount: guide?.groupCount ?? 0,
      guideVisibleGroupCount: guide?.visibleGroupCount ?? 0,
      guideTextCacheHits: guide?.textCacheHits ?? 0,
      guideTextCacheMisses: guide?.textCacheMisses ?? 0,
      guideDrawCalls: guide?.drawCalls ?? 0,
      guideRenderPath: guide?.renderPath ?? "canvas_fallback",
      visibleNoteCount,
      visibleHoldCount,
      lineCount: lines.length,
      drawnLineCount: drawStats.lines,
      drawnNoteCount: drawStats.notes,
      drawnHoldCount: drawStats.holds,
      batchFallbackCount: drawStats.batchFallbacks,
      fallbackReasons: drawStats.fallbackReasons,
      lineDrawMs: drawStats.lineMs,
      noteDrawMs: drawStats.noteMs,
      collectGeometry,
      noteBatchActive: this.noteBatch.isActive(),
      sampledLineCount: this.scene.lastSampleStats.sampledLineCount,
      staticLineCacheHits: this.scene.lastSampleStats.staticLineCacheHits,
      continuousLineCount: this.scene.lastSampleStats.continuousLineCount,
      parentComposeCount: this.scene.lastSampleStats.parentComposeCount,
      stateCopyCount: this.scene.lastSampleStats.stateCopyCount,
      eventCursorHits: eventCursorStats.cursorHits,
      eventCursorMisses: eventCursorStats.cursorMisses,
      renderPath: this.noteBatch.isActive()
        ? drawStats.batchFallbacks > 0
          ? "mixed"
          : "webgl_batch"
        : "canvas_fallback",
    });
  }
}
