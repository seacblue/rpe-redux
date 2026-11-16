/** Draws retained guide labels and selected arrows through the shared WebGL2 context. */
import type { WebGlRenderBackend } from "../../../canvas/renderBackend.ts";
import { createCornerBuffer, linkProgram } from "../../../canvas/webgl.ts";
import type { GuideDrawStats, GuideRenderPacket } from "../drawing/previewGuides.ts";

const GUIDE_VERTEX_SOURCE = `#version 300 es
in vec2 a_corner;
in vec2 a_center;
in vec2 a_size;
in float a_rotation;
in vec4 a_uv;
uniform vec2 u_resolution;
out vec2 v_uv;
void main() {
  vec2 local = a_corner * a_size - a_size * 0.5;
  float cosine = cos(a_rotation);
  float sine = sin(a_rotation);
  vec2 rotated = vec2(
    local.x * cosine - local.y * sine,
    local.x * sine + local.y * cosine
  );
  vec2 position = a_center + rotated;
  vec2 clip = vec2(
    position.x / u_resolution.x * 2.0 - 1.0,
    1.0 - position.y / u_resolution.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
}`;

const GUIDE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_atlas, v_uv);
}`;

const INSTANCE_STRIDE = 9;

/** Retained WebGL guide batch with one atlas upload and at most two draw calls. */
export class PreviewGuideBatch {
  private readonly canvas: HTMLCanvasElement;
  private readonly backend: WebGlRenderBackend;
  private readonly removeLifecycle: () => void;
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private cornerBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private resolution: WebGLUniformLocation | null = null;
  private atlasUniform: WebGLUniformLocation | null = null;
  private cornerLocation = -1;
  private centerLocation = -1;
  private sizeLocation = -1;
  private rotationLocation = -1;
  private uvLocation = -1;
  private atlasTexture: WebGLTexture | null = null;
  private atlasCanvas: HTMLCanvasElement | null = null;
  private atlasRevision = -1;
  private arrowTexture: WebGLTexture | null = null;
  private arrowSource: CanvasImageSource | null = null;
  /** Reused CPU instance storage; only the active prefix is uploaded per frame. */
  private instanceData = new Float32Array(0);
  private instanceCapacity = 0;
  private lost = false;

  /** Create a guide batch bound to the preview shader's shared WebGL2 context. */
  constructor(canvas: HTMLCanvasElement, backend: WebGlRenderBackend) {
    this.canvas = canvas;
    this.backend = backend;
    const gl = backend.gl as WebGL2RenderingContext;
    if (typeof gl.drawArraysInstanced !== "function") {
      throw new Error("Preview guide batch requires WebGL2 instancing");
    }
    this.gl = gl;
    if (!this.initializeResources()) {
      throw new Error("Cannot create preview guide buffers");
    }
    this.removeLifecycle = backend.addLifecycle({
      onLost: () => {
        this.lost = true;
      },
      onRestored: () => {
        this.lost = false;
        this.atlasRevision = -1;
        this.atlasCanvas = null;
        this.arrowSource = null;
        this.initializeResources();
      },
    });
  }

  /** Submit visible labels and the selected arrow without touching Canvas2D. */
  render(
    packet: GuideRenderPacket,
    width: number,
    height: number,
    clip?: { left: number; top: number; width: number; height: number },
  ): GuideDrawStats | null {
    const started = performance.now();
    if (
      this.lost ||
      !this.backend.isUsable() ||
      !this.program ||
      !this.cornerBuffer ||
      !this.instanceBuffer ||
      (!packet.glyphs.length && !packet.arrows.length)
    ) {
      return null;
    }
    const atlas = packet.atlas.getCanvas();
    if (!atlas || !this.ensureAtlas(packet)) {
      return null;
    }
    const gl = this.gl;
    const ratio = this.canvas.width / Math.max(1, width);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (clip) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.max(0, Math.round(clip.left * ratio)),
        Math.max(0, Math.round((height - clip.top - clip.height) * ratio)),
        Math.max(0, Math.round(clip.width * ratio)),
        Math.max(0, Math.round(clip.height * ratio)),
      );
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    if (this.atlasUniform) {
      gl.uniform1i(this.atlasUniform, 0);
    }
    if (this.resolution) {
      gl.uniform2f(this.resolution, width, height);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    if (this.cornerLocation >= 0) {
      gl.enableVertexAttribArray(this.cornerLocation);
      gl.vertexAttribPointer(this.cornerLocation, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    this.bindInstanceAttribute(this.centerLocation, 2, 0);
    this.bindInstanceAttribute(this.sizeLocation, 2, 2);
    this.bindInstanceAttribute(this.rotationLocation, 1, 4);
    this.bindInstanceAttribute(this.uvLocation, 4, 5);
    let drawCalls = 0;
    if (packet.glyphs.length) {
      this.ensureInstanceCapacity(packet.glyphs.length);
      const instances = this.instanceData;
      const atlasWidth = Math.max(1, atlas.width);
      const atlasHeight = Math.max(1, atlas.height);
      packet.glyphs.forEach((glyph, index) => {
        const entry = glyph.atlasGlyph;
        if (!entry) {
          return;
        }
        const offset = index * INSTANCE_STRIDE;
        instances[offset] = glyph.x;
        instances[offset + 1] = glyph.y;
        instances[offset + 2] = entry.width;
        instances[offset + 3] = entry.height;
        instances[offset + 4] = (glyph.rotation * Math.PI) / 180;
        instances[offset + 5] = entry.sourceX / atlasWidth;
        // Canvas-backed WebGL uploads keep row zero at v=0, matching the
        // top-down corner buffer used by the Canvas2D fallback.
        instances[offset + 6] = entry.sourceY / atlasHeight;
        instances[offset + 7] = (entry.sourceX + entry.sourceWidth) / atlasWidth;
        instances[offset + 8] = (entry.sourceY + entry.sourceHeight) / atlasHeight;
      });
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        instances.subarray(0, packet.glyphs.length * INSTANCE_STRIDE),
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, packet.glyphs.length);
      drawCalls += 1;
    }
    if (packet.arrows.length && this.ensureArrowTexture(packet.arrows[0].source)) {
      this.ensureInstanceCapacity(packet.arrows.length);
      const instances = this.instanceData;
      packet.arrows.forEach((arrow, index) => {
        const offset = index * INSTANCE_STRIDE;
        instances[offset] = arrow.x;
        instances[offset + 1] = arrow.y;
        instances[offset + 2] = arrow.size * 2;
        instances[offset + 3] = arrow.size * 2;
        instances[offset + 4] = (arrow.rotation * Math.PI) / 180 + Math.PI;
        instances[offset + 5] = 0;
        instances[offset + 6] = 1;
        instances[offset + 7] = 1;
        instances[offset + 8] = 0;
      });
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.arrowTexture);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        instances.subarray(0, packet.arrows.length * INSTANCE_STRIDE),
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, packet.arrows.length);
      drawCalls += 1;
    }
    gl.disable(gl.SCISSOR_TEST);
    return {
      durationMs: performance.now() - started,
      groupCount: packet.groupCount,
      visibleGroupCount: packet.visibleGroupCount,
      textCacheHits: packet.textCacheHits,
      textCacheMisses: packet.textCacheMisses,
      drawCalls,
      renderPath: "webgl_atlas",
    };
  }

  /** Release the GPU resources while leaving the caller-owned canvas intact. */
  dispose(): void {
    this.removeLifecycle();
    if (!this.backend.isUsable()) {
      return;
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    if (this.cornerBuffer) {
      this.gl.deleteBuffer(this.cornerBuffer);
    }
    if (this.instanceBuffer) {
      this.gl.deleteBuffer(this.instanceBuffer);
    }
    if (this.atlasTexture) {
      this.gl.deleteTexture(this.atlasTexture);
    }
    if (this.arrowTexture) {
      this.gl.deleteTexture(this.arrowTexture);
    }
  }

  private ensureAtlas(packet: GuideRenderPacket): boolean {
    const canvas = packet.atlas.getCanvas();
    if (!canvas) {
      return false;
    }
    const gl = this.gl;
    if (!this.atlasTexture) {
      this.atlasTexture = gl.createTexture();
    }
    if (!this.atlasTexture) {
      return false;
    }
    if (this.atlasCanvas === canvas && this.atlasRevision === packet.atlas.getRevision()) {
      return true;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.atlasCanvas = canvas;
    this.atlasRevision = packet.atlas.getRevision();
    return true;
  }

  private initializeResources(): boolean {
    if (!this.backend.isUsable()) {
      return false;
    }
    const gl = this.gl;
    const program = linkProgram(gl, GUIDE_VERTEX_SOURCE, GUIDE_FRAGMENT_SOURCE);
    const cornerBuffer = createCornerBuffer(gl);
    const instanceBuffer = gl.createBuffer();
    if (!cornerBuffer || !instanceBuffer) {
      if (program) {
        gl.deleteProgram(program);
      }
      if (cornerBuffer) {
        gl.deleteBuffer(cornerBuffer);
      }
      if (instanceBuffer) {
        gl.deleteBuffer(instanceBuffer);
      }
      return false;
    }
    this.program = program;
    this.cornerBuffer = cornerBuffer;
    this.instanceBuffer = instanceBuffer;
    this.resolution = gl.getUniformLocation(program, "u_resolution");
    this.atlasUniform = gl.getUniformLocation(program, "u_atlas");
    this.cornerLocation = gl.getAttribLocation(program, "a_corner");
    this.centerLocation = gl.getAttribLocation(program, "a_center");
    this.sizeLocation = gl.getAttribLocation(program, "a_size");
    this.rotationLocation = gl.getAttribLocation(program, "a_rotation");
    this.uvLocation = gl.getAttribLocation(program, "a_uv");
    return true;
  }

  private ensureArrowTexture(source: CanvasImageSource | null): boolean {
    if (!source) {
      return false;
    }
    const gl = this.gl;
    if (!this.arrowTexture) {
      this.arrowTexture = gl.createTexture();
    }
    if (!this.arrowTexture) {
      return false;
    }
    if (this.arrowSource !== source) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.arrowTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      this.arrowSource = source;
    }
    return true;
  }

  private bindInstanceAttribute(location: number, size: number, offsetFloats: number): void {
    if (location < 0) {
      return;
    }
    this.gl.enableVertexAttribArray(location);
    this.gl.vertexAttribPointer(
      location,
      size,
      this.gl.FLOAT,
      false,
      INSTANCE_STRIDE * Float32Array.BYTES_PER_ELEMENT,
      offsetFloats * Float32Array.BYTES_PER_ELEMENT,
    );
    this.gl.vertexAttribDivisor(location, 1);
  }

  /** Grow the retained instance buffer only when a frame needs more entries. */
  private ensureInstanceCapacity(count: number): void {
    if (count <= this.instanceCapacity) {
      return;
    }
    let capacity = Math.max(1, this.instanceCapacity);
    while (capacity < count) {
      capacity *= 2;
    }
    this.instanceCapacity = capacity;
    this.instanceData = new Float32Array(capacity * INSTANCE_STRIDE);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
  }
}
