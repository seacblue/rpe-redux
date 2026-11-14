/** Owns canvas render-surface lifetimes so Canvas2D and WebGL share one contract. */
/** Highest device-pixel ratio allowed by editor render surfaces. */
const MAX_RENDER_PIXEL_RATIO = 2;

/** Logical CSS-pixel dimensions shared by both backends. */
export interface CanvasMeasurement {
  readonly width: number;
  readonly height: number;
}

/** Physical backing-store dimensions shared by both backends. */
export interface CanvasBackingStore extends CanvasMeasurement {
  readonly ratio: number;
}

/** Cap the device-pixel ratio before allocating a render target. */
function canvasPixelRatio(ratio = globalThis.devicePixelRatio || 1): number {
  const value = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return Math.min(MAX_RENDER_PIXEL_RATIO, value);
}

/** Context type accepted by the low-level WebGL resource helpers. */
export type RenderGlContext = WebGLRenderingContext | WebGL2RenderingContext;

/** Context attributes used by editor GPU surfaces. */
export interface RenderBackendOptions extends WebGLContextAttributes {
  readonly ratio?: number;
}

/** One resize result shared by software and GPU surfaces. */
export interface RenderSurfaceFrame extends CanvasBackingStore {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
}

/** Callbacks for the lifetime of a GPU context. */
export interface RenderContextLifecycle {
  readonly onLost?: () => void;
  readonly onRestored?: () => void;
}

/** Compute and apply one logical surface size without performing a draw. */
function resizeCanvas(
  canvas: HTMLCanvasElement,
  measurement: CanvasMeasurement,
  ratio: number,
): RenderSurfaceFrame {
  const cappedRatio = canvasPixelRatio(ratio);
  const width = Math.max(1, Math.round(measurement.width * cappedRatio));
  const height = Math.max(1, Math.round(measurement.height * cappedRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return {
    width,
    height,
    ratio: cappedRatio,
    logicalWidth: measurement.width,
    logicalHeight: measurement.height,
  };
}

/** Canvas2D surface with retained size and transform state. */
export class Canvas2DRenderBackend {
  readonly kind = "canvas2d" as const;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  private frame: RenderSurfaceFrame | null = null;

  /** Creates a software surface or throws when the browser cannot provide one. */
  constructor(canvas: HTMLCanvasElement, context?: CanvasRenderingContext2D) {
    this.canvas = canvas;
    const resolved = context ?? canvas.getContext("2d");
    if (!resolved) {
      throw new Error("Cannot create Canvas2D render surface");
    }
    this.context = resolved;
  }

  /** Resize the backing store and restore the logical-pixel transform. */
  resize(measurement: CanvasMeasurement, ratio = canvasPixelRatio()): RenderSurfaceFrame {
    const frame = resizeCanvas(this.canvas, measurement, ratio);
    this.frame = frame;
    this.context.setTransform(frame.ratio, 0, 0, frame.ratio, 0, 0);
    return frame;
  }

  /** Begin a software pass and optionally clear the logical surface. */
  begin(clear = true): RenderSurfaceFrame {
    const frame = this.frame;
    if (!frame) {
      throw new Error("Canvas2D render surface must be resized before begin");
    }
    if (clear) {
      this.context.clearRect(0, 0, frame.logicalWidth, frame.logicalHeight);
    }
    return frame;
  }

  /** Release the retained surface state. The DOM canvas remains caller-owned. */
  dispose(): void {
    this.frame = null;
  }
}

/** WebGL surface with one context-loss boundary and retained viewport state. */
export class WebGlRenderBackend {
  readonly kind = "webgl" as const;
  readonly canvas: HTMLCanvasElement;
  readonly gl: RenderGlContext;
  private readonly uninstallLifecycle: () => void;
  private frame: RenderSurfaceFrame | null = null;
  private lost = false;
  private readonly lifecycles = new Set<RenderContextLifecycle>();

  /** Creates a WebGL surface and installs the browser context lifecycle. */
  constructor(
    canvas: HTMLCanvasElement,
    options: WebGLContextAttributes = { alpha: true, antialias: false, depth: false },
    lifecycle: RenderContextLifecycle = {},
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
    if (!gl) {
      throw new Error("Cannot create WebGL render surface");
    }
    this.gl = gl;
    this.lifecycles.add(lifecycle);
    const onLost = (event: Event): void => {
      event.preventDefault();
      this.lost = true;
      for (const entry of this.lifecycles) {
        entry.onLost?.();
      }
    };
    const onRestored = (): void => {
      this.lost = false;
      for (const entry of this.lifecycles) {
        entry.onRestored?.();
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this.uninstallLifecycle = () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }

  /** Attach another resource owner to this context's loss and restore events. */
  addLifecycle(lifecycle: RenderContextLifecycle): () => void {
    this.lifecycles.add(lifecycle);
    return () => this.lifecycles.delete(lifecycle);
  }

  /** Whether GPU commands are safe to submit. */
  isUsable(): boolean {
    return !this.lost && this.gl.isContextLost() !== true;
  }

  /** Resize the backing store and update the GPU viewport. */
  resize(measurement: CanvasMeasurement, ratio = canvasPixelRatio()): RenderSurfaceFrame {
    const frame = resizeCanvas(this.canvas, measurement, ratio);
    this.frame = frame;
    if (this.isUsable()) {
      this.gl.viewport(0, 0, frame.width, frame.height);
    }
    return frame;
  }

  /** Begin a transparent GPU pass. */
  begin(clear = true): RenderSurfaceFrame | null {
    const frame = this.frame;
    if (!frame || !this.isUsable()) {
      return null;
    }
    if (clear) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    return frame;
  }

  /** Release event listeners and forget surface state. */
  dispose(): void {
    this.uninstallLifecycle();
    this.lifecycles.clear();
    this.frame = null;
    this.lost = true;
  }
}

/** Try to create the unified WebGL surface without turning fallback into an error. */
export function tryCreateWebGlBackend(
  canvas: HTMLCanvasElement,
  options?: WebGLContextAttributes,
  lifecycle?: RenderContextLifecycle,
): WebGlRenderBackend | null {
  try {
    return new WebGlRenderBackend(canvas, options, lifecycle);
  } catch {
    return null;
  }
}

/** Try to create the WebGL2-only surface required by instanced editor batches. */
export function tryCreateWebGl2Backend(
  canvas: HTMLCanvasElement,
  options?: WebGLContextAttributes,
  lifecycle?: RenderContextLifecycle,
): WebGlRenderBackend | null {
  try {
    const backend = new WebGlRenderBackend(canvas, options, lifecycle);
    if (typeof (backend.gl as WebGL2RenderingContext).drawArraysInstanced !== "function") {
      backend.dispose();
      return null;
    }
    return backend;
  } catch {
    return null;
  }
}
