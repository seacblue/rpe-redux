/** Submits retained preview shader-composite packets to the shader pipeline. */
import type { RenderDevice } from "../../../canvas/renderGraph.ts";
import type {
  ShaderFrameSize,
  ShaderInputLayer,
  ShaderPipeline,
  ShaderPass,
  ShaderView,
} from "./shaderPipeline.ts";

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
  /** Fixed device-pixel target size, or null to follow the source measurement. */
  readonly textureLimit?: { width: number; height: number } | null;
  /** Logical size the frame was drawn in. */
  readonly frameSize?: ShaderFrameSize | null;
  /** RGBA semantic object-layer atlas for masked workspace passes. */
  readonly maskCanvas?: HTMLCanvasElement | null;
  /** Note-field semantic atlas for field-aware workspace passes. */
  readonly noteFieldMaskCanvas?: HTMLCanvasElement | null;
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
    const maskCanvas = packet.maskCanvas ?? null;
    const noteFieldMaskCanvas = packet.noteFieldMaskCanvas ?? null;
    if (packet.frameSize != null) {
      if (maskCanvas || noteFieldMaskCanvas) {
        return this.pipeline.render(
          packet.sourceCanvas,
          packet.targetCanvas,
          packet.passes,
          packet.seconds,
          packet.sourceFor,
          packet.viewport,
          packet.sourceRevision,
          packet.overlayCanvas,
          packet.inputLayer ?? null,
          packet.textureLimit ?? null,
          packet.frameSize,
          maskCanvas,
          noteFieldMaskCanvas,
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
        packet.inputLayer ?? null,
        packet.textureLimit ?? null,
        packet.frameSize,
      );
    }
    if (!packet.inputLayer) {
      if (maskCanvas || noteFieldMaskCanvas) {
        return this.pipeline.render(
          packet.sourceCanvas,
          packet.targetCanvas,
          packet.passes,
          packet.seconds,
          packet.sourceFor,
          packet.viewport,
          packet.sourceRevision,
          packet.overlayCanvas,
          undefined,
          packet.textureLimit,
          undefined,
          maskCanvas,
          noteFieldMaskCanvas,
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
        undefined,
        packet.textureLimit,
      );
    }
    if (maskCanvas || noteFieldMaskCanvas) {
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
        packet.textureLimit,
        undefined,
        maskCanvas,
        noteFieldMaskCanvas,
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
      packet.textureLimit,
    );
  }

  /** Release the pipeline resources owned by this device. */
  dispose(): void {
    this.pipeline.dispose();
  }
}
