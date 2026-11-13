/**
 * Loads and caches the note and hold skin bitmaps and renders tinted sprites for
 * the preview and timeline. Skin selection and alignment rules live in core/media;
 * this class owns browser decoding, tinting, and URL lifetime.
 */
import { assetUrl } from "../../../../core/platform/assetUrl.ts";
import { t } from "../../../../i18n/index.ts";
import {
  alignedTexture,
  alignedTextureBox,
  type UsefulRect,
  NOTE_TEXTURES,
} from "../../../../core/media/noteSkin.ts";
import {
  activeNoteSkin,
  DEFAULT_NOTE_SKIN,
  loadNoteSkinWithFallback,
  selectNoteSkin,
} from "../../../../core/media/noteSkins.ts";
import { bundledNoteSkinUrl } from "../../../platform/noteSkinBridge.ts";
import { toBlobPart } from "../../../../core/utils/bytes.ts";
import { HIT_FRAME_COUNT } from "./hitFrame.ts";
import { holdLayout } from "./noteGeometry.ts";
import { splitPhiraHitFx, splitPhiraHoldAtlas } from "./phiraAtlas.ts";
import type { NoteColor, TextureDescriptor } from "./noteSpriteGroups.ts";

/** Note type → normal texture name. */
const names: Record<number, string> = { 1: "tap", 2: "hold_head", 3: "flick", 4: "drag" };
/** Note type → highlighted texture name. */
const highlights: Record<number, string> = {
  1: "tap_highlight",
  2: "hold_head_highlight",
  3: "flick_highlight",
  4: "drag_highlight",
};

/** Tintable bitmap usable by `drawImage`, with optional intrinsic dimensions. */
export type SkinSource = CanvasImageSource & {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
};

/** Only finite, three-channel, non-white colors need generated tint textures. */
function isCustomTint(value: number[] | undefined): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(Number.isFinite) &&
    value.some((channel) => channel !== 255)
  );
}

/** Browser-side note skin cache and Canvas 2D renderer. */
export class RpeSkin {
  images: Map<string, HTMLImageElement>;
  tints: Map<string, HTMLCanvasElement>;
  sourceIds: WeakMap<SkinSource, number>;
  nextSourceId: number;
  invalidate: () => void;
  particleFrameCount = HIT_FRAME_COUNT;
  private baseImages = new Map<string, HTMLImageElement>();
  private useful = new Map<string, UsefulRect>();
  private urls: string[] = [];
  private generation = 0;
  private revision = 0;
  private disposed = false;
  private activeId = DEFAULT_NOTE_SKIN;
  private readonly colorKeys = new WeakMap<
    number[],
    { r: number; g: number; b: number; prefix: string; key: string; css: string }
  >();

  /** Create the skin with a callback invoked after a new selection decodes. */
  constructor(invalidate: () => void) {
    this.images = new Map();
    this.tints = new Map();
    this.sourceIds = new WeakMap();
    this.nextSourceId = 1;
    this.invalidate = invalidate;
  }

  /** Bumped whenever newly decoded bitmaps replace the current skin. */
  get textureRevision(): number {
    return this.revision;
  }

  /** Retain the currently decoded skin independently of later selection changes. */
  cloneForRecording(): RpeSkin {
    const copy = new RpeSkin(() => {});
    copy.images = new Map(this.images);
    copy.useful = new Map(this.useful);
    copy.activeId = this.activeId;
    copy.revision = this.revision;
    copy.particleFrameCount = this.particleFrameCount;
    return copy;
  }

  /** Decode the base chrome images, then apply the active note skin. */
  async load(): Promise<void> {
    await Promise.all(
      ["Pause", "Arrow2"].map(async (name) => {
        const picture = new Image();
        picture.src = assetUrl(`redux/Texture/${name}.png`);
        try {
          await picture.decode();
          if (!this.disposed) {
            this.images.set(name, picture);
          }
        } catch {
          return;
        }
      }),
    );
    // The bundled line image is the base texture; a skin pack may replace it.
    const defaultLine = new Image();
    defaultLine.src = bundledNoteSkinUrl("line.png");
    try {
      await defaultLine.decode();
      if (!this.disposed) {
        this.images.set("line", defaultLine);
      }
    } catch {
      // A missing bundled line image is handled by the renderer's flat-line fallback.
    }
    if (this.disposed) {
      return;
    }
    this.baseImages = new Map(this.images);
    await this.applySelection();
  }

