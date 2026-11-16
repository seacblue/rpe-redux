/** Executes timeline grid and label packets through the active line batch or Canvas2D. */
import type { RenderCommand } from "./renderGraph.ts";
import type { TimelineLineBatch } from "./timelineLineBatch.ts";

/** A grid packet targets an already prepared Canvas2D layer. */
export interface TimelineGridRenderPacket {
  readonly context: CanvasRenderingContext2D;
  readonly commands: readonly RenderCommand[];
  readonly clip?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Render device for horizontal grid lines, playheads, and timeline labels. */
export class TimelineGridRenderDevice {
  private readonly lineBatch: TimelineLineBatch | undefined;

  /** Create a device over one optional WebGL line batch and its Canvas2D fallback. */
  constructor(lineBatch?: TimelineLineBatch) {
    this.lineBatch = lineBatch;
  }

  /** Execute one aggregated packet without exposing backend calls to timeline drawing code. */
  render(packet: TimelineGridRenderPacket): void {
    const { context } = packet;
    context.save?.();
    if (packet.clip) {
      context.beginPath();
      context.rect(packet.clip.left, packet.clip.top, packet.clip.width, packet.clip.height);
      context.clip();
    }
    const fallbackLines = new Map<
      string,
      {
        readonly color: string;
        readonly alpha: number;
        readonly lineWidth: number;
        points: number[];
      }
    >();
    for (const command of packet.commands) {
      if (command.kind === "fillRect" && this.lineBatch?.isActive()) {
        this.lineBatch.addRect(
          command.x,
          command.y,
          command.width,
          command.height,
          command.color,
          command.alpha,
        );
        continue;
      }
      if (command.kind === "fillRect") {
        if (!this.lineBatch?.isActive()) {
          const key = `${command.color}|${command.alpha}|${command.height}`;
          const line = fallbackLines.get(key) ?? {
            color: command.color,
            alpha: command.alpha,
            lineWidth: command.height,
            points: [],
          };
          line.points.push(command.x, command.y, command.x + command.width, command.y);
          fallbackLines.set(key, line);
        }
        continue;
      }
      if (command.kind === "text") {
        context.globalAlpha = command.alpha;
        context.font = command.font;
        context.fillStyle = command.color;
        context.textAlign = command.align;
        context.textBaseline = "alphabetic";
        if (command.maxWidth === undefined) {
          context.fillText(command.text, command.x, command.y);
        } else {
          context.fillText(command.text, command.x, command.y, Math.max(1, command.maxWidth));
        }
        continue;
      }
      throw new Error(`timeline_grid_command_unsupported:${command.kind}`);
    }
    if (!this.lineBatch?.isActive()) {
      for (const line of fallbackLines.values()) {
        context.globalAlpha = line.alpha;
        context.strokeStyle = line.color;
        context.lineWidth = line.lineWidth;
        context.beginPath();
        for (let index = 0; index < line.points.length; index += 4) {
          context.moveTo(line.points[index] ?? 0, line.points[index + 1] ?? 0);
          context.lineTo(line.points[index + 2] ?? 0, line.points[index + 3] ?? 0);
        }
        context.stroke();
      }
    }
    context.restore?.();
  }

  /** Copy a cached label layer without leaking the Canvas2D composite call to the timeline. */
  blit(
    target: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    width: number,
    height: number,
  ): void {
    target.drawImage(source, 0, 0, width, height);
  }
}
