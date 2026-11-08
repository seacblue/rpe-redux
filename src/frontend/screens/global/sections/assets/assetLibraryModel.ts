/**
 * Pure model helpers for the asset library: path normalization, supported-media
 * classification, object-URL creation, and the yield cadence used by the tree
 * builder.
 *
 * They are free of panel state so the panel class stays about lifecycle and the
 * mutations it publishes.
 */
import { mediaType } from "../../../../../core/media/mime.ts";
import type { AssetMap } from "../../../../../core/global/document/types.ts";
import type { AssetViewKind } from "./model.ts";

export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i;
export const SHADER_EXTENSIONS = /\.(glsl|frag|vert|vsh|fsh|shader)$/i;
export const ASSET_EXTENSIONS =
  /\.(png|jpe?g|webp|gif|bmp|avif|mp3|wav|ogg|flac|m4a|aac|opus|webm|glsl|frag|vert|vsh|fsh|shader)$/i;

/**
 * How many assets to build before yielding the event loop.
 *
 * Small enough that a long build never blocks a frame, large enough that a
 * typical library still finishes in one pass without any timer.
 */
export const ASSETS_PER_YIELD = 24;

/** A node in the asset tree. */
export interface AssetNode {
  folders: Map<string, AssetNode>;
  /** [full path, file name, bytes]; the name is undefined when unavailable. */
  files: [string, string | undefined, Uint8Array][];
}

/** An image object URL paired with the bytes used to create it. */
export interface CachedUrl {
  bytes: Uint8Array;
  url: string;
}

/**
 * Yields once so a queued paint can run.
 *
 * A timer rather than `requestAnimationFrame`: the inspector mounts every panel
 * permanently behind `hidden`, and rAF never fires for a hidden document, so a
 * build in a closed pane would never resume.
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Normalizes a reference to forward slashes for tree and path comparisons. */
export function imageName(path: unknown): string {
  return String(path ?? "").replaceAll("\\", "/");
}

/** Supported media entries from the chart's asset map. */
export function assetEntries(assets: AssetMap | null | undefined): [string, Uint8Array][] {
  return [...(assets ?? [])].filter(([name]) => ASSET_EXTENSIONS.test(imageName(name)));
}

/** Classifies an asset by its file extension. */
export function assetKind(name: string): AssetViewKind {
  if (IMAGE_EXTENSIONS.test(name)) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.test(name)) {
    return "audio";
  }
  return "shader";
}

/** Creates an object URL for an asset's bytes using its media type. */
export function createUrl(bytes: Uint8Array, name: string): string {
  // `BlobPart` accepts an ArrayBuffer-backed view; `slice()` copies the same bytes.
  return URL.createObjectURL(new Blob([bytes.slice()], { type: mediaType(name) }));
}

/**
 * Whether a name may be written as an asset reference.
 *
 * Asset references resolve relative to the chart's own folder, so absolute or
 * upward-walking names would place the file outside the project and are refused
 * before they reach the asset map.
 */
export function isChartRelativePath(path: string): boolean {
  const raw = path.replaceAll("\\", "/").trim();
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    return false;
  }
  return !raw.split("/").some((part) => !part || part === "." || part === "..");
}

/** The folder name a directory scan started from; `webkitRelativePath` prefixes it. */
export function scannedRoot(file: File): string | null {
  if (!file.webkitRelativePath) {
    return null;
  }
  return file.webkitRelativePath.replaceAll("\\", "/").split("/").filter(Boolean)[0] ?? null;
}

/** Adds every ancestor directory of a path to the folder set. */
export function collectAssetFolders(path: string, folders: Set<string>): void {
  const parts = imageName(path).split("/");
  parts.pop();
  for (let index = 1; index <= parts.length; index++) {
    folders.add(parts.slice(0, index).join("/"));
  }
}

/** Resolves the chart-relative path for an imported file inside a folder. */
export function assetPathFor(file: File, folder: string): string {
  const raw = imageName(file.webkitRelativePath || file.name).replace(/^\/+/, "");
  const parts = raw.split("/").filter(Boolean);
  // A directory scan reports `<picked folder>/<path>`; the picked folder is the
  // chart's own folder, so only the part below it is an asset path.
  if (file.webkitRelativePath && parts.length > 1) {
    parts.shift();
  }
  return [...(folder ? [folder] : []), ...parts].join("/") || file.name;
}
