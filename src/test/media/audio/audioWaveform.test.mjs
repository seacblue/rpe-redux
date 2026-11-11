/** Signed stereo min/max analysis and the perceptual waveform curve. */
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAudioBuffer, shapeWaveform } from "../../../core/media/audioAnalysis.ts";
import { paintSpectrumPixels } from "../../../core/media/spectrumPixels.ts";

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

test("the progress spectrum separates the two channel envelopes at the centre", () => {
  const width = 2;
  const height = 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const levels = new Float32Array([1, 1, 1, 1]);
  const silence = new Float32Array([0, 0, 0, 0]);
  paintSpectrumPixels(
    pixels,
    width,
    height,
    {
      duration: 1,
      channels: 2,
      left: { min: levels, max: levels },
      right: { min: silence, max: silence },
      spectrum: new Float32Array(16 * 4),
      bands: 16,
      frameCount: 4,
    },
    [90, 169, 255],
    1.5,
  );
  const alpha = (row, column) => pixels[(row * width + column) * 4 + 3];
  // Left channel occupies the upper half; the silent right channel stays empty.
  assert.ok(alpha(0, 0) > alpha(3, 0));
  assert.equal(alpha(3, 0), 0);
});
