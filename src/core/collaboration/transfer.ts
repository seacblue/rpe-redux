/**
 * Chunk planning and assembly for content-addressed room assets.
 *
 * Upload and download use the same fixed-size chunks. Ranges are planned once
 * on the sender, and an assembler accepts out-of-order or duplicate download
 * chunks while rejecting a wrong index, wrong final length, or overflow. The
 * caller still verifies the final hash before publishing bytes.
 */
import { ASSET_CHUNK_BYTES } from "./assets.ts";

/** Largest JSON header accepted before a binary asset chunk. */
const MAX_BINARY_HEADER_BYTES = 16 * 1024;

/** One decoded binary asset message: JSON header plus raw chunk bytes. */
export interface BinaryAssetFrame {
  readonly header: Record<string, unknown>;
  readonly body: Uint8Array;
}

const binaryEncoder = new TextEncoder();
const binaryDecoder = new TextDecoder();

/** Build one binary asset frame: 4-byte header length, JSON header, raw bytes. */
export function encodeBinaryAssetFrame(
  header: Record<string, unknown>,
  body: Uint8Array,
): ArrayBuffer {
  const encoded = binaryEncoder.encode(JSON.stringify(header));
  if (encoded.byteLength === 0 || encoded.byteLength > MAX_BINARY_HEADER_BYTES) {
    throw new Error("Binary asset header is invalid");
  }
  const output = new Uint8Array(4 + encoded.byteLength + body.byteLength);
  new DataView(output.buffer).setUint32(0, encoded.byteLength, false);
  output.set(encoded, 4);
  output.set(body, 4 + encoded.byteLength);
  return output.buffer;
}

/** Split one binary asset frame into its JSON header and chunk bytes. */
export function decodeBinaryAssetFrame(frame: ArrayBuffer): BinaryAssetFrame {
  if (frame.byteLength < 4) {
    throw new Error("Binary asset frame is too short");
  }
  const view = new DataView(frame);
  const length = view.getUint32(0, false);
  if (length === 0 || length > MAX_BINARY_HEADER_BYTES || 4 + length > frame.byteLength) {
    throw new Error("Binary asset header is invalid");
  }
  const parsed: unknown = JSON.parse(binaryDecoder.decode(new Uint8Array(frame, 4, length)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Binary asset header is not JSON");
  }
  return {
    header: parsed as Record<string, unknown>,
    body: new Uint8Array(frame, 4 + length),
  };
}

/** One fixed-size slice of an asset. */
export interface AssetChunkRange {
  readonly index: number;
  readonly offset: number;
  /** Bytes in this slice; only the final one may be shorter than the chunk size. */
  readonly length: number;
}

/** Result of accepting one download chunk. */
export type ChunkWriteResult =
  | { readonly ok: true; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: "invalid_index" | "invalid_size" };

/** Coerce a size to a non-negative safe integer. */
function safeSize(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Coerce a chunk size to a positive safe integer. */
function safeChunkSize(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : ASSET_CHUNK_BYTES;
}

/**
 * Plan every chunk for an asset.
 *
 * The result is ordered by index and covers exactly `size` bytes. A zero-byte
 * asset returns an empty plan; the protocol rejects zero-byte uploads before
 * this point.
 */
export function assetChunkRanges(
  size: number,
  chunkSize = ASSET_CHUNK_BYTES,
): readonly AssetChunkRange[] {
  const total = safeSize(size);
  const width = safeChunkSize(chunkSize);
  const count = total === 0 ? 0 : Math.ceil(total / width);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const offset = index * width;
      return Object.freeze({
        index,
        offset,
        length: Math.min(width, total - offset),
      });
    }),
  );
}

/** Reassembles one download from indexed chunks. */
export class AssetAssembler {
  readonly size: number;
  readonly chunkSize: number;
  private readonly bytes: Uint8Array;
  private readonly received = new Set<number>();
  private acceptedBytes = 0;

  /** Allocate the final buffer; `size` and `chunkSize` are clamped to safe integers. */
  constructor(size: number, chunkSize = ASSET_CHUNK_BYTES) {
    this.size = safeSize(size);
    this.chunkSize = safeChunkSize(chunkSize);
    this.bytes = new Uint8Array(this.size);
  }

  /** Total number of chunks in the plan. */
  get totalChunks(): number {
    return this.size === 0 ? 0 : Math.ceil(this.size / this.chunkSize);
  }

  /** Number of distinct chunks accepted so far. */
  get receivedChunks(): number {
    return this.received.size;
  }

  /** Bytes accepted so far; duplicate chunks do not advance this value. */
  get receivedBytes(): number {
    return this.acceptedBytes;
  }

  /** Fraction of the asset accepted, from 0 to 1. */
  get progress(): number {
    return this.size === 0 ? 1 : this.acceptedBytes / this.size;
  }

  /** Whether every chunk has arrived. */
  get complete(): boolean {
    return this.acceptedBytes === this.size && this.received.size === this.totalChunks;
  }

  /** Indexes not yet accepted, in ascending order. */
  get missing(): readonly number[] {
    const missing: number[] = [];
    for (let index = 0; index < this.totalChunks; index += 1) {
      if (!this.received.has(index)) {
        missing.push(index);
      }
    }
    return missing;
  }

  /**
   * Accept one chunk.
   *
   * Duplicate chunks are reported but ignored. The final chunk must be exactly
   * the remaining length, and no chunk may extend past the declared size.
   */
  write(index: number, chunk: Uint8Array): ChunkWriteResult {
    if (!Number.isInteger(index) || index < 0 || index >= this.totalChunks) {
      return { ok: false, reason: "invalid_index" };
    }
    const expected = Math.min(this.chunkSize, this.size - index * this.chunkSize);
    if (chunk.byteLength !== expected) {
      return { ok: false, reason: "invalid_size" };
    }
    if (this.received.has(index)) {
      return { ok: true, duplicate: true };
    }
    this.bytes.set(chunk, index * this.chunkSize);
    this.received.add(index);
    this.acceptedBytes += chunk.byteLength;
    return { ok: true, duplicate: false };
  }

  /** The assembled buffer. Call only after `complete`; no copy is made. */
  result(): Uint8Array {
    return this.bytes;
  }
}
