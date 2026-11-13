/**
 * WebGL2 instanced rectangles for timeline grid lines and playheads.
 *
 * The batch owns only GPU resources and packed line instances. Text, labels,
 * hit testing, and Canvas2D fallback drawing remain outside this module.
 */
import { InstancedQuadBatch, type InstanceBatchAttribute } from "./instancedBatch.ts";

const INSTANCE_STRIDE = 8;

/** Instance attributes of the line shader, in binding order. */
const INSTANCE_ATTRIBUTES: readonly InstanceBatchAttribute[] = [
  { name: "a_rect", size: 4, offsetFloats: 0 },
  { name: "a_color", size: 4, offsetFloats: 4 },
];

/** GPU batch for horizontal and vertical timeline rectangles. */
export class TimelineLineBatch extends InstancedQuadBatch {
  /** Create the line batch; Canvas2D remains the caller-owned fallback. */
  constructor(canvas: HTMLCanvasElement) {
    super(canvas, INSTANCE_STRIDE, INSTANCE_ATTRIBUTES);
    this.initializeBatch();
  }

  /** Drop only the queued instances before a new frame. */
  clear(): void {
    this.clearQueuedInstances();
  }

  /** Queue one axis-aligned rectangle in CSS-pixel coordinates. */
  addRect(x: number, y: number, width: number, height: number, color: string, alpha = 1): void {
    if (!this.isActive() || width <= 0 || height <= 0) {
      return;
    }
    const channels = this.colorChannels(color);
    const offset = this.reserveInstance();
    const instances = this.instances;
    instances[offset] = x;
    instances[offset + 1] = y;
    instances[offset + 2] = width;
    instances[offset + 3] = height;
    instances[offset + 4] = channels[0];
    instances[offset + 5] = channels[1];
    instances[offset + 6] = channels[2];
    instances[offset + 7] = channels[3] * Math.max(0, Math.min(1, alpha));
  }

  protected vertexSource(): string {
    return `#version 300 es
          in vec2 a_corner;
          in vec4 a_rect;
          in vec4 a_color;
          uniform vec2 u_resolution;
          out vec4 v_color;
          void main() {
            vec2 pixel = a_rect.xy + a_corner * a_rect.zw;
            vec2 clip = pixel / u_resolution * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            v_color = a_color;
          }
        `;
  }

  protected fragmentSource(): string {
    return `#version 300 es
          precision mediump float;
          in vec4 v_color;
          out vec4 outColor;
          void main() { outColor = v_color; }
        `;
  }
}
