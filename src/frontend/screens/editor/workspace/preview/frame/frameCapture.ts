/**
 * Renders one chart frame through the existing preview pipeline.
 *
 * The capture keeps its own detached canvas stack and renderer, so a frame
 * request never seeks playback, changes the live preview, or reads the window
 * layout. Renderers are cached by chart revision, geometry, skin, and image
 * generation; a document change rebuilds the cache on the next capture.
 */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import { fromNumber } from "../../../../../../core/global/chart/timing/beat.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";
import {
  frozenPreviewFrameImage,
  previewFrameBeatValue,
  previewFrameDataUrlBytes,
  previewFrameMimeType,
  type PreviewFrameFormat,
  type PreviewFrameImage,
  type PreviewFrameSpec,
} from "../../../../../../core/edit/preview/frame.ts";
import { chartFingerprint } from "../../../../../../core/edit/document/chartRevision.ts";
import type { Preview } from "../scene/preview.ts";
import type { RpeSkin } from "../../../canvas/skin.ts";
import type { OffscreenPreviewAppearance, OffscreenPreviewSurface } from "./offscreenPreview.ts";

/** The renderer surface a capture needs; tests can supply a lighter one. */
export interface PreviewFrameRenderer {
  prepare(signal: AbortSignal): Promise<void>;
  frameDataUrl(seconds: number, format: PreviewFrameFormat, quality: number): string;
  dispose(): void;
}

/** Inputs for one offscreen renderer instance. */
export interface PreviewFrameRendererOptions {
  readonly chart: Chart;
  readonly tempo: TempoMap;
  readonly images: ProjectImages;
  readonly reference: OffscreenPreviewAppearance;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
}

/** Host state needed to sample a chart frame without the live surface. */
export interface PreviewFrameCaptureOptions {
  readonly preview: Preview;
  readonly skin: RpeSkin;
  readonly images: ProjectImages;
  readonly chart: () => Chart;
  readonly tempo: () => TempoMap;
  readonly duration: () => number;
  /** Renderer factory seam; defaults to the detached preview renderer. */
  readonly createRenderer?: (
    options: PreviewFrameRendererOptions,
  ) => PreviewFrameRenderer | Promise<PreviewFrameRenderer>;
}

/** One cached renderer and the resources it borrowed from the host. */
interface CachedPreviewRenderer {
  readonly key: string;
  readonly renderer: PreviewFrameRenderer;
  readonly skin: RpeSkin;
}

/** Create one detached canvas with an explicit backing-store size. */
function detachedCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Build the five-layer surface used by the offscreen renderer. */
function detachedSurface(width: number, height: number): OffscreenPreviewSurface {
  return {
    primary: detachedCanvas(width, height),
    notes: detachedCanvas(width, height),
    shader: detachedCanvas(width, height),
    overlay: detachedCanvas(width, height),
    output: detachedCanvas(width, height),
  };
}

/** Build the default detached renderer for one frame geometry. */
async function createOffscreenRenderer(
  options: PreviewFrameRendererOptions,
): Promise<PreviewFrameRenderer> {
  const { OffscreenPreviewRenderer } = await import("./offscreenPreview.ts");
  return new OffscreenPreviewRenderer({
    ...options,
    surface: detachedSurface(options.width, options.height),
    detached: true,
  });
}

/** Copy the live preview's appearance into the offscreen renderer. */
function previewAppearance(preview: Preview, skin: RpeSkin): OffscreenPreviewAppearance {
  return {
    skin,
    noteSize: preview.noteSize,
    hitEffectScale: preview.hitEffectScale,
    lineScale: preview.lineScale,
    backgroundEnabled: preview.backgroundEnabled,
    backgroundAlpha: preview.backgroundAlpha,
    backgroundBrightness: preview.backgroundBrightness,
    backgroundBlur: preview.backgroundBlur,
    defaultLineColor: [...preview.defaultLineColor],
    defaultParticleColor: [...preview.defaultParticleColor],
    highlight: preview.highlight,
    showHitEffects: preview.showHitEffects,
    showGameUI: preview.showGameUI,
    gameUiCornerCompression: preview.gameUiCornerCompression,
  };
}

