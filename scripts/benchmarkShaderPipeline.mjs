/** Benchmarks shader staging uploads and fullscreen pass submission with a mock WebGL API. */
import { performance } from "node:perf_hooks";
import { ShaderPipeline } from "../src/frontend/screens/editor/workspace/preview/render/shaderPipeline.ts";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument?.startsWith("--")) {
    continue;
  }
  const [name, value] = argument.split("=", 2);
  args.set(name, value ?? process.argv[++index]);
}

const frames = Math.max(1, Number(args.get("--frames") ?? 120));
const width = Math.max(1, Number(args.get("--width") ?? 1600));
const height = Math.max(1, Number(args.get("--height") ?? 900));
const passCount = Math.max(1, Number(args.get("--passes") ?? 2));

/** Creates the narrow canvas surface used by source staging. */
function fakeCanvas(logicalWidth, logicalHeight, counters) {
  const context = {
    drawImage: () => {
      counters.stagingDrawImage += 1;
    },
  };
  return {
    width: logicalWidth,
    height: logicalHeight,
    clientWidth: logicalWidth,
    clientHeight: logicalHeight,
    style: {},
    getBoundingClientRect: () => ({ width: logicalWidth, height: logicalHeight }),
    getContext: (kind) => (kind === "2d" ? context : null),
  };
}

/** Creates a WebGL-shaped counter surface without pretending to measure a driver. */
function fakeGl(counters) {
  let id = 0;
  const object = (kind) => ({ kind, id: ++id });
  return {
    ARRAY_BUFFER: 1,
    STATIC_DRAW: 2,
    FLOAT: 3,
    TEXTURE_2D: 4,
    RGBA: 5,
    UNSIGNED_BYTE: 6,
    FRAMEBUFFER: 7,
    COLOR_ATTACHMENT0: 8,
    TEXTURE0: 9,
    TRIANGLE_STRIP: 10,
    createBuffer: () => object("buffer"),
    bindBuffer() {},
    bufferData() {},
    createTexture: () => object("texture"),
    createFramebuffer: () => object("framebuffer"),
    bindTexture() {},
    texParameteri() {},
    texImage2D: () => {
      counters.texImage2D += 1;
    },
    pixelStorei() {},
    bindFramebuffer() {},
    framebufferTexture2D() {},
    viewport() {},
    useProgram() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    activeTexture() {},
    drawArrays: () => {
      counters.drawArrays += 1;
    },
    flush() {},
  };
}

/** Runs one upload/pass configuration and returns bounded timing statistics. */
function benchmark(overlayEnabled) {
  const counters = { stagingDrawImage: 0, texImage2D: 0, drawArrays: 0 };
  const previousDocument = globalThis.document;
  const previousDevicePixelRatio = globalThis.devicePixelRatio;
  const source = fakeCanvas(width, height, counters);
  const target = fakeCanvas(width, height, counters);
  const overlay = overlayEnabled ? fakeCanvas(width, height, counters) : null;
  const gl = fakeGl(counters);
  const pipeline = new ShaderPipeline();
  const program = {
    program: {},
    positionAttribute: -1,
    texCoordAttribute: -1,
    uniforms: new Map(),
    types: new Map(),
    defaults: {},
    builtin: true,
  };
  pipeline.gl = gl;
  pipeline.webgl2 = false;
  pipeline.canvas = target;
  pipeline.sourceTexture = gl.createTexture();
  pipeline.overlayTexture = gl.createTexture();
  pipeline.pingTexture = gl.createTexture();
  pipeline.pongTexture = gl.createTexture();
  pipeline.framebuffer = gl.createFramebuffer();
  pipeline.buffer = gl.createBuffer();
  pipeline.ensure = () => true;
  pipeline.compile = () => program;
  pipeline.compositeProgram = {};
  pipeline.compositePosition = -1;
  pipeline.compositeTexCoord = -1;
  pipeline.compositeSourceUniform = null;
  pipeline.compositeOverlayUniform = null;
  globalThis.document = { createElement: () => fakeCanvas(width, height, counters) };
  globalThis.devicePixelRatio = 1;
  const passes = Array.from({ length: passCount }, (_, index) => ({ shader: `pass-${index}` }));
  const durations = [];
  try {
    for (let warmup = 0; warmup < 20; warmup += 1) {
      pipeline.render(
        source,
        target,
        passes,
        warmup / 60,
        () => "shader",
        undefined,
        warmup,
        overlay,
      );
    }
    counters.stagingDrawImage = 0;
    counters.texImage2D = 0;
    counters.drawArrays = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const started = performance.now();
      pipeline.render(
        source,
        target,
        passes,
        (frame + 20) / 60,
        () => "shader",
        undefined,
        frame,
        overlay,
      );
      durations.push(performance.now() - started);
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.devicePixelRatio = previousDevicePixelRatio;
  }
  durations.sort((left, right) => left - right);
  return {
    overlay: overlayEnabled,
    frames,
    width,
    height,
    passes: passCount,
    cpuMs: {
      p50: durations[Math.floor(durations.length * 0.5)] ?? 0,
      p95: durations[Math.floor(durations.length * 0.95)] ?? 0,
      max: durations.at(-1) ?? 0,
    },
    apiCalls: counters,
    note: "Mock WebGL API; counts pipeline submissions and CPU staging, not real GPU execution.",
  };
}

console.log(JSON.stringify({ direct: benchmark(false), withOverlay: benchmark(true) }));
