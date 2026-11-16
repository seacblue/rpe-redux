/**
 * The image/texture cache: which pictures a chart references, how big each one is
 * allowed to be drawn, and when decoded pixels are released.
 *
 * The policy here is sizing and lifetime — a texture is requested at a scale
 * derived from the viewport, decoding is queued and cancellable through one
 * `AbortController`, and a record is dropped when its bytes change. How a blob
 * becomes pixels (`createImageBitmap`, or an `<img>` for animated GIFs) comes from
 * `core/platform/browser/mediaHost.ts`; this file names no browser constructor.
 */
import { t } from "../../i18n/index.ts";
import { assetBytes, assetPath, resourceReferences } from "../global/document/resources.ts";
import { mediaType } from "./mime.ts";
import { type AssetMap } from "../global/document/types.ts";
import { toBlobPart } from "../utils/bytes.ts";
import type { Chart } from "../global/chart/chart.ts";
import { animatedImage, probePngDimensions } from "./imageMetadata.ts";
import { textureScale, viewportTextureScale } from "./imageGeometry.ts";
import {
  createImageElement,
  decodeImageBitmap,
  hasImageBitmap,
  objectUrlFor,
  releaseObjectUrl,
  viewportMetrics,
} from "../platform/browser/mediaHost.ts";

/** A decoded bitmap, whether it came from `createImageBitmap` or an `<img>`. */
/** A decoded image source with optional GPU-resource cleanup. */
export type ImageSource = (ImageBitmap | HTMLImageElement) & { close?(): void };

/** A media failure the UI may present, classified so asset notices can offer a fix. */
export interface MediaIssue {
  /** Missing files can reopen the asset library; decode failures only need the text. */
  kind: "missing" | "decode";
  /** The chart resource name that failed. */
  name: string;
  /** Localized sentence for the notice body. */
  message: string;
}

/** A decoded image with its natural dimensions. */
export interface DecodedImage {
  source: ImageSource;
  naturalWidth: number;
  naturalHeight: number;
}

/** One texture the project references, plus its decode bookkeeping. */
export interface ImageRecord {
  name: string;
  bytes: Uint8Array | null;
  uri: string | null;
  naturalWidth: number;
  naturalHeight: number;
  animated: boolean;
  lastUsed: number;
  requestedScale: number;
  generation: number;
  signal: AbortSignal;
  pending: Promise<void> | null;
  complete: () => void;
  failed: boolean;
  scale: number;
  image: DecodedImage | null;
  cost: number;
}

/**
 * The image/texture cache for one chart.
 *
 * Derives texture scales from the viewport, queues cancellable decodes, and drops
 * decoded pixels when bytes change or the memory budget is exceeded. Browser
 * decoding primitives come from `core/platform/browser/mediaHost.ts`.
 */
export class ProjectImages {
  invalidate: () => void;
  report: (issue: MediaIssue) => void;
  images: Map<string, DecodedImage>;
  records: Map<string, ImageRecord>;
  generation: number;
  background: DecodedImage | null;
  backgroundName: string;
  chartBackgroundName: string;
  backgroundAnimated: boolean;
  customBackgroundBytes: Uint8Array | null;
  customBackgroundReference: string;
  queue: ImageRecord[];
  activeLoads: number;
  decodedBytes: number;
  budget: number;
  controller: AbortController;

  /** Create an empty cache; `invalidate` is called whenever decoded state changes. */
  constructor(invalidate: () => void, report: (issue: MediaIssue) => void = () => {}) {
    this.invalidate = invalidate;
    this.report = report;
    this.images = new Map();
    this.records = new Map();
    this.generation = 0;
    this.background = null;
    this.backgroundName = "";
    this.chartBackgroundName = "";
    this.backgroundAnimated = false;
    this.customBackgroundBytes = null;
    this.customBackgroundReference = "";
    this.queue = [];
    this.activeLoads = 0;
    this.decodedBytes = 0;
    this.budget = 128 * 1024 ** 2;
    this.controller = new AbortController();
  }

