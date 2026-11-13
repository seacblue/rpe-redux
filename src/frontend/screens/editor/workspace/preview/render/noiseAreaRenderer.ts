/** Composes the preview scene and draws sampled noise areas over it. */
import {
  NoiseAreaRuntime,
  type NoiseAreaSample,
} from "../../../../../../core/global/chart/noise/noiseRuntime.ts";
import type { BlockArea } from "../../../../../../core/global/chart/noise/blockArea.ts";
import { blockAreaColor } from "../../../../../../core/global/chart/noise/blockAreaColor.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import type { PreviewFrame } from "../scene/previewTypes.ts";
import { canvasPixelRatio } from "../../../canvas/canvas2d.ts";
import { NoiseFieldPipeline, type NoiseMaskEntry } from "./noiseFieldPipeline.ts";
import { partitionNoiseMaskEntries } from "./noiseGeometry.ts";
import {
  noiseLinePreviewArea,
  sampleNoiseLinePreviewInto,
} from "../../../../../../core/global/chart/noise/noiseLinePreview.ts";
import { noiseLineSizeAt } from "../../../../../../core/global/chart/noise/noiseLineSize.ts";
import { noiseParentIndex } from "../../../../../../core/global/chart/noise/noiseParent.ts";
import type { JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";

interface NoiseAreaSource {
  area: BlockArea;
  lineIndex?: number;
}

interface MutableNoiseMaskEntry extends Omit<NoiseMaskEntry, "vertices"> {
  vertices: { x: number; y: number }[];
}

/** Create one reusable GPU-entry shell; its point arrays are filled per frame. */
function createMaskEntry(): MutableNoiseMaskEntry {
  return { state: "hidden", invert: false, vertices: [] };
}

/** Maintains reusable viewport-sized surfaces and the optional NoiseField pipeline. */
export class NoiseAreaRenderer {
  private readonly scene = document.createElement("canvas");
  private readonly surfaces = new Map<string, HTMLCanvasElement>();
  private runtimes = new WeakMap<
    BlockArea,
    { tempo: TempoSource; aspect: number; runtime: NoiseAreaRuntime }
  >();
  private pipeline: NoiseFieldPipeline | null = null;
  private readonly lineAreas = new WeakMap<
    JudgeLine,
    { chart: object; bpm: object; area: BlockArea }
  >();
  private readonly lineTempos = new WeakMap<object, TempoMap>();
  private readonly areaSources: NoiseAreaSource[] = [];
  /** Reused entry objects; the array is truncated to the current frame's entry count. */
  private readonly entries: MutableNoiseMaskEntry[] = [];
  private readonly simpleGroups: [NoiseMaskEntry[], NoiseMaskEntry[]] = [[], []];
  private readonly invalidate: () => void;
  private readonly onError: () => void;
  /** Creates the renderer; `invalidate` requests a repaint and `onError` reports GPU failure. */
  constructor(invalidate: () => void, onError: () => void = () => {}) {
    this.invalidate = invalidate;
    this.onError = onError;
  }
  /** Initialize detailed noise before an offline render reaches its first area. */
  async prepare(): Promise<boolean> {
    this.pipeline ??= new NoiseFieldPipeline(this.invalidate, this.onError);
    return this.pipeline.whenReady();
  }
  /** Returns a cleared scratch context for `name`, resizing it when needed. */
  private layer(name: string, width: number, height: number): CanvasRenderingContext2D {
    let canvas = this.surfaces.get(name);
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.surfaces.set(name, canvas);
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Noise area canvas unavailable");
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    return context;
  }
  /** Samples one area, reusing its runtime while tempo and aspect stay unchanged. */
  private sample(
    area: BlockArea,
    tempo: TempoSource,
    seconds: number,
    aspect: number,
  ): NoiseAreaSample {
    let entry = this.runtimes.get(area);
    if (!entry || entry.tempo !== tempo || entry.aspect !== aspect) {
      entry = { tempo, aspect, runtime: new NoiseAreaRuntime(area, tempo, aspect) };
      this.runtimes.set(area, entry);
    }
    return entry.runtime.sampleInto(seconds);
  }
  /** Build one canvas-space polygon from normalized area vertices. */
  private canvasPath(vertices: NoiseMaskEntry["vertices"], width: number, height: number): Path2D {
    const path = new Path2D();
    for (const [index, point] of vertices.entries()) {
      const x = ((point.x + 1) * width) / 2;
      const y = ((1 - point.y) * height) / 2;
      if (index) {
        path.lineTo(x, y);
      } else {
        path.moveTo(x, y);
      }
    }
    path.closePath();
    return path;
  }
  /** Paint the moving diagonal hatch that keeps an inactive area readable. */
  private hatch(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    seconds: number,
  ): void {
    const spacing = 18;
    const offset = (seconds * 30) % spacing;
    context.strokeStyle = "rgba(255,255,255,0.32)";
    context.lineWidth = 2;
    for (let x = -height - spacing; x <= width + spacing; x += spacing) {
      context.beginPath();
      context.moveTo(x + offset, 0);
      context.lineTo(x + offset + height, height);
      context.stroke();
    }
  }
  /** Paints the 2-D fallback overlay for mask entries when GPU rendering is unavailable. */
  private simple(
    entries: readonly NoiseMaskEntry[],
    width: number,
    height: number,
    seconds: number,
  ): void {
    const overlay = this.layer("overlay", width, height);
    partitionNoiseMaskEntries(entries, this.simpleGroups);
    for (let activeIndex = 0; activeIndex < 2; activeIndex++) {
      const active = activeIndex === 1;
      const group = this.simpleGroups[activeIndex];
      if (!group.length) {
        continue;
      }
      const normal = this.layer("normal", width, height),
        inverted = this.layer("inverted", width, height),
        overlap = this.layer("overlap", width, height),
        coverage = this.layer("coverage", width, height),
        material = this.layer("material", width, height);
      for (const entry of group) {
        const path = this.canvasPath(entry.vertices, width, height);
        const rgb =
          entry.color?.map((channel) => Math.round(channel * 255)) ??
          (active ? [182, 60, 60] : [127, 35, 35]);
        // The simple mode is an editing aid: it stays light enough that notes
        // and their outlines remain readable underneath every area.
        material.fillStyle = `rgba(${rgb.join(",")},${active ? 0.34 : 0.16})`;
        // Replacing covered pixels avoids increasing alpha when areas overlap.
        material.save();
        material.clip(path);
        material.clearRect(0, 0, width, height);
        material.fill(path);
        if (!active) {
          // Inactive areas get a moving diagonal hatch so an empty or disabled
          // region never hides the chart below.
          this.hatch(material, width, height, seconds);
        }
        material.restore();
        if (entry.invert) {
          overlap.save();
          overlap.clip(path);
          overlap.drawImage(inverted.canvas, 0, 0);
          overlap.restore();
          inverted.fillStyle = "#fff";
          inverted.fill(path);
        } else {
          normal.fillStyle = "#fff";
          normal.fill(path);
        }
      }
      inverted.globalCompositeOperation = "destination-out";
      inverted.drawImage(overlap.canvas, 0, 0);
      coverage.drawImage(normal.canvas, 0, 0);
      coverage.globalCompositeOperation = "xor";
      coverage.drawImage(inverted.canvas, 0, 0);
      overlay.globalCompositeOperation = "destination-out";
      overlay.drawImage(coverage.canvas, 0, 0);
      material.globalCompositeOperation = "destination-in";
      material.drawImage(coverage.canvas, 0, 0);
      overlay.globalCompositeOperation = "source-over";
      overlay.drawImage(material.canvas, 0, 0);
    }
    this.scene.getContext("2d")?.drawImage(overlay.canvas, 0, 0);
  }
  /** Paints a merged scene into the primary canvas and returns whether notes were merged. */
  draw(
    frame: PreviewFrame,
    primary: HTMLCanvasElement,
    notes: HTMLCanvasElement | null,
    detailed: boolean,
  ): boolean {
    const areas = this.areaSources;
    areas.length = 0;
    for (const area of frame.chart.blockAreaList ?? []) {
      const source = areas[areas.length] ?? { area };
      source.area = area;
      source.lineIndex = undefined;
      areas.push(source);
    }
    for (const [lineIndex, line] of (frame.chart.judgeLineList ?? []).entries()) {
      try {
        let cached = this.lineAreas.get(line);
        if (
          !cached ||
          cached.bpm !== frame.chart.BPMList ||
          (noiseParentIndex(line.father) !== -1 && cached.chart !== frame.chart)
        ) {
          let tempo = this.lineTempos.get(frame.chart.BPMList);
          if (!tempo) {
            tempo = new TempoMap(frame.chart.BPMList);
            this.lineTempos.set(frame.chart.BPMList, tempo);
          }
          const area = noiseLinePreviewArea(line, tempo);
          if (area) {
            cached = { chart: frame.chart, bpm: frame.chart.BPMList, area };
            this.lineAreas.set(line, cached);
          }
        }
        if (cached) {
          const source = areas[areas.length] ?? { area: cached.area };
          source.area = cached.area;
          source.lineIndex = lineIndex;
          areas.push(source);
        }
      } catch {
        // Unsupported transforms remain editable; export rejects them explicitly.
      }
    }
    if (!areas.length || frame.viewport.width <= 0 || frame.viewport.height <= 0) {
      return false;
    }
    const aspect = frame.scaleY / frame.scaleX;
    // Vertices are clip-space, so the camera centre has to be folded into the
    // normalized position; otherwise zoomed noise areas stay pinned to the
    // frame while their judge lines move with the free camera.
    const originX = frame.centerX - frame.viewport.left;
    const originY = frame.centerY - frame.viewport.top;
    const entries = this.entries;
    let entryCount = 0;
    for (const { area, lineIndex } of areas) {
      let sample = this.sample(area, frame.tempo, frame.seconds, aspect);
      if (lineIndex !== undefined) {
        const state = frame.states[lineIndex];
        const runtime = frame.scene.lines[lineIndex];
        if (!state || !runtime) {
          continue;
        }
        sample = sampleNoiseLinePreviewInto(
          area,
          sample,
          state,
          noiseLineSizeAt(runtime.extended.scaleXEvents, state.scaleX, frame.seconds),
          noiseLineSizeAt(runtime.extended.scaleYEvents, state.scaleY, frame.seconds),
          aspect,
          sample,
        );
      }
      if (sample.state === "hidden") {
        continue;
      }
      const entry = entries[entryCount] ?? createMaskEntry();
      entries[entryCount] = entry;
      entryCount += 1;
      entry.state = sample.state;
      entry.invert = sample.invert;
      entry.color = blockAreaColor(area.color) ?? undefined;
      const vertices = entry.vertices;
      for (let index = 0; index < sample.points.length; index++) {
        const point = sample.points[index];
        const vertex = vertices[index] ?? (vertices[index] = { x: 0, y: 0 });
        vertex.x = (2 * (originX + point.x * frame.scaleX)) / frame.viewport.width - 1;
        vertex.y = (2 * (point.y * frame.scaleY - originY)) / frame.viewport.height + 1;
      }
      vertices.length = sample.points.length;
    }
    entries.length = entryCount;
    if (!entries.length) {
      return false;
    }
    const ratio = canvasPixelRatio(),
      width = Math.max(1, Math.round(frame.viewport.width * ratio)),
      height = Math.max(1, Math.round(frame.viewport.height * ratio));
    if (this.scene.width !== width || this.scene.height !== height) {
      this.scene.width = width;
      this.scene.height = height;
    }
    const scene = this.scene.getContext("2d");
    if (!scene) {
      return false;
    }
    scene.clearRect(0, 0, width, height);
    const { left, top } = frame.viewport;
    const sx = left * ratio,
      sy = top * ratio,
      sw = frame.viewport.width * ratio,
      sh = frame.viewport.height * ratio;
    scene.drawImage(primary, sx, sy, sw, sh, 0, 0, width, height);
    if (notes) {
      scene.drawImage(notes, sx, sy, sw, sh, 0, 0, width, height);
    }
    let rendered: HTMLCanvasElement | null = null;
    if (detailed) {
      this.pipeline ??= new NoiseFieldPipeline(this.invalidate, this.onError);
      rendered = this.pipeline.render(
        this.scene,
        entries,
        frame.seconds + Number(frame.chart.META?.offset ?? 0) / 1000,
      );
    }
    if (detailed && !rendered) {
      return false;
    }
    if (!rendered) {
      this.simple(entries, width, height, frame.seconds);
      rendered = this.scene;
    }
    frame.context.clearRect(left, top, frame.viewport.width, frame.viewport.height);
    frame.context.drawImage(rendered, left, top, frame.viewport.width, frame.viewport.height);
    return true;
  }
  /** Release cached chart sampling data when a document closes. */
  clear(): void {
    this.runtimes = new WeakMap();
  }
  /** Release WebGL objects and temporary surfaces. */
  dispose(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.surfaces.clear();
    this.clear();
  }
}
