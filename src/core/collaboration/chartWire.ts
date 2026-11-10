/**
 * Gzip wire encoding for collaboration chart payloads.
 *
 * Charts are JSON documents with heavy repetition, so gzip keeps a room
 * create, welcome, or snapshot far inside the WebSocket frame budget. The
 * encoding tag travels beside the payload so the client and both server
 * implementations decode the same bytes.
 */
import { base64ToBytes, bytesToBase64 } from "./digest.ts";

/** Wire encodings accepted for a chart payload. */
export type ChartWireEncoding = "gzip";

/** One compressed chart payload ready for a create, welcome, or snapshot. */
export interface EncodedChart {
  readonly chart: string;
  readonly chartEncoding: ChartWireEncoding;
}

/** Upper bound for one decompressed chart or change document. */
export const MAX_CHART_JSON_BYTES = 512 * 1024 * 1024;

/** Change batches above this size are gzipped on the wire. */
export const CHANGES_GZIP_THRESHOLD_BYTES = 16 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Run one compression stream over bytes and return the transformed bytes. */
async function transformBytes(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  return new Uint8Array(await new Response(source.pipeThrough(stream)).arrayBuffer());
}

/** Encode one chart object as base64 gzip JSON. */
export async function encodeChartWire(chart: unknown): Promise<EncodedChart> {
  return encodeChartJsonWire(JSON.stringify(chart));
}

/** Encode already serialized chart JSON, avoiding a second stringify. */
export async function encodeChartJsonWire(json: string): Promise<EncodedChart> {
  const bytes = encoder.encode(json);
  if (bytes.byteLength > MAX_CHART_JSON_BYTES) {
    throw new Error("The chart is too large to share.");
  }
  const compressed = await transformBytes(bytes, new CompressionStream("gzip"));
  return { chart: bytesToBase64(compressed), chartEncoding: "gzip" };
}

/**
 * Decode a chart payload when it carries a gzip encoding tag.
 *
 * Inline object payloads pass through unchanged, which keeps encrypted rooms
 * and older test fixtures on the existing path.
 */
export async function decodeChartWire(chart: unknown, encoding?: string): Promise<unknown> {
  if (encoding !== "gzip") {
    return chart;
  }
  if (typeof chart !== "string") {
    throw new Error("The compressed room chart is not text.");
  }
  return decodeGzipJson(chart);
}

/** Compress bytes with gzip for a change payload that is encrypted afterwards. */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return transformBytes(bytes, new CompressionStream("gzip"));
}

/** Expand gzip bytes and enforce the shared decompressed-size ceiling. */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const decompressed = await transformBytes(bytes, new DecompressionStream("gzip"));
  if (decompressed.byteLength > MAX_CHART_JSON_BYTES) {
    throw new Error("The compressed payload exceeds the supported size.");
  }
  return decompressed;
}

/** Encode JSON as a base64 gzip string for the plaintext change wire. */
export async function encodeGzipJson(json: string): Promise<string> {
  const compressed = await gzipBytes(encoder.encode(json));
  return bytesToBase64(compressed);
}

/** Decode a base64 gzip JSON string into its value. */
export async function decodeGzipJson(value: string): Promise<unknown> {
  const decompressed = await gunzipBytes(base64ToBytes(value));
  return JSON.parse(decoder.decode(decompressed));
}
