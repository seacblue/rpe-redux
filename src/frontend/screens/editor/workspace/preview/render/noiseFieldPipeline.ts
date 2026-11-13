/** Owns the NoiseField GPU passes used by the editor preview. */
import config from "./noiseField/config.json";
import active from "./noiseField/composeActive.glsl?raw";
import disabledCompose from "./noiseField/composeDisabled.glsl?raw";
import edge from "./noiseField/edge.glsl?raw";
import glow from "./noiseField/glow.glsl?raw";
import glowExtract from "./noiseField/glowExtract.glsl?raw";
import disabled from "./noiseField/disabled.glsl?raw";
import ready from "./noiseField/ready.glsl?raw";
import copy from "./noiseField/copy.glsl?raw";
import touchMask from "./noiseField/touchMask.glsl?raw";
import main from "./noiseField/main.glsl?raw";
import blockNoise from "./noiseField/tex/BlockNoise1.png";
import pointNoise from "./noiseField/tex/PointNoise.png";
import fieldNoise from "./noiseField/tex/FD_Noise.png";
import type { NoiseAreaSample } from "../../../../../../core/global/chart/noise/noiseRuntime.ts";
import {
  configureTextureSampling,
  createCornerBuffer,
  installContextLossHandlers,
  linkProgram,
} from "../../../canvas/webgl.ts";
import { noiseMaskBitsForEntry, noiseThemeEntryBelongsToPass } from "./noiseGeometry.ts";

/** GLSL sources keyed by their file name, consumed by `config.json` passes. */
const sources: Record<string, string> = {
  "composeActive.glsl": active,
  "composeDisabled.glsl": disabledCompose,
  "edge.glsl": edge,
  "glow.glsl": glow,
  "glowExtract.glsl": glowExtract,
  "disabled.glsl": disabled,
  "ready.glsl": ready,
  "copy.glsl": copy,
  "touchMask.glsl": touchMask,
  "main.glsl": main,
};
const vertex = `#version 300 es
in vec2 position; out highp vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0,1);}`;
const geometryVertex = `#version 300 es
in vec2 position;
void main(){gl_Position=vec4(position,0,1);}`;
const maskFragment =
  "precision highp float; uniform float bitValue; void main(){gl_FragColor=vec4(bitValue,0,0,1);}";
const maskSolid = "precision highp float; void main(){gl_FragColor=vec4(0.0);}";
const themeSolid =
  "precision highp float; uniform vec4 themeColor; void main(){gl_FragColor=themeColor;}";
// The colour follows the same source displacement as the active mask. Empty
// alpha means no owner; black RGB is a valid colour, not an empty pixel.
const themeCompose = `precision highp float; varying highp vec2 uv;
uniform sampler2D themeBaseRT; uniform sampler2D composeRT; uniform sampler2D blockNoise;
uniform float time;
void main(){
  if(texture2D(composeRT,uv).r<=0.0001){gl_FragColor=vec4(0.0);return;}
  vec2 dir=normalize(vec2(0.5)); vec2 perpendicular=vec2(-dir.y,dir.x);
  float t=(time/20.0)*2.5899999141693115; vec2 p=uv*vec2(2.13,1.02);
  float a=texture2D(blockNoise,p+dir*t).r-0.5;
  float b=texture2D(blockNoise,p+perpendicular*t).r-0.5;
  vec4 theme=texture2D(themeBaseRT,uv+(dir*a+perpendicular*b)*0.10000000149011612);
  gl_FragColor=theme.a>0.5?theme:vec4(0.0);
}`;
// Propagate the nearest occupied colour. Equal-distance ties use the same
// lexicographic RGB8 order as the theme dilation shader.
const themeDilate = `precision highp float; varying highp vec2 uv;
uniform sampler2D themeRT; uniform vec2 texelSize;
bool greaterColor(vec3 a,vec3 b){float e=0.5/255.0;
 if(a.r>b.r+e)return true;if(b.r>a.r+e)return false;
 if(a.g>b.g+e)return true;if(b.g>a.g+e)return false;return a.b>b.b+e;}
void consider(inout vec4 best,vec4 next){if(next.a>0.5&&(best.a<=0.5||greaterColor(next.rgb,best.rgb)))best=next;}
void main(){vec4 best=texture2D(themeRT,uv);if(best.a>0.5){gl_FragColor=best;return;}
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)if(x!=0||y!=0)consider(best,texture2D(themeRT,uv+vec2(float(x),float(y))*texelSize));
 gl_FragColor=best;}`;
