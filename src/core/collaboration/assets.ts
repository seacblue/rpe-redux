/** Content-addressed asset rules shared by the client and room server. */

import type { ChartChange } from "./changes.ts";

/** The largest single audio/image blob a room accepts. */
export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
/** Base64 chunks stay comfortably below the WebSocket message cap. */
export const ASSET_CHUNK_BYTES = 256 * 1024;
/** Maximum number of assets a room retains. */
export const MAX_ROOM_ASSETS = 512;
/** Maximum total bytes of assets a room retains. */
export const MAX_ROOM_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
/** SHA-256 in lowercase hexadecimal. */
export const ASSET_HASH = /^[0-9a-f]{64}$/;
/** Maximum resource-name length counted in Unicode code points. */
export const MAX_ASSET_NAME_CODE_POINTS = 240;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  webm: "audio/webm",
});

const ALLOWED_MIME = new Set([...Object.values(MIME_BY_EXTENSION), "application/octet-stream"]);

/** Normalize a chart resource name and reject paths that can escape a room. */
export function sanitizeAssetName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().replaceAll("\\", "/");
  const characters = [...name];
  if (
    !name ||
    characters.length > MAX_ASSET_NAME_CODE_POINTS ||
    name.startsWith("/") ||
    /^[a-z]:\//i.test(name) ||
    name.split("/").some((part) => part === ".." || part === "") ||
    characters.some((character) => character.charCodeAt(0) < 32)
  ) {
    return null;
  }
  return name;
}

/** Derive a conservative MIME type from the file extension. */
export function mimeForAsset(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Whether a value is one of the MIME types a room accepts. */
export function isAllowedAssetMime(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_MIME.has(value);
}

/** Cheap magic check so a mislabeled HTML/script file never reaches an image decoder. */
export function matchesAssetMagic(mime: string, bytes: Uint8Array): boolean {
  /** Whether the bytes start with the given signature. */
  const starts = (...prefix: number[]): boolean =>
    prefix.every((byte, index) => bytes[index] === byte);
  /** Whether an ASCII marker appears at the given offset. */
  const ascii = (offset: number, value: string): boolean =>
    [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return ascii(0, "GIF8");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/bmp":
      return ascii(0, "BM");
    case "image/avif":
      return ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"));
    case "audio/mpeg":
      return ascii(0, "ID3") || starts(0xff, 0xfb) || starts(0xff, 0xf3) || starts(0xff, 0xf2);
    case "audio/ogg":
      return ascii(0, "OggS");
    case "audio/wav":
      return ascii(0, "RIFF") && ascii(8, "WAVE");
    case "audio/flac":
      return ascii(0, "fLaC");
    case "audio/mp4":
      return ascii(4, "ftyp");
    case "audio/opus":
      return ascii(0, "OggS");
    case "audio/webm":
      return starts(0x1a, 0x45, 0xdf, 0xa3);
    default:
      return true;
  }
}

/** Number of fixed-size chunks an asset of `size` bytes occupies. */
export function assetChunkCount(size: number): number {
  return size <= 0 ? 0 : Math.ceil(size / ASSET_CHUNK_BYTES);
}

/** Collect every resource name the chart can reference, including note hit sounds. */
export function chartAssetNames(chart: unknown): string[] {
  if (!chart || typeof chart !== "object") {
    return [];
  }
  const record = chart as {
    META?: Record<string, unknown>;
    judgeLineList?: unknown;
  };
  const names = new Set<string>();
  /** Add a sanitized resource name when the value is a usable string. */
  const add = (value: unknown): void => {
    if (typeof value === "string") {
      const name = sanitizeAssetName(value);
      if (name) {
        names.add(name);
      }
    }
  };
  add(record.META?.song);
  add(record.META?.background);
  add(record.META?.illustration);
  if (Array.isArray(record.judgeLineList)) {
    for (const line of record.judgeLineList) {
      if (!line || typeof line !== "object") {
        continue;
      }
      const entry = line as { Texture?: unknown; attachUI?: unknown; notes?: unknown };
      add(entry.Texture);
      add(entry.attachUI);
      if (Array.isArray(entry.notes)) {
        for (const note of entry.notes) {
          if (note && typeof note === "object") {
            add((note as { hitSound?: unknown }).hitSound);
            add((note as { hitsound?: unknown }).hitsound);
          }
        }
      }
    }
  }
  return [...names];
}

const ASSET_REFERENCE_FIELDS = new Set([
  "song",
  "background",
  "illustration",
  "Texture",
  "attachUI",
  "hitSound",
  "hitsound",
]);

/** Decode one JSON-pointer path token for resource-change classification. */
function decodeChangeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Whether a chart change can alter the set of resources the chart references. */
export function chartChangesMayAffectAssets(changes: readonly ChartChange[]): boolean {
  return changes.some((change) => {
    if (!change.path) {
      return true;
    }
    const tokens = change.path.slice(1).split("/").map(decodeChangeToken);
    if (tokens.some((token) => ASSET_REFERENCE_FIELDS.has(token))) {
      return true;
    }
    if (tokens[0] === "META") {
      return tokens.length === 1;
    }
    if (tokens[0] !== "judgeLineList") {
      return false;
    }
    const relative = tokens.slice(1);
    if (relative.length === 0 || change.op !== "set") {
      return true;
    }
    const last = relative.at(-1) ?? "";
    return last === "notes" || last.startsWith("$") || /^\d+$/.test(last);
  });
}
