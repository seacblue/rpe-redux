/** Upload and draw note sprite groups while preserving their paint order. */
import { INSTANCE_STRIDE, type SpriteGroup } from "./noteSpriteGroups.ts";
import { bindInstanceAttribute } from "./webgl.ts";

/** Reusable staging arrays for one note batch's grouped instance upload. */
export interface NoteBatchUploadState {
  readonly groups: SpriteGroup[];
  readonly textures: WebGLTexture[];
  readonly offsets: number[];
  staging: Float32Array;
}

/** Counters produced while submitting one grouped note batch. */
export interface NoteBatchUploadMetrics {
  groupCount: number;
  instanceCount: number;
  bufferSubDataCalls: number;
  bufferSubDataBytes: number;
  drawCalls: number;
  textureBinds: number;
  maxInstancesPerGroup: number;
}

/** Upload result needed by the caller for capacity and diagnostics state. */
export interface NoteBatchUploadResult {
  instanceBufferCapacity: number;
  metrics: NoteBatchUploadMetrics;
}

/** Packed texture groups whose offsets remain stable until the next upload. */
export interface PackedNoteGroups {
  readonly groups: SpriteGroup[];
  readonly textures: WebGLTexture[];
  readonly offsets: number[];
  readonly totalFloats: number;
}

/** Create empty reusable storage for grouped note uploads. */
export function createNoteBatchUploadState(): NoteBatchUploadState {
  return { groups: [], textures: [], offsets: [], staging: new Float32Array(0) };
}

/**
 * Size the streamed instance store for one frame's upload.
 *
 * The store follows the current frame rather than the largest frame ever
 * recorded, so a single dense frame cannot raise every later frame's allocation.
 * It only shrinks below half the previous capacity, which keeps a dense/sparse
 * alternation on one reused store.
 */
export function nextBufferCapacity(requiredBytes: number, currentCapacity: number): number {
  if (requiredBytes <= 0) {
    return 0;
  }
  let capacity = Math.max(4096, currentCapacity || 0);
  if (requiredBytes > capacity || requiredBytes * 2 < capacity) {
    capacity = 4096;
    while (capacity < requiredBytes) {
      capacity *= 2;
    }
  }
  return capacity;
}

/** Collect drawable groups once so a retained buffer can replay the same offsets. */
export function collectNoteBatchGroups(
  source: Iterable<SpriteGroup>,
  textureFor: (source: HTMLImageElement) => WebGLTexture | null,
  reuse?: NoteBatchUploadState,
): PackedNoteGroups {
  const groups = reuse?.groups ?? [];
  const textures = reuse?.textures ?? [];
  const offsets = reuse?.offsets ?? [];
  groups.length = 0;
  textures.length = 0;
  offsets.length = 0;
  let totalFloats = 0;
  for (const group of source) {
    if (!group.count) {
      continue;
    }
    const texture = textureFor(group.descriptor.source);
    if (!texture) {
      continue;
    }
    groups.push(group);
    textures.push(texture);
    offsets.push(totalFloats);
    totalFloats += group.count * INSTANCE_STRIDE;
  }
  return { groups, textures, offsets, totalFloats };
}

/** Collect several paint layers into one reusable packed group list. */
export function collectNoteBatchGroupSources(
  sources: readonly Iterable<SpriteGroup>[],
  textureFor: (source: HTMLImageElement) => WebGLTexture | null,
  reuse?: NoteBatchUploadState,
): PackedNoteGroups {
  const groups = reuse?.groups ?? [];
  const textures = reuse?.textures ?? [];
  const offsets = reuse?.offsets ?? [];
  groups.length = 0;
  textures.length = 0;
  offsets.length = 0;
  let totalFloats = 0;
  for (const source of sources) {
    for (const group of source) {
      if (!group.count) {
        continue;
      }
      const texture = textureFor(group.descriptor.source);
      if (!texture) {
        continue;
      }
      groups.push(group);
      textures.push(texture);
      offsets.push(totalFloats);
      totalFloats += group.count * INSTANCE_STRIDE;
    }
  }
  return { groups, textures, offsets, totalFloats };
}

/** Collect the four fixed preview paint layers without allocating a source list. */
export function collectNoteBatchGroupLayers(
  first: Iterable<SpriteGroup>,
  second: Iterable<SpriteGroup>,
  third: Iterable<SpriteGroup>,
  fourth: Iterable<SpriteGroup>,
  textureFor: (source: HTMLImageElement) => WebGLTexture | null,
  reuse?: NoteBatchUploadState,
): PackedNoteGroups {
  const groups = reuse?.groups ?? [];
  const textures = reuse?.textures ?? [];
  const offsets = reuse?.offsets ?? [];
  groups.length = 0;
  textures.length = 0;
  offsets.length = 0;
  let totalFloats = 0;
  for (const source of [first, second, third, fourth]) {
    for (const group of source) {
      if (!group.count) {
        continue;
      }
      const texture = textureFor(group.descriptor.source);
      if (!texture) {
        continue;
      }
      groups.push(group);
      textures.push(texture);
      offsets.push(totalFloats);
      totalFloats += group.count * INSTANCE_STRIDE;
    }
  }
  return { groups, textures, offsets, totalFloats };
}

