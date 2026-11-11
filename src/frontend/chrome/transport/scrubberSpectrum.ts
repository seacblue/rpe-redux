/**
 * The spectrum canvas on the progress card: keeps the last audio analysis,
 * sizes the backing store to the host, and repaints when the data, geometry,
 * accent, or curve changes. The loader supplies one full-track analysis; the
 * A-B range is a separate frame on the progress surface.
 */
import { paintSpectrumPixels } from "../../../core/media/spectrumPixels.ts";

import { type AudioAnalysisData } from "../../../core/media/audioAnalysis.ts";

const MAX_SCALE = 2;

let probeContext: CanvasRenderingContext2D | null | undefined;

/** Parses a CSS colour through a 1x1 probe canvas, falling back to the accent blue. */
function resolveColor(value: string): [number, number, number] {
  if (probeContext === undefined) {
    if (typeof document === "undefined") {
      probeContext = null;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probeContext = canvas.getContext("2d", { willReadFrequently: true });
    }
  }
  if (!probeContext) {
    return [90, 169, 255];
  }
  probeContext.clearRect(0, 0, 1, 1);
  probeContext.fillStyle = value || "#5aa9ff";
  probeContext.fillRect(0, 0, 1, 1);
  const pixel = probeContext.getImageData(0, 0, 1, 1).data;
  return [pixel[0] ?? 90, pixel[1] ?? 169, pixel[2] ?? 255];
}

/** Paints the scrubber spectrum for one canvas. */
export class ScrubberSpectrum {
  canvas: HTMLCanvasElement;
  data: AudioAnalysisData | null = null;
  /** Perceptual emphasis shared with the timeline waveform. */
  curve = 1.5;
  painted = "";
  /** Bumped by `setData` so two tracks with identical shapes still repaint. */
  revision = 0;

  /** Binds the canvas this instance draws into. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** Replaces the analysed track and repaints, even when the shape is unchanged. */
  setData(data: AudioAnalysisData | null): void {
    this.data = data;
    this.revision += 1;
    this.painted = "";
    this.draw();
  }

  /** Drops the analysed track and clears the canvas. */
  clear(): void {
    this.setData(null);
  }

  /** Repaints when size, accent, curve, or data changed since the last frame. */
  draw(): void {
    // The backing store follows the CSS layout box; the full-track analysis is
    // painted once and remains aligned with the full-track seek domain.
    const layoutWidth = this.canvas.clientWidth;
    const layoutHeight = this.canvas.clientHeight;
    if (layoutWidth < 2 || layoutHeight < 2) {
      return;
    }
    const scale = Math.min(MAX_SCALE, Math.max(1, globalThis.devicePixelRatio || 1));
    const width = Math.max(2, Math.round(layoutWidth * scale));
    const height = Math.max(2, Math.round(layoutHeight * scale));
    const accent = getComputedStyle(this.canvas).getPropertyValue("--accent").trim();
    const key = `${width}x${height}:${accent}:${this.curve}:${this.revision}`;
    if (key === this.painted) {
      return;
    }
    this.painted = key;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }
    const image = context.createImageData(width, height);
    const pixels = image.data;
    const data = this.data;
    if (data && data.bands > 0 && data.frameCount > 0 && data.left.min.length > 0) {
      paintSpectrumPixels(pixels, width, height, data, resolveColor(accent), this.curve);
    }
    context.putImageData(image, 0, 0);
  }
}
