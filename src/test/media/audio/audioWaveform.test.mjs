/** Signed stereo analysis, the perceptual curve, and the spectrum heatmaps. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAudioBuffer, shapeWaveform } from "../../../core/media/audioAnalysis.ts";
import {
  paintSpectrogramPixels,
  paintVerticalSpectrogramPixels,
} from "../../../core/media/spectrumPixels.ts";

function buffer(channels) {
  const length = channels[0].length;
  return {
    length,
    numberOfChannels: channels.length,
    duration: 1,
    getChannelData: (index) => channels[index],
  };
}

test("waveform buckets keep signed min/max per channel instead of averaging", () => {
  const left = new Float32Array([0.25, 0.25, 0.25, 0.25]);
  const right = new Float32Array([-0.5, -0.5, -0.5, -0.5]);
  const result = analyzeAudioBuffer(buffer([left, right]), {
    waveformSize: 4,
    bands: 16,
    spectrumFrames: 256,
  });
  assert.equal(result.channels, 2);
  assert.deepEqual([...result.left.min.slice(0, 4)], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...result.left.max.slice(0, 4)], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...result.right.min.slice(0, 4)], [-1, -1, -1, -1]);
  assert.deepEqual([...result.right.max.slice(0, 4)], [-1, -1, -1, -1]);
});

test("waveform curve lifts quiet detail while preserving sign and order", () => {
  assert.ok(shapeWaveform(0.1, 1.5) > 0.1);
  assert.ok(shapeWaveform(-0.1, 1.5) < -0.1);
  assert.ok(shapeWaveform(0.1, 0.7) < 0.1);
  assert.ok(shapeWaveform(0.5, 1.5) < shapeWaveform(0.8, 1.5));
});

function heatmapData() {
  // Frame 0 is low-band energy; frame 1 is high-band energy.
  return {
    duration: 1,
    channels: 1,
    left: { min: new Float32Array(4), max: new Float32Array(4) },
    right: { min: new Float32Array(4), max: new Float32Array(4) },
    spectrum: new Float32Array([1, 0, 0, 1]),
    bands: 2,
    frameCount: 2,
  };
}

test("the horizontal heatmap puts time on x and low frequencies at the bottom", () => {
  const width = 2;
  const height = 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  paintSpectrogramPixels(pixels, width, height, heatmapData(), {
    low: [90, 169, 255],
    high: [237, 240, 244],
    curve: 1,
  });
  const alpha = (row, column) => pixels[(row * width + column) * 4 + 3];
  assert.ok(alpha(1, 0) > 0, "the first time column should carry the low band");
  assert.equal(alpha(0, 0), 0, "the first time column has no high band");
  assert.ok(alpha(0, 1) > 0, "the second time column should carry the high band");
  assert.equal(alpha(1, 1), 0, "the second time column has no low band");
});

test("the vertical heatmap mirrors low frequencies around the centre", () => {
  const width = 3;
  const height = 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  paintVerticalSpectrogramPixels(pixels, width, height, heatmapData(), {
    low: [90, 169, 255],
    high: [237, 240, 244],
    curve: 1,
  });
  const alpha = (row, column) => pixels[(row * width + column) * 4 + 3];
  assert.ok(alpha(0, 1) > 0, "the centre column carries the low band at the first frame");
  assert.equal(alpha(0, 0), 0, "the edge column has no high band at the first frame");
  assert.ok(alpha(1, 0) > 0, "the edge column carries the high band at the second frame");
  assert.equal(alpha(1, 1), 0, "the centre column has no low band at the second frame");
  // Both edges mirror the same high band.
  assert.equal(alpha(1, 0), alpha(1, 2));
});
