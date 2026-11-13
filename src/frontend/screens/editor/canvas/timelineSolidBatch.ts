/**
 * WebGL2 instanced solid geometry for skinless timeline notes and Holds.
 *
 * Textured skin rendering remains in NoteBatch; this adapter removes the
 * Canvas2D fallback from the common no-skin timeline path.
 */
import { InstancedQuadBatch, type InstanceBatchAttribute } from "./instancedBatch.ts";

const INSTANCE_STRIDE = 10;

/** Instance attributes of the solid shader, in binding order. */
const INSTANCE_ATTRIBUTES: readonly InstanceBatchAttribute[] = [
  { name: "a_transform", size: 4, offsetFloats: 0 },
  { name: "a_rotation", size: 1, offsetFloats: 4 },
  { name: "a_shear", size: 1, offsetFloats: 5 },
  { name: "a_color", size: 4, offsetFloats: 6 },
];

/** GPU batch for transformed solid rectangles used by skinless notes. */
export class TimelineSolidBatch extends InstancedQuadBatch {
  /** Create the solid batch; callers retain Canvas2D as the fallback. */
  constructor(canvas: HTMLCanvasElement) {
    super(canvas, INSTANCE_STRIDE, INSTANCE_ATTRIBUTES);
    this.initializeBatch();
  }

  /** Queue a transformed solid rectangle in CSS-pixel coordinates. */
  addRect(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    shear: number,
    alpha: number,
    color: string,
  ): boolean {
    if (!this.isActive() || width <= 0 || height <= 0) {
      return false;
    }
    const channels = this.colorChannels(color);
    const offset = this.reserveInstance();
    const instances = this.instances;
    instances[offset] = centerX;
    instances[offset + 1] = centerY;
    instances[offset + 2] = width;
    instances[offset + 3] = height;
    instances[offset + 4] = rotation;
    instances[offset + 5] = shear;
    instances[offset + 6] = channels[0];
    instances[offset + 7] = channels[1];
    instances[offset + 8] = channels[2];
    instances[offset + 9] = channels[3] * Math.max(0, Math.min(1, alpha));
    return true;
  }

  /** Queue the procedural shape used for a skinless ordinary Note. */
  addHead(
    centerX: number,
    centerY: number,
    width: number,
    rotation: number,
    shear: number,
    alpha: number,
    color: string,
  ): boolean {
    return this.addRect(centerX, centerY, width, 8, rotation, shear, alpha, color);
  }

  /** Queue the procedural body and tail cap used for a skinless Hold. */
  addHold(
    centerX: number,
    headY: number,
    tailY: number,
    width: number,
    canvasHeight: number,
    alpha: number,
    color: string,
  ): boolean {
    const top = Math.max(-10, Math.min(headY, tailY));
    const bottom = Math.min(canvasHeight + 20, Math.max(headY, tailY));
    const bodyAdded = this.addRect(
      centerX,
      (top + bottom) / 2,
      width,
      Math.max(1, bottom - top),
      0,
      0,
      alpha * 0.45,
      color,
    );
    const capAdded = this.addRect(centerX, tailY, width, 6, 0, 0, alpha, color);
    return bodyAdded && capAdded;
  }

  protected vertexSource(): string {
    return `#version 300 es
          in vec2 a_corner;
          in vec4 a_transform;
          in float a_rotation;
          in float a_shear;
          in vec4 a_color;
          uniform vec2 u_resolution;
          out vec4 v_color;
          void main() {
            vec2 local = (a_corner - vec2(0.5)) * a_transform.zw;
            local.x += a_shear * local.y;
            float c = cos(a_rotation);
            float s = sin(a_rotation);
            vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
            vec2 pixel = a_transform.xy + rotated;
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
