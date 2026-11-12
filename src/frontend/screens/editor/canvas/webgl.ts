/**
 * Shared WebGL resource helpers for canvas batches and preview pipelines.
 *
 * Callers keep their own shader sources, program caches, attribute tables, and
 * draw loops; this module owns only the repetitive context and resource setup.
 */

type GlContext = WebGLRenderingContext | WebGL2RenderingContext;

/** The unit corner quad used by instanced sprite batches, as x/y pairs. */
const UNIT_CORNER_QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

/**
 * Compile one shader stage.
 *
 * Throws with the driver info log when the shader cannot be created or
 * compiled, and releases a failed shader before throwing.
 */
export function compileShader(gl: GlContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Cannot create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message ?? "Shader compilation failed");
  }
  return shader;
}

/**
 * Compile and link a vertex/fragment source pair.
 *
 * Both stages are released after linking. A link failure releases the program
 * and throws the driver info log, matching the preview pipelines' failure text.
 */
export function linkProgram(
  gl: GlContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Cannot create program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message ?? "Program link failed");
  }
  return program;
}

/**
 * Allocate a static corner-quad buffer and upload `vertices`.
 *
 * The default is the unit quad used by instanced sprite batches; full-screen
 * passes pass their own clip-space vertices.
 */
export function createCornerBuffer(
  gl: GlContext,
  vertices: Float32Array = UNIT_CORNER_QUAD,
): WebGLBuffer | null {
  const buffer = gl.createBuffer();
  if (!buffer) {
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return buffer;
}

/**
 * Point one attribute at its slot in an interleaved instance buffer.
 *
 * Negative locations are ignored because a linked program may drop an unused
 * attribute. Offsets and stride are measured in floats.
 * `baseOffsetFloats` points the attributes at one group's range inside a
 * shared staging upload.
 */
export function bindInstanceAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  strideFloats: number,
  offsetFloats: number,
  divisor = 1,
  baseOffsetFloats = 0,
): void {
  if (location < 0) {
    return;
  }
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    strideFloats * Float32Array.BYTES_PER_ELEMENT,
    (baseOffsetFloats + offsetFloats) * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.vertexAttribDivisor(location, divisor);
}

/** One instance attribute and the float offset of its components. */
export interface InstanceAttribute {
  readonly location: number;
  readonly size: number;
  readonly offsetFloats: number;
}

/**
 * Point several attributes at one interleaved instance buffer.
 *
 * This is the array form of `bindInstanceAttribute` for callers that describe
 * their whole instance layout in one place.
 */
export function bindInstanceAttributes(
  gl: WebGL2RenderingContext,
  attributes: readonly InstanceAttribute[],
  strideFloats: number,
  divisor = 1,
): void {
  for (const { location, size, offsetFloats } of attributes) {
    bindInstanceAttribute(gl, location, size, strideFloats, offsetFloats, divisor);
  }
}

/**
 * Apply the shared clamp-to-edge sampling parameters to the bound texture.
 *
 * Callers choose the filter; wrapping stays clamped unless the texture's owner
 * overrides it afterwards, as the NoiseField image textures do.
 */
export function configureTextureSampling(gl: GlContext, filter: number = gl.LINEAR): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Callbacks for one canvas's WebGL context loss and restoration cycle. */
export interface ContextLossHandlers {
  onLost?(event: Event): void;
  onRestored?(event: Event): void;
}

/**
 * Subscribe to context loss and restoration for `canvas`.
 *
 * Returns an idempotent uninstall function. Callbacks keep ownership of
 * `preventDefault()` and of resetting or rebuilding their own resources.
 */
export function installContextLossHandlers(
  canvas: HTMLCanvasElement,
  handlers: ContextLossHandlers,
): () => void {
  const onLost = (event: Event): void => {
    handlers.onLost?.(event);
  };
  const onRestored = (event: Event): void => {
    handlers.onRestored?.(event);
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  let installed = true;
  return () => {
    if (!installed) {
      return;
    }
    installed = false;
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}
