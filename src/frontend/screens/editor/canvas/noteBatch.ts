/**
 * WebGL batch shared by the preview and timeline for drawing note and hold skins.
 * Geometry and hit testing stay on the CPU; the batch owns only its GL program,
 * buffers, and per-frame instance data.
 */
/* eslint-disable max-lines -- the batch keeps texture, instance, and context-loss ownership together. */
import { canvasPixelRatio } from "./canvas2d.ts";
import type { WebGlRenderBackend } from "./renderBackend.ts";
import { tryCreateWebGl2Backend } from "./renderBackend.ts";
import { createHoldLayoutScratch, holdLayoutInto, holdRenderRotation } from "./noteGeometry.ts";
import {
  collectNoteBatchGroups,
  createNoteBatchUploadState,
  drawPackedNoteGroups,
  mergeNoteBatchUploadMetrics,
  submitNoteBatchGroups,
  uploadPackedNoteGroups,
  type PackedNoteGroups,
} from "./noteBatchUpload.ts";
import { NoteBatchDiagnostics } from "./noteBatchDiagnostics.ts";
import type { RenderSurface } from "../../../../core/diagnostics/renderMetrics.ts";
import {
  HEAD_PAINT_LAYER,
  HOLD_PAINT_LAYER,
  INSTANCE_STRIDE,
  NoteSpriteGroups,
  notePaintLayer,
  type NoteColor,
  type NotePaintLayer,
  type SpriteGroup,
  type TextureDescriptor,
} from "./noteSpriteGroups.ts";
import { configureTextureSampling, createCornerBuffer, linkProgram } from "./webgl.ts";

const ROTATION_CACHE_LIMIT = 512;
/** Note type slots resolved without building a cache key on every note. */
const NOTE_TYPE_SLOTS = 5;
/** Slot order: type × 2 + (highlight ? 1 : 0). */
const NOTE_SLOT_COUNT = NOTE_TYPE_SLOTS * 2;
/** Resolved Hold textures and skin-specific cap ratios for the current skin. */
interface HoldTextureSet {
  body: TextureDescriptor | null;
  end: TextureDescriptor | null;
  head: TextureDescriptor | null | undefined;
  endRatio: number;
  headRatio: number | undefined;
}

/**
 * Note textures addressed by `type * 2 + (highlight ? 1 : 0)`.
 *
 * The table is a plain array so a paint pass can submit thousands of notes
 * without a cache key, a closure, or a Map lookup per note.
 */
export type NoteTextureTable = readonly (TextureDescriptor | null | undefined)[];

export interface NoteBatchSkin {
  /** Bumped whenever the skin swaps its decoded bitmaps. */
  readonly textureRevision?: number;
  noteTexture(type: number, highlight: boolean): TextureDescriptor | null;
  holdBodyTexture(highlight: boolean): TextureDescriptor | null;
  holdHeadTexture(highlight: boolean): TextureDescriptor | null;
  holdEndTexture(highlight: boolean): TextureDescriptor | null;
  /** Optional default judge-line texture, batched beneath notes when available. */
  lineTexture?: () => TextureDescriptor | null;
}

/**
 * GPU batch for preview note skins; geometry and hit testing stay on the CPU.
 *
 * Holds paint beneath Tap/Drag/Flick heads (see `notePaintLayer`); selected
 * instances paint last so an overlap cannot hide the selection.
 */
