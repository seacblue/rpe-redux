/**
 * Package-relative media assets declared by an Extension manifest.
 *
 * The manifest only stores names and relative paths. Bytes stay host-side and
 * cross the sandbox bridge on demand, either as a byte array or a data URL.
 */
import type { TrustedExtensionManifest } from "./extensionContract.ts";

export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_ASSET_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_ASSETS = 64;

const ASSET_MIME: Readonly<Record<string, string>> = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
});

/** Whether a manifest asset path is one bounded relative media file. */
export function isSafeAssetPath(value: string): boolean {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return false;
  }
  const extension = segments.at(-1)?.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && Object.hasOwn(ASSET_MIME, extension);
}

/** The media type for one declared asset path. */
export function assetMime(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return ASSET_MIME[extension] ?? "application/octet-stream";
}

/** Optional frame-grid metadata declared beside one packaged asset. */
export interface AssetAtlas {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns?: number;
  readonly rows?: number;
  readonly frameCount?: number;
  readonly margin?: number;
  readonly spacing?: number;
}

/** Byte length, intrinsic size, and atlas metadata for one asset. */
export interface AssetInfo {
  readonly name: string;
  readonly type: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly atlas: AssetAtlas | null;
}

/** Read one big-endian or little-endian unsigned integer with bounds checks. */
function readUint(
  view: DataView,
  offset: number,
  bytes: 2 | 4,
  littleEndian: boolean,
): number | null {
  if (offset < 0 || offset + bytes > view.byteLength) {
    return null;
  }
  return bytes === 2 ? view.getUint16(offset, littleEndian) : view.getUint32(offset, littleEndian);
}

/** Locate one ASCII marker in a byte range. */
function indexOfAscii(bytes: Uint8Array, marker: string, from = 0): number {
  const code = [...marker].map((character) => character.charCodeAt(0));
  outer: for (let index = from; index <= bytes.length - code.length; index += 1) {
    for (let offset = 0; offset < code.length; offset += 1) {
      if (bytes[index + offset] !== code[offset]) {
        continue outer;
      }
    }
    return index;
  }
  return -1;
}

/** Parse intrinsic dimensions from one supported media header. */
export function assetDimensions(
  path: string,
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = assetMime(path);
  if (type === "image/png") {
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const width = readUint(view, 16, 4, false);
      const height = readUint(view, 20, 4, false);
      return width && height ? { width, height } : null;
    }
    return null;
  }
  if (type === "image/gif") {
    if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const width = readUint(view, 6, 2, true);
      const height = readUint(view, 8, 2, true);
      return width && height ? { width, height } : null;
    }
    return null;
  }
  if (type === "image/bmp") {
    if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      const width = view.getInt32(18, true);
      const height = Math.abs(view.getInt32(22, true));
      return width > 0 && height > 0 ? { width, height } : null;
    }
    return null;
  }
  if (type === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return null;
    }
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = readUint(view, offset + 2, 2, false);
      if (!length || length < 2) {
        return null;
      }
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = readUint(view, offset + 5, 2, false);
        const width = readUint(view, offset + 7, 2, false);
        return width && height ? { width, height } : null;
      }
      offset += 2 + length;
    }
    return null;
  }
  if (type === "image/webp") {
    if (
      bytes.length < 30 ||
      bytes[0] !== 0x52 ||
      bytes[1] !== 0x49 ||
      bytes[2] !== 0x46 ||
      bytes[3] !== 0x46 ||
      bytes[8] !== 0x57 ||
      bytes[9] !== 0x45 ||
      bytes[10] !== 0x42 ||
      bytes[11] !== 0x50
    ) {
      return null;
    }
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      const width =
        1 + (((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)) & 0xffffff);
      const height =
        1 + (((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)) & 0xffffff);
      return { width, height };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = readUint(view, 21, 4, true);
      if (bits === null) {
        return null;
      }
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      const width = readUint(view, 26, 2, true);
      const height = readUint(view, 28, 2, true);
      return width && height ? { width: width & 0x3fff, height: height & 0x3fff } : null;
    }
    return null;
  }
  if (type === "image/avif") {
    const marker = indexOfAscii(bytes, "ispe");
    if (marker < 0) {
      return null;
    }
    const width = readUint(view, marker + 8, 4, false);
    const height = readUint(view, marker + 12, 4, false);
    return width && height ? { width, height } : null;
  }
  if (type === "image/svg+xml") {
    const source = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
    const start = source.search(/<svg\b/iu);
    if (start < 0) {
      return null;
    }
    const end = source.indexOf(">", start);
    const tag = source.slice(start, end < 0 ? undefined : end + 1);
    const attribute = (name: string): number | null => {
      const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "iu").exec(tag);
      if (!match) {
        return null;
      }
      const value = Number.parseFloat(match[1]);
      return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    };
    const width = attribute("width");
    const height = attribute("height");
    if (width && height) {
      return { width, height };
    }
    const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/iu.exec(tag);
    if (viewBox) {
      const parts = viewBox[1]
        .trim()
        .split(/[\s,]+/u)
        .map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
      }
    }
    return null;
  }
  return null;
}

/** Encode host bytes as a data URL the opaque sandbox can render. */
export function assetDataUrl(path: string, bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${assetMime(path)};base64,${btoa(binary)}`;
}

/** The declared asset names, stable in manifest order. */
export function manifestAssetNames(manifest: TrustedExtensionManifest): readonly string[] {
  return Object.freeze(Object.keys(manifest.assets ?? {}));
}

/** Resolve one declared name to its package-relative path. */
export function manifestAssetPath(
  manifest: TrustedExtensionManifest,
  name: string,
): string | undefined {
  const path = manifest.assets?.[name];
  return typeof path === "string" ? path : undefined;
}
