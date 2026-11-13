/**
 * WebGL2 instanced batch for repeated timeline event bars, including skin-texture
 * sampling and per-instance UV and alpha data.
 *
 * It owns GPU resources and draw submission; callers supply rectangles and keep
 * the canvas path as the fallback when WebGL is unavailable.
 */
import type { TimelineEventRect } from "../../../../../../core/edit/timeline/types.ts";
import { sizeCanvasBackingStore } from "../../../canvas/canvas2d.ts";
import type { RpeSkin } from "../../../canvas/skin.ts";
import {
  bindInstanceAttribute,
  configureTextureSampling,
  createCornerBuffer,
  installContextLossHandlers,
  linkProgram,
} from "../../../canvas/webgl.ts";

type EventBarRectangle = Pick<TimelineEventRect, "x" | "y" | "width" | "height">;
const INSTANCE_STRIDE = 9;

interface SkinTextureDescriptor {
  readonly source: HTMLImageElement;
  readonly useful: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** GPU batch for repeated timeline event bars. */
export class TimelineEventBatch {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private cornerBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private resolution: WebGLUniformLocation | null = null;
  private textureUniform: WebGLUniformLocation | null = null;
  private cornerLocation = -1;
  private rectLocation = -1;
  private uvLocation = -1;
  private alphaLocation = -1;
  private alphaUniform: WebGLUniformLocation | null = null;
  private active = false;
  private width = 0;
  private height = 0;
  private alpha = 1;
  private instances = new Float32Array(0);
  private instanceCount = 0;
  private instanceBufferCapacity = 0;
  private textureSource: HTMLImageElement | null = null;
  private descriptor: SkinTextureDescriptor | null = null;
  private renderKey: string | null = null;
  private contextLost = false;
  private uninstallContextLoss: (() => void) | null = null;

  /** Create the WebGL2 batch, falling back to canvas when WebGL is unavailable. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false });
    if (!this.gl) {
      return;
    }
    this.uninstallContextLoss = installContextLossHandlers(this.canvas, {
      onLost: this.handleContextLost,
      onRestored: this.handleContextRestored,
    });
    this.initializeResources();
  }

  /** Whether the current frame can submit event bars through the GPU batch. */
  isActive(): boolean {
    return this.active;
  }

  /** Whether the batch cannot submit GPU work until its context is restored. */
  isContextLost(): boolean {
    return this.contextLost || this.gl?.isContextLost() === true;
  }

