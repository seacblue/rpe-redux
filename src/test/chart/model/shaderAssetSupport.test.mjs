/** Custom GLSL asset paths and uniform declarations stay safe and inspectable. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  shaderParameters,
  shaderParametersForChart,
  setShaderParameterOverrides,
} from "../../../core/global/chart/shader/shaderEvents.ts";
import {
  builtinShaderReference,
  ShaderRuntime,
  shaderAssetPath,
  shaderIdentity,
} from "../../../core/global/chart/shader/shader.ts";

test("accepts chart-relative shader assets and rejects traversal", () => {
  assert.equal(shaderAssetPath("effects/wave.glsl"), "effects/wave.glsl");
  assert.equal(shaderAssetPath("/effects/wave.glsl"), "effects/wave.glsl");
  assert.equal(shaderAssetPath("../wave.glsl"), null);
  assert.equal(shaderAssetPath("C:/wave.glsl"), null);
});

test("uses a custom shader asset as the event identity", () => {
  assert.equal(shaderIdentity({ shader: "effects/wave.glsl" }), "effects/wave.glsl");
  assert.equal(shaderIdentity({ shader: "/effects/wave.glsl" }), "effects/wave.glsl");
});

test("keeps Phira built-in preview references on the built-in path", () => {
  assert.equal(builtinShaderReference("/rain_pr.glsl"), true);
  assert.equal(shaderIdentity({ shader: "/rain_pr.glsl" }), "rain");
  assert.equal(builtinShaderReference("/effects/rain.glsl"), false);
  assert.equal(builtinShaderReference("rain.glsl"), false);
  assert.equal(shaderIdentity({ shader: "rain.glsl" }), "rain.glsl");
});

test("loads a built-in preview source instead of reading its root reference as an asset", async () => {
  const requested = [];
  const runtime = new ShaderRuntime(
    () => {},
    async (path) => {
      requested.push(path);
      return path === "redux/shaders/pr/rain_pr.glsl" ? "void main() {}" : null;
    },
  );
  runtime.compile(
    {
      META: {},
      BPMList: [],
      judgeLineList: [],
      effects: [{ shader: "/rain_pr.glsl", start: [0, 0, 1], end: [1, 0, 1] }],
    },
    null,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, ["rain_pr.glsl", "redux/shaders/pr/rain_pr.glsl"]);
  assert.match(runtime.source("rain", "/rain_pr.glsl"), /@rpen-builtin/);
});

test("prefers a same-named chart asset over the packaged built-in", async () => {
  const requested = [];
  const runtime = new ShaderRuntime(
    () => {},
    async (path) => {
      requested.push(path);
      return path === "rain.glsl" ? "void main() { gl_FragColor = vec4(1.0); }" : null;
    },
  );
  runtime.compile(
    {
      META: {},
      BPMList: [],
      judgeLineList: [],
      effects: [{ shader: "rain.glsl", start: [0, 0, 1], end: [1, 0, 1] }],
    },
    null,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requested, ["rain.glsl"]);
  assert.match(runtime.source("rain", "rain.glsl"), /vec4\(1\.0\)/);
});

test("passes the chart path to relative shader asset loaders", async () => {
  const calls = [];
  const runtime = new ShaderRuntime(
    () => {},
    async (path, chartName) => {
      calls.push([path, chartName]);
      return "void main() { gl_FragColor = vec4(1.0); }";
    },
  );
  runtime.setChartName("charts/main.json");
  runtime.compile(
    {
      META: {},
      BPMList: [],
      judgeLineList: [],
      effects: [{ shader: "effects/rain.glsl", start: [0, 0, 1], end: [1, 0, 1] }],
    },
    null,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["effects/rain.glsl", "charts/main.json"]]);
});

test("drops source text when an effect leaves the chart", async () => {
  const runtime = new ShaderRuntime(
    () => {},
    async () => "void main() { gl_FragColor = vec4(1.0); }",
  );
  const first = {
    META: {},
    BPMList: [],
    judgeLineList: [],
    effects: [{ shader: "effects/a.glsl", start: [0, 0, 1], end: [1, 0, 1] }],
  };
  runtime.compile(first, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.sources.size, 1);

  runtime.compile({ ...first, effects: [] }, null);
  assert.equal(runtime.sources.size, 0);
  assert.equal(runtime.sourcesWanted.size, 0);
});

test("a late source load does not resurrect a dropped effect", async () => {
  let resolveLoad;
  const pending = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const runtime = new ShaderRuntime(
    () => {},
    () => pending,
  );
  const first = {
    META: {},
    BPMList: [],
    judgeLineList: [],
    effects: [{ shader: "effects/a.glsl", start: [0, 0, 1], end: [1, 0, 1] }],
  };
  runtime.compile(first, null);
  runtime.compile({ ...first, effects: [] }, null);

  resolveLoad("void main() { gl_FragColor = vec4(1.0); }");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.sources.size, 0);
});

test("sniffs every editable numeric uniform without guessing from its name", () => {
  const parameters = shaderParameters(`
    uniform float intensity; // %0.5%
    uniform vec3 tint; // %1,0.5,0%
    uniform sampler2D screenTexture;
    uniform float u_time;
    uniform float u_speed;
    uniform vec2 resolution;
    uniform highp vec4 preciseColor;
    // uniform float commentedOut;
  `);
  assert.deepEqual(parameters, [
    { name: "intensity", type: "float", dimensions: 1, value: 0.5 },
    { name: "tint", type: "vec3", dimensions: 3, value: [1, 0.5, 0] },
    { name: "u_time", type: "float", dimensions: 1, value: 0 },
    { name: "u_speed", type: "float", dimensions: 1, value: 0 },
    { name: "resolution", type: "vec2", dimensions: 2, value: [0, 0] },
    { name: "preciseColor", type: "vec4", dimensions: 4, value: [0, 0, 0, 0] },
  ]);
});

test("uses asset-library parameter configuration for later shader events", () => {
  const chart = {
    META: {},
    BPMList: [],
  };
  const configured = setShaderParameterOverrides(chart, "effects/wave.glsl", {
    intensity: { enabled: true, label: "强度" },
    hidden: { enabled: false },
  });
  assert.deepEqual(
    shaderParametersForChart(
      configured,
      "effects/wave.glsl",
      "uniform float intensity;\nuniform float hidden;",
    ),
    [{ name: "intensity", type: "float", dimensions: 1, value: 0, label: "强度" }],
  );
});
