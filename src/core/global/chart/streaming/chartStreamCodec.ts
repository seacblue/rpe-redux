/**
 * Binary frame codec for chart streams. A frame is a little-endian length, one
 * kind byte, and a payload; payloads stay raw JSON so line text is never
 * re-encoded by the transport.
 */
import { CHART_FRAME, type ChartFrame, type ChartFrameKind } from "./chartStreamTypes.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode one frame with a length prefix and kind byte. */
export function encodeChartFrame(kind: ChartFrameKind, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, true);
  frame[4] = kind;
  frame.set(payload, 5);
  return frame;
}

/** Encode a JSON payload as one frame. */
export function encodeJsonFrame(kind: ChartFrameKind, value: unknown): Uint8Array {
  return encodeChartFrame(kind, encoder.encode(JSON.stringify(value)));
}

/** Encode one line frame: a u32 index followed by raw JSON text. */
export function encodeLineFrame(index: number, raw: string): Uint8Array {
  const text = encoder.encode(raw);
  const payload = new Uint8Array(4 + text.length);
  new DataView(payload.buffer).setUint32(0, index, true);
  payload.set(text, 4);
  return encodeChartFrame(CHART_FRAME.line, payload);
}

/** Encode one line batch: start, count, then a raw JSON array. */
export function encodeLinesFrame(start: number, count: number, raw: string): Uint8Array {
  const text = encoder.encode(raw);
  const payload = new Uint8Array(8 + text.length);
  const view = new DataView(payload.buffer);
  view.setUint32(0, start, true);
  view.setUint32(4, count, true);
  payload.set(text, 8);
  return encodeChartFrame(CHART_FRAME.lines, payload);
}

/** Read a line frame's index and raw JSON text. */
export function decodeLineFrame(frame: ChartFrame): { index: number; raw: string } {
  if (frame.kind !== CHART_FRAME.line || frame.payload.length < 4) {
    throw new Error("Not a line frame");
  }
  const index = new DataView(
    frame.payload.buffer,
    frame.payload.byteOffset,
    frame.payload.byteLength,
  ).getUint32(0, true);
  return { index, raw: decoder.decode(frame.payload.subarray(4)) };
}

/** Read a line batch frame's start, count, and raw JSON array text. */
export function decodeLinesFrame(frame: ChartFrame): {
  start: number;
  count: number;
  raw: string;
} {
  if (frame.kind !== CHART_FRAME.lines || frame.payload.length < 8) {
    throw new Error("Not a lines frame");
  }
  const view = new DataView(
    frame.payload.buffer,
    frame.payload.byteOffset,
    frame.payload.byteLength,
  );
  return {
    start: view.getUint32(0, true),
    count: view.getUint32(4, true),
    raw: decoder.decode(frame.payload.subarray(8)),
  };
}

/** Decode a JSON frame payload. */
export function decodeJsonFrame<T = unknown>(frame: ChartFrame): T {
  return JSON.parse(decoder.decode(frame.payload)) as T;
}

/** Incremental frame reader for a byte stream split at arbitrary boundaries. */
export class ChartFrameDecoder {
  private chunks: Uint8Array[] = [];
  private head = 0;
  private headOffset = 0;
  private buffered = 0;

  /** Feed one byte chunk and return every complete frame it completed. */
  push(chunk: Uint8Array): ChartFrame[] {
    if (!chunk.length) {
      return [];
    }
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    const frames: ChartFrame[] = [];
    while (this.buffered >= 5) {
      const length =
        (this.byteAt(0) |
          (this.byteAt(1) << 8) |
          (this.byteAt(2) << 16) |
          (this.byteAt(3) << 24)) >>>
        0;
      if (this.buffered < 5 + length) {
        break;
      }
      const kind = this.byteAt(4) as ChartFrameKind;
      const payload = this.readBytes(5 + length).subarray(5);
      frames.push({ kind, payload });
    }
    return frames;
  }

  /** Return any incomplete tail bytes for diagnostics. */
  get pendingBytes(): number {
    return this.buffered;
  }

  /** Read one buffered byte without consuming it. */
  private byteAt(offset: number): number {
    let remaining = offset;
    for (let index = this.head; index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      const start = index === this.head ? this.headOffset : 0;
      const available = chunk.length - start;
      if (remaining < available) {
        return chunk[start + remaining];
      }
      remaining -= available;
    }
    throw new RangeError("Frame buffer underflow");
  }

  /** Consume `length` buffered bytes and return one contiguous copy. */
  private readBytes(length: number): Uint8Array {
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const chunk = this.chunks[this.head];
      const available = chunk.length - this.headOffset;
      const take = Math.min(available, length - written);
      output.set(chunk.subarray(this.headOffset, this.headOffset + take), written);
      written += take;
      this.headOffset += take;
      if (this.headOffset >= chunk.length) {
        this.head += 1;
        this.headOffset = 0;
      }
    }
    this.buffered -= length;
    if (this.head > 64 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
    return output;
  }
}
