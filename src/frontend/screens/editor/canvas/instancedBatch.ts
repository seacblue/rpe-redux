/**
 * Shared WebGL2 batch surfaces for the timeline's line, solid, and overlay layers.
 *
 * Every timeline batch owns one canvas, one WebGL2 context, and one
 * context-loss subscription. This module keeps that lifetime, the transparent
 * frame setup, and the CSS-colour parse cache in one place. Subclasses keep
 * their shader sources, attribute layouts, and per-frame data packing.
 */
import { normalizedCssColor } from "../../../../core/utils/colors.ts";
import { sizeCanvasBackingStore, type CanvasBackingStore } from "./canvas2d.ts";
import {
  bindInstanceAttributes,
  createCornerBuffer,
  installContextLossHandlers,
  linkProgram,
  type InstanceAttribute,
} from "./webgl.ts";

/** Normalized red, green, blue, and alpha channels uploaded for one CSS colour. */
type ColorChannels = readonly [number, number, number, number];

/**
 * One instance attribute a shared batch subclass declares for its shader.
 *
 * The batch resolves the name to an attribute location after linking, so the
 * layout stays data in the subclass that owns the shader.
 */
export interface InstanceBatchAttribute {
  /** Shader attribute name, resolved to a location after linking. */
  readonly name: string;
  /** Component count passed to `vertexAttribPointer`. */
  readonly size: number;
  /** Float offset of this attribute inside one packed instance. */
  readonly offsetFloats: number;
}

/**
 * One WebGL2 batch layer backed by a timeline canvas.
 *
 * The base owns context creation, the context-loss subscription, the frame
 * viewport/clear, and the per-colour cache. Subclasses build programs in
 * `initializeResources`, delete them in `releaseResources`, and drop their
 * handles in `forgetResources`; the base calls those at construction, on
 * context loss/restore, and on `dispose`.
 */
export abstract class WebGlBatchSurface {
  /** Canvas this batch paints into. */
  protected readonly canvas: HTMLCanvasElement;
  /** WebGL2 context, or null when the canvas cannot provide one. */
  protected readonly gl: WebGL2RenderingContext | null;
  /** Logical CSS-pixel width of the current frame. */
  protected width = 0;
  /** Logical CSS-pixel height of the current frame. */
  protected height = 0;
  /** Device-pixel ratio of the current backing store. */
  protected ratio = 1;
  /** Whether the current frame passed the resource check in `begin`. */
  protected active = false;
  /** Whether the GL context is currently lost. */
  protected contextLost = false;
  private uninstallContextLoss: (() => void) | null = null;
  private readonly colors = new Map<string, ColorChannels>();

  /** Create the layer for one canvas; nothing runs without WebGL2. */
  protected constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false });
  }

  /** Whether this batch can submit the current frame through WebGL2. */
  isActive(): boolean {
    return this.active && !this.contextLost;
  }

  /** Release GPU resources and the context-loss subscription. */
  dispose(): void {
    this.uninstallContextLoss?.();
    this.uninstallContextLoss = null;
    if (this.gl && !this.contextLost) {
      this.releaseResources(this.gl);
    }
    this.forgetResources();
    this.active = false;
  }

  /**
   * Subscribe to context loss and build the initial GPU resources.
   *
   * Subclasses call this at the end of their constructor so their own fields
   * are initialized before `initializeResources` reads them.
   */
  protected initializeBatch(): void {
    if (!this.gl) {
      return;
    }
    this.uninstallContextLoss = installContextLossHandlers(this.canvas, {
      onLost: this.handleContextLost,
      onRestored: this.handleContextRestored,
    });
    this.initializeResources();
  }

  /** Normalized channels for one CSS colour, parsed once per distinct string. */
  protected colorChannels(color: string): ColorChannels {
    const cached = this.colors.get(color);
    if (cached) {
      return cached;
    }
    const channels = normalizedCssColor(color);
    this.colors.set(color, channels);
    return channels;
  }

  /**
   * Start one transparent frame overlay on this batch's canvas.
   *
   * Stores the logical frame size, resizes the backing store through the shared
   * ratio clamp, resets the viewport, and clears only this layer. Returns the
   * cleared backing store, or null when the context is lost or `ready` is
   * false.
   */
  protected beginFrame(width: number, height: number, ready: boolean): CanvasBackingStore | null {
    this.width = width;
    this.height = height;
    const gl = this.gl;
    if (!gl || !ready || this.contextLost) {
      this.active = false;
      return null;
    }
    this.active = true;
    const backing = sizeCanvasBackingStore(this.canvas, { width, height });
    this.ratio = backing.ratio;
    gl.viewport(0, 0, backing.width, backing.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return backing;
  }

  /** Build programs, buffers, and attribute locations. */
  protected abstract initializeResources(): void;

  /** Delete GPU resources; only called while the context is usable. */
  protected abstract releaseResources(gl: WebGL2RenderingContext): void;

  /** Drop every resource handle and staged count on loss or disposal. */
  protected abstract forgetResources(): void;

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.active = false;
    this.forgetResources();
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.initializeResources();
  };
}

