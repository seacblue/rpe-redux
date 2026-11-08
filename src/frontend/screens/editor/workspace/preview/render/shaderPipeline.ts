/**
 * WebGL shader pipeline for chart shaders: compiles a portable program, uploads
 * uniforms, and draws one pass inside the preview viewport. Source rewriting and
 * uniform defaults live in the sibling shader modules.
 */
import { PREVIEW_LOGICAL_SIZE } from "../scene/constants.ts";
import { defaultShaderUniform } from "../../../../../../core/global/chart/shader/shader.ts";
import { t } from "../../../../../../i18n/index.ts";
import { canvasPixelRatio, measureCanvas } from "../../../canvas/canvas2d.ts";
import {
  configureTextureSampling,
  createCornerBuffer,
  linkProgram,
} from "../../../canvas/webgl.ts";
import { VERTEX_SOURCE, fragmentSource } from "./shaderSource.ts";
import { normalizeUniformValue, shaderDefaults } from "./shaderUniforms.ts";

/** Upper bound for the shader render target's device-pixel width. */
export const SHADER_MAX_TEXTURE_WIDTH = 1920;
/** Upper bound for the shader render target's device-pixel height. */
export const SHADER_MAX_TEXTURE_HEIGHT = 1080;

/**
 * Fit a shader render target to the canvas's logical size and the texture cap.
 *
 * The result is at most 1920×1080 device pixels; the target canvas is stretched
 * by CSS, so a large DPR no longer multiplies the upload and pass cost.
 */
export function shaderTextureSize(
  logicalWidth: number,
  logicalHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, Number(logicalWidth) || 1);
  const height = Math.max(1, Number(logicalHeight) || 1);
  const scale = Math.min(1, SHADER_MAX_TEXTURE_WIDTH / width, SHADER_MAX_TEXTURE_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Display rectangle: the preview viewport or source-canvas bounds. */
export interface ShaderViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Preview viewport: rectangle plus scale. */
export interface ShaderView extends ShaderViewportRect {
  scale: number;
}

/** Clip-space rectangle. */
export interface ShaderRect {
  min: number[];
  max: number[];
}

/** One pass: shader source plus an open uniform-value table for preview. */
export interface ShaderPass {
  shader: string;
  values?: unknown;
}

/** Compiled and linked program with its uniform metadata. */
export interface ShaderProgram {
  program: WebGLProgram;
  positionAttribute: number;
  texCoordAttribute: number;
  uniforms: Map<string, WebGLUniformLocation | null>;
  types: Map<string, number>;
  defaults: Record<string, number | number[]>;
  builtin: boolean;
}

type GlContext = WebGL2RenderingContext | WebGLRenderingContext;

/** Clip-space position and texture coordinates for one full-screen quad. */
const FULLSCREEN_QUAD = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]);

