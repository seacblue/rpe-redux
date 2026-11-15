/** Creates a bounded preview image for library cards without changing source media. */
import { createImageThumbnail } from "../platform/browser/mediaHost.ts";

/** The reserved library asset name attached to one project's generated cover. */
export const LIBRARY_THUMBNAIL_ASSET = "__redux/thumbnail.png";

/** The image formats the browser can decode for a library cover. */
const IMAGE_ASSET_PATTERN = /\.(png|jpe?g|webp|gif|bmp|avif|apng)$/i;

/** Generate the small library preview from one image asset. */
export async function generateLibraryThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  return createImageThumbnail(bytes, 480, 270);
}

/** Whether a stored asset can be considered as a fallback cover. */
export function isLibraryImageAsset(name: string): boolean {
  return IMAGE_ASSET_PATTERN.test(name);
}