/**
 * Instanced unit-quad batch shared by the timeline's line and solid layers.
 *
 * Subclasses supply their shader sources and declare their instance attribute
 * layout; this class owns the corner quad, the corner buffer, the growable
 * instance staging buffer, the resolved attribute locations, the per-frame
 * upload, and the single instanced draw call.
 */
export abstract class InstancedQuadBatch extends WebGlBatchSurface {
  private program: WebGLProgram | null = null;
  private cornerBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private resolution: WebGLUniformLocation | null = null;
  private cornerLocation = -1;
  /** Packed instance staging data uploaded from its first `instanceCount` items. */
  protected instances = new Float32Array(0);
  private attributes: InstanceAttribute[] = [];
  private readonly layout: readonly InstanceBatchAttribute[];
  private instanceBufferCapacity = 0;
  private instanceCount = 0;
  private readonly stride: number;

  /**
   * Create the batch; `stride` is the float count of one packed instance and
   * `layout` lists the shader's instance attributes in binding order.
   */
  protected constructor(
    canvas: HTMLCanvasElement,
    stride: number,
    layout: readonly InstanceBatchAttribute[],
  ) {
    super(canvas);
    this.stride = stride;
    this.layout = layout;
  }

  /** Begin a frame and clear only this batch's transparent layer. */
  begin(width: number, height: number): boolean {
    this.instanceCount = 0;
    return this.beginFrame(width, height, Boolean(this.program && this.instanceBuffer)) !== null;
  }

  /** Upload all queued instances with one instanced draw call. */
  finish(): void {
    if (
      !this.isActive() ||
      !this.gl ||
      !this.program ||
      !this.instanceBuffer ||
      !this.cornerBuffer
    ) {
      return;
    }
    if (!this.instanceCount) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    if (this.resolution) {
      gl.uniform2f(this.resolution, this.width, this.height);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    if (this.cornerLocation >= 0) {
      gl.enableVertexAttribArray(this.cornerLocation);
      gl.vertexAttribPointer(this.cornerLocation, 2, gl.FLOAT, false, 0, 0);
    }
    const upload = this.instances.subarray(0, this.instanceCount * this.stride);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const uploadBytes = upload.byteLength;
    if (uploadBytes > this.instanceBufferCapacity) {
      this.instanceBufferCapacity = uploadBytes;
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceBufferCapacity, gl.STREAM_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
    bindInstanceAttributes(gl, this.attributes, this.stride);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
  }

  /** Release GPU resources and the context-loss listeners. */
  dispose(): void {
    super.dispose();
    this.instances = new Float32Array(0);
  }

  /**
   * Reserve the float offset of the next instance, growing the staging buffer.
   *
   * Callers write one `stride`-sized instance at the returned offset; the
   * instance count advances so `finish` uploads the packed range.
   */
  protected reserveInstance(): number {
    const offset = this.instanceCount * this.stride;
    if (offset + this.stride > this.instances.length) {
      const next = new Float32Array(Math.max(this.stride * 64, this.instances.length * 2));
      next.set(this.instances);
      this.instances = next;
    }
    this.instanceCount += 1;
    return offset;
  }

  /** Drop the queued instances without touching GPU state. */
  protected clearQueuedInstances(): void {
    this.instanceCount = 0;
  }

  /** Read the instance attribute locations from the linked program. */
  private resolveAttributes(gl: WebGL2RenderingContext): void {
    const program = this.program;
    this.attributes = this.layout.map((attribute) => ({
      location: program ? gl.getAttribLocation(program, attribute.name) : -1,
      size: attribute.size,
      offsetFloats: attribute.offsetFloats,
    }));
  }

  /** Vertex shader source paired with `fragmentSource` for one linked program. */
  protected abstract vertexSource(): string;

  /** Fragment shader source paired with `vertexSource` for one linked program. */
  protected abstract fragmentSource(): string;

  protected initializeResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    try {
      this.program = linkProgram(gl, this.vertexSource(), this.fragmentSource());
    } catch {
      this.program = null;
    }
    this.cornerBuffer = createCornerBuffer(gl);
    this.instanceBuffer = gl.createBuffer();
    this.resolution = this.program ? gl.getUniformLocation(this.program, "u_resolution") : null;
    this.cornerLocation = this.program ? gl.getAttribLocation(this.program, "a_corner") : -1;
    this.resolveAttributes(gl);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  protected releaseResources(gl: WebGL2RenderingContext): void {
    if (this.program) {
      gl.deleteProgram(this.program);
    }
    if (this.cornerBuffer) {
      gl.deleteBuffer(this.cornerBuffer);
    }
    if (this.instanceBuffer) {
      gl.deleteBuffer(this.instanceBuffer);
    }
  }

  protected forgetResources(): void {
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.resolution = null;
    this.attributes = [];
    this.instanceCount = 0;
    this.instanceBufferCapacity = 0;
  }
}
