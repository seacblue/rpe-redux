/**
 * Maps chart asset extensions to media types for blob URLs and downloads.
 *
 * Unknown extensions fall back to `application/octet-stream`.
 */
const MEDIA_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg",
  webm: "audio/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  glsl: "text/plain",
  frag: "text/plain",
  vert: "text/plain",
  vsh: "text/plain",
  fsh: "text/plain",
  shader: "text/plain",
};

/** Media type for an asset name, or `application/octet-stream` when unknown. */
export function mediaType(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}
