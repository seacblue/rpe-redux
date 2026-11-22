/**
 * Note-skin types and geometry shared by the Phira parser and the renderer.
 *
 * Phira respacks are the only authored skin format. `phiraRespack.ts` owns
 * package validation and the normalized slot view; this module owns the
 * semantic slot names the runtime renders, the PNG check every skin image
 * passes, and the aligned-texture maths that places a texture rectangle on a
 * note. Runtime callers parse through `parseNoteSkin`, which returns that
 * normalized manifest.
 */
import { t } from "../../i18n/index.ts";
import type { PackageName } from "../utils/packageName.ts";
import { parsePhiraRespack } from "./phiraRespack.ts";
import type { PhiraInfo } from "./phiraRespack.ts";

/** Texture bounds used by the renderer after transparent padding is removed. */
export interface TextureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** One texture slot in the Phira package. */
export interface NoteTexture {
  file: string;
}
/** The validated shape of a note skin's manifest. */
export interface NoteSkinManifest {
  name: PackageName;
  notes: Record<string, NoteTexture>;
  events: Record<string, NoteTexture>;
  /** Phira metadata retained so the browser renderer can split Hold atlases. */
  phira?: PhiraSkinManifest;
  /** Optional package-root judge-line texture; the bundled default applies when absent. */
  judgeline?: { line: NoteTexture };
  /** Named effect sprite resources, resolved relative to the package root. */
  particles?: Record<string, string>;
  /** Named audio resources, resolved relative to the package root. */
  audio?: Record<string, string>;
}
/** Phira-specific files retained beside the normalized semantic slots. */
export interface PhiraSkinManifest {
  info: PhiraInfo;
  holdFile: string;
  holdFileMH: string;
  hitFxFile: string;
}
/** Every semantic texture slot the runtime renders. */
export const NOTE_TEXTURES = [
  "tap",
  "tap_highlight",
  "drag",
  "drag_highlight",
  "flick",
  "flick_highlight",
  "hold_head",
  "hold_head_highlight",
  "hold_body",
  "event_bar",
  "hold_body_highlight",
  "hold_end",
  "event_hold",
] as const;

/** Phira's default and selectable note-scale range. */
export const PHIRA_NOTE_SCALE_DEFAULT = 1;
export const PHIRA_NOTE_SCALE_MIN = 0.8;
export const PHIRA_NOTE_SCALE_MAX = 1.2;

/** Validate the PNG signature and IHDR dimensions, rejecting oversized images. */
export function validatePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 33 ||
    signature.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
  ) {
    throw new Error(t("model.noteSkin.invalidPng"));
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) {
    throw new Error(t("model.noteSkin.invalidSize"));
  }
  return { width, height };
}

/**
 * Phira's simultaneous-note width multiplier.
 *
 * `prpr` scales one `_mh` note by the normal and highlighted click widths, so a
 * skin whose highlight art is wider also renders a wider note.
 */
export function highlightWidthScale(baseWidth: number, highlightWidth: number): number {
  return baseWidth > 0 && highlightWidth > 0 ? highlightWidth / baseWidth : 1;
}

/** The three vertical slices of a Phira Hold atlas, in image coordinates. */
export interface HoldAtlasSlices {
  tail: { y: number; height: number };
  body: { y: number; height: number };
  head: { y: number; height: number };
}

/**
 * Split a Phira Hold atlas into tail, body, and head rows.
 *
 * Phira puts the tail at the top and the head at the bottom; `holdAtlas` and
 * `holdAtlasMH` name their heights, in that order. Either cap may be zero, but
 * the body must keep at least one row.
 */
export function phiraHoldAtlasSlices(
  textureHeight: number,
  atlas: readonly [number, number],
): HoldAtlasSlices | null {
  const [tail, head] = atlas;
  const body = textureHeight - tail - head;
  if (tail < 0 || head < 0 || body <= 0) {
    return null;
  }
  return {
    tail: { y: 0, height: tail },
    body: { y: tail, height: body },
    head: { y: tail + body, height: head },
  };
}

/** Draw the full PNG around its logical centre without stretching aspect ratio. */
export function alignedTexture(
  rect: TextureBounds,
  textureWidth: number,
  textureHeight: number,
  x: number,
  y: number,
  width: number,
) {
  const scale = width / rect.width;
  return {
    x: x - width / 2 - rect.x * scale,
    y: y - (rect.height * scale) / 2 - rect.y * scale,
    width: textureWidth * scale,
    height: textureHeight * scale,
  };
}

/** Draws the full image so its declared bounds align to a logical box. */
export function alignedTextureBox(
  rect: TextureBounds,
  textureWidth: number,
  textureHeight: number,
  centerX: number,
  centerY: number,
  logicalWidth: number,
  logicalHeight: number,
) {
  const scaleX = logicalWidth / rect.width;
  const scaleY = logicalHeight / rect.height;
  return {
    x: centerX - logicalWidth / 2 - rect.x * scaleX,
    y: centerY - logicalHeight / 2 - rect.y * scaleY,
    width: textureWidth * scaleX,
    height: textureHeight * scaleY,
  };
}

/** Parse options shared by strict imports and workbench-authored partial packs. */
export interface NoteSkinParseOptions {
  allowIncomplete?: boolean;
}

/**
 * Parse and validate a note-skin package.
 *
 * A skin is a Phira respack, so parsing delegates to `phiraRespack.ts` and this
 * entry point returns only the manifest view the runtime consumes. Imported
 * packages are strict; the workbench opts into `allowIncomplete` when it saves
 * a partial package whose slots the runtime fills from fallbacks.
 */
export function parseNoteSkin(
  files: ReadonlyMap<string, Uint8Array>,
  options: NoteSkinParseOptions = {},
): NoteSkinManifest {
  return parsePhiraRespack(files, options).manifest;
}
