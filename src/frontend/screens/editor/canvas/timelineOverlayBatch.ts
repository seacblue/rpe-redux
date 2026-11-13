/**
 * WebGL2 overlay for timeline strokes, selection geometry, and cached text.
 *
 * Geometry is submitted as coloured triangles so line widths do not depend on
 * the browser's implementation of `gl.lineWidth`. Text is rasterized once into
 * a transparent label texture and composited by WebGL; Canvas2D remains the
 * fallback when WebGL2 or the texture surface is unavailable.
 */
import { WebGlBatchSurface } from "./instancedBatch.ts";
import { configureTextureSampling, createCornerBuffer, linkProgram } from "./webgl.ts";

const GEOMETRY_STRIDE = 6;

/** GPU overlay used by the timeline's event field. */
export class TimelineOverlayBatch extends WebGlBatchSurface {
  private readonly labelCanvas: HTMLCanvasElement | null;
  private readonly labelContext: CanvasRenderingContext2D | null;
  private geometryProgram: WebGLProgram | null = null;
  private geometryBuffer: WebGLBuffer | null = null;
  private labelProgram: WebGLProgram | null = null;
  private labelBuffer: WebGLBuffer | null = null;
  private labelTexture: WebGLTexture | null = null;
  private geometryResolution: WebGLUniformLocation | null = null;
  private geometryScale: WebGLUniformLocation | null = null;
  private geometryPosition = -1;
  private geometryColor = -1;
  private labelResolution: WebGLUniformLocation | null = null;
  private labelSize: WebGLUniformLocation | null = null;
  private labelTextureUniform: WebGLUniformLocation | null = null;
  private labelCorner = -1;
  private vertices = new Float32Array(0);
  private vertexCount = 0;
  private vertexCapacity = 0;
  private labelDirty = false;

