/** Benchmarks shader, GPU-batch, and cross-canvas composite submission seams. */
import { performance } from "node:perf_hooks";
import { PreviewCompositeRenderDevice } from "../src/frontend/screens/editor/workspace/preview/frame/previewCompositeRenderDevice.ts";
import { ShaderCompositeRenderDevice } from "../src/frontend/screens/editor/workspace/preview/render/shaderCompositeRenderDevice.ts";
import { ShaderPipeline } from "../src/frontend/screens/editor/workspace/preview/render/shaderPipeline.ts";
import { TimelineOverlayRenderDevice } from "../src/frontend/screens/editor/canvas/timelineOverlayRenderDevice.ts";

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
const commandCount = Math.max(1, Number(args.get("--commands") ?? 741));

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function timingSummary(values) {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: Math.max(...values, 0),
  };
}

/** Creates a canvas/context pair with the operations used by the render devices. */
function fakeCanvas(logicalWidth, logicalHeight, counters) {
  const context = {
    globalAlpha: 1,
    drawImage: () => {
      counters.drawImage += 1;
    },
    clearRect: () => {
      counters.clearRect += 1;
    },
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: () => {},
    fillText: () => {},
    strokeRect: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };
  return {
    width: logicalWidth,
    height: logicalHeight,
    clientWidth: logicalWidth,
    clientHeight: logicalHeight,
    style: {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: logicalWidth,
      bottom: logicalHeight,
      width: logicalWidth,
      height: logicalHeight,
    }),
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
    STREAM_DRAW: 3,
    FLOAT: 4,
    TEXTURE_2D: 5,
    RGBA: 6,
    UNSIGNED_BYTE: 7,
    FRAMEBUFFER: 8,
    COLOR_ATTACHMENT0: 9,
    TEXTURE0: 10,
    TEXTURE1: 12,
    TRIANGLE_STRIP: 11,
    createBuffer: () => object("buffer"),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {
      counters.bufferSubData += 1;
    },
    createTexture: () => object("texture"),
    createFramebuffer: () => object("framebuffer"),
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {
      counters.texImage2D += 1;
    },
    pixelStorei: () => {},
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    viewport: () => {},
    useProgram: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    activeTexture: () => {},
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform2fv: () => {},
    uniform3fv: () => {},
    uniform4fv: () => {},
    drawArrays: () => {
      counters.drawArrays += 1;
    },
    drawArraysInstanced: () => {
      counters.drawArraysInstanced += 1;
    },
    flush: () => {},
    isContextLost: () => false,
  };
}

/** Build a pipeline with program compilation and context setup bypassed. */
function fakeShaderDevice(counters) {
  const previousDocument = globalThis.document;
  const previousDevicePixelRatio = globalThis.devicePixelRatio;
  const source = fakeCanvas(width, height, counters);
  const target = fakeCanvas(width, height, counters);
  const overlay = fakeCanvas(width, height, counters);
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
  const device = new ShaderCompositeRenderDevice(pipeline);
  const passes = Array.from({ length: passCount }, (_, index) => ({ shader: `pass-${index}` }));
  return {
    device,
    packet: {
      sourceCanvas: source,
      targetCanvas: target,
      passes,
      seconds: 0,
      sourceFor: () => "shader",
      sourceRevision: 0,
      overlayCanvas: null,
    },
    source,
    target,
    overlay,
    pipeline,
    restore() {
      globalThis.document = previousDocument;
      globalThis.devicePixelRatio = previousDevicePixelRatio;
    },
  };
}

function benchmarkShader(overlayEnabled, reuseUpload = false, sharedInput = false) {
  const counters = {
    drawImage: 0,
    clearRect: 0,
    texImage2D: 0,
    drawArrays: 0,
    bufferSubData: 0,
    inputLayerDraws: 0,
  };
  const shader = fakeShaderDevice(counters);
  shader.pipeline.webgl2 = sharedInput;
  shader.packet.overlayCanvas = overlayEnabled ? shader.overlay : null;
  shader.packet.inputLayer = sharedInput
    ? {
        finishToFramebuffer() {
          counters.inputLayerDraws += 1;
          return true;
        },
      }
    : null;
  const durations = [];
  try {
    for (let warmup = 0; warmup < 20; warmup += 1) {
      shader.packet.seconds = warmup / 60;
      shader.packet.sourceRevision = reuseUpload ? 1 : warmup;
      shader.device.render(shader.packet);
    }
    counters.drawImage = 0;
    counters.texImage2D = 0;
    counters.drawArrays = 0;
    counters.inputLayerDraws = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      shader.packet.seconds = (frame + 20) / 60;
      shader.packet.sourceRevision = reuseUpload ? 1 : frame;
      const started = performance.now();
      shader.device.render(shader.packet);
      durations.push(performance.now() - started);
    }
  } finally {
    shader.restore();
  }
  return {
    overlay: overlayEnabled,
    passes: passCount,
    frames,
    cpu: timingSummary(durations),
    apiCalls: counters,
    note: sharedInput
      ? "Mock shared WebGL input; note geometry is submitted into the shader source target without Canvas upload."
      : "Mock WebGL; upload and draw submission CPU/API cost only, not driver GPU execution.",
  };
}