/** Draw already uploaded groups without touching their instance data. */
export function drawPackedNoteGroups(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  packed: PackedNoteGroups,
  textureUniform: WebGLUniformLocation | null,
  attributes: readonly [number, number, number, number, number, number, number],
): NoteBatchUploadMetrics {
  const metrics: NoteBatchUploadMetrics = {
    groupCount: packed.groups.length,
    instanceCount: packed.groups.reduce((total, group) => total + group.count, 0),
    bufferSubDataCalls: 0,
    bufferSubDataBytes: 0,
    drawCalls: packed.groups.length,
    textureBinds: packed.groups.length,
    maxInstancesPerGroup: packed.groups.reduce(
      (maximum, group) => Math.max(maximum, group.count),
      0,
    ),
  };
  if (textureUniform) {
    gl.uniform1i(textureUniform, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  for (let index = 0; index < packed.groups.length; index++) {
    const group = packed.groups[index];
    const baseOffset = packed.offsets[index] ?? 0;
    gl.bindTexture(gl.TEXTURE_2D, packed.textures[index] ?? null);
    bindInstanceAttribute(gl, attributes[0], 4, INSTANCE_STRIDE, 0, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[1], 1, INSTANCE_STRIDE, 4, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[2], 1, INSTANCE_STRIDE, 5, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[3], 4, INSTANCE_STRIDE, 6, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[4], 1, INSTANCE_STRIDE, 10, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[5], 3, INSTANCE_STRIDE, 11, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[6], 1, INSTANCE_STRIDE, 14, 1, baseOffset);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count);
  }
  return metrics;
}

/** Upload one packed group set, then draw it in its retained paint order. */
export function uploadPackedNoteGroups(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  state: NoteBatchUploadState,
  packed: PackedNoteGroups,
  textureUniform: WebGLUniformLocation | null,
  attributes: readonly [number, number, number, number, number, number, number],
  instanceBufferCapacity: number,
): NoteBatchUploadResult {
  const metrics: NoteBatchUploadMetrics = {
    groupCount: packed.groups.length,
    instanceCount: packed.groups.reduce((total, group) => total + group.count, 0),
    bufferSubDataCalls: 0,
    bufferSubDataBytes: 0,
    drawCalls: packed.groups.length,
    textureBinds: packed.groups.length,
    maxInstancesPerGroup: packed.groups.reduce(
      (maximum, group) => Math.max(maximum, group.count),
      0,
    ),
  };
  if (!packed.totalFloats) {
    return { instanceBufferCapacity, metrics };
  }
  if (state.staging.length < packed.totalFloats) {
    state.staging = new Float32Array(Math.max(packed.totalFloats, state.staging.length * 2));
  }
  for (let index = 0; index < packed.groups.length; index++) {
    const group = packed.groups[index];
    const count = group.count * INSTANCE_STRIDE;
    state.staging.set(group.instances.subarray(0, count), packed.offsets[index] ?? 0);
  }
  const upload = state.staging.subarray(0, packed.totalFloats);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  const targetCapacity = nextBufferCapacity(upload.byteLength, instanceBufferCapacity);
  instanceBufferCapacity = targetCapacity;
  gl.bufferData(gl.ARRAY_BUFFER, instanceBufferCapacity, gl.STREAM_DRAW);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
  metrics.bufferSubDataCalls = 1;
  metrics.bufferSubDataBytes = upload.byteLength;
  return {
    instanceBufferCapacity,
    metrics: {
      ...metrics,
      ...drawPackedNoteGroups(gl, instanceBuffer, packed, textureUniform, attributes),
      bufferSubDataCalls: 1,
      bufferSubDataBytes: upload.byteLength,
    },
  };
}

/** Add two bounded upload metric records without allocating a new group list. */
export function mergeNoteBatchUploadMetrics(
  left: NoteBatchUploadMetrics,
  right: NoteBatchUploadMetrics,
): NoteBatchUploadMetrics {
  return {
    groupCount: left.groupCount + right.groupCount,
    instanceCount: left.instanceCount + right.instanceCount,
    bufferSubDataCalls: left.bufferSubDataCalls + right.bufferSubDataCalls,
    bufferSubDataBytes: left.bufferSubDataBytes + right.bufferSubDataBytes,
    drawCalls: left.drawCalls + right.drawCalls,
    textureBinds: left.textureBinds + right.textureBinds,
    maxInstancesPerGroup: Math.max(left.maxInstancesPerGroup, right.maxInstancesPerGroup),
  };
}

/** Submit all groups in layer order and return capacity plus bounded counters. */
export function submitNoteBatchGroups(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  state: NoteBatchUploadState,
  lineLayer: Iterable<SpriteGroup>,
  holdLayer: Iterable<SpriteGroup>,
  headLayer: Iterable<SpriteGroup>,
  selected: Iterable<SpriteGroup>,
  textureFor: (source: HTMLImageElement) => WebGLTexture | null,
  textureUniform: WebGLUniformLocation | null,
  attributes: readonly [number, number, number, number, number, number, number],
  instanceBufferCapacity: number,
): NoteBatchUploadResult {
  const packed = collectNoteBatchGroupLayers(
    lineLayer,
    holdLayer,
    headLayer,
    selected,
    textureFor,
    state,
  );
  return uploadPackedNoteGroups(
    gl,
    instanceBuffer,
    state,
    packed,
    textureUniform,
    attributes,
    instanceBufferCapacity,
  );
}
