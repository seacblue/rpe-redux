/* eslint-disable max-lines -- preview lifecycle, sampling, painting, and hit geometry are one runtime. */
/**
 * The preview's imperative runtime: scene sampling, viewport fitting, painting,
 * shaders, and hit geometry for one frame. Core chart modules own evaluation.
 */
import { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
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
import { canvasPixelRatio, measureCanvas, prepareCanvas } from "../../../canvas/canvas2d.ts";
import { drawComposite } from "./previewComposite.ts";
import { drawHitEffects } from "../drawing/previewHitEffects.ts";

import { drawLinePasses } from "../drawing/previewLines.ts";
import { readCanvasPalette } from "../../../canvas/palette.ts";
import { ShaderPipeline, type ShaderProgramSource } from "../render/shaderPipeline.ts";
import { NoteBatch } from "../../../canvas/noteBatch.ts";
import { PreviewBackground, type TextureImage } from "../render/background.ts";
import { NoiseAreaRenderer } from "../render/noiseAreaRenderer.ts";
import { detailedNoiseRendering } from "../../../../../../core/edit/state/noiseRendering.ts";
import { createPreviewDisplay, type PreviewDisplayAdapter } from "../surface/previewDisplay.ts";
import type { Chart, JudgeLineNote } from "../../../../../../core/global/chart/chart.ts";
import type { NoteEntry } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { SampledLineState } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
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
import type {
  PreviewCanvasLayers,
  PreviewColorSettings,
  PreviewFrame,
  PreviewHitArea,
  PreviewImages,
  PreviewLineFrame,
  PreviewSkin,
  PreviewNoteSelection,
} from "./previewTypes.ts";

/** Per-call switches for one preview paint. */
export interface PreviewDrawOptions {
  /** Build hit-test geometry only for an interaction or an explicit query. */
  readonly collectGeometry?: boolean;
  /** Maximum cosmetic hit effects to draw in one frame. */
  readonly maxHitEffects?: number;
  /** Let a large chart edit repaint after the interaction frame. */
  readonly deferHeavyFrame?: boolean;
  /** All judge lines in the current selection; falls back to selectedLine. */
  readonly selectedLines?: readonly number[];
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
  private readonly geometryCache = new PreviewGeometryCache();
  private readonly completionTimesCache = new CompletionTimesCache();
  private readonly geometryObservers = new Set<(geometry: HitTestPreviewGeometry | null) => void>();
  private drawCollectGeometry = false;
  // `declare` fields are assigned by the constructor or methods; this adds types only.
  declare canvas: HTMLCanvasElement;
  declare scene: SceneRuntime;
  declare shaderRuntime: ShaderRuntime;
  declare shaderPipeline: ShaderPipeline;
  declare noteBatch: NoteBatch;
  private readonly noteBatchCanvas: HTMLCanvasElement;
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
  declare noteHitAreas: PreviewHitArea[];
  declare chart: Chart | null;
  declare simultaneous: Set<unknown> | null;
  declare simultaneousCache: SimultaneousNotesCache<JudgeLineNote>;
  declare completionTimes: number[];
  declare passes: RenderPass[];
  declare guides: LineGuide[] | null;
  declare viewport: PreviewViewport | null;
  /** Chart-content camera; only notes, lines, guides, and hit effects follow it. */
  camera: PreviewCamera = { active: false, zoom: 1, panX: 0, panY: 0 };
  private readonly cameraTracker = new PreviewCameraTracker();
  declare selectedLine: number;
  /** Every line in the current multi-line selection, if any. */
  declare selectedLines: readonly number[];
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
  private readonly visibleNoteBuckets: NoteEntry[][] = [];
  private readonly visibleHoldBuckets: NoteEntry[][] = [];
  private readonly sampledStates: SampledLineState[] = [];
  /** Chart and source revision already handed to the shader precompiler. */
  private shaderPrewarmChart: Chart | null = null;
  private shaderPrewarmRevision = -1;
  private readonly guideBuffer: NonNullable<Preview["guides"]> = [];
  readonly hitStateCache = new Map<number, (index: number) => SampledLineState>();

  /** Resets all cached chart, frame, and geometry state for a closed document. */
  clearDocument(): void {
    this.noiseAreas.clear();
    this.noiseComposited = false;
    this.lineFrames.length = 0;
    this.lastFrame = null;
    this.scene.clear();
    this.chart = null;
    this.samplingFocus = null;
    this.samplingAlpha = null;
    this.simultaneous = null;
    this.simultaneousCache.clear();
    this.completionTimes = [];
    this.completionTimesCache.clear();
    this.passes = [];
    this.noteHitAreas.length = 0;
    this.selectedNotes = new Map();
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
    this.shaderPipeline.dispose();
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
    this.noiseAreas.dispose();
    this.noteBatch.dispose();
    this.display.dispose();
  }

  /** Creates the preview for `canvas`, optionally reusing caller-provided layers. */
  constructor(canvas: HTMLCanvasElement, layers: PreviewCanvasLayers | null = null) {
    this.canvas = canvas;
    this.scene = new SceneRuntime();
    this.simultaneousCache = new SimultaneousNotesCache();
    this.shaderRuntime = new ShaderRuntime(() => this.invalidate?.(), readShaderSource);
    this.shaderPipeline = new ShaderPipeline(() => this.invalidate?.());
    this.noteBatchCanvas = layers?.noteBatch ?? document.createElement("canvas");
    this.noteBatch = new NoteBatch(this.noteBatchCanvas);
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
    this.shaderCanvas = layers?.shader ?? null;
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
  private updateSceneCollections(chart: Chart, tempo: TempoSource, tempoChanged: boolean): void {
    this.hitStateCache.clear();
    const sourceLines = chart.judgeLineList ?? [];
    const noteSources = sourceLines.map((line) => line.notes);
    const notesSame =
      !tempoChanged &&
      sourceLines.length === this.previewNoteSources.length &&
      sourceLines.every((line, index) => line.notes === this.previewNoteSources[index]);
    const orderSame =
      sourceLines.length === this.previewZOrder.length &&
      sourceLines.every((line, index) => Number(line.zOrder ?? 0) === this.previewZOrder[index]);
    if (!notesSame) {
      this.simultaneous = this.simultaneousCache.update(chart, tempo);
      this.completionTimes = this.completionTimesCache.update(this.scene.lines, noteSources, tempo);
    }
    if (!orderSame) {
      this.passes = linePasses(sourceLines, this.scene.order);
    }
    this.previewNoteSources = noteSources;
    this.previewZOrder = sourceLines.map((line) => Number(line.zOrder ?? 0));
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
    const { context, width, height } = prepareCanvas(this.canvas, true, measurement);
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
    drawStarted: number,
    setupMs: number,
    sampleMs: number,
  ): {
    visibleNoteCount: number;
    visibleHoldCount: number;
    visibilityMs: number;
    visibilityIndexMs: number;
    visibilityCandidateCount: number;
  } {
    const lines = this.scene.lines;
    const visibleNotes = this.visibleNoteBuckets;
    const visibleHolds = this.visibleHoldBuckets;
    visibleNotes.length = lines.length;
    visibleHolds.length = lines.length;
    let visibleNoteCount = 0;
    let visibleHoldCount = 0;
    let visibilityIndexMs = 0;
    let visibilityCandidateCount = 0;
    for (const index of order) {
      const state = states[index];
      const runtime = lines[index];
      const bucket = visibleNotes[index] ?? (visibleNotes[index] = []);
      const holdBucket = visibleHolds[index] ?? (visibleHolds[index] = []);
      if (!runtime || !state) {
        bucket.length = 0;
        holdBucket.length = 0;
        continue;
      }
      runtime.visibleNotes(seconds, state, 1600 * divisor + Math.hypot(state.x, state.y), bucket);
      visibilityIndexMs += runtime.lastVisibilityStats.indexMs;
      visibilityCandidateCount += runtime.lastVisibilityStats.candidateCount;
      holdBucket.length = 0;
      let noteWrite = 0;
      let holdWrite = 0;
      for (const entry of bucket) {
        if (entry.note.type === 2) {
          holdBucket[holdWrite++] = entry;
        } else {
          bucket[noteWrite++] = entry;
        }
      }
      bucket.length = noteWrite;
      holdBucket.length = holdWrite;
      visibleNoteCount += noteWrite;
      visibleHoldCount += holdWrite;
    }
    return {
      visibleNoteCount,
      visibleHoldCount,
      visibilityMs: performance.now() - drawStarted - setupMs - sampleMs,
      visibilityIndexMs,
      visibilityCandidateCount,
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
  } {
    this.noteHitAreas.length = 0;
    this.lineFrames.length = 0;
    const notesStarted = performance.now();
    this.noteBatch.begin(frame.width, frame.height, this.skin ?? null, frame.viewport);
    const drawStats = drawLinePasses(this, frame);
    this.noteBatch.finish();
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
      drawHitEffects(this, frame, options.maxHitEffects);
    }
    const effectsMs = performance.now() - effectsStarted;
    const compositeStarted = performance.now();
    this.noiseComposited =
      this.soloLine === null &&
      this.noiseAreas.draw(
        frame,
        this.canvas,
        this.noteBatch.isActive() ? this.noteBatchCanvas : null,
        this.detailedNoise ?? detailedNoiseRendering.get(),
      );
    // Shader passes consume the primary canvas. Include the GPU note layer
    // before those passes when noise has not already composed it there.
    if (
      !this.noiseComposited &&
      this.applyShaders &&
      this.shaderRuntime.active(frame.seconds).length > 0 &&
      this.noteBatch.isActive() &&
      this.noteBatchCanvas
    ) {
      frame.context.save();
      frame.context.setTransform(1, 0, 0, 1, 0, 0);
      frame.context.drawImage(this.noteBatchCanvas, 0, 0, this.canvas.width, this.canvas.height);
      frame.context.restore();
      this.noiseComposited = true;
    }
    drawComposite(this, frame);
    this.images?.trim?.();
    return {
      drawStats,
      notesMs,
      effectsMs,
      compositeMs: performance.now() - compositeStarted,
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
    if (chartChanged || lineColorChanged) {
      this.scene.compile(chart, tempo, this.defaultLineColor);
    }
    if (chartChanged) {
      this.updateSceneCollections(chart, tempo, tempoChanged);
    }
    // Start source loading and idle compilation before the composite pass can
    // request a program. A pending source is skipped for this frame instead of
    // linking synchronously while the transport is playing.
    if (this.applyShaders) {
      this.shaderRuntime.compile(chart, tempo);
    }
    this.prewarmShaderPrograms();
    const prepared = this.prepareCanvasFrame(measurement, drawStarted);
    const { context, width, height, viewport, divisor, screenScale, contentFrame, setupMs } =
      prepared;
    const { scale, scaleX, scaleY, centerX, centerY } = contentFrame;
    // Each frame samples into a fresh state array.
    const states = this.scene.sampleInto(seconds, this.sampledStates);
    const sampleMs = performance.now() - drawStarted - setupMs;
    const order = this.scene.order;
    this.viewport = viewport;
    this.selectedLine = selectedLine;
    this.selectedNotes = selectedNotes;
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
    const {
      visibleNoteCount,
      visibleHoldCount,
      visibilityMs,
      visibilityIndexMs,
      visibilityCandidateCount,
    } = this.collectVisibleNotes(seconds, states, order, divisor, drawStarted, setupMs, sampleMs);
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
      shaderSourceRevision: this.shaderSourceRevision,
    };
    const { drawStats, notesMs, effectsMs, compositeMs } = this.drawFrameLayers(frame, options);
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
      totalMs: performance.now() - drawStarted,
      setupMs,
      sampleMs,
      visibilityMs,
      visibilityIndexMs,
      visibilityCandidateCount,
      notesMs,
      effectsMs,
      compositeMs,
      visibleNoteCount,
      visibleHoldCount,
      lineCount: lines.length,
      drawnLineCount: drawStats.lines,
      drawnNoteCount: drawStats.notes,
      drawnHoldCount: drawStats.holds,
      batchFallbackCount: drawStats.batchFallbacks,
      lineDrawMs: drawStats.lineMs,
      noteDrawMs: drawStats.noteMs,
      collectGeometry,
      noteBatchActive: this.noteBatch.isActive(),
    });
  }
}