/**
 * Serialized frame capture for one mounted editor.
 *
 * `capture` queues requests because the offscreen preview keeps per-frame
 * caches. Frames from the same chart, size, skin, and image generation reuse
 * one renderer and its compiled shaders.
 */
export class PreviewFrameCapture {
  private readonly options: PreviewFrameCaptureOptions;
  private cached: CachedPreviewRenderer | null = null;
  private queue: Promise<void> = Promise.resolve();
  private prepareController: AbortController | null = null;
  private disposed = false;

  /** Bind the capture to one preview, skin, image cache, and chart source. */
  constructor(options: PreviewFrameCaptureOptions) {
    this.options = options;
  }

  /** Render one validated frame; requests run in arrival order. */
  capture(request: PreviewFrameSpec): Promise<PreviewFrameImage> {
    const run = this.queue.then(() => this.captureNow(request));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Release the cached renderer and any preparation still running. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.prepareController?.abort();
    this.queue = this.queue.then(
      () => this.releaseRenderer(),
      () => this.releaseRenderer(),
    );
  }

  /** Resolve the requested time and render it through the cached renderer. */
  private async captureNow(request: PreviewFrameSpec): Promise<PreviewFrameImage> {
    if (this.disposed) {
      throw new Error("Preview frame capture is disposed");
    }
    const chart = this.options.chart();
    const tempo = this.options.tempo();
    const seconds = request.seconds ?? tempo.seconds(request.beat as Beat);
    const beat = request.beat ?? fromNumber(tempo.beat(seconds));
    const renderer = await this.rendererFor(chart, tempo, request);
    const dataUrl = renderer.frameDataUrl(seconds, request.format, request.quality);
    return frozenPreviewFrameImage({
      seconds,
      beat,
      beatValue: previewFrameBeatValue(beat),
      width: request.width,
      height: request.height,
      format: request.format,
      mimeType: previewFrameMimeType(request.format),
      quality: request.quality,
      dataUrl,
      byteLength: previewFrameDataUrlBytes(dataUrl),
      chartFingerprint: chartFingerprint(chart),
    });
  }

  /** Return the cached renderer for this revision and geometry, or build one. */
  private async rendererFor(
    chart: Chart,
    tempo: TempoMap,
    request: PreviewFrameSpec,
  ): Promise<PreviewFrameRenderer> {
    const key = [
      chartFingerprint(chart),
      `${request.width}x${request.height}`,
      this.options.skin.textureRevision,
      this.options.images.generation,
    ].join("|");
    if (this.cached?.key === key) {
      return this.cached.renderer;
    }
    this.releaseRenderer();
    const skin = this.options.skin.cloneForRecording();
    const duration = this.options.duration();
    const createRenderer = this.options.createRenderer ?? createOffscreenRenderer;
    let renderer: PreviewFrameRenderer;
    try {
      renderer = await createRenderer({
        chart,
        tempo,
        images: this.options.images,
        reference: previewAppearance(this.options.preview, skin),
        width: request.width,
        height: request.height,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 600,
      });
    } catch (error) {
      skin.dispose();
      throw error;
    }
    const controller = new AbortController();
    this.prepareController = controller;
    try {
      await renderer.prepare(controller.signal);
    } catch (error) {
      renderer.dispose();
      skin.dispose();
      throw error;
    } finally {
      if (this.prepareController === controller) {
        this.prepareController = null;
      }
    }
    if (this.disposed) {
      renderer.dispose();
      skin.dispose();
      throw new Error("Preview frame capture is disposed");
    }
    this.cached = { key, renderer, skin };
    return renderer;
  }

  /** Dispose the cached renderer and the skin copy it owns. */
  private releaseRenderer(): void {
    const cached = this.cached;
    this.cached = null;
    if (!cached) {
      return;
    }
    cached.renderer.dispose();
    cached.skin.dispose();
  }
}

/** Build one capture service for the mounted editor. */
export function createPreviewFrameCapture(
  options: PreviewFrameCaptureOptions,
): PreviewFrameCapture {
  return new PreviewFrameCapture(options);
}