  /**
   * Register the images a chart references and decode its background.
   *
   * When `onProgress` is supplied, every referenced texture is also requested and
   * awaited; missing optional textures are reported through `report`.
   */
  async load(
    chart: Chart,
    assets: AssetMap,
    chartName: string,
    info?: Record<string, string>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<void> {
    this.clear();
    const references = resourceReferences(chart, assets, chartName, info);
    this.chartBackgroundName = references.background;
    this.backgroundName = references.background;
    const names = new Set(
      [references.background, ...(chart.judgeLineList ?? []).map((line) => line.Texture)].filter(
        (name): name is string => Boolean(name),
      ),
    );
    for (const name of names) {
      const path = assetPath(assets, name, chartName);
      const bytes =
        assetBytes(assets, name, chartName) ??
        (path && assets.read ? ((await assets.read(path)) ?? null) : null);
      const uri = path ? assets.uri?.(path) : null;
      if (!bytes && !uri) {
        if (name !== "line.png") {
          this.report({
            kind: "missing",
            name,
            message: t("system.image.missing", { name }),
          });
        }
        continue;
      }
      const dimensions = probePngDimensions(bytes ?? new Uint8Array());
      this.records.set(name, {
        name,
        bytes: bytes ?? null,
        uri: uri ?? null,
        naturalWidth: dimensions.naturalWidth ?? 0,
        naturalHeight: dimensions.naturalHeight ?? 0,
        animated: animatedImage(name, bytes ?? new Uint8Array()),
        lastUsed: 0,
        requestedScale: 0,
        generation: this.generation,
        signal: this.controller.signal,
        pending: null,
        complete: () => {},
        failed: false,
        scale: 0,
        image: null,
        cost: 0,
      });
    }
    const background = this.records.get(this.backgroundName);
    if (background) {
      const viewport = viewportMetrics();
      const display =
        Math.max(viewport.width || 1920, viewport.height || 1080) *
        (viewport.devicePixelRatio || 1);
      this.texture(
        this.backgroundName,
        Math.min(
          1,
          display /
            Math.max(background.naturalWidth || display, background.naturalHeight || display),
        ),
      );
      await background.pending;
    }
    await this.applyCustomBackground();
    this.invalidate();
    if (onProgress) {
      let completed = 0;
      const total = this.records.size;
      onProgress(0, total);
      await Promise.all(
        [...this.records.values()].map(async (record) => {
          this.texture(
            record.name,
            record.name === this.backgroundName
              ? record.requestedScale
              : viewportTextureScale(1, record.naturalWidth, record.naturalHeight),
          );
          await record.pending;
          onProgress(++completed, total);
        }),
      );
      if (!total) {
        onProgress(1, 1);
      }
    }
  }

  /** Read the decode bookkeeping for one referenced texture. */
  describe(name: string): ImageRecord | undefined {
    return this.records.get(name);
  }

  /** Replace the chart cover for every preview using this image surface. */
  async loadCustomBackground(bytes: Uint8Array | null, reference: string): Promise<void> {
    this.removeCustomBackgroundRecord();
    this.customBackgroundBytes = bytes && bytes.length ? bytes : null;
    this.customBackgroundReference = this.customBackgroundBytes ? reference : "";
    await this.applyCustomBackground();
    this.invalidate();
  }

  /** Return the decoded texture at a scale, queuing a higher-resolution decode when needed. */
  texture(name: string, scale = 1): DecodedImage | null {
    const record = this.records.get(name);
    if (!record || record.failed) {
      return null;
    }
    record.lastUsed = performance.now();
    const desired = textureScale(scale);
    record.requestedScale = Math.max(record.requestedScale, desired);
    if (!record.pending && (!record.image || record.scale < desired)) {
      record.pending = new Promise((resolve) => {
        record.complete = resolve;
      });
      this.queue.push(record);
      this.pump();
    }
    return record.image ?? null;
  }

  /** Start queued decodes up to the concurrency limit, skipping stale records. */
  pump(): void {
    while (this.activeLoads < 2 && this.queue.length) {
      const record = this.queue.shift();
      if (!record) {
        return;
      }
      if (record.generation !== this.generation) {
        record.complete();
        continue;
      }
      this.activeLoads++;
      this.decode(record).finally(() => {
        this.activeLoads--;
        record.pending = null;
        record.complete();
        this.pump();
      });
    }
  }

  /** Decode one record, store its image, and release the previous one. */
  async decode(record: ImageRecord): Promise<void> {
    const scale = record.requestedScale;
    let source: ImageSource | undefined;
    try {
      const blob = record.bytes
        ? new Blob([toBlobPart(record.bytes)], { type: mediaType(record.name) })
        : await (await fetch(record.uri ?? "", { signal: record.signal })).blob();
      if (record.animated || !hasImageBitmap()) {
        const url = objectUrlFor(blob);
        try {
          const image = createImageElement();
          image.src = url;
          await image.decode();
          source = image;
        } finally {
          releaseObjectUrl(url);
        }
        record.naturalWidth = source.naturalWidth;
        record.naturalHeight = source.naturalHeight;
      } else {
        const options: ImageBitmapOptions = record.naturalWidth
          ? {
              resizeWidth: Math.max(1, Math.ceil(record.naturalWidth * scale)),
              resizeHeight: Math.max(1, Math.ceil(record.naturalHeight * scale)),
              resizeQuality: "high",
            }
          : {};
        const bitmap = await decodeImageBitmap(blob, options);
        source = bitmap;
        if (!record.naturalWidth) {
          record.naturalWidth = bitmap.width;
          record.naturalHeight = bitmap.height;
        }
      }
      if (record.generation !== this.generation) {
        source.close?.();
        return;
      }
      this.release(record);
      record.scale = record.animated ? 1 : source.width / record.naturalWidth;
      record.image = {
        source,
        naturalWidth: record.naturalWidth,
        naturalHeight: record.naturalHeight,
      };
      record.cost =
        (source.width || record.naturalWidth) * (source.height || record.naturalHeight) * 4;
      this.decodedBytes += record.cost;
      this.images.set(record.name, record.image);
      if (record.name === this.backgroundName) {
        this.background = record.image;
        this.backgroundAnimated = record.animated;
      }
      this.trim();
      this.invalidate();
    } catch {
      source?.close?.();
      if (record.generation === this.generation) {
        record.failed = true;
        this.report({
          kind: "decode",
          name: record.name,
          message: t("system.image.decodeFailed", { name: record.name }),
        });
      }
    }
  }

  /** Close and forget one record's decoded image. */
  release(record: ImageRecord): void {
    if (!record.image) {
      return;
    }
    record.image.source.close?.();
    this.decodedBytes -= record.cost;
    this.images.delete(record.name);
    record.image = null;
    record.scale = 0;
    record.requestedScale = 0;
  }

  /** Release least-recently-used non-background textures until under budget. */
  trim(): void {
    if (this.decodedBytes <= this.budget) {
      return;
    }
    const cutoff = performance.now() - 1000;
    const candidates = [...this.records.values()]
      .filter(
        (record) => record.image && record.name !== this.backgroundName && record.lastUsed < cutoff,
      )
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const record of candidates) {
      if (this.decodedBytes <= this.budget) {
        break;
      }
      this.release(record);
    }
  }

