/* eslint-disable max-lines -- shader context ownership, compilation, and pass execution share one pipeline. */

/**
 * WebGL shader pipeline for chart shaders: compiles portable programs, uploads
 * uniforms, and draws passes inside the preview viewport. Compilation runs ahead
 * of playback, and only sources the current chart references stay cached. Source
 * rewriting and uniform defaults live in the sibling shader modules.
 */
import { PREVIEW_LOGICAL_SIZE } from "../scene/constants.ts";
import {
  recordShaderCompile,
  recordShaderOverlayUpload,
  renderProfileMark,
  recordShaderSourceUpload,
  recordShaderState,
} from "../../../../../../core/diagnostics/renderMetrics.ts";
import { defaultShaderUniform } from "../../../../../../core/global/chart/shader/shader.ts";
import { t } from "../../../../../../i18n/index.ts";
import { canvasPixelRatio, measureCanvas } from "../../../canvas/canvas2d.ts";
import type { WebGlRenderBackend } from "../../../canvas/renderBackend.ts";
import { tryCreateWebGlBackend } from "../../../canvas/renderBackend.ts";
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

/** One shader source to compile ahead of a render pass. */
export interface ShaderProgramSource {
  readonly name: string;
  readonly source: string;
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
  /** Last uploaded values for uniforms that are stable across frames. */
  uniformCache: Map<string, number | number[]>;
}

type GlContext = WebGL2RenderingContext | WebGLRenderingContext;

/** GPU input layer rendered into the shader overlay texture before user passes. */
export interface ShaderInputLayer {
  /** Draw the layer without changing the source texture's existing pixels. */
  finishToFramebuffer(
    gl: WebGL2RenderingContext,
    framebuffer: WebGLFramebuffer,
    width: number,
    height: number,
  ): boolean;
}

/** CPU-side upload timings captured for the most recent shader frame. */
export interface ShaderFrameMetrics {
  sourceUploadMs: number;
  overlayUploadMs: number;
}

/** Clip-space position and texture coordinates for one full-screen quad. */
const FULLSCREEN_QUAD = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]);
const EMPTY_UNIFORM_VALUES: Record<string, unknown> = Object.freeze({});
const BUILTIN_UNIFORM_NAMES = new Set([
  "u_texture",
  "u_time",
  "time",
  "screenSize",
  "rpenSurfaceSize",
  "resolution",
  "rpeRectMin",
  "rpeRectMax",
]);

/** The optional completion-status query from KHR_parallel_shader_compile. */
interface ParallelShaderCompile {
  readonly COMPLETION_STATUS_KHR: number;
}

/**
 * Yield once to idle time, or to the next task when idle scheduling is absent.
 *
 * Compilation starts outside the paint that requested it, so the first shader
 * upload never extends a frame that is already over budget.
 */
