/**
 * The spectrum canvas on the progress card: keeps the last audio analysis,
 * sizes the backing store to the host, and repaints when the data, geometry,
 * accent, or curve changes. The loader supplies one full-track analysis; the
 * A-B range is a separate frame on the progress surface.
 */
import { paintSpectrogramPixels } from "../../../core/media/spectrumPixels.ts";

import { type AudioAnalysisData } from "../../../core/media/audioAnalysis.ts";
import { resolveCanvasColor } from "../../../design/components/media/canvasColor.ts";

const MAX_SCALE = 2;

/** Paints the scrubber spectrum for one canvas. */
export class ScrubberSpectrum {
  canvas: HTMLCanvasElement;
  data: AudioAnalysisData | null = null;
  /** Perceptual emphasis shared with the timeline heatmap. */
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
    const style = getComputedStyle(this.canvas);
    const accent = style.getPropertyValue("--accent").trim();
    const foreground = style.getPropertyValue("--foreground").trim();
    const key = `${width}x${height}:${accent}:${foreground}:${this.curve}:${this.revision}`;
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
    if (data && data.bands > 0 && data.frameCount > 0 && data.spectrum.length > 0) {
      paintSpectrogramPixels(pixels, width, height, data, {
        low: resolveCanvasColor(accent, [90, 169, 255]),
        high: resolveCanvasColor(foreground, [255, 255, 255]),
        curve: this.curve,
        alpha: 0.9,
      });
    }
    context.putImageData(image, 0, 0);
  }
}
