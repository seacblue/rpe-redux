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

/** Create empty reusable storage for grouped note uploads. */
export function createNoteBatchUploadState(): NoteBatchUploadState {
  return { groups: [], textures: [], offsets: [], staging: new Float32Array(0) };
}

/** Submit all groups in layer order and return the required GPU buffer capacity. */
export function submitNoteBatchGroups(
  gl: WebGL2RenderingContext,
  instanceBuffer: WebGLBuffer,
  state: NoteBatchUploadState,
  holdLayer: Iterable<SpriteGroup>,
  headLayer: Iterable<SpriteGroup>,
  selected: Iterable<SpriteGroup>,
  textureFor: (source: HTMLImageElement) => WebGLTexture | null,
  textureUniform: WebGLUniformLocation | null,
  attributes: readonly [number, number, number, number, number, number, number],
  instanceBufferCapacity: number,
): number {
  const { groups, textures, offsets } = state;
  groups.length = 0;
  textures.length = 0;
  offsets.length = 0;
  let totalFloats = 0;
  const collect = (source: Iterable<SpriteGroup>): void => {
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
  };
  collect(holdLayer);
  collect(headLayer);
  collect(selected);
  if (!totalFloats) {
    return instanceBufferCapacity;
  }
  if (state.staging.length < totalFloats) {
    state.staging = new Float32Array(Math.max(totalFloats, state.staging.length * 2));
  }
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const count = group.count * INSTANCE_STRIDE;
    state.staging.set(group.instances.subarray(0, count), offsets[index]);
  }
  const upload = state.staging.subarray(0, totalFloats);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  if (upload.byteLength > instanceBufferCapacity) {
    instanceBufferCapacity = upload.byteLength;
  }
  // Orphan the previous store before writing the next frame. Reusing a store
  // that the compositor still consumes can make bufferSubData wait for the
  // Intel driver even when the CPU-side upload is small.
  gl.bufferData(gl.ARRAY_BUFFER, instanceBufferCapacity, gl.STREAM_DRAW);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, upload);
  if (textureUniform) {
    gl.uniform1i(textureUniform, 0);
  }
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const baseOffset = offsets[index];
    gl.bindTexture(gl.TEXTURE_2D, textures[index]);
    bindInstanceAttribute(gl, attributes[0], 4, INSTANCE_STRIDE, 0, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[1], 1, INSTANCE_STRIDE, 4, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[2], 1, INSTANCE_STRIDE, 5, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[3], 4, INSTANCE_STRIDE, 6, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[4], 1, INSTANCE_STRIDE, 10, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[5], 3, INSTANCE_STRIDE, 11, 1, baseOffset);
    bindInstanceAttribute(gl, attributes[6], 1, INSTANCE_STRIDE, 14, 1, baseOffset);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count);
  }
  groups.length = 0;
  textures.length = 0;
  offsets.length = 0;
  return instanceBufferCapacity;
}
