/**
 * WebGL batch shared by the preview and timeline for drawing note and hold skins.
 * Geometry and hit testing stay on the CPU; the batch owns only its GL program,
 * buffers, and per-frame instance data.
 */
import { sizeCanvasBackingStore } from "./canvas2d.ts";
import { holdBodySegment, holdRenderRotation } from "./noteGeometry.ts";
import {
  bindInstanceAttribute,
  configureTextureSampling,
  createCornerBuffer,
  installContextLossHandlers,
  linkProgram,
} from "./webgl.ts";

/** A note's authored multiply tint or its selected-state recoloring. */
export type NoteColor = { mode: "tint" | "selected"; color: number[] };

/** One decoded skin bitmap and the useful rectangle inside it. */
interface TextureDescriptor {
  readonly source: HTMLImageElement;
  readonly useful: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Resolved Hold textures and skin-specific cap ratios for the current skin. */
interface HoldTextureSet {
  body: TextureDescriptor | null;
  end: TextureDescriptor | null;
  head: TextureDescriptor | null | undefined;
  endRatio: number;
  headRatio: number | undefined;
}

export interface NoteBatchSkin {
  /** Bumped whenever the skin swaps its decoded bitmaps. */
  readonly textureRevision?: number;
  noteTexture(type: number, highlight: boolean): TextureDescriptor | null;
  holdBodyTexture(highlight: boolean): TextureDescriptor | null;
  holdHeadTexture(highlight: boolean): TextureDescriptor | null;
  holdEndTexture(): TextureDescriptor | null;
}

/** Instances sharing one texture, with their packed vertex data. */
interface SpriteGroup {
  descriptor: TextureDescriptor;
  instances: Float32Array;
  count: number;
}

/** Floats per instance: transform, rotation, shear, UV rect, alpha, tint, and colorize mode. */
const INSTANCE_STRIDE = 15;

/** GPU batch for preview note skins; geometry and hit testing stay on the CPU. */
export class NoteBatch {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;
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
  private width = 0;
  private height = 0;
  private groups = new Map<HTMLImageElement, SpriteGroup>();
  /** Selected instances render as a foreground pass so overlap cannot hide the selection. */
  private selectedGroups = new Map<HTMLImageElement, SpriteGroup>();
  private descriptorSkin: NoteBatchSkin | null = null;
  private descriptorRevision: number | undefined;
  private readonly descriptorCache = new Map<string, TextureDescriptor | null>();
  private readonly holdDescriptorSets: [HoldTextureSet | null, HoldTextureSet | null] = [
    null,
    null,
  ];
  private readonly rotationCache = new Map<number, readonly [number, number]>();
  private instanceBufferCapacity = 0;
  private active = false;
  private prewarmQueue: HTMLImageElement[] = [];
  private prewarmTimer: number | ReturnType<typeof setTimeout> | null = null;
  private prewarmIdle = false;
  private contextLost = false;
  private uninstallContextLoss: (() => void) | null = null;