/** Benchmark the RenderDevice-owned batch lifecycle and retained command submission. */
function benchmarkOverlayBatch() {
  const counters = {
    begin: 0,
    finish: 0,
    rectCommands: 0,
    strokeCommands: 0,
    polylineCommands: 0,
    textCommands: 0,
    drawImage: 0,
    clearRect: 0,
  };
  const canvas = fakeCanvas(width, height, counters);
  const batch = {
    begin: () => {
      counters.begin += 1;
      return true;
    },
    finish: () => {
      counters.finish += 1;
    },
    addRect: () => {
      counters.rectCommands += 1;
    },
    addStrokeRect: () => {
      counters.strokeCommands += 1;
    },
    addPolyline: () => {
      counters.polylineCommands += 1;
    },
    addText: () => {
      counters.textCommands += 1;
    },
    dispose: () => {},
  };
  const device = new TimelineOverlayRenderDevice(canvas, batch);
  const commands = Array.from({ length: commandCount }, (_, index) => ({
    kind: "fillRect",
    x: index % width,
    y: index % height,
    width: 1,
    height: 1,
    color: "#ffffff",
    alpha: 1,
  }));
  const durations = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const started = performance.now();
    device.render({
      surface: "benchmark",
      key: String(frame),
      width,
      height,
      commands,
    });
    durations.push(performance.now() - started);
  }
  return {
    commands: commandCount,
    frames,
    cpu: timingSummary(durations),
    lifecycle: counters,
    note: "Fake GPU batch; measures RenderDevice begin/finish and command submission overhead.",
  };
}

/** Benchmark the retained static batch path that skips unchanged begin/finish work. */
function benchmarkRetainedBatch() {
  const counters = { begin: 0, finish: 0, rectCommands: 0 };
  const batch = {
    active: true,
    key: null,
    beginRetained(_width, _height, key) {
      if (this.active && this.key === key) {
        return false;
      }
      this.key = key;
      counters.begin += 1;
      return true;
    },
    finish() {
      counters.finish += 1;
    },
    addRect() {
      counters.rectCommands += 1;
    },
  };
  const commands = Array.from({ length: commandCount }, () => ({
    kind: "fillRect",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    color: "#ffffff",
    alpha: 1,
  }));
  const durations = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const started = performance.now();
    if (batch.beginRetained(width, height, "static-grid")) {
      for (const command of commands) {
        batch.addRect(command.x, command.y, command.width, command.height);
      }
      batch.finish();
    }
    durations.push(performance.now() - started);
  }
  return {
    commands: commandCount,
    frames,
    cpu: timingSummary(durations),
    lifecycle: counters,
    note: "Fake retained GPU batch; unchanged static frames skip begin/finish and command submission.",
  };
}

/** Benchmark the final cross-canvas capture pass separately from shader work. */
function benchmarkCanvasComposite() {
  const counters = { drawImage: 0, clearRect: 0 };
  const output = fakeCanvas(width, height, counters);
  const base = fakeCanvas(width, height, counters);
  const notes = fakeCanvas(width, height, counters);
  const overlay = fakeCanvas(width, height, counters);
  const device = new PreviewCompositeRenderDevice(output);
  const durations = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const started = performance.now();
    device.render({ base, notes, overlay, includeNotes: true, includeOverlay: true });
    durations.push(performance.now() - started);
  }
  return {
    layers: 3,
    frames,
    cpu: timingSummary(durations),
    apiCalls: counters,
    note: "Fake Canvas2D; measures clearRect/drawImage submission overhead only.",
  };
}

console.log(
  JSON.stringify({
    shader: {
      withoutOverlay: benchmarkShader(false),
      withoutOverlayReuse: benchmarkShader(false, true),
      withOverlay: benchmarkShader(true),
      withSharedInput: benchmarkShader(false, false, true),
    },
    timelineGpuBatch: benchmarkOverlayBatch(),
    timelineGpuStaticBatch: benchmarkRetainedBatch(),
    canvasComposite: benchmarkCanvasComposite(),
  }),
);