const blit =
  "precision highp float; varying highp vec2 uv; uniform sampler2D screenTexture; void main(){gl_FragColor=texture2D(screenTexture,uv);}";
const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
/** Adds the GLSL ES 3.00 header and renames the fixed-function texture output. */
const fragment = (source: string) =>
  "#version 300 es\n" +
  source
    .replace(/^\s*#version[^\n]*\n/gm, "")
    .replace(/\bvarying\b/g, "in")
    .replace(/\btexture2D\b/g, "texture")
    .replace(/\bgl_FragColor\b/g, "noiseOutput")
    .replace(/(precision\s+\w+\s+float\s*;)/, "$1\nout vec4 noiseOutput;");

type Uniform = number | readonly number[] | Float32Array;
interface Program {
  program: WebGLProgram;
  position: number;
  uniforms: Map<string, { location: WebGLUniformLocation | null; type: number }>;
}
interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  size: [number, number];
  texelSize: [number, number];
  stencil?: WebGLRenderbuffer;
}
interface TargetSpec {
  scaleX?: number;
  scaleY?: number;
  format?: string;
  filter?: string;
}
interface PassSpec {
  shader: string;
  output: string;
  inputs?: Record<string, string>;
  constants?: Record<string, number | number[]>;
}
interface NoiseConfig {
  targets: Record<string, TargetSpec>;
  passes: PassSpec[];
}
interface TargetPair {
  front: Target;
  back: Target;
}
type NoiseColorMask = [boolean, boolean, boolean, boolean];
interface NoisePassPlan {
  shader: string;
  outputName: string;
  component: string | undefined;
  inputs: readonly [string, string][];
  constants: readonly [string, number | number[]][];
  colorMask: NoiseColorMask | null;
}

/** Compile static NoiseField config into allocation-free frame pass metadata. */
const noisePassPlans: readonly NoisePassPlan[] = (config as NoiseConfig).passes.map((pass) => {
  const [outputName, component] = pass.output.split(".", 2);
  const colorMask = component
    ? (["r", "g", "b", "a"].map((channel) => channel === component) as NoiseColorMask)
    : null;
  return {
    shader: pass.shader,
    outputName,
    component,
    inputs: Object.entries(pass.inputs ?? {}) as [string, string][],
    constants: Object.entries(pass.constants ?? {}) as [string, number | number[]][],
    colorMask,
  };
});

/** One sampled noise area prepared for the GPU passes; `vertices` is its only geometry. */
export interface NoiseMaskEntry {
  state: NoiseAreaSample["state"];
  invert: boolean;
  /** Polygon vertices normalized to the preview viewport, with Y increasing upward. */
  vertices: readonly { x: number; y: number }[];
  /** Optional theme RGB in the 0–1 range. */
  color?: readonly [number, number, number];
}

