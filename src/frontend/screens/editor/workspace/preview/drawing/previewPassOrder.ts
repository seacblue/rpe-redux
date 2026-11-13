/** Caches the sampled-line draw order while a preview scene remains unchanged. */
import type { RenderPass } from "./previewLines.ts";

interface SamplingPassOrder {
  readonly samplingLine: number;
  readonly passes: readonly RenderPass[];
}

const samplingPassOrders = new WeakMap<RenderPass[], SamplingPassOrder>();

/** Move one sampled line to the end of the line passes without rebuilding it per frame. */
export function passesForSampling(
  passes: RenderPass[],
  samplingLine: number | null | undefined,
): readonly RenderPass[] {
  if (samplingLine == null) {
    return passes;
  }
  const cached = samplingPassOrders.get(passes);
  if (cached?.samplingLine === samplingLine) {
    return cached.passes;
  }
  const reordered: RenderPass[] = [];
  for (const pass of passes) {
    if (pass.kind === "line" && pass.index !== samplingLine) {
      reordered.push(pass);
    }
  }
  for (const pass of passes) {
    if (pass.kind === "line" && pass.index === samplingLine) {
      reordered.push(pass);
      break;
    }
  }
  for (const pass of passes) {
    if (pass.kind !== "line") {
      reordered.push(pass);
    }
  }
  const result = { samplingLine, passes: reordered } satisfies SamplingPassOrder;
  samplingPassOrders.set(passes, result);
  return reordered;
}