export class NoteBatch {
  private readonly canvas: HTMLCanvasElement;
  private readonly diagnostics: NoteBatchDiagnostics;
  private readonly backend: WebGlRenderBackend | null;
  private readonly removeSharedLifecycle: (() => void) | null;
  private get gl(): WebGL2RenderingContext | null {
    return this.backend?.gl as WebGL2RenderingContext | null;
  }
  private program: WebGLProgram | null = null;
  private cornerBuffer: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private readonly textures = new Map<HTMLImageElement, WebGLTexture>();
  private resolution: WebGLUniformLocation | null = null;
  private textureUniform: WebGLUniformLocation | null = null;
  private cornerLocation = -1;
  private transformLocation = -1;
  private rotationLocation = -1;
  private shearLocation = -1;
  private uvLocation = -1;
  private alphaLocation = -1;
  private tintLocation = -1;
  private colorizeLocation = -1;
  private readonly instanceAttributes = [-1, -1, -1, -1, -1, -1, -1] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  private width = 0;
  private height = 0;
  private readonly groups = new NoteSpriteGroups();
  private descriptorSkin: NoteBatchSkin | null = null;
  private descriptorRevision: number | undefined;
  private readonly descriptorCache = new Map<string, TextureDescriptor | null>();
  /** Note textures by `type * 2 + highlight`; empty until the skin resolves them. */
  private readonly noteTextures: (TextureDescriptor | null | undefined)[] = new Array(
    NOTE_SLOT_COUNT,
  ).fill(undefined);
  /** Set once any note slot is resolved, so a hot frame can skip the slot check. */
  private noteTextureSlotsReady = false;
  private readonly holdDescriptorSets: [HoldTextureSet | null, HoldTextureSet | null] = [
    null,
    null,
  ];
  private readonly holdDirection = { x: 0, y: 1 };
  private readonly holdLayout = createHoldLayoutScratch();
  /** Reuse note rotation trigonometry across frames; add() keeps it bounded. */
  private readonly rotationCache = new Map<number, readonly [number, number]>();
  private readonly uploadState = createNoteBatchUploadState();
  private readonly staticLineUploadState = createNoteBatchUploadState();
  private instanceBufferCapacity = 0;
  private staticLineBufferCapacity = 0;
  private staticLineBuffer: WebGLBuffer | null = null;
  private staticLineGroups: PackedNoteGroups | null = null;
  private staticLineBufferValid = false;
  /** Whether the line groups contain a reusable static judge-line layer. */
  private retainedLineBatchValid = false;
  private active = false;
  private prewarmQueue: HTMLImageElement[] = [];
  private prewarmTimer: number | ReturnType<typeof setTimeout> | null = null;
  private prewarmIdle = false;
  private contextLost = false;
  /** Create the batch for one canvas; without WebGL2 every submit is a no-op. */
  constructor(
    canvas: HTMLCanvasElement,
    surface: RenderSurface = "preview",
    sharedBackend: WebGlRenderBackend | null = null,
  ) {
    this.canvas = canvas;
    this.diagnostics = new NoteBatchDiagnostics(surface);
    this.backend =
      sharedBackend ??
      tryCreateWebGl2Backend(
        canvas,
        { alpha: true, antialias: false, depth: false },
        {
          onLost: this.handleContextLost,
          onRestored: this.handleContextRestored,
        },
      );
    this.removeSharedLifecycle = sharedBackend
      ? sharedBackend.addLifecycle({
          onLost: this.handleContextLost,
          onRestored: this.handleContextRestored,
        })
      : null;
    this.reportState();
    if (!this.backend) {
      return;
    }
    this.initializeResources();
    this.reportState();
  }

  /** Publish the bounded WebGL and skin-cache state for diagnostics. */
  private reportState(): void {
    this.diagnostics.state(
      this.gl,
      this.contextLost,
      this.active,
      this.textures.size,
      this.prewarmQueue.length,
    );
  }

  /** Whether the batch cannot submit GPU work until its context is restored. */
  isContextLost(): boolean {
    return this.contextLost || this.gl?.isContextLost() === true;
  }