function nextIdleSlice(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

/** Yield one task turn while polling a parallel compile. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

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

/** Owns the WebGL context, program cache, and ping-pong textures for shader passes. */
export class ShaderPipeline {
  invalidate: () => void;
  gl: GlContext | null;
  private backend: WebGlRenderBackend | null;
  canvas: HTMLCanvasElement | null;
  programs: Map<string, ShaderProgram>;
  sourceTexture: WebGLTexture | null;
  overlayTexture: WebGLTexture | null;
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
  private sourceStagingContext?: CanvasRenderingContext2D | null;
  private uploadedSource?: HTMLCanvasElement | null;
  private uploadedRevision?: number | null;
  private uploadedWidth?: number;
  private uploadedHeight?: number;
  /** Sources the current chart wants; everything else is released on retain. */
  private wantedSources = new Set<string>();
  /** Sources queued or waiting for their idle compile turn. */
  private readonly pendingSources = new Set<string>();
  /** Sources that failed to link; retrying them every frame would stall playback. */
  private readonly failedSources = new Set<string>();
  /** Serializes asynchronous compilation so one selection never floods the GPU. */
  private precompileChain: Promise<void> = Promise.resolve();
  /** Invalidates queued work when the context or canvas is replaced. */
  private cacheEpoch = 0;
  /** Reusable pass list for one render submission. */
  private readonly usablePasses: { pass: ShaderPass; program: ShaderProgram }[] = [];
  private compositeProgram: WebGLProgram | null = null;
  private compositePosition = -1;
  private compositeTexCoord = -1;
  private compositeSourceUniform: WebGLUniformLocation | null = null;
  private compositeOverlayUniform: WebGLUniformLocation | null = null;
  /** Upload work from the most recent render call, exposed to frame diagnostics. */
  readonly lastFrameMetrics: ShaderFrameMetrics = { sourceUploadMs: 0, overlayUploadMs: 0 };

  /** Releases every GL object this pipeline created. */
  dispose(): void {
    this.cacheEpoch += 1;
    this.wantedSources.clear();
    this.pendingSources.clear();
    this.failedSources.clear();
    this.precompileChain = Promise.resolve();
    this.releaseGpuResources();
    this.programs.clear();
    this.backend?.dispose();
    this.backend = null;
    this.gl = null;
    this.canvas = null;
    this.sourceStaging = null;
    this.sourceStagingContext = null;
    this.uploadedSource = null;
    this.uploadedRevision = null;
    this.uploadedWidth = 0;
    this.uploadedHeight = 0;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.sourceTexture =
      this.overlayTexture =
      this.pingTexture =
      this.pongTexture =
      this.framebuffer =
      this.buffer =
        null;
    recordShaderState("preview", {
      webglAvailable: false,
      webgl2: false,
      active: false,
      programCount: 0,
      lastErrorPresent: false,
    });
  }
  /** Creates a pipeline, optionally owning the preview canvas context up front. */
  constructor(invalidate: () => void = () => {}, sharedCanvas: HTMLCanvasElement | null = null) {
    this.invalidate = invalidate;
    this.gl = null;
    this.backend = null;
    this.canvas = null;
    this.programs = new Map();
    this.sourceTexture = null;
    this.overlayTexture = null;
    this.pingTexture = null;
    this.pongTexture = null;
    this.framebuffer = null;
    this.buffer = null;
    this.disabled = false;
    this.webgl2 = false;
    if (sharedCanvas) {
      this.ensure(sharedCanvas);
    }
  }

  /** Return the context that note and other input layers may share. */
  sharedBackend(): WebGlRenderBackend | null {
    return this.backend;
  }

  /** Clear chart-specific shader programs while preserving a shared GL context. */
  resetChartResources(): void {
    this.cacheEpoch += 1;
    this.wantedSources.clear();
    this.pendingSources.clear();
    this.failedSources.clear();
    this.precompileChain = Promise.resolve();
    const gl = this.gl;
    if (gl) {
      for (const result of this.programs.values()) {
        gl.deleteProgram(result.program);
      }
    }
    this.programs.clear();
    this.uploadedSource = null;
    this.uploadedRevision = null;
    this.uploadedWidth = 0;
    this.uploadedHeight = 0;
    this.lastError = null;
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
    if (this.canvas === canvas && this.backend) {
      this.gl = this.backend.isUsable() ? this.backend.gl : null;
      return this.gl !== null;
    }
    if (this.gl || this.canvas) {
      this.dispose();
    }
    this.canvas = canvas;
    this.backend = tryCreateWebGlBackend(
      canvas,
      // The shared note batch writes source-over pixels with premultiplied RGB
      // (`SRC_ALPHA` for colour and `ONE` for alpha). Keep the presentation
      // surface in the same alpha convention, otherwise a fading judge line
      // is displayed as dark RGB instead of becoming transparent.
      { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false },
      {
        onLost: this.handleContextLost,
        onRestored: this.handleContextRestored,
      },
    );
    this.gl = this.backend?.gl ?? null;
    this.webgl2 = Boolean(
      this.gl && typeof (this.gl as WebGL2RenderingContext).drawArraysInstanced === "function",
    );
    if (!this.gl) {
      this.disabled = true;
      recordShaderState("preview", {
        webglAvailable: false,
        webgl2: false,
        active: false,
        programCount: 0,
        lastErrorPresent: Boolean(this.lastError),
      });
      return false;
    }
    this.disabled = false;
    recordShaderState("preview", {
      webglAvailable: true,
      webgl2: Boolean(this.webgl2),
      active: true,
      programCount: this.programs.size,
      lastErrorPresent: Boolean(this.lastError),
    });
    this.initializeGpuResources();
    return true;
  }

  /** Recreate the small set of persistent GPU objects owned by the pipeline. */
  private initializeGpuResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    this.buffer = createCornerBuffer(gl, FULLSCREEN_QUAD);
    this.sourceTexture = gl.createTexture();
    this.overlayTexture = gl.createTexture();
    this.pingTexture = gl.createTexture();
    this.pongTexture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
    for (const texture of [
      this.sourceTexture,
      this.overlayTexture,
      this.pingTexture,
      this.pongTexture,
    ]) {
      this.configureTexture(texture);
    }
    try {
      this.compositeProgram = linkProgram(gl, this.vertexSource(), this.compositeFragmentSource());
    } catch {
      this.compositeProgram = null;
    }
    this.compositePosition = this.compositeProgram
      ? gl.getAttribLocation(this.compositeProgram, "a_position")
      : -1;
    this.compositeTexCoord = this.compositeProgram
      ? gl.getAttribLocation(this.compositeProgram, "a_texCoord")
      : -1;
    this.compositeSourceUniform = this.compositeProgram
      ? gl.getUniformLocation(this.compositeProgram, "u_texture")
      : null;
    this.compositeOverlayUniform = this.compositeProgram
      ? gl.getUniformLocation(this.compositeProgram, "u_overlay")
      : null;
    if (this.compositeProgram && this.compositeOverlayUniform) {
      gl.useProgram(this.compositeProgram);
      gl.uniform1i(this.compositeOverlayUniform, 1);
    }
  }

  /** Release GPU objects without discarding the caller's chart-side settings. */
  private releaseGpuResources(): void {
    const gl = this.gl;
    if (gl) {
      for (const result of this.programs.values()) {
        gl.deleteProgram(result.program);
      }
      for (const texture of [
        this.sourceTexture,
        this.overlayTexture,
        this.pingTexture,
        this.pongTexture,
      ]) {
        if (texture) {
          gl.deleteTexture(texture);
        }
      }
      if (this.compositeProgram) {
        gl.deleteProgram(this.compositeProgram);
      }
      if (this.framebuffer) {
        gl.deleteFramebuffer(this.framebuffer);
      }
      if (this.buffer) {
        gl.deleteBuffer(this.buffer);
      }
    }
    this.programs.clear();
    this.sourceTexture = null;
    this.overlayTexture = null;
    this.pingTexture = null;
    this.pongTexture = null;
    this.framebuffer = null;
    this.buffer = null;
    this.sourceStaging = null;
    this.sourceStagingContext = null;
    this.uploadedSource = null;
    this.uploadedRevision = null;
    this.uploadedWidth = 0;
    this.uploadedHeight = 0;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.compositeProgram = null;
    this.compositePosition = -1;
    this.compositeTexCoord = -1;
    this.compositeSourceUniform = null;
    this.compositeOverlayUniform = null;
  }

  /** Drop invalid GPU handles after a browser context loss and schedule recovery. */
  private readonly handleContextLost = (): void => {
    this.releaseGpuResources();
    this.gl = null;
    this.cacheEpoch += 1;
    this.pendingSources.clear();
    this.precompileChain = Promise.resolve();
    this.invalidate();
  };

  /** Recreate targets after the backend reports that the context is usable again. */
  private readonly handleContextRestored = (): void => {
    if (!this.backend || this.disabled) {
      return;
    }
    this.gl = this.backend.gl;
    this.initializeGpuResources();
    this.invalidate();
  };

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

  /**
   * Release every compiled program the selected chart no longer references.
   *
   * WebGL programs are driver resources rather than JavaScript objects, so the
   * engine garbage collector cannot reclaim them. Keeping only the current
   * source set bounds GPU memory across chart switches and shader edits.
   */
  retainSources(sources: Iterable<string>): void {
    this.wantedSources = new Set(sources);
    for (const source of [...this.failedSources]) {
      if (!this.wantedSources.has(source)) {
        this.failedSources.delete(source);
      }
    }
    const gl = this.gl;
    for (const [source, cached] of [...this.programs]) {
      if (this.wantedSources.has(source)) {
        continue;
      }
      gl?.deleteProgram(cached.program);
      this.programs.delete(source);
    }
  }

  /** Whether a source already has a program or a recorded compile failure. */
  isSettled(source: string): boolean {
    return this.programs.has(source) || this.failedSources.has(source);
  }

  /**
   * Compile missing programs away from the paint path.
   *
   * Source text arrives asynchronously, so the caller repeats this call as more
   * sources load; cached sources are skipped. A queued source is marked pending
   * before the first await, which makes the synchronous `compile` path skip it
   * instead of stalling a playback frame. Works through KHR parallel compile
   * when the driver exposes it, and otherwise links during an idle slice.
   */
  precompile(sources: readonly ShaderProgramSource[]): Promise<void> {
    if (!this.gl) {
      return Promise.resolve();
    }
    this.wantedSources = new Set(sources.map((entry) => entry.source));
    const jobs: ShaderProgramSource[] = [];
    for (const entry of sources) {
      if (
        !entry.source ||
        this.programs.has(entry.source) ||
        this.pendingSources.has(entry.source) ||
        this.failedSources.has(entry.source)
      ) {
        continue;
      }
      this.pendingSources.add(entry.source);
      jobs.push(entry);
    }
    if (!jobs.length) {
      return this.precompileChain;
    }
    this.precompileChain = this.precompileChain
      .then(async () => {
        for (const job of jobs) {
          if (!this.wantedSources.has(job.source)) {
            this.pendingSources.delete(job.source);
            continue;
          }
          try {
            await this.compileAsync(job.name, job.source);
          } finally {
            this.pendingSources.delete(job.source);
          }
        }
      })
      .catch(() => undefined);
    return this.precompileChain;
  }

  /** Compiles and caches one program per source; returns null and records the log on failure. */
  compile(name: string, source: string): ShaderProgram | null {
    const key = source;
    const cached = this.programs.get(key);
    if (cached) {
      return cached;
    }
    // The idle precompile owns this source; skipping it for one frame avoids a
    // synchronous link in the middle of playback. The next frame repaints when
    // the queued program becomes available.
    if (this.pendingSources.has(key) || this.failedSources.has(key)) {
      return null;
    }
    const gl = this.context();
    let program: WebGLProgram;
    try {
      program = linkProgram(gl, this.vertexSource(), fragmentSource(source, this.webgl2));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.failedSources.add(key);
      recordShaderCompile("preview", false);
      return null;
    }
    return this.record(source, program);
  }

  /** Vertex source for the active WebGL dialect. */
  private vertexSource(): string {
    return this.webgl2
      ? "#version 300 es\n" +
          VERTEX_SOURCE.replace(/\battribute\b/g, "in").replace(/\bvarying\b/g, "out")
      : VERTEX_SOURCE;
  }

  /** Read one linked program's uniforms and metadata, then cache it. */
  private record(source: string, program: WebGLProgram): ShaderProgram {
    const gl = this.context();
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
      uniformCache: new Map(),
    };
    this.programs.set(source, result);
    this.failedSources.delete(source);
    this.lastError = null;
    recordShaderCompile("preview", true);
    recordShaderState("preview", {
      webglAvailable: Boolean(this.gl),
      webgl2: Boolean(this.webgl2),
      active: Boolean(this.gl) && !this.disabled,
      programCount: this.programs.size,
      lastErrorPresent: false,
    });
    return result;
  }

  /** Compile and link one program outside the frame, honouring parallel compile. */
  private async compileAsync(name: string, source: string): Promise<ShaderProgram | null> {
    if (this.programs.has(source)) {
      return this.programs.get(source) ?? null;
    }
    const epoch = this.cacheEpoch;
    await nextIdleSlice();
    if (epoch !== this.cacheEpoch || !this.gl || !this.wantedSources.has(source)) {
      return null;
    }
    const program = await this.linkAsync(source, epoch);
    if (!program) {
      if (epoch === this.cacheEpoch && this.wantedSources.has(source)) {
        recordShaderCompile("preview", false);
      }
      if (epoch === this.cacheEpoch && this.wantedSources.has(source)) {
        this.failedSources.add(source);
      }
      return null;
    }
    if (epoch !== this.cacheEpoch || !this.wantedSources.has(source)) {
      this.gl?.deleteProgram(program);
      return null;
    }
    try {
      return this.record(source, program);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.failedSources.add(source);
      this.gl?.deleteProgram(program);
      return null;
    }
  }

  /** Link one program; with the parallel extension, wait without blocking. */
  private async linkAsync(source: string, epoch: number): Promise<WebGLProgram | null> {
    const gl = this.gl;
    if (!gl) {
      return null;
    }
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      if (vertex) {
        gl.deleteShader(vertex);
      }
      if (fragment) {
        gl.deleteShader(fragment);
      }
      if (program) {
        gl.deleteProgram(program);
      }
      this.lastError = "Cannot create shader program";
      return null;
    }
    try {
      gl.shaderSource(vertex, this.vertexSource());
      gl.compileShader(vertex);
      gl.shaderSource(fragment, fragmentSource(source, this.webgl2));
      gl.compileShader(fragment);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      const parallel = gl.getExtension(
        "KHR_parallel_shader_compile",
      ) as ParallelShaderCompile | null;
      if (parallel) {
        const status = parallel.COMPLETION_STATUS_KHR;
        while (!gl.getProgramParameter(program, status)) {
          if (epoch !== this.cacheEpoch || !this.wantedSources.has(source)) {
            gl.deleteProgram(program);
            return null;
          }
          await nextTurn();
        }
      }
      const vertexLog = gl.getShaderParameter(vertex, gl.COMPILE_STATUS)
        ? null
        : (gl.getShaderInfoLog(vertex) ?? "Vertex shader compilation failed");
      const fragmentLog = gl.getShaderParameter(fragment, gl.COMPILE_STATUS)
        ? null
        : (gl.getShaderInfoLog(fragment) ?? "Fragment shader compilation failed");
      if (vertexLog || fragmentLog) {
        throw new Error(vertexLog ?? fragmentLog ?? "Shader compilation failed");
      }
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
      }
      return program;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      gl.deleteProgram(program);
      return null;
    } finally {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    }
  }

  /**
   * Upload `sourceCanvas` into the shader's source texture.
   *
   * The source is uploaded at the shader target size when possible; a small
   * Canvas2D staging surface is used only when the source backing store needs
   * downsampling. Separate overlay layers use their own GPU texture and pass.
   */
  private uploadCanvas(
    texture: WebGLTexture | null,
    sourceCanvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): boolean {
    const gl = this.gl;
    if (!gl || !texture) {
      return false;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (sourceCanvas.width === width && sourceCanvas.height === height) {
      // Storage is allocated once when the render target changes size. Updating
      // an existing store avoids a per-frame texImage2D reallocation on the
      // Canvas2D -> WebGL upload path.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      return true;
    }
    let staging = this.sourceStaging ?? null;
    if (!staging) {
      staging = document.createElement("canvas");
      this.sourceStaging = staging;
    }
    if (staging.width !== width || staging.height !== height) {
      staging.width = width;
      staging.height = height;
    }
    let stagingContext = this.sourceStagingContext ?? null;
    if (!stagingContext) {
      stagingContext = staging.getContext("2d");
      this.sourceStagingContext = stagingContext;
    }
    if (!stagingContext) {
      return false;
    }
    // The source draw covers the entire staging surface, including transparent
    // pixels, so clearing it first would be a redundant full-canvas pass.
    stagingContext.drawImage(sourceCanvas, 0, 0, width, height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, staging);
    return true;
  }

  /** Upload the primary source without compositing another Canvas2D layer. */
  private uploadSource(sourceCanvas: HTMLCanvasElement, width: number, height: number): boolean {
    return this.uploadCanvas(this.sourceTexture, sourceCanvas, width, height);
  }

  /** Link the small GPU-side source-plus-overlay composition pass. */
  private compositeFragmentSource(): string {
    return this.webgl2
      ? `#version 300 es
          precision mediump float;
          uniform sampler2D u_texture;
          uniform sampler2D u_overlay;
          in vec2 v_texCoord;
          out vec4 outColor;
          void main() {
            vec4 base = texture(u_texture, v_texCoord);
            vec4 overlay = texture(u_overlay, v_texCoord);
            outColor = overlay + base * (1.0 - overlay.a);
          }
        `
      : `precision mediump float;
          uniform sampler2D u_texture;
          uniform sampler2D u_overlay;
          varying vec2 v_texCoord;
          void main() {
            vec4 base = texture2D(u_texture, v_texCoord);
            vec4 overlay = texture2D(u_overlay, v_texCoord);
            gl_FragColor = overlay + base * (1.0 - overlay.a);
          }
        `;
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
    const provided: Record<string, unknown> = isUniformValues(values)
      ? values
      : EMPTY_UNIFORM_VALUES;
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
      const cacheable = name !== "u_time" && name !== "time";
      if (cacheable && (typeof normalized === "number" || Array.isArray(normalized))) {
        const previous = result.uniformCache.get(name);
        const equal =
          typeof normalized === "number" && typeof previous === "number"
            ? normalized === previous
            : Array.isArray(normalized) && Array.isArray(previous)
              ? normalized.length === previous.length &&
                normalized.every((entry, index) => entry === previous[index])
              : false;
        if (equal) {
          return;
        }
        result.uniformCache.set(name, Array.isArray(normalized) ? [...normalized] : normalized);
      }
      if (type === gl.SAMPLER_2D || type === gl.INT || type === gl.BOOL) {
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
      if (BUILTIN_UNIFORM_NAMES.has(name)) {
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
  private drawCompositeQuad(
    sourceTexture: WebGLTexture,
    overlayTexture: WebGLTexture,
    outputTexture: WebGLTexture,
    width: number,
    height: number,
  ): boolean {
    const gl = this.context();
    if (!this.compositeProgram || !this.buffer || !this.framebuffer) {
      return false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.compositeProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.compositePosition >= 0) {
      gl.enableVertexAttribArray(this.compositePosition);
      gl.vertexAttribPointer(this.compositePosition, 2, gl.FLOAT, false, 16, 0);
    }
    if (this.compositeTexCoord >= 0) {
      gl.enableVertexAttribArray(this.compositeTexCoord);
      gl.vertexAttribPointer(this.compositeTexCoord, 2, gl.FLOAT, false, 16, 8);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    if (this.compositeSourceUniform) {
      gl.uniform1i(this.compositeSourceUniform, 0);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    if (this.compositeOverlayUniform) {
      gl.uniform1i(this.compositeOverlayUniform, 1);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
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
    gl.disable(gl.BLEND);
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
   * revision reuses the uploaded texture. `inputLayer` is rendered into the
   * transparent overlay texture when it shares this pipeline's WebGL2 context,
   * then uses the same GPU composite equation as the Canvas overlay path.
   */
  render(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement | null,
    passes: readonly ShaderPass[],
    seconds: number,
    sourceFor: (pass: ShaderPass) => string | null | undefined,
    viewport?: ShaderView | null,
    sourceRevision?: number,
    overlayCanvas?: HTMLCanvasElement | null,
    inputLayer?: ShaderInputLayer | null,
  ): boolean {
    renderProfileMark("preview.shader.render.start");
    this.lastFrameMetrics.sourceUploadMs = 0;
    this.lastFrameMetrics.overlayUploadMs = 0;
    if (!passes.length || !targetCanvas || !this.ensure(targetCanvas)) {
      renderProfileMark("preview.shader.render.end");
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
      this.resizeTexture(this.sourceTexture, width, height);
      this.resizeTexture(this.overlayTexture, width, height);
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
      renderProfileMark("preview.shader.source-upload.start");
      const uploadStarted = performance.now();
      const uploaded = this.uploadSource(sourceCanvas, width, height);
      const uploadMs = performance.now() - uploadStarted;
      this.lastFrameMetrics.sourceUploadMs = uploadMs;
      recordShaderSourceUpload("preview", uploadMs);
      renderProfileMark("preview.shader.source-upload.end");
      if (!uploaded) {
        renderProfileMark("preview.shader.render.end");
        return false;
      }
      this.uploadedSource = sourceCanvas;
      this.uploadedRevision = sourceRevision ?? null;
      this.uploadedWidth = width;
      this.uploadedHeight = height;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    }
    let input = this.sourceTexture;
    let output = this.pingTexture;
    if (
      inputLayer &&
      this.framebuffer &&
      this.sourceTexture &&
      this.overlayTexture &&
      this.pingTexture &&
      this.webgl2
    ) {
      renderProfileMark("preview.shader.input-layer.start");
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this.overlayTexture,
        0,
      );
      gl.viewport(0, 0, width, height);
      // The overlay is a reusable texture. Clear it before the note batch
      // writes into it so alpha from a previous frame cannot survive. Preserve
      // the note batch's clip state while clearing the full target.
      const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
      const scissorBox = scissorEnabled ? (gl.getParameter(gl.SCISSOR_BOX) as Int32Array) : null;
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (scissorEnabled && scissorBox) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(scissorBox[0], scissorBox[1], scissorBox[2], scissorBox[3]);
      }
      if (
        !inputLayer.finishToFramebuffer(
          gl as WebGL2RenderingContext,
          this.framebuffer,
          width,
          height,
        )
      ) {
        renderProfileMark("preview.shader.render.end");
        return false;
      }
      if (
        !this.drawCompositeQuad(
          this.sourceTexture,
          this.overlayTexture,
          this.pingTexture,
          width,
          height,
        )
      ) {
        renderProfileMark("preview.shader.render.end");
        return false;
      }
      renderProfileMark("preview.shader.input-layer.end");
      input = this.pingTexture;
      output = this.pongTexture;
    } else if (overlayCanvas) {
      renderProfileMark("preview.shader.overlay-upload.start");
      const overlayStarted = performance.now();
      const uploadedOverlay = this.uploadCanvas(this.overlayTexture, overlayCanvas, width, height);
      const uploadMs = performance.now() - overlayStarted;
      this.lastFrameMetrics.overlayUploadMs = uploadMs;
      recordShaderOverlayUpload("preview", uploadMs);
      renderProfileMark("preview.shader.overlay-upload.end");
      if (!uploadedOverlay || !this.overlayTexture || !this.pingTexture) {
        renderProfileMark("preview.shader.render.end");
        return false;
      }
      renderProfileMark("preview.shader.overlay-composite.start");
      if (
        !this.drawCompositeQuad(
          this.sourceTexture!,
          this.overlayTexture,
          this.pingTexture,
          width,
          height,
        )
      ) {
        renderProfileMark("preview.shader.render.end");
        return false;
      }
      renderProfileMark("preview.shader.overlay-composite.end");
      input = this.pingTexture;
      output = this.pongTexture;
    }
    let rendered = 0;
    const usable = this.usablePasses;
    usable.length = 0;
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
      usable.length = 0;
      renderProfileMark("preview.shader.render.end");
      return false;
    }
    usable.length = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targetCanvas.style.visibility = "visible";
    renderProfileMark("preview.shader.render.end");
    return true;
  }
}
