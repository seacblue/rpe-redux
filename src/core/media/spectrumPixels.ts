/**
 * Paints analysed spectrum data into the RGBA buffer the spectrum scrubber uploads.
 *
 * Owns tone shaping and the body and crest styling of the mirrored strip; canvas
 * and GPU upload stay in the frontend.
 */
import {
  SPECTRUM_GAMMA,
  shapeWaveform,
  type AudioAnalysisData,
  type WaveformChannel,
} from "./audioAnalysis.ts";
import { clamp01 } from "../utils/numbers.ts";

const TEXTURE_ALPHA = 0.58;

const BODY_MIN = 0.06;

const BODY_MAX = 0.34;

const CREST_ALPHA = 0.66;

const QUIET_FLOOR = 0.12;

/** Map a waveform level to a brighter display value with a square-root curve. */
function expand(value: number): number {
  return Math.sqrt(clamp01(value));
}

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

/** Peak level of one channel across a normalized progress span. */
function channelLevel(channel: WaveformChannel, start: number, end: number, curve: number): number {
  const length = Math.min(channel.min.length, channel.max.length);
  if (length === 0) {
    return 0;
  }
  const low = Math.max(0, Math.min(length - 1, Math.floor(start * (length - 1))));
  const high = Math.max(low, Math.min(length - 1, Math.ceil(end * (length - 1))));
  let minimum = 0;
  let maximum = 0;
  for (let index = low; index <= high; index++) {
    minimum = Math.min(minimum, channel.min[index] ?? 0);
    maximum = Math.max(maximum, channel.max[index] ?? 0);
  }
  return Math.abs(shapeWaveform(Math.max(Math.abs(minimum), Math.abs(maximum)), curve));
}

/**
 * Paint the stereo spectrum strip into an RGBA buffer.
 *
 * Left levels fill the upper half and right levels the lower half; `red`,
 * `green`, and `blue` are the base ink. `curve` shapes the waveform envelope.
 */
export function paintSpectrumPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  data: AudioAnalysisData,
  [red, green, blue]: [number, number, number],
  curve = 1,
): void {
  const { bands, frameCount, spectrum, left, right } = data;
  const center = (height - 1) / 2;
  const halfHeight = Math.max(1, height / 2);
  for (let column = 0; column < width; column++) {
    const progress = column / Math.max(1, width - 1);
    const nextProgress = (column + 1) / Math.max(1, width - 1);
    // The stereo strip is split at the centre line: left above, right below.
    const leftLevel = expand(channelLevel(left, progress, nextProgress, curve));
    const rightLevel = expand(channelLevel(right, progress, nextProgress, curve));

    // --- the texture: box-average the frames this column covers.
    const firstFrame = Math.floor((column * frameCount) / width);
    const lastFrame = Math.max(firstFrame + 1, Math.floor(((column + 1) * frameCount) / width));
    const frameWeight = 1 / (lastFrame - firstFrame);

    for (let row = 0; row < height; row++) {
      const distance = Math.abs(row - center);
      const depth = distance / halfHeight;
      const level = row <= center ? leftLevel : rightLevel;
      const gain = QUIET_FLOOR + (1 - QUIET_FLOOR) * level;
      const reach = Math.max(1, halfHeight * (0.2 + level * 0.8));
      // Low frequencies sit in the core and higher frequencies form the finer
      // outer texture. The two halves keep their own channel envelope.
      const band = Math.min(bands - 1, Math.floor(depth * bands));
      let alpha =
        distance <= reach
          ? BODY_MIN + (BODY_MAX - BODY_MIN) * Math.pow(1 - Math.min(1, depth), 1.45)
          : 0;
      let energy = 0;
      for (let frame = firstFrame; frame < lastFrame; frame++) {
        energy += spectrum[frame * bands + band] ?? 0;
      }
      alpha += TEXTURE_ALPHA * tone(energy * frameWeight) * gain * (1 - alpha);
      if (distance <= reach && distance < 1.2) {
        // A crisp but thin centre accent keeps the split strip legible.
        alpha = Math.min(1, Math.max(alpha, CREST_ALPHA * (0.4 + 0.6 * level)));
      }
      if (alpha <= 0.006) {
        continue;
      }
      // The brightest cells lift towards white, so the strip keeps some depth.
      const lift = Math.min(1, alpha) * 0.5;
      const offset = (row * width + column) * 4;
      pixels[offset] = red + (255 - red) * lift;
      pixels[offset + 1] = green + (255 - green) * lift;
      pixels[offset + 2] = blue + (255 - blue) * lift;
      pixels[offset + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
}