  /** Create the overlay; callers keep the Canvas2D drawing path as fallback. */
  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.labelCanvas = typeof document === "undefined" ? null : document.createElement("canvas");
    this.labelContext = this.labelCanvas?.getContext("2d") ?? null;
    this.initializeBatch();
  }

  /** Start a transparent overlay frame in logical CSS-pixel coordinates. */
  begin(width: number, height: number): boolean {
    this.vertexCount = 0;
    this.labelDirty = false;
    const ready = Boolean(
      this.geometryProgram &&
      this.geometryBuffer &&
      this.labelProgram &&
      this.labelBuffer &&
      this.labelTexture,
    );
    const backing = this.beginFrame(width, height, ready);
    if (!backing) {
      return false;
    }
    const labelCanvas = this.labelCanvas;
    const labelContext = this.labelContext;
    if (labelCanvas && labelContext) {
      if (labelCanvas.width !== backing.width || labelCanvas.height !== backing.height) {
        labelCanvas.width = backing.width;
        labelCanvas.height = backing.height;
      }
      labelContext.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      labelContext.clearRect(0, 0, width, height);
    }
    return true;
  }

  /** Queue a filled CSS-pixel rectangle. */
  addRect(x: number, y: number, width: number, height: number, color: string, alpha = 1): void {
    if (!this.isActive() || width <= 0 || height <= 0) {
      return;
    }
    this.addTriangle(x, y, x + width, y, x, y + height, color, alpha);
    this.addTriangle(x + width, y, x + width, y + height, x, y + height, color, alpha);
  }

  /** Queue a stroked CSS-pixel rectangle with a stable width on every browser. */
  addStrokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
    alpha = 1,
  ): void {
    this.addSegment(x, y, x + width, y, color, lineWidth, alpha);
    this.addSegment(x + width, y, x + width, y + height, color, lineWidth, alpha);
    this.addSegment(x + width, y + height, x, y + height, color, lineWidth, alpha);
    this.addSegment(x, y + height, x, y, color, lineWidth, alpha);
  }

  /** Queue one stroked segment, expanded to two triangles in the CPU staging buffer. */
  addSegment(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: string,
    lineWidth: number,
    alpha = 1,
  ): void {
    if (!this.isActive()) {
      return;
    }
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) {
      return;
    }
    const half = Math.max(0.5, lineWidth) / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    this.addTriangle(
      startX + nx,
      startY + ny,
      endX + nx,
      endY + ny,
      startX - nx,
      startY - ny,
      color,
      alpha,
    );
    this.addTriangle(
      endX + nx,
      endY + ny,
      endX - nx,
      endY - ny,
      startX - nx,
      startY - ny,
      color,
      alpha,
    );
  }

  /** Queue a sampled polyline without allocating a second point array. */
  addPolyline(points: readonly number[], color: string, lineWidth: number, alpha = 1): void {
    for (let index = 2; index < points.length; index += 2) {
      this.addSegment(
        points[index - 2] ?? 0,
        points[index - 1] ?? 0,
        points[index] ?? 0,
        points[index + 1] ?? 0,
        color,
        lineWidth,
        alpha,
      );
    }
  }

  /** Queue text using the same Canvas2D font and max-width semantics as fallback. */
  addText(
    text: string,
    x: number,
    y: number,
    maxWidth: number | undefined,
    font: string,
    color: string,
    align: CanvasTextAlign = "left",
    alpha = 1,
  ): void {
    if (!this.isActive() || !this.labelContext || !text) {
      return;
    }
    const context = this.labelContext;
    context.save();
    context.font = font;
    context.textAlign = align;
    context.textBaseline = "alphabetic";
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.fillStyle = color;
    if (maxWidth === undefined) {
      context.fillText(text, x, y);
    } else {
      context.fillText(text, x, y, Math.max(1, maxWidth));
    }
    context.restore();
    this.labelDirty = true;
  }

  /** Queue a selected-value label with its compact background chip. */
  addTextChip(
    text: string,
    centerX: number,
    baselineY: number,
    maxWidth: number,
    font: string,
    foreground: string,
    background: string,
    alpha = 1,
  ): void {
    if (!this.isActive() || !this.labelContext || !text) {
      return;
    }
    const context = this.labelContext;
    context.save();
    context.font = font;
    const chipWidth = Math.min(
      maxWidth,
      Math.max(12, Math.ceil(context.measureText(text).width) + 8),
    );
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    context.fillStyle = background;
    context.fillRect(centerX - chipWidth / 2, baselineY - 11, chipWidth, 14);
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.fillText(text, centerX, baselineY, Math.max(1, chipWidth - 6));
    context.restore();
    this.labelDirty = true;
  }

  /** Upload queued geometry/text and submit the overlay passes. */
  finish(): void {
    if (!this.isActive() || !this.gl) {
      return;
    }
    this.drawGeometry();
    const labelCanvas = this.labelCanvas;
    if (this.labelDirty && labelCanvas) {
      this.drawLabels();
    }
  }

  /** Release GPU resources and the context-loss listener. */
  dispose(): void {
    super.dispose();
    this.vertices = new Float32Array(0);
    this.vertexCapacity = 0;
  }

  private addTriangle(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    color: string,
    alpha: number,
  ): void {
    const channels = this.colorChannels(color);
    this.ensureCapacity(this.vertexCount + 3);
    this.writeVertex(ax, ay, channels, alpha);
    this.writeVertex(bx, by, channels, alpha);
    this.writeVertex(cx, cy, channels, alpha);
  }

  private writeVertex(x: number, y: number, color: readonly number[], alpha: number): void {
    const offset = this.vertexCount * GEOMETRY_STRIDE;
    this.vertices[offset] = x;
    this.vertices[offset + 1] = y;
    this.vertices[offset + 2] = color[0] ?? 0;
    this.vertices[offset + 3] = color[1] ?? 0;
    this.vertices[offset + 4] = color[2] ?? 0;
    this.vertices[offset + 5] = (color[3] ?? 1) * Math.max(0, Math.min(1, alpha));
    this.vertexCount += 1;
  }

  private ensureCapacity(vertexCount: number): void {
    if (vertexCount <= this.vertexCapacity) {
      return;
    }
    const nextCapacity = Math.max(vertexCount, this.vertexCapacity ? this.vertexCapacity * 2 : 256);
    const next = new Float32Array(nextCapacity * GEOMETRY_STRIDE);
    next.set(this.vertices.subarray(0, this.vertexCount * GEOMETRY_STRIDE));
    this.vertices = next;
    this.vertexCapacity = nextCapacity;
  }

  private drawGeometry(): void {
    if (!this.gl || !this.geometryProgram || !this.geometryBuffer || !this.vertexCount) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.geometryProgram);
    gl.uniform2f(this.geometryResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.geometryScale, this.ratio);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
    const upload = this.vertices.subarray(0, this.vertexCount * GEOMETRY_STRIDE);
    gl.bufferData(gl.ARRAY_BUFFER, upload, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.geometryPosition);
    gl.vertexAttribPointer(
      this.geometryPosition,
      2,
      gl.FLOAT,
      false,
      GEOMETRY_STRIDE * Float32Array.BYTES_PER_ELEMENT,
      0,
    );
    gl.enableVertexAttribArray(this.geometryColor);
    gl.vertexAttribPointer(
      this.geometryColor,
      4,
      gl.FLOAT,
      false,
      GEOMETRY_STRIDE * Float32Array.BYTES_PER_ELEMENT,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }

  private drawLabels(): void {
    const labelCanvas = this.labelCanvas;
    if (!this.gl || !this.labelProgram || !this.labelBuffer || !this.labelTexture || !labelCanvas) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.labelProgram);
    gl.uniform2f(this.labelResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.labelSize, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.labelTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.labelBuffer);
    gl.enableVertexAttribArray(this.labelCorner);
    gl.vertexAttribPointer(this.labelCorner, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  protected initializeResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    try {
      this.geometryProgram = linkProgram(
        gl,
        `#version 300 es
          in vec2 a_position;
          in vec4 a_color;
          uniform vec2 u_resolution;
          uniform float u_scale;
          out vec4 v_color;
          void main() {
            vec2 pixel = a_position * u_scale;
            vec2 clip = pixel / u_resolution * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            v_color = a_color;
          }
        `,
        `#version 300 es
          precision mediump float;
          in vec4 v_color;
          out vec4 outColor;
          void main() { outColor = v_color; }
        `,
      );
      this.labelProgram = linkProgram(
        gl,
        `#version 300 es
          in vec2 a_corner;
          uniform vec2 u_resolution;
          uniform vec2 u_size;
          out vec2 v_uv;
          void main() {
            vec2 pixel = a_corner * u_size;
            vec2 clip = pixel / u_resolution * 2.0 - 1.0;
            gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
            // DOM canvas uploads keep row 0 at v=0, and corner y=0 is the canvas
            // top, so the label texture is sampled in the same top-down order.
            v_uv = vec2(a_corner.x, a_corner.y);
          }
        `,
        `#version 300 es
          precision mediump float;
          uniform sampler2D u_texture;
          in vec2 v_uv;
          out vec4 outColor;
          void main() { outColor = texture(u_texture, v_uv); }
        `,
      );
    } catch {
      this.geometryProgram = null;
      this.labelProgram = null;
    }
    this.geometryBuffer = gl.createBuffer();
    this.labelBuffer = createCornerBuffer(gl);
    this.labelTexture = gl.createTexture();
    this.geometryResolution = this.geometryProgram
      ? gl.getUniformLocation(this.geometryProgram, "u_resolution")
      : null;
    this.geometryScale = this.geometryProgram
      ? gl.getUniformLocation(this.geometryProgram, "u_scale")
      : null;
    this.geometryPosition = this.geometryProgram
      ? gl.getAttribLocation(this.geometryProgram, "a_position")
      : -1;
    this.geometryColor = this.geometryProgram
      ? gl.getAttribLocation(this.geometryProgram, "a_color")
      : -1;
    this.labelResolution = this.labelProgram
      ? gl.getUniformLocation(this.labelProgram, "u_resolution")
      : null;
    this.labelSize = this.labelProgram ? gl.getUniformLocation(this.labelProgram, "u_size") : null;
    this.labelTextureUniform = this.labelProgram
      ? gl.getUniformLocation(this.labelProgram, "u_texture")
      : null;
    this.labelCorner = this.labelProgram ? gl.getAttribLocation(this.labelProgram, "a_corner") : -1;
    if (this.labelTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.labelTexture);
      configureTextureSampling(gl, gl.LINEAR);
    }
    if (this.labelTextureUniform) {
      gl.useProgram(this.labelProgram);
      gl.uniform1i(this.labelTextureUniform, 0);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  protected releaseResources(gl: WebGL2RenderingContext): void {
    gl.deleteProgram(this.geometryProgram);
    gl.deleteBuffer(this.geometryBuffer);
    gl.deleteProgram(this.labelProgram);
    gl.deleteBuffer(this.labelBuffer);
    gl.deleteTexture(this.labelTexture);
  }

  protected forgetResources(): void {
    this.geometryProgram = null;
    this.geometryBuffer = null;
    this.labelProgram = null;
    this.labelBuffer = null;
    this.labelTexture = null;
    this.vertexCount = 0;
  }
}