/** Fixed NoiseField renderer; the caller owns scene composition and the canvas being displayed. */
export class NoiseFieldPipeline {
  private canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext | null = null;
  private programs = new Map<string, Program>();
  private targets = new Map<string, TargetPair>();
  private resources: Target[] = [];
  private images = new Map<string, Target>();
  private quadBuffer: WebGLBuffer | null = null;
  private geometryBuffer: WebGLBuffer | null = null;
  private readonly geometryVertices = new Float32Array(12);
  private readonly maskGroups: [
    NoiseMaskEntry[],
    NoiseMaskEntry[],
    NoiseMaskEntry[],
    NoiseMaskEntry[],
    NoiseMaskEntry[],
    NoiseMaskEntry[],
  ] = [[], [], [], [], [], []];
  private screen: [Target, Target] | null = null;
  private mask: Target | null = null;
  private themeBase: Target | null = null;
  private themeSeed: Target | null = null;
  private themeEffects: [Target, Target] | null = null;
  private width = 0;
  private height = 0;
  private ready = false;
  private failed = false;
  private disposed = false;
  private uninstallContextLoss: (() => void) | null = null;
  private initialization: Promise<void> = Promise.resolve();
  private readonly parameters = new Map<string, Uniform>();
  private readonly touchPoints = new Float32Array(128);
  private readonly themeColor = new Float32Array(4);
  private readonly invalidate: () => void;
  private readonly onError: () => void;
  /** Creates the pipeline and starts texture loading; `onError` reports GPU failure. */
  constructor(invalidate: () => void, onError: () => void = () => {}) {
    this.invalidate = invalidate;
    this.onError = onError;
    for (const match of main.matchAll(
      /uniform\s+(float|vec2|vec4)\s+(\w+)\s*;[^\r\n]*?\/\/\s*%([^%\r\n]+)%/g,
    )) {
      const values = match[3].split(",").map(Number);
      this.parameters.set(match[2], values.length === 1 ? values[0] : values);
    }
    this.gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: false,
      stencil: true,
    });
    if (!this.gl) {
      this.fail();
      return;
    }
    this.uninstallContextLoss = installContextLossHandlers(this.canvas, {
      onLost: (event) => {
        event.preventDefault();
        this.fail();
      },
    });
    try {
      const gl = this.gl;
      this.quadBuffer = createCornerBuffer(gl, quad);
      this.geometryBuffer = gl.createBuffer();
      if (this.geometryBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.geometryVertices.byteLength, gl.STREAM_DRAW);
      }
      for (const [name, source] of Object.entries({
        ...sources,
        "@mask": maskFragment,
        "@maskSolid": maskSolid,
        "@themeSolid": themeSolid,
        "@themeCompose": themeCompose,
        "@themeDilate": themeDilate,
        "@blit": blit,
      })) {
        this.programs.set(
          name,
          this.compile(
            source,
            name === "@maskSolid" || name === "@themeSolid" ? geometryVertex : vertex,
          ),
        );
      }
      this.initialization = this.loadImages();
    } catch (error) {
      this.fail();
      console.error("NoiseField initialization failed", error);
    }
  }
  /** Wait until the GPU resources are available for deterministic frame sampling. */
  async whenReady(): Promise<boolean> {
    await this.initialization;
    return this.ready && !this.failed && !this.disposed;
  }
  /** Marks the pipeline failed once and notifies the host. */
  private fail(): void {
    if (!this.failed && !this.disposed) {
      this.failed = true;
      this.onError();
    }
  }
  /** Returns the live GL context or throws when initialization failed. */
  private context(): WebGL2RenderingContext {
    if (!this.gl) {
      throw new Error("WebGL2 unavailable");
    }
    return this.gl;
  }
  /** Compiles and links one program, throwing with the GL log on failure. */
  private compile(source: string, vertexSource = vertex): Program {
    const gl = this.context();
    const program = linkProgram(gl, vertexSource, fragment(source));
    const uniforms = new Map<string, { location: WebGLUniformLocation | null; type: number }>();
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) {
        uniforms.set(info.name.replace(/\[0\]$/, ""), {
          location: gl.getUniformLocation(program, info.name),
          type: info.type,
        });
      }
    }
    return { program, uniforms, position: gl.getAttribLocation(program, "position") };
  }
  /** Allocates a cleared texture and framebuffer pair of the requested format. */
  private target(width: number, height: number, format = "rgba8", filter = "nearest"): Target {
    const gl = this.context(),
      texture = gl.createTexture(),
      framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error("Cannot allocate NoiseField target");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const [internal, channels] =
      format === "r8" ? [gl.R8, gl.RED] : format === "rg8" ? [gl.RG8, gl.RG] : [gl.RGBA8, gl.RGBA];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, channels, gl.UNSIGNED_BYTE, null);
    configureTextureSampling(gl, filter === "linear" ? gl.LINEAR : gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Incomplete NoiseField framebuffer");
    }
    const target: Target = {
      texture,
      framebuffer,
      width,
      height,
      size: [width, height],
      texelSize: [1 / width, 1 / height],
    };
    this.resources.push(target);
    this.clear(target);
    return target;
  }
  /** Fetches the three noise textures and uploads them as GL targets. */
  private async loadImages(): Promise<void> {
    try {
      const imageSources = [
        ["blockNoise", blockNoise, true],
        ["pointNoise", pointNoise, false],
        ["fieldNoise", fieldNoise, true],
      ] as const;
      await Promise.all(
        imageSources.map(async ([name, url, mirror]) => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Texture load failed: ${name}`);
          }
          const bitmap = await createImageBitmap(await response.blob(), {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
            imageOrientation: "flipY",
          });
          if (this.disposed || this.failed) {
            bitmap.close();
            return;
          }
          const gl = this.context(),
            target = this.target(bitmap.width, bitmap.height);
          gl.bindTexture(gl.TEXTURE_2D, target.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
          bitmap.close();
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_S,
            mirror ? gl.MIRRORED_REPEAT : gl.REPEAT,
          );
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_WRAP_T,
            mirror ? gl.MIRRORED_REPEAT : gl.REPEAT,
          );
          this.images.set(name, target);
        }),
      );
      if (!this.disposed && !this.failed) {
        this.ready = true;
        this.invalidate();
      }
    } catch (error) {
      this.fail();
      console.error("NoiseField texture loading failed", error);
      this.invalidate();
    }
  }
  /** Clears a target framebuffer to transparent black. */
  private clear(target: Target): void {
    const gl = this.context();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  /** Draw the shared fullscreen quad with the currently bound program. */
  private drawQuad(): void {
    const gl = this.context();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  /** Binds a program, its output target, and the shared quad buffer. */
  private bind(program: Program, target: Target | null): void {
    const gl = this.context();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.width, target?.height ?? this.height);
    gl.useProgram(program.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  }
  /** Uploads one uniform, choosing the GL call from its declared type. */
  private uniform(program: Program, name: string, value: Uniform): void {
    const gl = this.context(),
      entry = program.uniforms.get(name);
    if (!entry || entry.location === null) {
      return;
    }
    if (entry.type === gl.INT || entry.type === gl.BOOL || entry.type === gl.SAMPLER_2D) {
      gl.uniform1i(entry.location, Number(value));
    } else if (entry.type === gl.FLOAT) {
      gl.uniform1f(entry.location, Number(value));
    } else if (entry.type === gl.FLOAT_VEC2 && typeof value !== "number") {
      gl.uniform2fv(entry.location, value);
    } else if (entry.type === gl.FLOAT_VEC3 && typeof value !== "number") {
      gl.uniform3fv(entry.location, value);
    } else if (entry.type === gl.FLOAT_VEC4 && typeof value !== "number") {
      gl.uniform4fv(entry.location, value);
    }
  }
  /** Binds `target` to the next texture unit and returns the following unit. */
  private sampler(
    program: Program,
    name: string,
    target: Target | undefined,
    unit: number,
  ): number {
    if (!program.uniforms.has(name) || !target) {
      return unit;
    }
    const gl = this.context();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    this.uniform(program, name, unit);
    this.uniform(program, `${name}Size`, target.size);
    return unit + 1;
  }
  /** Returns a required program, throwing when its name is unknown. */
  private getProgram(name: string): Program {
    const program = this.programs.get(name);
    if (!program) {
      throw new Error(`Missing NoiseField program ${name}`);
    }
    return program;
  }
  /** Copies one target into another through the blit program. */
  private blit(source: Target, target: Target | null, program = this.getProgram("@blit")): void {
    this.bind(program, target);
    this.sampler(program, "screenTexture", source, 0);
    this.uniform(program, "screenSize", source.size);
    this.drawQuad();
  }
  /** Rebuilds every size-dependent target when the scene size changes. */
  private resize(width: number, height: number): void {
    if (this.width === width && this.height === height && this.screen) {
      return;
    }
    const gl = this.context();
    const images = new Set(this.images.values());
    for (const target of this.resources) {
      if (images.has(target)) {
        continue;
      }
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
      if (target.stencil) {
        gl.deleteRenderbuffer(target.stencil);
      }
    }
    this.resources = [...this.images.values()];
    this.targets.clear();
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.screen = [
      this.target(width, height, "rgba8", "linear"),
      this.target(width, height, "rgba8", "linear"),
    ];
    for (const [name, spec] of Object.entries((config as NoiseConfig).targets)) {
      const w = Math.max(1, Math.floor(width * (spec.scaleX ?? 1))),
        h = Math.max(1, Math.floor(height * (spec.scaleY ?? 1)));
      this.targets.set(name, {
        front: this.target(w, h, spec.format, spec.filter),
        back: this.target(w, h, spec.format, spec.filter),
      });
    }
    this.mask = this.target(
      Math.max(1, Math.floor(width / 8)),
      Math.max(1, Math.floor(height / 8)),
      "r8",
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.framebuffer);
    const stencil = gl.createRenderbuffer();
    if (!stencil) {
      throw new Error("Cannot allocate stencil");
    }
    this.mask.stencil = stencil;
    gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, this.mask.width, this.mask.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Incomplete NoiseField stencil");
    }
    this.themeBase = this.target(this.mask.width, this.mask.height);
    this.themeSeed = this.target(
      Math.max(1, Math.floor(width / 4)),
      Math.max(1, Math.floor(height / 4)),
    );
    this.themeEffects = [
      this.target(Math.max(1, Math.floor(width / 4)), Math.max(1, Math.floor(height / 4))),
      this.target(Math.max(1, Math.floor(width / 4)), Math.max(1, Math.floor(height / 4))),
    ];
  }
  /** Rasterise theme owners into the same low-resolution grid as the mask. */
  private themeGeometry(entries: readonly NoiseMaskEntry[], fallback: readonly number[]): void {
    const target = this.themeBase;
    if (!target) {
      return;
    }
    this.clear(target);
    const gl = this.context();
    const program = this.getProgram("@themeSolid");
    gl.disable(gl.BLEND);
    this.bindGeometry(program, target);
    // Active owners take priority over disabled/ready owners at overlaps;
    // two stable passes preserve the old order without filtering or sorting.
    for (const active of [false, true]) {
      for (const entry of entries) {
        if (!noiseThemeEntryBelongsToPass(entry.state, active)) {
          continue;
        }
        const color = entry.color ?? fallback;
        this.themeColor[0] = color[0];
        this.themeColor[1] = color[1];
        this.themeColor[2] = color[2];
        this.themeColor[3] = 1;
        this.uniform(program, "themeColor", this.themeColor);
        this.drawGeometry(entry);
      }
    }
  }
  /** Binds the geometry vertex layout for a mask or theme pass. */
  private bindGeometry(program: Program, target: Target): void {
    const gl = this.context();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometryBuffer);
    gl.enableVertexAttribArray(program.position);
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
  }
  /** Draw the entry's quad as two triangles into the currently bound geometry program. */
  private drawGeometry(entry: NoiseMaskEntry): void {
    const [a, b, c, d] = entry.vertices;
    if (!a || !b || !c || !d) {
      return;
    }
    const area = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    if (Math.abs(area) < 1e-12) {
      return;
    }
    const gl = this.context();
    const vertices = this.geometryVertices;
    vertices[0] = a.x;
    vertices[1] = a.y;
    vertices[2] = b.x;
    vertices[3] = b.y;
    vertices[4] = c.x;
    vertices[5] = c.y;
    vertices[6] = a.x;
    vertices[7] = a.y;
    vertices[8] = c.x;
    vertices[9] = c.y;
    vertices[10] = d.x;
    vertices[11] = d.y;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  /** Displace the body colour and grow its edge/glow ownership field. */
  private composeTheme(seconds: number): Target | undefined {
    const base = this.themeBase,
      seed = this.themeSeed,
      effects = this.themeEffects;
    const mask = this.targets.get("activeCompose")?.front;
    if (!base || !seed || !effects || !mask) {
      return undefined;
    }
    const compose = this.getProgram("@themeCompose");
    this.bind(compose, seed);
    let unit = this.sampler(compose, "themeBaseRT", base, 0);
    unit = this.sampler(compose, "composeRT", mask, unit);
    this.sampler(compose, "blockNoise", this.images.get("blockNoise"), unit);
    this.uniform(compose, "time", seconds);
    this.drawQuad();
    let [front, back] = effects;
    this.blit(seed, front);
    const dilate = this.getProgram("@themeDilate");
    for (let i = 0; i < 6; i++) {
      this.bind(dilate, back);
      this.sampler(dilate, "themeRT", front, 0);
      this.uniform(dilate, "texelSize", front.texelSize);
      this.drawQuad();
      [front, back] = [back, front];
    }
    return front;
  }
  /**
   * Rasterise the six packed masks at Screen/8. The effect draws its mask quads
   * at that resolution, so drawing them directly avoids half-cell drift at
   * rotated and non-integer boundaries.
   */
  private geometry(entries: readonly NoiseMaskEntry[]): void {
    const gl = this.context(),
      full = this.mask,
      mask = this.mask;
    if (!full || !mask) {
      return;
    }
    this.clear(full);
    for (const selected of this.maskGroups) {
      selected.length = 0;
    }
    for (const entry of entries) {
      const bits = noiseMaskBitsForEntry(entry);
      for (let bit = 0; bit < 6; bit++) {
        if (bits & (1 << bit)) {
          this.maskGroups[bit].push(entry);
        }
      }
    }
    for (let bit = 0; bit < 6; bit++) {
      const selected = this.maskGroups[bit];
      const inverted = bit % 2 === 1;
      if (!selected.length) {
        continue;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, full.framebuffer);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(255);
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.ALWAYS, 0, 255);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.colorMask(false, false, false, false);
      const solid = this.getProgram("@maskSolid");
      this.bindGeometry(solid, full);
      for (const entry of selected) {
        this.drawGeometry(entry);
      }
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(inverted ? gl.EQUAL : gl.LEQUAL, 1, 255);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const program = this.getProgram("@mask");
      this.bind(program, full);
      this.uniform(program, "bitValue", (1 << bit) / 255);
      this.drawQuad();
      gl.disable(gl.BLEND);
      gl.disable(gl.STENCIL_TEST);
    }
  }
  /** Render a viewport-sized scene into the returned canvas, or null until GPU assets are ready. */
  render(
    scene: HTMLCanvasElement,
    entries: readonly NoiseMaskEntry[],
    seconds: number,
  ): HTMLCanvasElement | null {
    if (!this.ready || this.failed || this.disposed || !scene.width || !scene.height) {
      return null;
    }
    try {
      const gl = this.context();
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      this.resize(scene.width, scene.height);
      if (!this.screen || !this.mask) {
        return null;
      }
      let [screen, other] = this.screen;
      gl.bindTexture(gl.TEXTURE_2D, screen.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.geometry(entries);
      for (const pair of this.targets.values()) {
        this.clear(pair.front);
      }
      const defaultColor = this.parameters.get("outlineColor") as readonly number[];
      const firstColor = entries[0]?.color ?? defaultColor;
      let sharedTheme = true;
      for (const entry of entries) {
        const color = entry.color ?? defaultColor;
        if (
          color[0] !== firstColor[0] ||
          color[1] !== firstColor[1] ||
          color[2] !== firstColor[2]
        ) {
          sharedTheme = false;
          break;
        }
      }
      const uniformColor = [firstColor[0], firstColor[1], firstColor[2], 1];
      if (!sharedTheme) {
        this.themeGeometry(entries, defaultColor);
      }
      let themeEffect = this.themeEffects?.[0];
      for (const pass of noisePassPlans) {
        const pair = this.targets.get(pass.outputName),
          output = pair ? pair.back : other;
        if (pass.component && pair) {
          this.blit(pair.front, output);
        }
        const program = this.getProgram(pass.shader);
        this.bind(program, output);
        let unit = 0;
        unit = this.sampler(program, "screenTexture", screen, unit);
        unit = this.sampler(program, "blockMask", this.mask, unit);
        for (const [uniformName, input] of pass.inputs) {
          unit = this.sampler(
            program,
            uniformName,
            input === "$screen" ? screen : this.targets.get(input)?.front,
            unit,
          );
        }
        for (const [uniformName, target] of this.images) {
          unit = this.sampler(program, uniformName, target, unit);
        }
        unit = this.sampler(program, "themeBaseRT", this.themeBase ?? undefined, unit);
        this.sampler(program, "themeEffectRT", themeEffect, unit);
        this.uniform(program, "useThemeField", sharedTheme ? 0 : 1);
        this.uniform(program, "screenSize", [this.width, this.height]);
        this.uniform(program, "targetSize", output.size);
        this.uniform(program, "targetTexelSize", output.texelSize);
        this.uniform(program, "time", seconds);
        this.uniform(program, "touchCount", 0);
        this.uniform(program, "touchPoints", this.touchPoints);
        for (const [key, value] of this.parameters) {
          this.uniform(program, key, key === "outlineColor" ? uniformColor : value);
        }
        for (const [key, value] of pass.constants) {
          this.uniform(program, key, value);
        }
        if (pass.colorMask) {
          gl.colorMask(...pass.colorMask);
        }
        this.drawQuad();
        gl.colorMask(true, true, true, true);
        if (pair) {
          [pair.front, pair.back] = [pair.back, pair.front];
        } else {
          [screen, other] = [other, screen];
        }
        if (!sharedTheme && pass.shader === "composeActive.glsl") {
          themeEffect = this.composeTheme(seconds);
        }
      }
      this.blit(screen, null);
      gl.flush();
      return this.canvas;
    } catch (error) {
      this.fail();
      console.error("NoiseField render failed", error);
      return null;
    }
  }
  /** Release programs, render targets and image textures when the preview is disposed. */
  dispose(): void {
    this.disposed = true;
    this.uninstallContextLoss?.();
    this.uninstallContextLoss = null;
    const gl = this.gl;
    if (!gl) {
      return;
    }
    for (const target of this.resources) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
      if (target.stencil) {
        gl.deleteRenderbuffer(target.stencil);
      }
    }
    for (const program of this.programs.values()) {
      gl.deleteProgram(program.program);
    }
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.geometryBuffer);
    this.resources = [];
    this.targets.clear();
    this.images.clear();
    this.programs.clear();
    this.gl = null;
  }
}
