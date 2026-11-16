/** Composites the preview's already rendered layers into one capture surface. */

/** Retained layer selection for one explicit preview frame. */
export interface PreviewCompositeRenderPacket {
  readonly base: HTMLCanvasElement;
  readonly notes: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly includeNotes: boolean;
  readonly includeOverlay: boolean;
}

/** Owns the Canvas2D operations needed to produce an offscreen preview frame. */
export class PreviewCompositeRenderDevice {
  private readonly output: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  /** Bind the device to the caller-owned output canvas. */
  constructor(output: HTMLCanvasElement) {
    this.output = output;
    const context = output.getContext("2d");
    if (!context) {
      throw new Error("preview_frame_canvas_unavailable");
    }
    this.context = context;
  }

  /** Submit one complete frame without exposing compositing calls to the renderer. */
  render(packet: PreviewCompositeRenderPacket): void {
    const { output, context } = this;
    context.clearRect(0, 0, output.width, output.height);
    context.drawImage(packet.base, 0, 0, output.width, output.height);
    if (packet.includeNotes) {
      context.drawImage(packet.notes, 0, 0, output.width, output.height);
    }
    if (packet.includeOverlay) {
      context.drawImage(packet.overlay, 0, 0, output.width, output.height);
    }
  }

  /** Release references held by the device; the output canvas remains caller-owned. */
  dispose(): void {
    // Canvas2D contexts do not expose an explicit destruction API.
  }
}
