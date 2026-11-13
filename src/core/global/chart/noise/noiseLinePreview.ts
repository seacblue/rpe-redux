/** Projects an editor noise line from its sampled scene transform for preview. */
import type { JudgeLine } from "../chart.ts";
import type { LineState } from "../runtime/scene.ts";
import type { TempoMap } from "../timing/tempo.ts";
import { blockAreaBounds, type BlockArea } from "./blockArea.ts";
import type { NoiseAreaSample } from "./noiseRuntime.ts";
import { noiseAreaForLine } from "./noiseLine.ts";

/** Compile lifetime and activation independently of world-space line transforms. */
export function noiseLinePreviewArea(line: JudgeLine, tempo: TempoMap): BlockArea | null {
  return noiseAreaForLine({ ...line, father: -1, notes: [], eventLayers: [], extended: {} }, tempo);
}

/** Replace template corners with the current scene's world-space line geometry. */
export function sampleNoiseLinePreview(
  area: BlockArea,
  sample: NoiseAreaSample,
  state: LineState,
  sizeX: number,
  sizeY: number,
  aspect: number,
): NoiseAreaSample {
  return sampleNoiseLinePreviewInto(area, sample, state, sizeX, sizeY, aspect, {
    state: sample.state,
    activation: sample.activation,
    points: [],
    invert: sample.invert,
  });
}

/** Project a noise-line sample into caller-owned storage without allocating a polygon. */
export function sampleNoiseLinePreviewInto(
  area: BlockArea,
  sample: NoiseAreaSample,
  state: LineState,
  sizeX: number,
  sizeY: number,
  aspect: number,
  target: NoiseAreaSample,
): NoiseAreaSample {
  const bounds = blockAreaBounds(area);
  const angle = (state.rotation * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const points = target.points;
  for (let index = 0; index < bounds.corners.length; index++) {
    const { x, y } = bounds.corners[index];
    const dx = (x - bounds.centerX) * sizeX;
    const dy = (y - bounds.centerY) * sizeY;
    const point = points[index] ?? (points[index] = { x: 0, y: 0 });
    point.x = state.x + c * dx + s * dy * aspect;
    point.y = state.y - (s * dx) / aspect + c * dy;
  }
  points.length = bounds.corners.length;
  target.state = sample.state;
  target.activation = sample.activation;
  target.invert = sample.invert;
  return target;
}
