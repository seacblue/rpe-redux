/** Executes retained overlay packets through Canvas2D or the timeline GPU batch. */
import { prepareCanvas } from "./canvas2d.ts";
import type { RenderCommand, RenderDevice, RenderPacket } from "./renderGraph.ts";
import type { TimelineOverlayBatch } from "./timelineOverlayBatch.ts";
import { renderProfileMark } from "../../../../core/diagnostics/renderMetrics.ts";

/** Draw one backend-neutral command through Canvas2D. */
function drawCanvasCommand(context: CanvasRenderingContext2D, command: RenderCommand): void {
  context.save();
  context.globalAlpha = command.alpha;
  if (command.kind === "fillRect") {
    context.fillStyle = command.color;
    context.fillRect(command.x, command.y, command.width, command.height);
  } else if (command.kind === "strokeRect") {
    context.strokeStyle = command.color;
    context.lineWidth = command.lineWidth;
    context.setLineDash([6, 4]);
    context.strokeRect(
      command.x + command.offset,
      command.y + command.offset,
      command.width,
      command.height,
    );
  } else if (command.kind === "polyline") {
    context.beginPath();
    for (let index = 0; index < command.points.length; index += 2) {
      const x = command.points[index] ?? 0;
      const y = command.points[index + 1] ?? 0;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = command.color;
    context.lineWidth = command.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([]);
    context.stroke();
  } else {
    context.font = command.font;
    context.fillStyle = command.color;
    context.textAlign = command.align;
    context.textBaseline = "alphabetic";
    if (command.maxWidth === undefined) {
      context.fillText(command.text, command.x, command.y);
    } else {
      context.fillText(command.text, command.x, command.y, Math.max(1, command.maxWidth));
    }
  }
  context.restore();
}

/** Queue one backend-neutral command through the GPU overlay batch. */
function drawGpuCommand(batch: TimelineOverlayBatch, command: RenderCommand): void {
  if (command.kind === "fillRect") {
    batch.addRect(
      command.x,
      command.y,
      command.width,
      command.height,
      command.color,
      command.alpha,
    );
  } else if (command.kind === "strokeRect") {
    batch.addStrokeRect(
      command.x + command.offset,
      command.y + command.offset,
      command.width,
      command.height,
      command.color,
      command.lineWidth,
      command.alpha,
    );
  } else if (command.kind === "polyline") {
    batch.addPolyline(command.points, command.color, command.lineWidth, command.alpha);
  } else {
    batch.addText(
      command.text,
      command.x,
      command.y,
      command.maxWidth,
      command.font,
      command.color,
      command.align,
      command.alpha,
    );
  }
}

/** Render device for the timeline overlay's two physical backend surfaces. */
export class TimelineOverlayRenderDevice implements RenderDevice {
  private readonly fallbackCanvas: HTMLCanvasElement;
  private readonly gpuBatch: TimelineOverlayBatch;

  /** Creates one device; business drawing never receives either backend object. */
  constructor(fallbackCanvas: HTMLCanvasElement, gpuBatch: TimelineOverlayBatch) {
    this.fallbackCanvas = fallbackCanvas;
    this.gpuBatch = gpuBatch;
  }

  /** Submit a retained packet to the GPU batch or Canvas2D fallback. */
  render(packet: RenderPacket): void {
    renderProfileMark("timeline.overlay.begin.start");
    const gpuActive = this.gpuBatch.begin(packet.width, packet.height);
    const context = gpuActive ? null : prepareCanvas(this.fallbackCanvas).context;
    if (gpuActive) {
      prepareCanvas(this.fallbackCanvas);
      for (const command of packet.commands) {
        drawGpuCommand(this.gpuBatch, command);
      }
      this.gpuBatch.finish();
      renderProfileMark("timeline.overlay.finish.end");
      return;
    }
    for (const command of packet.commands) {
      drawCanvasCommand(context!, command);
    }
  }

  /** Dispose the GPU adapter; the fallback canvas remains DOM-owned. */
  dispose(): void {
    this.gpuBatch.dispose();
  }
}