  /** Prevent the default loss handling and stop submitting GPU work. */
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.active = false;
    // Some hosts keep the last presented pixels after a loss. Resizing the
    // backing store clears the overlay so the canvas fallback is not doubled.
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      this.canvas.width = Math.max(1, this.canvas.width);
    }
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.texture = null;
    this.resolution = null;
    this.textureUniform = null;
    this.alphaUniform = null;
    this.cornerLocation = -1;
    this.rectLocation = -1;
    this.uvLocation = -1;
    this.alphaLocation = -1;
    this.textureSource = null;
    this.descriptor = null;
    this.instanceCount = 0;
    this.instanceBufferCapacity = 0;
    this.renderKey = null;
  };

  /** Recreate every GPU object after the browser restores the context. */
  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.instanceCount = 0;
    this.textureSource = null;
    this.renderKey = null;
    this.initializeResources();
  };

  /** Compile the shaders and allocate the buffers, texture, and attribute slots. */
  private initializeResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    try {
      this.program = linkProgram(
        gl,
        `#version 300 es
      in vec2 a_corner;
      in vec4 a_rect;
      in vec4 a_uv;
      in float a_alpha;
      uniform vec2 u_resolution;
      out vec2 v_uv;
      out float v_alpha;
      void main() {
        vec2 pixel = a_rect.xy + a_corner * a_rect.zw;
        vec2 clip = pixel / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
        v_alpha = a_alpha;
      }
    `,
        `#version 300 es
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_alpha;
      in vec2 v_uv;
      in float v_alpha;
      out vec4 outColor;
      void main() {
        outColor = texture(u_texture, v_uv) * vec4(1.0, 1.0, 1.0, u_alpha * v_alpha);
      }
    `,
      );
    } catch {
      this.program = null;
    }
    this.cornerBuffer = createCornerBuffer(gl);
    this.instanceBuffer = gl.createBuffer();
    this.texture = gl.createTexture();
    this.resolution = this.program ? gl.getUniformLocation(this.program, "u_resolution") : null;
    this.textureUniform = this.program ? gl.getUniformLocation(this.program, "u_texture") : null;
    this.cornerLocation = this.program ? gl.getAttribLocation(this.program, "a_corner") : -1;
    this.rectLocation = this.program ? gl.getAttribLocation(this.program, "a_rect") : -1;
    this.uvLocation = this.program ? gl.getAttribLocation(this.program, "a_uv") : -1;
    this.alphaLocation = this.program ? gl.getAttribLocation(this.program, "a_alpha") : -1;
    this.alphaUniform = this.program ? gl.getUniformLocation(this.program, "u_alpha") : null;
    if (this.texture) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      configureTextureSampling(gl);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Start a pass; returns false when the same key, size, and skin texture are already current. */
  begin(
    width: number,
    height: number,
    skin: RpeSkin | null,
    alpha = 1,
    renderKey?: string,
  ): boolean {
    if (this.isContextLost()) {
      this.contextLost = true;
      this.active = false;
      return true;
    }
    const descriptor = skin?.eventBarTexture() ?? null;
    const active = Boolean(this.gl && this.program && this.texture && descriptor);
    if (
      renderKey &&
      this.renderKey === renderKey &&
      this.width === width &&
      this.height === height &&
      this.alpha === alpha &&
      this.active === active &&
      this.descriptor === descriptor
    ) {
      return false;
    }
    this.width = width;
    this.height = height;
    this.alpha = alpha;
    this.instanceCount = 0;
    this.descriptor = descriptor;
    this.active = active;
    this.renderKey = renderKey ?? null;
    if (!this.gl) {
      return true;
    }
    const backing = sizeCanvasBackingStore(this.canvas, { width, height });
    this.gl.viewport(0, 0, backing.width, backing.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    return true;
  }

  /** Queue one bar instance; false means the caller must use the canvas fallback. */
  add(rectangle: EventBarRectangle, lineAlpha = 1): boolean {
    if (!this.active || this.isContextLost() || rectangle.width <= 0 || rectangle.height <= 0) {
      return false;
    }
    const descriptor = this.descriptor;
    if (!descriptor) {
      return false;
    }
    const { source, useful } = descriptor;
    if (this.textureSource !== source) {
      this.uploadTexture(source);
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) {
      return false;
    }
    const offset = this.instanceCount * INSTANCE_STRIDE;
    this.ensureCapacity(offset + INSTANCE_STRIDE);
    this.instances[offset] = rectangle.x;
    this.instances[offset + 1] = rectangle.y;
    this.instances[offset + 2] = rectangle.width;
    this.instances[offset + 3] = rectangle.height;
    this.instances[offset + 4] = useful.x / width;
    this.instances[offset + 5] = useful.y / height;
    this.instances[offset + 6] = (useful.x + useful.width) / width;
    this.instances[offset + 7] = (useful.y + useful.height) / height;
    this.instances[offset + 8] = lineAlpha;
    this.instanceCount += 1;
    return true;
  }

  /** Upload the queued instances and submit one instanced draw call. */
  finish(): void {
    if (
      !this.active ||
      this.isContextLost() ||
      !this.gl ||
      !this.program ||
      !this.instanceBuffer ||
      !this.instanceCount
    ) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    if (this.resolution) {
      gl.uniform2f(this.resolution, this.width, this.height);
    }
    if (this.alphaUniform) {
      gl.uniform1f(this.alphaUniform, this.alpha);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.textureUniform) {
      gl.uniform1i(this.textureUniform, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(this.cornerLocation);
    gl.vertexAttribPointer(this.cornerLocation, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.cornerLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const upload = this.instances.subarray(0, this.instanceCount * INSTANCE_STRIDE);
    if (upload.byteLength > this.instanceBufferCapacity) {
      this.instanceBufferCapacity = upload.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceBufferCapacity, gl.STREAM_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
    bindInstanceAttribute(gl, this.rectLocation, 4, INSTANCE_STRIDE, 0);
    bindInstanceAttribute(gl, this.uvLocation, 4, INSTANCE_STRIDE, 4);
    bindInstanceAttribute(gl, this.alphaLocation, 1, INSTANCE_STRIDE, 8);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
  }

  /** Release the GPU buffers, texture, and program. */
  dispose(): void {
    this.uninstallContextLoss?.();
    this.uninstallContextLoss = null;
    if (!this.gl) {
      return;
    }
    if (!this.isContextLost()) {
      if (this.program) {
        this.gl.deleteProgram(this.program);
      }
      if (this.cornerBuffer) {
        this.gl.deleteBuffer(this.cornerBuffer);
      }
      if (this.instanceBuffer) {
        this.gl.deleteBuffer(this.instanceBuffer);
      }
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
      }
    }
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.texture = null;
    this.instances = new Float32Array(0);
    this.instanceCount = 0;
    this.instanceBufferCapacity = 0;
    this.descriptor = null;
    this.textureSource = null;
    this.active = false;
    this.renderKey = null;
  }

  /** Grow the instance buffer geometrically to hold `required` floats. */
  private ensureCapacity(required: number): void {
    if (required <= this.instances.length) {
      return;
    }
    let capacity = Math.max(INSTANCE_STRIDE * 64, this.instances.length || INSTANCE_STRIDE);
    while (capacity < required) {
      capacity *= 2;
    }
    const next = new Float32Array(capacity);
    next.set(this.instances);
    this.instances = next;
  }

  /** Upload the skin event-bar image and remember its source element. */
  private uploadTexture(source: HTMLImageElement): void {
    if (!this.gl || !this.texture || this.isContextLost()) {
      return;
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    this.textureSource = source;
  }
}