  /** Decode the selected skin pack and swap it in, keeping the old bitmaps on failure. */
  async applySelection(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.generation;
    const id = activeNoteSkin();
    const images = new Map(this.baseImages);
    const useful = new Map<string, UsefulRect>();
    const urls: string[] = [];
    let adopted = false;
    try {
      const pack = await loadNoteSkinWithFallback(id);
      for (const name of NOTE_TEXTURES) {
        images.delete(name);
      }
      const assets: { name: string; file: string; useful?: UsefulRect }[] = [
        ...(pack.manifest.judgeline?.line
          ? [
              {
                name: "line",
                file: pack.manifest.judgeline.line.file,
                useful: pack.manifest.judgeline.line.useful,
              },
            ]
          : []),
        ...(pack.manifest.phira && pack.files.has(pack.manifest.phira.hitFxFile)
          ? [{ name: "phira_hit_fx", file: pack.manifest.phira.hitFxFile }]
          : []),
        ...[...Object.entries(pack.manifest.notes), ...Object.entries(pack.manifest.events)].map(
          ([name, entry]) => ({
            name,
            file: entry.file,
            useful: entry.useful,
          }),
        ),
        ...Object.entries(pack.manifest.particles ?? {}).map(([name, file]) => ({ name, file })),
      ];
      // Decode every distinct file once and in parallel; a pack carries a few
      // dozen textures and sequential decoding delays the skin swap.
      const decoded = new Map<string, Promise<HTMLImageElement>>();
      /** Decode each pack file once and share the pending promise. */
      const decodeFile = (file: string): Promise<HTMLImageElement> => {
        let pending = decoded.get(file);
        if (pending) {
          return pending;
        }
        const bytes = pack.files.get(file);
        if (!bytes) {
          return Promise.reject(new Error(t("editor.skin.missingFile", { file })));
        }
        pending = (async () => {
          const url = URL.createObjectURL(new Blob([toBlobPart(bytes)], { type: "image/png" }));
          urls.push(url);
          const image = new Image();
          image.src = url;
          await image.decode();
          return image;
        })();
        decoded.set(file, pending);
        return pending;
      };
      await Promise.all(
        assets.map(async (entry) => {
          const image = await decodeFile(entry.file);
          images.set(entry.name, image);
          if (entry.useful) {
            useful.set(entry.name, entry.useful);
          }
        }),
      );
      if (pack.manifest.phira) {
        const atlas = images.get("hold_body");
        const atlasMh = images.get("hold_body_highlight");
        if (atlas && atlasMh) {
          const [head, body, end] = await splitPhiraHoldAtlas(
            atlas,
            pack.manifest.phira.info.holdAtlas,
          );
          const [headMh, bodyMh, endMh] = await splitPhiraHoldAtlas(
            atlasMh,
            pack.manifest.phira.info.holdAtlasMH,
          );
          images.set("hold_head", head);
          images.set("hold_body", body);
          images.set("hold_end", end);
          images.set("hold_head_highlight", headMh);
          images.set("hold_body_highlight", bodyMh);
          images.set("hold_end_highlight", endMh);
          for (const name of [
            "hold_head",
            "hold_body",
            "hold_end",
            "hold_head_highlight",
            "hold_body_highlight",
            "hold_end_highlight",
          ]) {
            useful.delete(name);
          }
        }
        const hitFx = images.get("phira_hit_fx");
        if (hitFx) {
          const frames = await splitPhiraHitFx(hitFx, pack.manifest.phira.info.hitFx);
          frames.forEach((frame, index) => images.set(`img-${index + 1}`, frame));
          images.delete("phira_hit_fx");
        }
      }
      if (generation !== this.generation || this.disposed) {
        return;
      }
      this.urls.forEach((url) => URL.revokeObjectURL(url));
      this.urls = urls;
      this.images = images;
      this.useful = useful;
      this.particleFrameCount = [...images.keys()].filter((name) => /^img-\d+$/.test(name)).length;
      this.activeId = id;
      this.clearTints();
      // The same RpeSkin instance survives a selection change; the revision is
      // what tells the GPU batch that its descriptor and texture caches are now
      // stale.
      this.revision += 1;
      adopted = true;
      this.invalidate();
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        selectNoteSkin(this.activeId);
        window.dispatchEvent(
          new CustomEvent("redux:note-skin-error", {
            detail: t("editor.skin.loadFailed", { message: String(error) }),
          }),
        );
      }
    } finally {
      if (!adopted) {
        urls.forEach((url) => URL.revokeObjectURL(url));
      }
    }
  }

  /** The useful rectangle for a texture, defaulting to the whole picture. */
  private bounds(name: string, picture: HTMLImageElement): UsefulRect {
    // Preserve RPE's built-in measurements; imported packs explicitly normalize useful bounds.
    return (
      this.useful.get(name) ?? {
        x: 0,
        y: 0,
        width: picture.naturalWidth,
        height: picture.naturalHeight,
      }
    );
  }

  /** Descriptor for the default judge-line texture, aligned by its useful rect. */
  lineTexture(): TextureDescriptor | null {
    const picture = this.images.get("line");
    if (!picture) {
      return null;
    }
    const rect = this.bounds("line", picture);
    return rect.width > 0 && rect.height > 0 ? { source: picture, useful: rect } : null;
  }

  /** Draw one texture aligned by its useful rectangle into a logical box. */
  drawAligned(
    context: CanvasRenderingContext2D,
    name: string,
    source: CanvasImageSource,
    centerX: number,
    centerY: number,
    logicalWidth: number,
    logicalHeight: number,
  ): boolean {
    const picture = this.images.get(name);
    if (!picture || logicalWidth <= 0 || logicalHeight <= 0) {
      return false;
    }
    const rect = this.bounds(name, picture);
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const box = alignedTextureBox(
      rect,
      picture.naturalWidth,
      picture.naturalHeight,
      centerX,
      centerY,
      logicalWidth,
      logicalHeight,
    );
    context.drawImage(source, box.x, box.y, box.width, box.height);
    return true;
  }
  /** Draw the skin-owned event bar into the timeline event rectangle. */
  eventBar(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): boolean {
    const name = this.images.has("event_hold")
      ? "event_hold"
      : this.images.has("event_bar")
        ? "event_bar"
        : "hold_body";
    const picture = this.images.get(name);
    if (!picture || width <= 0 || height <= 0) {
      return false;
    }
    const box = alignedTextureBox(
      this.bounds(name, picture),
      picture.naturalWidth,
      picture.naturalHeight,
      centerX,
      centerY,
      width,
      height,
    );
    context.drawImage(picture, box.x, box.y, box.width, box.height);
    return true;
  }

  /** Pre-tint every hit animation frame for the configured particle colour. */
  prewarmHitEffects(color: number[]): void {
    for (const name of this.images.keys()) {
      if (/^img-\d+$/.test(name)) {
        this.tinted(name, color);
      }
    }
  }

  /** Return the skin-owned event texture for GPU batch renderers. */
  eventBarTexture(): { source: HTMLImageElement; useful: UsefulRect } | null {
    const name = this.images.has("event_hold")
      ? "event_hold"
      : this.images.has("event_bar")
        ? "event_bar"
        : "hold_body";
    const source = this.images.get(name);
    return source ? { source, useful: this.bounds(name, source) } : null;
  }

  /** Return an untinted note texture for the preview GPU batch. */
  noteTexture(
    type: number,
    highlight: boolean,
  ): { source: HTMLImageElement; useful: UsefulRect } | null {
    const name = highlight && this.images.has(highlights[type]) ? highlights[type] : names[type];
    const source = this.images.get(name);
    return source ? { source, useful: this.bounds(name, source) } : null;
  }

  /** Return the hold body texture, preferring the highlighted variant. */
  holdBodyTexture(highlight: boolean): { source: HTMLImageElement; useful: UsefulRect } | null {
    const name =
      highlight && this.images.has("hold_body_highlight") ? "hold_body_highlight" : "hold_body";
    const source = this.images.get(name);
    return source ? { source, useful: this.bounds(name, source) } : null;
  }

  /** Return the hold head texture, preferring the highlighted variant. */
  holdHeadTexture(highlight: boolean): { source: HTMLImageElement; useful: UsefulRect } | null {
    const name =
      highlight && this.images.has("hold_head_highlight") ? "hold_head_highlight" : "hold_head";
    const source = this.images.get(name);
    return source ? { source, useful: this.bounds(name, source) } : null;
  }

  /** Return the hold tail cap texture, preferring the highlighted variant. */
  holdEndTexture(highlight: boolean): { source: HTMLImageElement; useful: UsefulRect } | null {
    const name =
      highlight && this.images.has("hold_end_highlight") ? "hold_end_highlight" : "hold_end";
    const source = this.images.get(name);
    return source ? { source, useful: this.bounds(name, source) } : null;
  }
  /** Release every generated tint canvas and reset source identity tracking. */
  private clearTints() {
    for (const canvas of this.tints.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.tints.clear();
    this.sourceIds = new WeakMap();
  }
  /** Mark the skin disposed and release decoded images, URLs, and tints. */
  dispose() {
    this.disposed = true;
    this.generation++;
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls = [];
    this.clearTints();
    this.images.clear();
    this.particleFrameCount = 0;
    this.baseImages.clear();
    this.useful.clear();
  }
  /** Filter a caller color down to a finite custom tint. */
  private color(color?: number[]): number[] | undefined {
    return isCustomTint(color) ? color : undefined;
  }

  /** Evict old tint canvases before adding one, bounding count and bytes. */
  private reserveTint(width: number, height: number) {
    let bytes = [...this.tints.values()].reduce(
      (total, canvas) => total + canvas.width * canvas.height * 4,
      0,
    );
    while (
      this.tints.size &&
      (this.tints.size >= 192 || bytes + width * height * 4 > 64 * 1024 * 1024)
    ) {
      const oldest = this.tints.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      const canvas = this.tints.get(oldest);
      if (!canvas) {
        this.tints.delete(oldest);
        continue;
      }
      bytes -= canvas.width * canvas.height * 4;
      canvas.width = 0;
      canvas.height = 0;
      this.tints.delete(oldest);
    }
  }

  /** Build the clamp, key, and CSS value for one tint plus its cache prefix. */
  private colorKey(
    prefix: string,
    color: number[],
  ): { r: number; g: number; b: number; key: string; css: string } {
    const r = Math.round(Math.max(0, Math.min(255, color[0] ?? 255)));
    const g = Math.round(Math.max(0, Math.min(255, color[1] ?? 255)));
    const b = Math.round(Math.max(0, Math.min(255, color[2] ?? 255)));
    const cached = this.colorKeys.get(color);
    if (cached && cached.r === r && cached.g === g && cached.b === b && cached.prefix === prefix) {
      return cached;
    }
    const css = `rgb(${r},${g},${b})`;
    const entry = { r, g, b, prefix, key: `${prefix}${r},${g},${b}`, css };
    this.colorKeys.set(color, entry);
    return entry;
  }

  /** Return a cached tint of a named skin image, generating it on first use. */
  tinted(name: string, color: number[], preserveGoldAccent = false): HTMLCanvasElement | null {
    const picture = this.images.get(name);
    if (!picture) {
      return null;
    }
    const { key, css } = this.colorKey(`${preserveGoldAccent ? "gold:" : ""}${name}:`, color);
    if (!this.tints.has(key)) {
      this.reserveTint(picture.naturalWidth, picture.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      context.drawImage(picture, 0, 0);
      const sourcePixels = preserveGoldAccent
        ? context.getImageData(0, 0, canvas.width, canvas.height).data
        : null;
      context.globalCompositeOperation = "multiply";
      context.fillStyle = css;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(picture, 0, 0);
      if (preserveGoldAccent) {
        const tintedPixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = tintedPixels.data;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          const red = sourcePixels?.[offset] ?? 0;
          const green = sourcePixels?.[offset + 1] ?? 0;
          const blue = sourcePixels?.[offset + 2] ?? 0;
          if (red >= 220 && green >= 160 && blue >= 55 && blue <= 120 && red - green <= 70) {
            pixels[offset] = red;
            pixels[offset + 1] = green;
            pixels[offset + 2] = blue;
          }
        }
        context.putImageData(tintedPixels, 0, 0);
      }
      this.tints.set(key, canvas);
    }
    return this.tints.get(key) ?? null;
  }

  /** Return a cached solid-color version of a skin image while preserving alpha. */
  colorized(name: string, color: number[]): HTMLCanvasElement | null {
    const picture = this.images.get(name);
    if (!picture) {
      return null;
    }
    const { key, css } = this.colorKey(`colorized:${name}:`, color);
    if (!this.tints.has(key)) {
      this.reserveTint(picture.naturalWidth, picture.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      context.drawImage(picture, 0, 0);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = css;
      context.fillRect(0, 0, canvas.width, canvas.height);
      this.tints.set(key, canvas);
    }
    return this.tints.get(key) ?? null;
  }

  /** Return a cached tint of an arbitrary source bitmap, or the source if white. */
  tintedSource(name: string, source: SkinSource | null, color: number[]): SkinSource | null {
    if (!source) {
      return null;
    }
    if (!this.sourceIds.has(source)) {
      this.sourceIds.set(source, this.nextSourceId++);
    }
    const { r, g, b, key, css } = this.colorKey(
      `source:${name}:${this.sourceIds.get(source)}:`,
      color,
    );
    if (r === 255 && g === 255 && b === 255) {
      return source;
    }
    if (!this.tints.has(key)) {
      const width = source.naturalWidth ?? source.width;
      const height = source.naturalHeight ?? source.height;
      if (!width || !height) {
        return source;
      }
      this.reserveTint(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        return source;
      }
      context.drawImage(source, 0, 0);
      context.globalCompositeOperation = "multiply";
      context.fillStyle = css;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(source, 0, 0);
      this.tints.set(key, canvas);
    }
    return this.tints.get(key) ?? null;
  }

  /** Draw one note head, using its highlighted texture and optional tint. */
  head(
    context: CanvasRenderingContext2D,
    type: number,
    horizontal: number,
    vertical: number,
    width: number,
    highlight = false,
    color?: NoteColor | null,
  ): boolean {
    const highlightedName = highlights[type];
    const name = highlight && this.images.has(highlightedName) ? highlightedName : names[type];
    const picture = this.images.get(name);
    if (!picture) {
      return false;
    }
    const box = alignedTexture(
      this.bounds(name, picture),
      picture.naturalWidth,
      picture.naturalHeight,
      horizontal,
      vertical,
      width,
    );
    const tintColor = color?.mode === "selected" ? color.color : this.color(color?.color);
    context.drawImage(
      tintColor
        ? color?.mode === "selected"
          ? (this.colorized(name, tintColor) ?? picture)
          : (this.tinted(name, tintColor, highlight) ?? picture)
        : picture,
      box.x,
      box.y,
      box.width,
      box.height,
    );
    return true;
  }

  /**
   * Draw a Hold texture mirrored on V about the logical centre.
   *
   * Hold art is authored head-down while `hold` draws along local +Y from head
   * to tail. The mirror pivots on the logical centre because the useful
   * rectangle may not be centred in the PNG.
   */
  private drawHoldTexture(
    context: CanvasRenderingContext2D,
    source: CanvasImageSource,
    box: { x: number; y: number; width: number; height: number },
    centerX: number,
    centerY: number,
  ): void {
    context.save();
    context.translate(centerX, centerY);
    context.scale(1, -1);
    context.drawImage(source, box.x - centerX, box.y - centerY, box.width, box.height);
    context.restore();
  }

  /**
   * Draw a Hold from its head to its tail, including body and both caps.
   *
   * `rotation` is the line's angle; without it, the Hold is drawn head-up or
   * flipped when the tail is above the head.
   */
  hold(
    context: CanvasRenderingContext2D,
    horizontal: number,
    head: number,
    tail: number,
    width: number,
    highlight = false,
    showHead = true,
    color?: NoteColor | null,
    rotation?: number,
    capScale = 1,
  ): boolean {
    const bodyName =
      highlight && this.images.has("hold_body_highlight") ? "hold_body_highlight" : "hold_body";
    const body = this.images.get(bodyName);
    const endName =
      highlight && this.images.has("hold_end_highlight") ? "hold_end_highlight" : "hold_end";
    const end = this.images.get(endName);
    if (!body) {
      return false;
    }
    const axisRotation = rotation ?? (tail >= head ? 0 : Math.PI);
    const headName =
      highlight && this.images.has("hold_head_highlight") ? "hold_head_highlight" : "hold_head";
    const headPicture = this.images.get(headName);
    const tintColor = color?.mode === "selected" ? color.color : this.color(color?.color);
    /** Resolve a tinted texture, or throw when the skin image is missing. */
    const texture = (name: string, preserveGoldAccent = false): CanvasImageSource => {
      const picture = tintColor
        ? color?.mode === "selected"
          ? this.colorized(name, tintColor)
          : this.tinted(name, tintColor, preserveGoldAccent)
        : this.images.get(name);
      if (!picture) {
        throw new Error(t("editor.skin.missingTexture", { name }));
      }
      return picture;
    };
    const bodyRect = this.bounds(bodyName, body);
    const span = Math.abs(tail - head);
    const endRect = end ? this.bounds(endName, end) : null;
    const headRect = headPicture ? this.bounds(headName, headPicture) : null;
    const headLength =
      showHead && headRect ? width * (headRect.height / headRect.width) * capScale : 0;
    const tailLength = endRect ? width * (endRect.height / endRect.width) * capScale : 0;
    const layout = holdLayout(0, 0, 0, span, headLength, tailLength, { x: 0, y: 1 });
    context.save();
    context.translate(horizontal, head);
    context.rotate(axisRotation);
    if (layout.bodyLength > 0) {
      const bodyCenter = (layout.bodyHead.y + layout.bodyTail.y) / 2;
      const bodyBox = alignedTextureBox(
        bodyRect,
        body.naturalWidth || body.width || bodyRect.width,
        body.naturalHeight || body.height || bodyRect.height,
        0,
        bodyCenter,
        width,
        layout.bodyLength,
      );
      this.drawHoldTexture(context, texture(bodyName, highlight), bodyBox, 0, bodyCenter);
    }
    if (end && layout.tailCapLength > 0) {
      const rect = this.bounds(endName, end);
      const endBox = alignedTextureBox(
        rect,
        end.naturalWidth || end.width || rect.width,
        end.naturalHeight || end.height || rect.height,
        0,
        layout.tailCap.y,
        width,
        layout.tailCapLength,
      );
      this.drawHoldTexture(context, texture(endName, highlight), endBox, 0, layout.tailCap.y);
    }
    if (showHead && headPicture && layout.headCapLength > 0) {
      const rect = this.bounds(headName, headPicture);
      const headBox = alignedTextureBox(
        rect,
        headPicture.naturalWidth || headPicture.width,
        headPicture.naturalHeight || headPicture.height,
        0,
        layout.headCap.y,
        width,
        layout.headCapLength,
      );
      this.drawHoldTexture(context, texture(headName, highlight), headBox, 0, layout.headCap.y);
    }
    context.restore();
    return true;
  }
}