  /** Prevent the default loss handling and stop submitting GPU work. */
  private readonly handleContextLost = (): void => {
    this.diagnostics.context("lost");
    this.contextLost = true;
    this.active = false;
    // Some hosts keep the last presented pixels after a loss. Resizing the
    // backing store clears the overlay so the canvas fallback is not doubled.
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      this.canvas.width = Math.max(1, this.canvas.width);
    }
    this.cancelPrewarm();
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.staticLineBuffer = null;
    this.resolution = null;
    this.textureUniform = null;
    this.cornerLocation = -1;
    this.transformLocation = -1;
    this.rotationLocation = -1;
    this.shearLocation = -1;
    this.uvLocation = -1;
    this.alphaLocation = -1;
    this.tintLocation = -1;
    this.colorizeLocation = -1;
    this.textures.clear();
    this.groups.clear();
    this.retainedLineBatchValid = false;
    this.clearDescriptorCaches();
    this.instanceBufferCapacity = 0;
    this.staticLineBufferCapacity = 0;
    this.staticLineGroups = null;
    this.staticLineBufferValid = false;
    this.reportState();
  };

  /** Recreate every GPU object after the browser restores the context. */
  private readonly handleContextRestored = (): void => {
    this.diagnostics.context("restored");
    this.contextLost = false;
    this.descriptorSkin = null;
    this.descriptorRevision = undefined;
    this.clearDescriptorCaches();
    this.groups.clear();
    this.retainedLineBatchValid = false;
    this.textures.clear();
    this.instanceBufferCapacity = 0;
    this.staticLineBufferCapacity = 0;
    this.staticLineGroups = null;
    this.staticLineBufferValid = false;
    this.initializeResources();
    this.reportState();
  };

  /** Compile the shaders and allocate the buffers and attribute slots. */
  private initializeResources(): void {
    const gl = this.gl;
    if (!gl) {
      return;
    }
    try {
      this.program = linkProgram(
        gl,
        `#version 300 es
      in vec2 a_corner;
      in vec4 a_transform;
      in float a_rotation;
      in float a_shear;
      in vec4 a_uv;
      in float a_alpha;
      in vec3 a_tint;
      in float a_colorize;
      uniform vec2 u_resolution;
      out vec2 v_uv;
      out float v_alpha;
      out vec3 v_tint;
      out float v_colorize;
      void main() {
        vec2 local = (a_corner - vec2(0.5)) * a_transform.zw;
        local.x += a_shear * local.y;
        float c = cos(a_rotation);
        float s = sin(a_rotation);
        vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
        vec2 pixel = a_transform.xy + rotated;
        vec2 clip = pixel / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
        v_alpha = a_alpha;
        v_tint = a_tint;
        v_colorize = a_colorize;
      }
    `,
        `#version 300 es
      precision mediump float;
      uniform sampler2D u_texture;
      in vec2 v_uv;
      in float v_alpha;
      in vec3 v_tint;
      in float v_colorize;
      out vec4 outColor;
      void main() {
        vec4 texel = texture(u_texture, v_uv);
        float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        vec3 selected = v_tint * (0.65 + 0.35 * luminance);
        vec3 color = mix(texel.rgb * v_tint, selected, v_colorize);
        outColor = vec4(color, texel.a * v_alpha);
      }
    `,
      );
    } catch {
      this.program = null;
    }
    this.cornerBuffer = createCornerBuffer(gl);
    this.instanceBuffer = gl.createBuffer();
    this.staticLineBuffer = gl.createBuffer();
    this.resolution = this.program ? gl.getUniformLocation(this.program, "u_resolution") : null;
    this.textureUniform = this.program ? gl.getUniformLocation(this.program, "u_texture") : null;
    this.cornerLocation = this.program ? gl.getAttribLocation(this.program, "a_corner") : -1;
    this.transformLocation = this.program ? gl.getAttribLocation(this.program, "a_transform") : -1;
    this.rotationLocation = this.program ? gl.getAttribLocation(this.program, "a_rotation") : -1;
    this.shearLocation = this.program ? gl.getAttribLocation(this.program, "a_shear") : -1;
    this.uvLocation = this.program ? gl.getAttribLocation(this.program, "a_uv") : -1;
    this.alphaLocation = this.program ? gl.getAttribLocation(this.program, "a_alpha") : -1;
    this.tintLocation = this.program ? gl.getAttribLocation(this.program, "a_tint") : -1;
    this.colorizeLocation = this.program ? gl.getAttribLocation(this.program, "a_colorize") : -1;
    this.instanceAttributes[0] = this.transformLocation;
    this.instanceAttributes[1] = this.rotationLocation;
    this.instanceAttributes[2] = this.shearLocation;
    this.instanceAttributes[3] = this.uvLocation;
    this.instanceAttributes[4] = this.alphaLocation;
    this.instanceAttributes[5] = this.tintLocation;
    this.instanceAttributes[6] = this.colorizeLocation;
    gl.enable(gl.BLEND);
    // Keep the color source-over equation while accumulating straight alpha.
    // Using the same factors for both channels squares semi-transparent sprite
    // alpha, which makes Hold caps visibly darker than their Canvas fallback.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Whether the current frame can submit notes through the GPU batch. */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Upload skin textures while the editor is idle, one texture per idle slice.
   *
   * Replacing the skin resets the descriptor and texture caches so stale
   * bitmaps are never reused.
   */
  prewarm(skin: NoteBatchSkin | null): void {
    this.cancelPrewarm();
    if (!skin) {
      this.descriptorSkin = null;
      this.descriptorRevision = undefined;
      this.resetTextureCache();
      return;
    }
    if (this.descriptorSkin !== skin || this.descriptorRevision !== skin.textureRevision) {
      this.descriptorSkin = skin;
      this.descriptorRevision = skin.textureRevision;
      this.resetTextureCache();
    }
    if (!this.gl || this.isContextLost()) {
      return;
    }
    const seen = new Set<HTMLImageElement>();
    /** Queue one texture source at most once per prewarm pass. */
    const enqueue = (descriptor: TextureDescriptor | null): void => {
      if (!descriptor || seen.has(descriptor.source) || this.textures.has(descriptor.source)) {
        return;
      }
      seen.add(descriptor.source);
      this.prewarmQueue.push(descriptor.source);
    };
    for (const highlight of [false, true]) {
      for (const type of [1, 2, 3, 4]) {
        enqueue(skin.noteTexture(type, highlight));
      }
      enqueue(skin.holdBodyTexture(highlight));
      enqueue(skin.holdHeadTexture(highlight));
      enqueue(skin.holdEndTexture(highlight));
    }
    enqueue(skin.lineTexture?.() ?? null);
    this.schedulePrewarm();
    this.reportState();
  }

  /** Schedule the next queued texture upload without blocking the frame. */
  private schedulePrewarm(): void {
    if (this.prewarmTimer !== null || !this.prewarmQueue.length) {
      return;
    }
    const step = (): void => {
      this.prewarmTimer = null;
      const source = this.prewarmQueue.shift();
      if (source && this.gl && !this.isContextLost()) {
        this.textureFor(source);
      }
      this.schedulePrewarm();
    };
    if (typeof globalThis.requestIdleCallback === "function") {
      this.prewarmIdle = true;
      this.prewarmTimer = globalThis.requestIdleCallback(step, { timeout: 500 });
    } else {
      this.prewarmIdle = false;
      this.prewarmTimer = globalThis.setTimeout(step, 0);
    }
  }

  /** Drop pending uploads and cancel their idle or timeout callback. */
  private cancelPrewarm(): void {
    this.prewarmQueue.length = 0;
    if (this.prewarmTimer === null) {
      return;
    }
    if (this.prewarmIdle && typeof globalThis.cancelIdleCallback === "function") {
      globalThis.cancelIdleCallback(this.prewarmTimer as number);
    } else {
      globalThis.clearTimeout(this.prewarmTimer);
    }
    this.prewarmTimer = null;
    this.prewarmIdle = false;
  }

  /**
   * Start a frame: size the canvas, clear it, and set the optional scissor clip.
   *
   * `pixelRatioScale` changes only the GPU layer's backing-store density; its
   * logical coordinates and paint order remain unchanged. Callers must follow
   * with `addHead`/`addHold` and `finish`.
   */
  begin(
    width: number,
    height: number,
    skin: NoteBatchSkin | null,
    clip?: { left: number; top: number; width: number; height: number },
    pixelRatioScale = 1,
    retainLineBatch = false,
  ): boolean {
    this.width = width;
    this.height = height;
    return this.markActive(skin, clip, pixelRatioScale, width, height, retainLineBatch);
  }

  /**
   * Resolve every note texture once so a paint pass can submit without lookups.
   *
   * A dense frame submits thousands of notes through one skin; the returned
   * table turns the per-note descriptor resolution into an array read.
   */
  prepareNoteTextures(skin: NoteBatchSkin | null): NoteTextureTable | null {
    if (!skin) {
      return null;
    }
    if (!this.noteTextureSlotsReady) {
      for (let type = 0; type < NOTE_TYPE_SLOTS; type++) {
        for (let highlight = 0; highlight < 2; highlight++) {
          this.noteTextures[type * 2 + highlight] = skin.noteTexture(type, highlight === 1) ?? null;
        }
      }
      this.noteTextureSlotsReady = true;
    }
    return this.noteTextures;
  }

  /** Set the skin, refresh its caches, and answer whether the batch can paint. */
  private markActive(
    skin: NoteBatchSkin | null,
    clip: { left: number; top: number; width: number; height: number } | undefined,
    pixelRatioScale: number,
    width: number,
    height: number,
    retainLineBatch: boolean,
  ): boolean {
    let preserveLines = retainLineBatch && this.retainedLineBatchValid;
    if (this.descriptorSkin !== skin || this.descriptorRevision !== skin?.textureRevision) {
      this.descriptorSkin = skin;
      this.descriptorRevision = skin?.textureRevision;
      this.resetTextureCache();
      preserveLines = false;
    }
    this.groups.reset(preserveLines);
    this.retainedLineBatchValid = preserveLines;
    if (!preserveLines) {
      this.staticLineGroups = null;
      this.staticLineBufferValid = false;
    }
    if (this.isContextLost()) {
      this.contextLost = true;
      this.active = false;
      this.reportState();
      this.retainedLineBatchValid = false;
      return false;
    }
    this.active = Boolean(this.backend?.isUsable() && this.program && this.instanceBuffer && skin);
    if (!this.backend) {
      this.reportState();
      this.retainedLineBatchValid = false;
      return false;
    }
    const safeScale = Number.isFinite(pixelRatioScale)
      ? Math.max(0.5, Math.min(1, pixelRatioScale))
      : 1;
    const backing = this.backend.resize(
      { width, height },
      Math.max(1, canvasPixelRatio() * safeScale),
    );
    if (!this.backend.begin(true)) {
      this.active = false;
      this.reportState();
      this.retainedLineBatchValid = false;
      return false;
    }
    const gl = this.gl;
    if (!gl) {
      this.active = false;
      this.reportState();
      this.retainedLineBatchValid = false;
      return false;
    }
    gl.disable(gl.SCISSOR_TEST);
    if (clip) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.max(0, Math.round(clip.left * backing.ratio)),
        Math.max(0, Math.round((height - clip.top - clip.height) * backing.ratio)),
        Math.max(0, Math.round(clip.width * backing.ratio)),
        Math.max(0, Math.round(clip.height * backing.ratio)),
      );
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    this.reportState();
    return preserveLines && this.groups.hasLineInstances();
  }

  /** Mark the current line instances as reusable for a later static frame. */
  retainLineBatch(): void {
    this.retainedLineBatchValid = this.active && this.groups.hasLineInstances();
  }

  /** Queue one note head; returns false when its texture is unavailable. */
  addHead(
    skin: NoteBatchSkin | null,
    type: number,
    highlight: boolean,
    centerX: number,
    centerY: number,
    width: number,
    rotation: number,
    shear: number,
    alpha: number,
    color?: NoteColor | null,
  ): boolean {
    if (!this.active || this.isContextLost()) {
      return false;
    }
    const descriptor = this.noteTexture(skin, type, highlight);
    if (!descriptor) {
      return false;
    }
    const height = (width * descriptor.useful.height) / descriptor.useful.width;
    return this.add(
      descriptor,
      centerX,
      centerY,
      width,
      height,
      rotation,
      shear,
      alpha,
      false,
      color,
      notePaintLayer(type),
    );
  }

  /**
   * Queue one note head from an already prepared texture table.
   *
   * This is the per-note entry point for a paint pass: the table replaces the
   * type-slot lookup and the skin method call that `addHead` performs.
   */
  addHeadSlotted(
    table: NoteTextureTable,
    type: number,
    highlight: boolean,
    centerX: number,
    centerY: number,
    width: number,
    rotation: number,
    shear: number,
    alpha: number,
    color?: NoteColor | null,
  ): boolean {
    if (!this.active || this.isContextLost()) {
      return false;
    }
    const slot = type * 2 + (highlight ? 1 : 0);
    const descriptor = slot >= 0 && slot < NOTE_SLOT_COUNT ? (table[slot] ?? null) : null;
    if (!descriptor) {
      return false;
    }
    const height = (width * descriptor.useful.height) / descriptor.useful.width;
    return this.add(
      descriptor,
      centerX,
      centerY,
      width,
      height,
      rotation,
      shear,
      alpha,
      false,
      color,
      notePaintLayer(type),
    );
  }

  /**
   * Resolve one note texture from its type slot.
   *
   * The slot table replaces a template-literal cache key and a closure per note,
   * which was the largest remaining per-note cost in a dense frame. Slots are
   * filled on first use and cleared whenever the skin bitmap set changes.
   */
  private noteTexture(
    skin: NoteBatchSkin | null,
    type: number,
    highlight: boolean,
  ): TextureDescriptor | null {
    if (!skin) {
      return null;
    }
    const slot = type * 2 + (highlight ? 1 : 0);
    if (slot < 0 || slot >= NOTE_SLOT_COUNT) {
      return skin.noteTexture(type, highlight) ?? null;
    }
    const cached = this.noteTextures[slot];
    if (cached !== undefined) {
      return cached;
    }
    const descriptor = skin.noteTexture(type, highlight) ?? null;
    this.noteTextures[slot] = descriptor;
    this.noteTextureSlotsReady = true;
    return descriptor;
  }

  /**
   * Queue a Hold body, tail cap, and optional head cap as one sprite set.
   *
   * `drawBody` false paints the two caps only; an inverted Hold uses that to
   * match Phira, which rejects a Hold body whose longitudinal size is negative.
   */
  addHold(
    skin: NoteBatchSkin | null,
    highlight: boolean,
    headX: number,
    headY: number,
    tailX: number,
    tailY: number,
    width: number,
    showHead: boolean,
    alpha: number,
    color?: NoteColor | null,
    fallbackRotation = 0,
    capScale = 1,
    drawBody = true,
  ): boolean {
    if (!this.active || this.isContextLost()) {
      return false;
    }
    const textures = this.holdTextures(skin, highlight);
    const { body, end } = textures;
    let head = showHead ? textures.head : null;
    if (showHead && head === undefined) {
      head = this.descriptor(
        skin,
        `hold-head:${highlight ? 1 : 0}`,
        () => skin?.holdHeadTexture(highlight) ?? null,
      );
      textures.head = head;
    }
    if ((drawBody && !body) || !end || (showHead && !head)) {
      return false;
    }
    // A Hold with no visible body (speed zero, or a tail already at the line)
    // carries cap textures. Its caps extend along the line's own axis, which is
    // also why a negative painted span keeps them upright instead of mirroring
    // them with the reversed head-to-tail vector.
    const rotation = drawBody
      ? holdRenderRotation(headX, headY, tailX, tailY, fallbackRotation)
      : fallbackRotation;
    if (showHead && textures.headRatio === undefined) {
      textures.headRatio = head ? head.useful.height / head.useful.width : 0;
    }
    const headLength = head ? width * (textures.headRatio ?? 0) * capScale : 0;
    const tailLength = width * textures.endRatio * capScale;
    this.holdDirection.x = -Math.sin(rotation);
    this.holdDirection.y = Math.cos(rotation);
    const layout = holdLayoutInto(
      this.holdLayout,
      headX,
      headY,
      tailX,
      tailY,
      headLength,
      tailLength,
      this.holdDirection,
    );
    let bodyAdded = true;
    if (drawBody && body) {
      bodyAdded =
        layout.bodyLength <= 0.5 ||
        this.add(
          body,
          (layout.bodyHead.x + layout.bodyTail.x) / 2,
          (layout.bodyHead.y + layout.bodyTail.y) / 2,
          width,
          layout.bodyLength,
          rotation,
          0,
          alpha,
          true,
          color,
          HOLD_PAINT_LAYER,
        );
    }
    return (
      bodyAdded &&
      this.addHoldCap(
        end,
        layout.tailCap.x,
        layout.tailCap.y,
        width,
        layout.tailCapLength,
        rotation,
        alpha,
        color,
      ) &&
      this.addHoldCap(
        head,
        layout.headCap.x,
        layout.headCap.y,
        width,
        layout.headCapLength,
        rotation,
        alpha,
        color,
      )
    );
  }

  /** Queue one Hold cap, or report success when that cap is not drawn. */
  private addHoldCap(
    descriptor: TextureDescriptor | null | undefined,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    alpha: number,
    color?: NoteColor | null,
  ): boolean {
    return descriptor
      ? this.add(
          descriptor,
          centerX,
          centerY,
          width,
          height,
          rotation,
          0,
          alpha,
          true,
          color,
          HOLD_PAINT_LAYER,
        )
      : true;
  }

  /** Upload the queued instance data and draw every group in layer order. */
  finish(): void {
    if (!this.groups.hasInstances()) {
      return;
    }
    if (this.gl && !this.isContextLost()) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    this.submit(null, this.width, this.height);
  }

  /** Draw queued notes into a framebuffer owned by the shared shader context. */
  finishToFramebuffer(
    gl: WebGL2RenderingContext,
    framebuffer: WebGLFramebuffer,
    width: number,
    height: number,
  ): boolean {
    if (this.gl !== gl) {
      return false;
    }
    if (!this.groups.hasInstances()) {
      return true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    return this.submit(framebuffer, width, height);
  }

  /** Submit the current instance groups to the selected framebuffer. */
  private submit(_framebuffer: WebGLFramebuffer | null, width: number, height: number): boolean {
    if (!this.active || this.isContextLost() || !this.gl || !this.program || !this.instanceBuffer) {
      this.diagnostics.submit({
        groupCount: 0,
        instanceCount: 0,
        bufferSubDataCalls: 0,
        bufferSubDataBytes: 0,
        drawCalls: 0,
        textureBinds: 0,
        maxInstancesPerGroup: 0,
      });
      return false;
    }
    const gl = this.gl;
    gl.enable(gl.BLEND);
    // The alpha channel needs the source factor ONE; otherwise a translucent
    // Hold cap writes `alpha * alpha` into the overlay texture.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    if (this.resolution) {
      gl.uniform2f(this.resolution, this.width, this.height);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    if (this.cornerLocation >= 0) {
      gl.enableVertexAttribArray(this.cornerLocation);
      gl.vertexAttribPointer(this.cornerLocation, 2, gl.FLOAT, false, 0, 0);
    }
    const textureFor = (source: HTMLImageElement): WebGLTexture | null => this.textureFor(source);
    const emptyMetrics = {
      groupCount: 0,
      instanceCount: 0,
      bufferSubDataCalls: 0,
      bufferSubDataBytes: 0,
      drawCalls: 0,
      textureBinds: 0,
      maxInstancesPerGroup: 0,
    };
    let metrics = emptyMetrics;
    let staticLinesDrawn = false;
    if (this.groups.hasLineInstances() && this.staticLineBuffer) {
      if (!this.staticLineBufferValid) {
        const packed = collectNoteBatchGroups(
          this.groups.line.values(),
          textureFor,
          this.staticLineUploadState,
        );
        const uploaded = uploadPackedNoteGroups(
          gl,
          this.staticLineBuffer,
          this.staticLineUploadState,
          packed,
          this.textureUniform,
          this.instanceAttributes,
          this.staticLineBufferCapacity,
        );
        this.staticLineBufferCapacity = uploaded.instanceBufferCapacity;
        this.staticLineGroups = packed;
        this.staticLineBufferValid = packed.totalFloats > 0;
        staticLinesDrawn = this.staticLineBufferValid;
        metrics = mergeNoteBatchUploadMetrics(metrics, uploaded.metrics);
      }
      if (!staticLinesDrawn && this.staticLineBufferValid && this.staticLineGroups) {
        metrics = mergeNoteBatchUploadMetrics(
          metrics,
          drawPackedNoteGroups(
            gl,
            this.staticLineBuffer,
            this.staticLineGroups,
            this.textureUniform,
            this.instanceAttributes,
          ),
        );
      }
    }
    // Ascending layer order keeps Holds beneath Tap/Drag/Flick heads; the
    // selection paints last so an overlap cannot hide the selection. Static
    // judge lines use a separate buffer and never enter this upload.
    const result = submitNoteBatchGroups(
      gl,
      this.instanceBuffer,
      this.uploadState,
      this.groups.dynamicLine.values(),
      this.groups.layers[HOLD_PAINT_LAYER].values(),
      this.groups.layers[HEAD_PAINT_LAYER].values(),
      this.groups.selected.values(),
      textureFor,
      this.textureUniform,
      this.instanceAttributes,
      this.instanceBufferCapacity,
    );
    this.instanceBufferCapacity = result.instanceBufferCapacity;
    metrics = mergeNoteBatchUploadMetrics(metrics, result.metrics);
    this.diagnostics.submit(metrics);
    gl.disable(gl.SCISSOR_TEST);
    this.reportState();
    return true;
  }

  /** Release every GL object and cached texture owned by the batch. */
  dispose(): void {
    this.removeSharedLifecycle?.();
    if (!this.gl) {
      if (!this.removeSharedLifecycle) {
        this.backend?.dispose();
      }
      return;
    }
    if (!this.isContextLost()) {
      if (this.program) {
        this.gl.deleteProgram(this.program);
      }
      if (this.cornerBuffer) {
        this.gl.deleteBuffer(this.cornerBuffer);
      }
      if (this.instanceBuffer) {
        this.gl.deleteBuffer(this.instanceBuffer);
      }
      if (this.staticLineBuffer) {
        this.gl.deleteBuffer(this.staticLineBuffer);
      }
      for (const texture of this.textures.values()) {
        this.gl.deleteTexture(texture);
      }
    }
    this.textures.clear();
    this.clear();
    this.groups.clear();
    this.retainedLineBatchValid = false;
    this.clearDescriptorCaches();
    this.instanceBufferCapacity = 0;
    this.staticLineBufferCapacity = 0;
    this.staticLineBuffer = null;
    this.staticLineGroups = null;
    this.staticLineBufferValid = false;
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.descriptorSkin = null;
    this.active = false;
    if (!this.removeSharedLifecycle) {
      this.backend?.dispose();
    }
    this.reportState();
  }

  /** Cancel queued uploads, reset instance counts, and clear the canvas. */
  clear(): void {
    this.cancelPrewarm();
    this.groups.reset();
    this.retainedLineBatchValid = false;
    this.staticLineGroups = null;
    this.staticLineBufferValid = false;
    if (this.gl && !this.isContextLost()) {
      this.gl.disable(this.gl.SCISSOR_TEST);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  /** Drop descriptors and GPU textures after the skin replaces its bitmaps. */
  private resetTextureCache(): void {
    this.cancelPrewarm();
    this.clearDescriptorCaches();
    this.groups.clear();
    this.retainedLineBatchValid = false;
    this.staticLineGroups = null;
    this.staticLineBufferValid = false;
    if (this.gl && !this.isContextLost()) {
      for (const texture of this.textures.values()) {
        this.gl.deleteTexture(texture);
      }
    }
    this.textures.clear();
  }

  /** Resolve one texture descriptor, caching misses until the skin changes. */
  private descriptor(
    skin: NoteBatchSkin | null,
    key: string,
    resolve: () => TextureDescriptor | null,
  ): TextureDescriptor | null {
    if (!skin) {
      return null;
    }
    const cached = this.descriptorCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const descriptor = resolve();
    this.descriptorCache.set(key, descriptor);
    return descriptor;
  }

  /** Resolve the Hold body and tail textures once per skin/highlight variant. */
  private holdTextures(skin: NoteBatchSkin | null, highlight: boolean): HoldTextureSet {
    const slot = highlight ? 1 : 0;
    const cached = this.holdDescriptorSets[slot];
    if (cached) {
      return cached;
    }
    const end = this.descriptor(
      skin,
      `hold-end:${highlight ? 1 : 0}`,
      () => skin?.holdEndTexture(highlight) ?? null,
    );
    const result: HoldTextureSet = {
      body: this.descriptor(
        skin,
        `hold-body:${highlight ? 1 : 0}`,
        () => skin?.holdBodyTexture(highlight) ?? null,
      ),
      end,
      head: undefined,
      endRatio: end ? end.useful.height / end.useful.width : 0,
      headRatio: undefined,
    };
    this.holdDescriptorSets[slot] = result;
    return result;
  }

  /** Clear skin-derived Hold descriptors after a skin or context change. */
  private clearHoldDescriptorCache(): void {
    this.holdDescriptorSets[0] = null;
    this.holdDescriptorSets[1] = null;
  }

  /** Drop every skin-derived descriptor, including the note type slots. */
  private clearDescriptorCaches(): void {
    this.descriptorCache.clear();
    this.clearHoldDescriptorCache();
    this.noteTextures.fill(undefined);
    this.noteTextureSlotsReady = false;
  }

  /**
   * Write one aligned, rotated quad into its texture group's instance buffer.
   *
   * `layer` selects the paint layer (see `notePaintLayer`); a selected instance
   * always joins the foreground pass. This is the hot path, so it avoids
   * temporary objects. Returns false when the instance cannot be drawn.
   */
  private add(
    descriptor: TextureDescriptor,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    shear: number,
    alpha: number,
    flipV: boolean,
    color: NoteColor | null | undefined,
    layer: NotePaintLayer,
  ): boolean {
    const colorize = color?.mode === "selected";
    return this.writeInstance(
      this.groups.group(descriptor, layer, colorize),
      centerX,
      centerY,
      width,
      height,
      rotation,
      shear,
      alpha,
      flipV,
      color,
    );
  }

  /** Queue one judge-line quad beneath every note and Hold. */
  addLine(
    descriptor: TextureDescriptor,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    alpha: number,
    color?: NoteColor | null,
    retainStatic = true,
  ): boolean {
    if (!this.active || this.isContextLost() || width <= 0 || height <= 0) {
      return false;
    }
    return this.writeInstance(
      retainStatic ? this.groups.lineGroup(descriptor) : this.groups.dynamicLineGroup(descriptor),
      centerX,
      centerY,
      width,
      height,
      rotation,
      0,
      alpha,
      false,
      color,
    );
  }

  /**
   * Write one aligned, rotated quad into an already selected texture group.
   *
   * This is the hot path, so it avoids temporary objects. Returns false when the
   * instance cannot be drawn.
   */
  private writeInstance(
    group: SpriteGroup,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    shear: number,
    alpha: number,
    flipV: boolean,
    color: NoteColor | null | undefined,
  ): boolean {
    if (!this.active || this.isContextLost() || !width || !height) {
      return false;
    }
    const descriptor = group.descriptor;
    const sourceWidth = descriptor.source.naturalWidth || descriptor.source.width;
    const sourceHeight = descriptor.source.naturalHeight || descriptor.source.height;
    if (!sourceWidth || !sourceHeight) {
      return false;
    }
    const colorize = color?.mode === "selected";
    const offset = group.count * INSTANCE_STRIDE;
    if (offset + INSTANCE_STRIDE > group.instances.length) {
      const next = new Float32Array(group.instances.length * 2);
      next.set(group.instances);
      group.instances = next;
    }
    const usefulWidth = descriptor.useful.width;
    const usefulHeight = descriptor.useful.height;
    if (usefulWidth <= 0 || usefulHeight <= 0) {
      return false;
    }
    const channels = color?.color;
    const tint =
      channels &&
      channels.length >= 3 &&
      Number.isFinite(channels[0]) &&
      Number.isFinite(channels[1]) &&
      Number.isFinite(channels[2])
        ? channels
        : null;
    // Keep this hot path allocation-free: the aligned quad is written directly
    // into the instance buffer for every note.
    const scaleX = width / usefulWidth;
    const scaleY = height / usefulHeight;
    const quadWidth = sourceWidth * scaleX;
    const quadHeight = sourceHeight * scaleY;
    const centerOffsetY = -height / 2 - descriptor.useful.y * scaleY + quadHeight / 2;
    const centerOffsetX = -width / 2 - descriptor.useful.x * scaleX + quadWidth / 2;
    const quadOffsetY = flipV && centerOffsetY !== 0 ? -centerOffsetY : centerOffsetY;
    const u0 = 0;
    const v0 = flipV ? 1 : 0;
    const u1 = 1;
    const v1 = flipV ? 0 : 1;
    let rotationValues = this.rotationCache.get(rotation);
    if (!rotationValues) {
      rotationValues = [Math.cos(rotation), Math.sin(rotation)];
      if (this.rotationCache.size >= ROTATION_CACHE_LIMIT) {
        this.rotationCache.clear();
      }
      this.rotationCache.set(rotation, rotationValues);
    }
    const [cosine, sine] = rotationValues;
    const localOffsetX = centerOffsetX + shear * quadOffsetY;
    const offsetX = localOffsetX * cosine - quadOffsetY * sine;
    const offsetY = localOffsetX * sine + quadOffsetY * cosine;
    group.instances[offset] = centerX + offsetX;
    group.instances[offset + 1] = centerY + offsetY;
    group.instances[offset + 2] = quadWidth;
    group.instances[offset + 3] = quadHeight;
    group.instances[offset + 4] = rotation;
    group.instances[offset + 5] = shear;
    group.instances[offset + 6] = u0;
    group.instances[offset + 7] = v0;
    group.instances[offset + 8] = u1;
    group.instances[offset + 9] = v1;
    group.instances[offset + 10] = alpha;
    // Canvas tinting is a multiply, applied per instance so each note colour does
    // not need its own tinted texture.
    group.instances[offset + 11] = tint ? Math.max(0, Math.min(255, tint[0] ?? 255)) / 255 : 1;
    group.instances[offset + 12] = tint ? Math.max(0, Math.min(255, tint[1] ?? 255)) / 255 : 1;
    group.instances[offset + 13] = tint ? Math.max(0, Math.min(255, tint[2] ?? 255)) / 255 : 1;
    group.instances[offset + 14] = colorize ? 1 : 0;
    group.count += 1;
    return true;
  }

  /** Return the cached GL texture for an image, uploading it on first use. */
  private textureFor(source: HTMLImageElement): WebGLTexture | null {
    if (!this.gl || this.isContextLost()) {
      return null;
    }
    const cached = this.textures.get(source);
    if (cached) {
      return cached;
    }
    const texture = this.gl.createTexture();
    if (!texture) {
      this.diagnostics.upload(false);
      return null;
    }
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    configureTextureSampling(this.gl);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      source,
    );
    this.textures.set(source, texture);
    this.diagnostics.upload(true);
    this.reportState();
    return texture;
  }
}
