/**
 * Paints analysed spectrum data as time-frequency heatmaps into RGBA buffers.
 *
 * The audio-analysis surface owns the energy grid; this module owns only the
 * display encoding. Horizontal callers get a conventional spectrogram with low
 * frequencies at the bottom. The timeline uses the vertical mirrored form so the
 * low bands hug the judge-line centre and the high bands spread outward.
 */
import { SPECTRUM_GAMMA, type AudioAnalysisData } from "./audioAnalysis.ts";
import { clamp01 } from "../utils/numbers.ts";

/** An opaque RGB triple in the 0-255 form ImageData consumes. */
export type SpectrogramRgb = readonly [number, number, number];

/** The ink and contrast of one heatmap. */
export interface SpectrogramStyle {
  /** Colour at the quiet end of the ramp. */
  low: SpectrogramRgb;
  /** Colour at the loud end of the ramp. */
  high: SpectrogramRgb;
  /**
   * Exponent applied to normalized energy. Values above one suppress quiet
   * texture; one keeps the analysis encoding unchanged.
   */
  curve?: number;
  /** Maximum alpha written into the buffer; defaults to fully opaque cells. */
  alpha?: number;
}

const TONE_FLOOR = 0.06;

const WINDOW_DECIBELS = 20;

const WINDOW_FLOOR = WINDOW_DECIBELS / 20;

/** Undo the spectrum gamma and map the magnitude onto a 20 dB display window. */
function tone(encoded: number): number {
  if (!(encoded > 0.0001)) {
    return 0;
  }
  const magnitude = Math.pow(encoded, 1 / SPECTRUM_GAMMA);
  return clamp01((Math.log10(magnitude) + WINDOW_FLOOR) / WINDOW_FLOOR);
}

/** Map one normalized cell value onto the styled colour and alpha ramp. */
function paintCell(
  pixels: Uint8ClampedArray,
  offset: number,
  encoded: number,
  style: SpectrogramStyle,
): void {
  const curve = Number.isFinite(style.curve) ? Math.max(0.25, style.curve as number) : 1.35;
  const shaped = Math.pow(clamp01(tone(encoded)), curve);
  const level = clamp01((shaped - TONE_FLOOR) / (1 - TONE_FLOOR));
  if (level <= 0.006) {
    return;
  }
  const alpha = Math.round(level * 255 * clamp01(style.alpha ?? 1));
  const lift = level;
  pixels[offset] = style.low[0] + (style.high[0] - style.low[0]) * lift;
  pixels[offset + 1] = style.low[1] + (style.high[1] - style.low[1]) * lift;
  pixels[offset + 2] = style.low[2] + (style.high[2] - style.low[2]) * lift;
  pixels[offset + 3] = alpha;
}

/** Average one band's encoded energy across the frames a display column covers. */
function bandEnergy(
  spectrum: Float32Array,
  frameCount: number,
  bands: number,
  band: number,
  firstFrame: number,
  lastFrame: number,
): number {
  let total = 0;
  for (let frame = firstFrame; frame < lastFrame; frame++) {
    total += spectrum[frame * bands + band] ?? 0;
  }
  return lastFrame > firstFrame ? total / (lastFrame - firstFrame) : 0;
}

/**
 * Paint a horizontal heatmap: time on the x-axis, frequency on the y-axis.
 *
 * Row zero is the highest band and the last row is the lowest band, which is
 * the conventional spectrogram orientation. A cell averages the frames and band
 * it covers so dense tracks keep stable blocks instead of flickering peaks.
 */
export function paintSpectrogramPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: AudioAnalysisData,
  style: SpectrogramStyle,
): void {
  const { bands, frameCount, spectrum } = data;
  if (width < 1 || height < 1 || bands < 1 || frameCount < 1) {
    return;
  }
  for (let column = 0; column < width; column++) {
    const firstFrame = Math.floor((column * frameCount) / width);
    const lastFrame = Math.max(firstFrame + 1, Math.floor(((column + 1) * frameCount) / width));
    for (let row = 0; row < height; row++) {
      const band = Math.min(bands - 1, Math.floor((1 - (row + 0.5) / height) * bands));
      const energy = bandEnergy(spectrum, frameCount, bands, band, firstFrame, lastFrame);
      paintCell(pixels, (row * width + column) * 4, energy, style);
    }
  }
}

/**
 * Paint a vertical, mirrored heatmap: time on the y-axis and frequency from the
 * centre outward. The centre is the lowest band, so the timeline's judge-line
 * axis stays in the quiet core and the brighter high bands sit at the edges.
 */
export function paintVerticalSpectrogramPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: AudioAnalysisData,
  style: SpectrogramStyle,
): void {
  const { bands, frameCount, spectrum } = data;
  if (width < 1 || height < 1 || bands < 1 || frameCount < 1) {
    return;
  }
  const centre = (width - 1) / 2;
  for (let row = 0; row < height; row++) {
    const firstFrame = Math.floor((row * frameCount) / height);
    const lastFrame = Math.max(firstFrame + 1, Math.floor(((row + 1) * frameCount) / height));
    for (let column = 0; column < width; column++) {
      const distance = centre > 0 ? Math.abs(column - centre) / centre : 0;
      const band = Math.min(bands - 1, Math.floor(distance * (bands - 1)));
      const energy = bandEnergy(spectrum, frameCount, bands, band, firstFrame, lastFrame);
      paintCell(pixels, (row * width + column) * 4, energy, style);
    }
  }
}