  /** Create the batch for one canvas; without WebGL2 every submit is a no-op. */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false });
    if (!this.gl) {
      return;
    }
    this.uninstallContextLoss = installContextLossHandlers(this.canvas, {
      onLost: this.handleContextLost,
      onRestored: this.handleContextRestored,
    });
    this.initializeResources();
  }

  /** Whether the batch cannot submit GPU work until its context is restored. */
  isContextLost(): boolean {
    return this.contextLost || this.gl?.isContextLost() === true;
  }

  /** Prevent the default loss handling and stop submitting GPU work. */
  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
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
    this.selectedGroups.clear();
    this.descriptorCache.clear();
    this.clearHoldDescriptorCache();
    this.instanceBufferCapacity = 0;
  };

  /** Recreate every GPU object after the browser restores the context. */
  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.descriptorSkin = null;
    this.descriptorRevision = undefined;
    this.descriptorCache.clear();
    this.clearHoldDescriptorCache();
    this.groups.clear();
    this.selectedGroups.clear();
    this.textures.clear();
    this.instanceBufferCapacity = 0;
    this.initializeResources();
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
    }
    enqueue(skin.holdEndTexture());
    this.schedulePrewarm();
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
   * Callers must follow with `addHead`/`addHold` and `finish`.
   */
  begin(
    width: number,
    height: number,
    skin: NoteBatchSkin | null,
    clip?: { left: number; top: number; width: number; height: number },
  ): void {
    this.width = width;
    this.height = height;
    if (this.descriptorSkin !== skin || this.descriptorRevision !== skin?.textureRevision) {
      this.descriptorSkin = skin;
      this.descriptorRevision = skin?.textureRevision;
      this.resetTextureCache();
    }
    for (const group of [...this.groups.values(), ...this.selectedGroups.values()]) {
      group.count = 0;
    }
    this.rotationCache.clear();
    if (this.isContextLost()) {
      this.contextLost = true;
      this.active = false;
      return;
    }
    this.active = Boolean(this.gl && this.program && this.instanceBuffer && skin);
    if (!this.gl) {
      return;
    }
    const backing = sizeCanvasBackingStore(this.canvas, { width, height });
    this.gl.viewport(0, 0, backing.width, backing.height);
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (clip) {
      this.gl.enable(this.gl.SCISSOR_TEST);
      this.gl.scissor(
        Math.max(0, Math.round(clip.left * backing.ratio)),
        Math.max(0, Math.round((height - clip.top - clip.height) * backing.ratio)),
        Math.max(0, Math.round(clip.width * backing.ratio)),
        Math.max(0, Math.round(clip.height * backing.ratio)),
      );
    } else {
      this.gl.disable(this.gl.SCISSOR_TEST);
    }
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
    const descriptor = this.descriptor(
      skin,
      `note:${type}:${highlight ? 1 : 0}`,
      () => skin?.noteTexture(type, highlight) ?? null,
    );
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
    );
  }

  /** Queue a Hold body, tail cap, and optional head cap as one sprite set. */
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
  ): boolean {
    if (!this.active || this.isContextLost()) {
      return false;
    }
    const textures = this.holdTextures(skin, highlight);
    const body = textures.body;
    const end = textures.end;
    let head = showHead ? textures.head : null;
    if (showHead && head === undefined) {
      head = this.descriptor(
        skin,
        `hold-head:${highlight ? 1 : 0}`,
        () => skin?.holdHeadTexture(highlight) ?? null,
      );
      textures.head = head;
    }
    if (!body || !end || (showHead && !head)) {
      return false;
    }
    // A Hold with no visible body (speed zero, or a tail already at the line)
    // carries cap textures. It has no head-to-tail vector, so its rotation
    // comes from the line's angle.
    const rotation = holdRenderRotation(headX, headY, tailX, tailY, fallbackRotation);
    if (showHead && textures.headRatio === undefined) {
      textures.headRatio = head ? head.useful.height / head.useful.width : 0;
    }
    const headLength = head ? width * (textures.headRatio ?? 0) : 0;
    const tailLength = width * textures.endRatio;
    const segment = holdBodySegment(headX, headY, tailX, tailY, headLength, tailLength);
    const bodyLength = Math.hypot(segment.tailX - segment.headX, segment.tailY - segment.headY);
    const bodyAdded = this.add(
      body,
      (segment.headX + segment.tailX) / 2,
      (segment.headY + segment.tailY) / 2,
      width,
      bodyLength,
      rotation,
      0,
      alpha,
      true,
      color,
    );
    const endAdded = this.add(
      end,
      tailX,
      tailY,
      width,
      tailLength,
      rotation,
      0,
      alpha,
      true,
      color,
    );
    const headAdded = head
      ? this.add(head, headX, headY, width, headLength, rotation, 0, alpha, true, color)
      : true;
    return (bodyLength <= 0.5 || bodyAdded) && endAdded && headAdded;
  }

  /** Upload the queued instance data and draw every group. */
  finish(): void {
    if (!this.active || this.isContextLost() || !this.gl || !this.program || !this.instanceBuffer) {
      return;
    }
    const gl = this.gl;
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
    const drawGroups = (groups: Iterable<SpriteGroup>): void => {
      for (const group of groups) {
        if (!group.count) {
          continue;
        }
        const texture = this.textureFor(group.descriptor.source);
        if (!texture) {
          continue;
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (this.textureUniform) {
          gl.uniform1i(this.textureUniform, 0);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        const upload = group.instances.subarray(0, group.count * INSTANCE_STRIDE);
        if (upload.byteLength > this.instanceBufferCapacity) {
          this.instanceBufferCapacity = upload.byteLength;
          gl.bufferData(gl.ARRAY_BUFFER, this.instanceBufferCapacity, gl.STREAM_DRAW);
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
        bindInstanceAttribute(gl, this.transformLocation, 4, INSTANCE_STRIDE, 0);
        bindInstanceAttribute(gl, this.rotationLocation, 1, INSTANCE_STRIDE, 4);
        bindInstanceAttribute(gl, this.shearLocation, 1, INSTANCE_STRIDE, 5);
        bindInstanceAttribute(gl, this.uvLocation, 4, INSTANCE_STRIDE, 6);
        bindInstanceAttribute(gl, this.alphaLocation, 1, INSTANCE_STRIDE, 10);
        bindInstanceAttribute(gl, this.tintLocation, 3, INSTANCE_STRIDE, 11);
        bindInstanceAttribute(gl, this.colorizeLocation, 1, INSTANCE_STRIDE, 14);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count);
      }
    };
    drawGroups(this.groups.values());
    // Keep the selection in the foreground without introducing a canvas overlay.
    drawGroups(this.selectedGroups.values());
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Release every GL object and cached texture owned by the batch. */
  dispose(): void {
    this.uninstallContextLoss?.();
    this.uninstallContextLoss = null;
    if (!this.gl) {
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
      for (const texture of this.textures.values()) {
        this.gl.deleteTexture(texture);
      }
    }
    this.textures.clear();
    this.clear();
    this.groups.clear();
    this.selectedGroups.clear();
    this.descriptorCache.clear();
    this.clearHoldDescriptorCache();
    this.instanceBufferCapacity = 0;
    this.program = null;
    this.cornerBuffer = null;
    this.instanceBuffer = null;
    this.descriptorSkin = null;
    this.active = false;
  }

  /** Cancel queued uploads, reset instance counts, and clear the canvas. */
  clear(): void {
    this.cancelPrewarm();
    for (const group of [...this.groups.values(), ...this.selectedGroups.values()]) {
      group.count = 0;
    }
    if (this.gl && !this.isContextLost()) {
      this.gl.disable(this.gl.SCISSOR_TEST);
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  /** Drop descriptors and GPU textures after the skin replaces its bitmaps. */
  private resetTextureCache(): void {
    this.cancelPrewarm();
    this.descriptorCache.clear();
    this.clearHoldDescriptorCache();
    this.groups.clear();
    this.selectedGroups.clear();
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
    const end = this.descriptor(skin, "hold-end", () => skin?.holdEndTexture() ?? null);
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

  /**
   * Write one aligned, rotated quad into its texture group's instance buffer.
   *
   * This is the hot path, so it avoids temporary objects. Returns false when the
   * instance cannot be drawn.
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
    flipV = false,
    color?: NoteColor | null,
  ): boolean {
    if (!this.active || this.isContextLost() || !width || !height) {
      return false;
    }
    const sourceWidth = descriptor.source.naturalWidth || descriptor.source.width;
    const sourceHeight = descriptor.source.naturalHeight || descriptor.source.height;
    if (!sourceWidth || !sourceHeight) {
      return false;
    }
    const colorize = color?.mode === "selected";
    const groups = colorize ? this.selectedGroups : this.groups;
    let group = groups.get(descriptor.source);
    if (!group) {
      group = {
        descriptor,
        instances: new Float32Array(INSTANCE_STRIDE * 64),
        count: 0,
      };
      groups.set(descriptor.source, group);
    }
    group.descriptor = descriptor;
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
    return texture;
  }
}
