/**
 * Samples the existing preview renderer into a React-owned recording surface.
 *
 * The composite canvas is either handed to the platform H.264 encoder or
 * encoded as a PNG when that encoder cannot take the requested geometry.
 */
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import type { TempoMap } from "../../../../../core/global/chart/timing/tempo.ts";
import type { PreviewImages } from "../preview/scene/previewTypes.ts";
import { Preview } from "../preview/scene/preview.ts";
import { createPreviewDisplay } from "../preview/surface/previewDisplay.ts";
import { noiseLineSettings } from "../../../../../core/global/chart/noise/noiseLine.ts";

/** Canvases mounted by the recording component; the renderer never creates shell nodes. */
export interface RecordingSurface {
  readonly primary: HTMLCanvasElement;
  readonly notes: HTMLCanvasElement;
  readonly shader: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly output: HTMLCanvasElement;
}

/** Appearance copied when the recording is requested. */
export type RecordingAppearance = Pick<
  Preview,
  | "skin"
  | "noteSize"
  | "hitEffectScale"
  | "lineScale"
  | "backgroundEnabled"
  | "backgroundAlpha"
  | "backgroundBrightness"
  | "backgroundBlur"
  | "defaultLineColor"
  | "defaultParticleColor"
  | "highlight"
  | "showHitEffects"
  | "showGameUI"
  | "gameUiCornerCompression"
>;

/** An isolated renderer that samples explicit chart times. */
export class RecordingRenderer {
  private readonly preview: Preview;
  private readonly surface: RecordingSurface;
  private readonly outputContext: CanvasRenderingContext2D;
  private readonly chart: Chart;
  private readonly tempo: TempoMap;
  private noiseFailed = false;

  /** Creates the offscreen preview renderer bound to the recording canvases. */
  constructor(options: {
    surface: RecordingSurface;
    chart: Chart;
    tempo: TempoMap;
    images: PreviewImages;
    reference: RecordingAppearance;
    width: number;
    height: number;
    duration: number;
  }) {
    const { surface, reference, width, height } = options;
    this.surface = surface;
    this.chart = options.chart;
    this.tempo = options.tempo;
    const display = createPreviewDisplay(
      {
        primary: () => surface.primary,
        noteBatch: () => surface.notes,
        shader: () => surface.shader,
        overlay: () => surface.overlay,
      },
      "dedicated",
    );
    const preview = new Preview(surface.primary, {
      noteBatch: surface.notes,
      shader: surface.shader,
      overlay: surface.overlay,
      display,
    });
    this.preview = preview;
    preview.visible = true;
    preview.images = options.images;
    preview.skin = reference.skin;
    preview.aspectRatio = width / height;
    preview.viewDivisor = 1;
    preview.duration = options.duration;
    preview.noteOpacity = 1;
    preview.opacity = 1;
    preview.noteSize = reference.noteSize;
    preview.hitEffectScale = reference.hitEffectScale;
    preview.lineScale = reference.lineScale;
    preview.backgroundEnabled = reference.backgroundEnabled;
    preview.backgroundAlpha = reference.backgroundAlpha;
    preview.backgroundBrightness = reference.backgroundBrightness;
    preview.backgroundBlur = reference.backgroundBlur;
    preview.defaultLineColor = [...reference.defaultLineColor];
    preview.defaultParticleColor = [...reference.defaultParticleColor];
    preview.selectedLineColor = [];
    preview.highlight = reference.highlight;
    preview.showHitEffects = reference.showHitEffects;
    preview.showGameUI = reference.showGameUI;
    preview.gameUiCornerCompression = reference.gameUiCornerCompression;
    preview.lineNumbers = false;
    preview.lineArrows = false;
    preview.effectsSince = -Number.MAX_VALUE;
    preview.applyShaders = true;
    preview.detailedNoise = true;
    preview.noiseError = () => {
      this.noiseFailed = true;
    };
    surface.output.width = width;
    surface.output.height = height;
    const outputContext = surface.output.getContext("2d");
    if (!outputContext) {
      throw new Error("recording_canvas_unavailable");
    }
    this.outputContext = outputContext;
  }

  /** Load all effects before frame zero so asynchronous initialization cannot change the video. */
  async prepare(signal: AbortSignal): Promise<void> {
    const preview = this.preview;
    preview.shaderRuntime.compile(this.chart, this.tempo);
    const hasNoise =
      this.chart.blockAreaList?.length || this.chart.judgeLineList?.some(noiseLineSettings);
    const noise = hasNoise ? preview.prepareNoise() : Promise.resolve(true);
    await Promise.all([
      document.fonts.ready,
      document.fonts.load('35px "Saira"'),
      document.fonts.load('35px "Source Han Sans CN"'),
    ]);
    while (preview.shaderRuntime.loading.size > 0) {
      if (signal.aborted) {
        throw new DOMException("Cancelled", "AbortError");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const shaderSources = preview.shaderRuntime.effects.map((effect) => {
      const source = preview.shaderRuntime.source(effect.shader, effect.sourceName);
      if (!source) {
        throw new Error(`recording_shader_unavailable:${effect.shader}`);
      }
      return { name: effect.shader, source };
    });
    if (!preview.shaderPipeline.ensure(this.surface.shader)) {
      throw new Error("recording_shader_failed");
    }
    preview.shaderPipeline.retainSources(shaderSources.map((entry) => entry.source));
    await preview.shaderPipeline.precompile(shaderSources);
    for (const entry of shaderSources) {
      if (!preview.shaderPipeline.compile(entry.name, entry.source)) {
        throw new Error(`recording_shader_failed:${entry.name}`);
      }
    }
    if (!(await noise) || this.noiseFailed) {
      throw new Error("recording_noise_unavailable");
    }
    if (signal.aborted) {
      throw new DOMException("Cancelled", "AbortError");
    }
  }

  /** Render and copy every visible layer synchronously before the WebGL buffer can clear. */
  render(seconds: number): HTMLCanvasElement {
    const { primary, notes, shader, overlay, output } = this.surface;
    this.preview.draw(this.chart, this.tempo, seconds, -1);
    if (this.noiseFailed) {
      throw new Error("recording_noise_unavailable");
    }
    const effects = this.preview.shaderRuntime.active(seconds);
    if (effects.length && shader.style.visibility !== "visible") {
      throw new Error(`recording_shader_failed:${this.preview.shaderPipeline.lastError ?? ""}`);
    }
    const context = this.outputContext;
    context.clearRect(0, 0, output.width, output.height);
    const base = shader.style.visibility === "visible" ? shader : primary;
    context.drawImage(base, 0, 0, output.width, output.height);
    if (shader.style.visibility !== "visible" && notes.style.opacity !== "0") {
      context.drawImage(notes, 0, 0, output.width, output.height);
    }
    if (overlay.style.visibility === "visible") {
      context.drawImage(overlay, 0, 0, output.width, output.height);
    }
    return output;
  }

  /** Encode the composited canvas as the PNG fallback frame. */
  async frame(seconds: number): Promise<Uint8Array> {
    const output = this.render(seconds);
    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("recording_frame_encode_failed");
    }
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Releases the preview renderer and its WebGL resources. */
  dispose(): void {
    this.preview.dispose();
  }
}