/** Uniform values: any non-null object is a valid `Record<string, unknown>`. */
function isUniformValues(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Converts a display rectangle into normalized clip-space bounds. */
export function shaderViewport(
  view: ShaderViewportRect,
  width: number,
  height: number,
): ShaderRect {
  return {
    min: [view.left / width, 1 - (view.top + view.height) / height],
    max: [(view.left + view.width) / width, 1 - view.top / height],
  };
}

/** Owns the WebGL context, compiled programs, and ping-pong textures for shader passes. */
export class ShaderPipeline {
  invalidate: () => void;
  gl: GlContext | null;
  canvas: HTMLCanvasElement | null;
  programs: Map<string, ShaderProgram>;
  sourceTexture: WebGLTexture | null;
  pingTexture: WebGLTexture | null;
  pongTexture: WebGLTexture | null;
  framebuffer: WebGLFramebuffer | null;
  buffer: WebGLBuffer | null;
  disabled: boolean;
  // Set after the first successful `ensure()`, `compile()`, or `render()`.
  webgl2?: boolean;
  lastError?: string | null;
  textureWidth?: number;
  textureHeight?: number;
  private sourceStaging?: HTMLCanvasElement | null;
  private uploadedSource?: HTMLCanvasElement | null;
  private uploadedRevision?: number | null;
  private uploadedWidth?: number;
  private uploadedHeight?: number;

  /** Releases every GL object this pipeline created. */
  dispose(): void {
    const gl = this.gl;
    if (gl) {
      for (const result of this.programs.values()) {
        gl.deleteProgram(result.program);
      }
      for (const texture of [this.sourceTexture, this.pingTexture, this.pongTexture]) {
        if (texture) {
          gl.deleteTexture(texture);
        }
      }
      if (this.framebuffer) {
        gl.deleteFramebuffer(this.framebuffer);
      }
      if (this.buffer) {
        gl.deleteBuffer(this.buffer);
      }
    }
    this.programs.clear();
    this.gl = null;
    this.canvas = null;
    this.sourceStaging = null;
    this.uploadedSource = null;
    this.uploadedRevision = null;
    this.uploadedWidth = 0;
    this.uploadedHeight = 0;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.sourceTexture =
      this.pingTexture =
      this.pongTexture =
      this.framebuffer =
      this.buffer =
        null;
  }
  /** Creates an idle pipeline; `invalidate` requests a repaint after GL work. */
  constructor(invalidate: () => void = () => {}) {
    this.invalidate = invalidate;
    this.gl = null;
    this.canvas = null;
    this.programs = new Map();
    this.sourceTexture = null;
    this.pingTexture = null;
    this.pongTexture = null;
    this.framebuffer = null;
    this.buffer = null;
    this.disabled = false;
  }

  /** Context after `ensure()` succeeds; callers guarantee it is present. */
  private context(): GlContext {
    const gl = this.gl;
    if (!gl) {
      throw new Error(t("editorPanels.preview.shader.unavailable"));
    }
    return gl;
  }

  /** Attaches a GL context to `canvas`, replacing any previous one; false when GL is unavailable. */
  ensure(canvas: HTMLCanvasElement): boolean {
    if (this.canvas === canvas && this.gl) {
      return true;
    }
    if (this.gl || this.canvas) {
      this.dispose();
    }
    this.canvas = canvas;
    try {
      const options: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      };
      // Keep the context types explicit; the union would select the broad string overload.
      const webgl2: WebGL2RenderingContext | null = canvas.getContext("webgl2", options);
      this.webgl2 = Boolean(webgl2);
      const webgl1: WebGLRenderingContext | null = webgl2
        ? null
        : canvas.getContext("webgl", options);
      this.gl = webgl2 ?? webgl1;
    } catch {
      this.gl = null;
    }
    if (!this.gl) {
      this.disabled = true;
      return false;
    }
    this.disabled = false;
    const gl = this.gl;
    this.buffer = createCornerBuffer(gl, FULLSCREEN_QUAD);
    this.sourceTexture = gl.createTexture();
    this.pingTexture = gl.createTexture();
    this.pongTexture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    for (const texture of [this.sourceTexture, this.pingTexture, this.pongTexture]) {
      this.configureTexture(texture);
    }
    return true;
  }

  /** Applies the sampling parameters shared by every shader texture. */
  configureTexture(texture: WebGLTexture | null): void {
    const gl = this.context();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureTextureSampling(gl);
  }

  /** Reallocates a texture to `width`×`height` RGBA storage. */
  resizeTexture(texture: WebGLTexture | null, width: number, height: number): void {
    const gl = this.context();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  /** Compiles and caches one program per source; returns null and records the log on failure. */
  compile(name: string, source: string): ShaderProgram | null {
    const key = source;
    if (this.programs.has(key)) {
      return this.programs.get(key) ?? null;
    }
    const gl = this.context();
    let program: WebGLProgram;
    try {
      program = linkProgram(
        gl,
        this.webgl2
          ? "#version 300 es\n" +
              VERTEX_SOURCE.replace(/attribute\b/g, "in").replace(/varying\b/g, "out")
          : VERTEX_SOURCE,
        fragmentSource(source, this.webgl2),
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const types = new Map<string, number>();
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
      const info = gl.getActiveUniform(program, index);
      if (!info) {
        continue;
      }
      const uniformName = info.name.replace(/\[0\]$/, "");
      uniforms.set(uniformName, gl.getUniformLocation(program, info.name));
      types.set(uniformName, info.type);
    }
    const defaults = shaderDefaults(source);
    const builtin =
      /(?:^|\n)\/\/ @rpen-builtin\b/.test(source) ||
      !/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler2D\s+screenTexture\b/.test(source);
    const result: ShaderProgram = {
      program,
      positionAttribute: gl.getAttribLocation(program, "a_position"),
      texCoordAttribute: gl.getAttribLocation(program, "a_texCoord"),
      uniforms,
      types,
      defaults,
      builtin,
    };
    this.programs.set(key, result);
    return result;
  }

  /** Uploads the frame uniforms and the pass's value overrides. */
  setUniforms(
    result: ShaderProgram,
    values: unknown,
    seconds: number,
    width: number,
    height: number,
    rect: ShaderRect | null,
    resolution?: number[],
  ): void {
    const gl = this.context();
    const provided: Record<string, unknown> = isUniformValues(values) ? values : {};
    // Integer uniforms use uniform1i; number[] accepts every relevant GLenum value.
    const integerTypes: number[] = [gl.SAMPLER_2D, gl.INT, gl.BOOL];
    /** Uploads one uniform if the program declares it. */
    const set = (name: string, value: unknown): void => {
      const location = result.uniforms.get(name);
      if (location === null || location === undefined) {
        return;
      }
      let normalized = normalizeUniformValue(name, value);
      if (result.types.get(name) === gl.FLOAT && Array.isArray(normalized)) {
        normalized = normalized[0];
      }
      const type = result.types.get(name);
      if (type !== undefined && integerTypes.includes(type)) {
        gl.uniform1i(location, Number(normalized) || 0);
        return;
      }
      if (Array.isArray(normalized)) {
        if (normalized.length === 2) {
          gl.uniform2fv(location, normalized);
        } else if (normalized.length === 3) {
          gl.uniform3fv(location, normalized);
        } else if (normalized.length === 4) {
          gl.uniform4fv(location, normalized);
        } else if (normalized.length === 1) {
          gl.uniform1f(location, normalized[0]);
        }
      } else if (typeof normalized === "number" && Number.isFinite(normalized)) {
        gl.uniform1f(location, normalized);
      }
    };
    set("u_texture", 0);
    set("u_time", provided.u_time ?? provided.time ?? seconds);
    set("time", provided.time ?? provided.u_time ?? seconds);
    const screenSize = result.builtin
      ? (resolution ?? [PREVIEW_LOGICAL_SIZE.width, PREVIEW_LOGICAL_SIZE.height])
      : rect
        ? [width * (rect.max[0] - rect.min[0]), height * (rect.max[1] - rect.min[1])]
        : [width, height];
    set("screenSize", provided.screenSize ?? screenSize);
    set("rpenSurfaceSize", [width, height]);
    set(
      "resolution",
      provided.resolution ??
        resolution ?? [PREVIEW_LOGICAL_SIZE.width, PREVIEW_LOGICAL_SIZE.height],
    );
    set("rpeRectMin", rect?.min ?? [0, 0]);
    set("rpeRectMax", rect?.max ?? [1, 1]);
    for (const name of result.uniforms.keys()) {
      if (
        [
          "u_texture",
          "u_time",
          "time",
          "screenSize",
          "rpenSurfaceSize",
          "resolution",
          "rpeRectMin",
          "rpeRectMax",
        ].includes(name)
      ) {
        continue;
      }
      const fallback =
        name === "offset" && result.types.get(name) === gl.FLOAT_VEC2
          ? [0, 0]
          : defaultShaderUniform(name, resolution);
      set(name, provided[name] ?? result.defaults[name] ?? fallback);
    }
  }

  /** Draws one full-screen quad through `result` into `framebuffer`. */
  drawQuad(
    result: ShaderProgram,
    inputTexture: WebGLTexture | null,
    framebuffer: WebGLFramebuffer | null,
    values: unknown,
    seconds: number,
    width: number,
    height: number,
    rect: ShaderRect,
    resolution: number[],
  ): void {
    const gl = this.context();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(result.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = result.positionAttribute;
    const texCoord = result.texCoordAttribute;
    if (position >= 0) {
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    }
    if (texCoord >= 0) {
      gl.enableVertexAttribArray(texCoord);
      gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    this.setUniforms(result, values, seconds, width, height, rect, resolution);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Runs `passes` over `sourceCanvas` and composites the result into `targetCanvas`.
   *
   * Returns false when there is nothing to draw or GL is unavailable. `viewport`
   * scopes the chart rect; `sourceFor` resolves each pass's GLSL source.
   * `sourceRevision` identifies the primary canvas's pixels; an unchanged
   * revision reuses the uploaded texture.
   */
  render(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement | null,
    passes: ShaderPass[],
    seconds: number,
    sourceFor: (pass: ShaderPass) => string | null | undefined,
    viewport?: ShaderView | null,
    sourceRevision?: number,
  ): boolean {
    if (!passes.length || !targetCanvas || !this.ensure(targetCanvas)) {
      return false;
    }
    const gl = this.context();
    const measurement = measureCanvas(sourceCanvas);
    const fallbackRatio = canvasPixelRatio();
    const displayWidth =
      measurement.width > 0 ? measurement.width : sourceCanvas.width / fallbackRatio;
    const displayHeight =
      measurement.height > 0 ? measurement.height : sourceCanvas.height / fallbackRatio;
    const { width, height } = shaderTextureSize(displayWidth, displayHeight);
    if (
      targetCanvas.width !== width ||
      targetCanvas.height !== height ||
      this.textureWidth !== width ||
      this.textureHeight !== height
    ) {
      targetCanvas.width = width;
      targetCanvas.height = height;
      this.resizeTexture(this.pingTexture, width, height);
      this.resizeTexture(this.pongTexture, width, height);
      this.textureWidth = width;
      this.textureHeight = height;
    }
    const view: ShaderView = viewport ?? {
      left: 0,
      top: 0,
      width: displayWidth,
      height: displayHeight,
      scale: 1,
    };
    const rect = shaderViewport(view, displayWidth, displayHeight);
    const resolution = [view.width / (view.scale || 1), view.height / (view.scale || 1)];
    const canReuseUpload =
      sourceRevision !== undefined &&
      this.uploadedSource === sourceCanvas &&
      this.uploadedRevision === sourceRevision &&
      this.uploadedWidth === width &&
      this.uploadedHeight === height;
    if (!canReuseUpload) {
      let staging = this.sourceStaging ?? null;
      if (!staging) {
        staging = document.createElement("canvas");
        this.sourceStaging = staging;
      }
      if (staging.width !== width || staging.height !== height) {
        staging.width = width;
        staging.height = height;
      }
      const stagingContext = staging.getContext("2d");
      if (!stagingContext) {
        return false;
      }
      stagingContext.clearRect(0, 0, width, height);
      stagingContext.drawImage(sourceCanvas, 0, 0, width, height);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, staging);
      this.uploadedSource = sourceCanvas;
      this.uploadedRevision = sourceRevision ?? null;
      this.uploadedWidth = width;
      this.uploadedHeight = height;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    }
    let input = this.sourceTexture;
    let output = this.pingTexture;
    let rendered = 0;
    const usable: { pass: ShaderPass; program: ShaderProgram }[] = [];
    for (const pass of passes) {
      const source = sourceFor(pass);
      const program = source ? this.compile(pass.shader, source) : null;
      if (program) {
        usable.push({ pass, program });
      }
    }
    for (let index = 0; index < usable.length; index++) {
      const { pass, program } = usable[index];
      const final = index === usable.length - 1;
      const framebuffer = final ? null : this.framebuffer;
      if (!final) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      }
      this.drawQuad(
        program,
        input,
        framebuffer,
        pass.values,
        seconds,
        width,
        height,
        rect,
        resolution,
      );
      rendered++;
      if (!final) {
        input = output;
        output = output === this.pingTexture ? this.pongTexture : this.pingTexture;
      }
    }
    if (!rendered) {
      return false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
    targetCanvas.style.visibility = "visible";
    return true;
  }
}