  /** Drop chart textures and pending decodes while keeping the profile background choice. */
  clear(): void {
    // Chart reloads clear decoded records, but the selected application-data
    // reference belongs to the profile and must survive the reload. `dispose`
    // is the explicit path that clears that profile-level selection.
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    for (const record of this.records.values()) {
      this.release(record);
    }
    for (const record of this.queue) {
      record.complete();
    }
    this.queue = [];
    this.records.clear();
    this.images.clear();
    this.background = null;
    this.backgroundName = "";
    this.chartBackgroundName = "";
    this.backgroundAnimated = false;
  }

  /** Release all decoded media when the preview runtime itself is disposed. */
  dispose(): void {
    this.clear();
    this.customBackgroundBytes = null;
    this.customBackgroundReference = "";
  }

  /** Remove the custom background record and restore the chart background. */
  private removeCustomBackgroundRecord(): void {
    const reference = this.customBackgroundReference;
    if (!reference) {
      return;
    }
    const record = this.records.get(reference);
    if (record) {
      // A custom image may still be queued or decoding. Make that record stale
      // before removing it so a late decode cannot repopulate the image cache.
      record.generation = -1;
      this.queue = this.queue.filter((queued) => queued !== record);
      record.complete();
      this.release(record);
      this.records.delete(reference);
    }
    this.images.delete(reference);
    if (this.backgroundName === reference) {
      this.backgroundName = this.chartBackgroundName;
      const chartBackground = this.records.get(this.chartBackgroundName);
      this.background = chartBackground?.image ?? null;
      this.backgroundAnimated = chartBackground?.animated ?? false;
    }
  }

  /** Register the selected custom cover and make it the active background. */
  private async applyCustomBackground(): Promise<void> {
    const bytes = this.customBackgroundBytes;
    const reference = this.customBackgroundReference;
    if (!bytes || !reference) {
      return;
    }
    const dimensions = probePngDimensions(bytes);
    const record: ImageRecord = {
      name: reference,
      bytes,
      uri: null,
      naturalWidth: dimensions.naturalWidth ?? 0,
      naturalHeight: dimensions.naturalHeight ?? 0,
      animated: animatedImage(reference, bytes),
      lastUsed: 0,
      requestedScale: 0,
      generation: this.generation,
      signal: this.controller.signal,
      pending: null,
      complete: () => {},
      failed: false,
      scale: 0,
      image: null,
      cost: 0,
    };
    this.records.set(reference, record);
    this.backgroundName = reference;
    this.backgroundAnimated = record.animated;
    this.texture(reference, 1);
    await record.pending;
    // Replacing or clearing the setting can finish the old decode after this
    // await. Only the record still owned by the current reference may select
    // the background or perform fallback work.
    if (this.customBackgroundReference !== reference || this.records.get(reference) !== record) {
      return;
    }
    if (!record.image) {
      this.backgroundName = this.chartBackgroundName;
      const chartBackground = this.records.get(this.chartBackgroundName);
      this.background = chartBackground?.image ?? null;
      this.backgroundAnimated = chartBackground?.animated ?? false;
    }
  }
}

export { animatedImage, probePngDimensions } from "./imageMetadata.ts";
export { textureScale, viewportTextureScale } from "./imageGeometry.ts";
