/** Submits retained preview shader-composite packets to the shader pipeline. */
import type { RenderDevice } from "../../../canvas/renderGraph.ts";
import type { ShaderInputLayer, ShaderPipeline, ShaderPass, ShaderView } from "./shaderPipeline.ts";

/** Complete shader composite request for one preview frame. */
export interface ShaderCompositeRenderPacket {
  readonly sourceCanvas: HTMLCanvasElement;
  readonly targetCanvas: HTMLCanvasElement | null;
  readonly passes: readonly ShaderPass[];
  readonly seconds: number;
  readonly sourceFor: (pass: ShaderPass) => string | null | undefined;
  readonly viewport?: ShaderView | null;
  readonly sourceRevision?: number;
  readonly overlayCanvas?: HTMLCanvasElement | null;
  readonly inputLayer?: ShaderInputLayer | null;
}

/** Render device that owns the shader pipeline submission seam. */
export class ShaderCompositeRenderDevice implements RenderDevice<ShaderCompositeRenderPacket> {
  private readonly pipeline: ShaderPipeline;

  /** Bind the device to the preview's persistent shader pipeline. */
  constructor(pipeline: ShaderPipeline) {
    this.pipeline = pipeline;
  }

  /** Submit one shader packet and return whether a visible pass was rendered. */
  render(packet: ShaderCompositeRenderPacket): boolean {
    if (!packet.inputLayer) {
      return this.pipeline.render(
        packet.sourceCanvas,
        packet.targetCanvas,
        packet.passes,
        packet.seconds,
        packet.sourceFor,
        packet.viewport,
        packet.sourceRevision,
        packet.overlayCanvas,
      );
    }
    return this.pipeline.render(
      packet.sourceCanvas,
      packet.targetCanvas,
      packet.passes,
      packet.seconds,
      packet.sourceFor,
      packet.viewport,
      packet.sourceRevision,
      packet.overlayCanvas,
      packet.inputLayer,
    );
  }

  /** Release the pipeline resources owned by this device. */
  dispose(): void {
    this.pipeline.dispose();
  }
}
