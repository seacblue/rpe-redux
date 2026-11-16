/** Owns the persistent line-number texture atlas shared by Canvas2D and WebGL guide paths. */
import { canvasPixelRatio } from "../../../canvas/canvas2d.ts";

/** Measured bounds for one line-number label in logical preview pixels. */
export interface GuideLabelBounds {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A source rectangle in the persistent atlas plus its logical destination size. */
export interface GuideAtlasGlyph {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
}

/** Result of looking up a label in the atlas. */
export interface GuideAtlasLookup {
  readonly glyph: GuideAtlasGlyph | null;
  readonly hit: boolean;
}

const INITIAL_ATLAS_SIZE = 2048;
/** Physical transparent gap that keeps linear sampling away from neighbours. */
const ATLAS_PADDING = 2;

/**
 * Keeps text rasterization stable across playback frames.
 *
 * The atlas is deliberately Canvas-backed: Canvas2D remains the fallback path,
 * while the same pixels can be uploaded once to the shared WebGL context by the
 * guide batch. Atlas entries are keyed by font, colour, scale, and label text.
 */
export class PreviewGuideTextAtlas {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private ratio = Number.NaN;
  private nextX = 0;
  private nextY = 0;
  private rowHeight = 0;
  private readonly entries = new Map<string, GuideAtlasGlyph>();
  private revision = 0;
  private generation = 0;

  /** Return the backing atlas canvas, or null when the browser cannot create one. */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** Return the physical atlas dimensions used by WebGL UV coordinates. */
  getSize(): { width: number; height: number } {
    return {
      width: this.canvas?.width ?? 0,
      height: this.canvas?.height ?? 0,
    };
  }

  /** Monotonic revision incremented whenever atlas pixels or dimensions change. */
  getRevision(): number {
    return this.revision;
  }

  /** Return the generation of the current atlas contents. */
  getGeneration(): number {
    return this.generation;
  }

  /** Look up or rasterize one label without allocating a per-label canvas. */
  lookup(
    context: CanvasRenderingContext2D,
    label: GuideLabelBounds,
    color: string,
    scale: number,
  ): GuideAtlasLookup {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return { glyph: null, hit: false };
    }
    const ratio = Math.max(1, canvasPixelRatio());
    if (!this.ensure(ratio)) {
      return { glyph: null, hit: false };
    }
    const key = `${context.font}|${color}|${scale}|${label.text}`;
    const cached = this.entries.get(key);
    if (cached) {
      return { glyph: cached, hit: true };
    }
    const atlasContext = this.context;
    const atlas = this.canvas;
    if (!atlasContext || !atlas) {
      return { glyph: null, hit: false };
    }
    const sourceWidth = Math.max(1, Math.ceil((label.right - label.left) * ratio));
    const sourceHeight = Math.max(1, Math.ceil((label.bottom - label.top) * ratio));
    const allocationWidth = sourceWidth + ATLAS_PADDING * 2;
    const allocationHeight = sourceHeight + ATLAS_PADDING * 2;
    if (this.nextX + allocationWidth > atlas.width) {
      this.nextX = 0;
      this.nextY += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.nextY + allocationHeight > atlas.height) {
      return { glyph: null, hit: false };
    }
    const sourceX = this.nextX + ATLAS_PADDING;
    const sourceY = this.nextY + ATLAS_PADDING;
    this.nextX += allocationWidth;
    this.rowHeight = Math.max(this.rowHeight, allocationHeight);
    atlasContext.save();
    atlasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    atlasContext.font = context.font;
    atlasContext.fillStyle = color;
    atlasContext.textAlign = "center";
    atlasContext.textBaseline = "top";
    atlasContext.fillText(
      label.text,
      sourceX / ratio - label.left,
      sourceY / ratio + 4 * scale - label.top,
    );
    atlasContext.restore();
    const glyph: GuideAtlasGlyph = {
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      width: label.right - label.left,
      height: label.bottom - label.top,
    };
    this.entries.set(key, glyph);
    this.revision += 1;
    return { glyph, hit: false };
  }

  /** Forget atlas pixels and entries after a font scale, skin, or context change. */
  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.nextX = 0;
    this.nextY = 0;
    this.rowHeight = 0;
    if (this.context && this.canvas) {
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.revision += 1;
  }

  /** Release the DOM canvas reference while keeping the owner reusable. */
  dispose(): void {
    this.generation += 1;
    this.canvas = null;
    this.context = null;
    this.entries.clear();
    this.ratio = Number.NaN;
    this.nextX = 0;
    this.nextY = 0;
    this.rowHeight = 0;
    this.revision += 1;
  }

  private ensure(ratio: number): boolean {
    if (this.canvas && this.context && this.ratio === ratio) {
      return true;
    }
    const canvas = this.canvas ?? document.createElement("canvas");
    canvas.width = INITIAL_ATLAS_SIZE;
    canvas.height = INITIAL_ATLAS_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }
    this.canvas = canvas;
    this.context = context;
    this.ratio = ratio;
    this.generation += 1;
    this.entries.clear();
    this.nextX = 0;
    this.nextY = 0;
    this.rowHeight = 0;
    this.revision += 1;
    return true;
  }
}
