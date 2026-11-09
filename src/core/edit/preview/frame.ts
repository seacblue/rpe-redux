/**
 * Owns the request and result contract for rendering one chart frame to an
 * image. A caller selects the frame by chart seconds or by beat, and the
 * renderer returns a self-contained data URL that a browser or AI client can
 * display without touching the live preview.
 */
import {
  beatValue,
  fromNumber,
  isBeat,
  normalizeBeat,
  type Beat,
} from "../../global/chart/timing/beat.ts";
import { isRecord } from "../../utils/guards.ts";

/** Image encodings accepted by the frame renderer. */
export type PreviewFrameFormat = "png" | "jpeg" | "webp";

/** The largest accepted output edge, in pixels. */
export const PREVIEW_FRAME_MAX_EDGE = 1920;

/** The largest accepted output area, in pixels. */
export const PREVIEW_FRAME_MAX_PIXELS = 1_000_000;

/** Default output geometry when the caller names neither edge. */
const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 540;

/** One frame request: exactly one of `seconds` or `beat` selects the frame. */
export interface PreviewFrameRequest {
  /** Chart seconds, measured on the tempo map. */
  readonly seconds?: number;
  /** Chart beat position as a number or a reduced `[whole, numerator, denominator]` triple. */
  readonly beat?: number | readonly number[];
  /** Output width in pixels; defaults to 960, or follows `height` when given. */
  readonly width?: number;
  /** Output height in pixels; defaults to 540, or follows `width` when given. */
  readonly height?: number;
  /** Output encoding; defaults to `png`. */
  readonly format?: PreviewFrameFormat;
  /** Encoder quality for `jpeg` and `webp`; `0` to `1`, defaults to `0.92`. */
  readonly quality?: number;
}

/** A validated request after units, defaults, and limits are applied. */
export interface PreviewFrameSpec {
  /** Chart seconds, or null when the caller selected the frame by beat. */
  readonly seconds: number | null;
  /** Beat position, or null when the caller selected the frame by seconds. */
  readonly beat: Beat | null;
  readonly width: number;
  readonly height: number;
  readonly format: PreviewFrameFormat;
  readonly quality: number;
}

/** One encoded chart frame. */
export interface PreviewFrameImage {
  /** Chart seconds painted by this frame. */
  readonly seconds: number;
  /** Reduced beat triple painted by this frame. */
  readonly beat: Beat;
  /** Numeric value of `beat`, provided so clients do not have to reduce it. */
  readonly beatValue: number;
  readonly width: number;
  readonly height: number;
  readonly format: PreviewFrameFormat;
  readonly mimeType: string;
  readonly quality: number;
  /** A `data:image/...;base64,...` URL carrying the encoded frame. */
  readonly dataUrl: string;
  /** Decoded byte length of the image payload. */
  readonly byteLength: number;
  /** Chart revision painted by this frame. */
  readonly chartFingerprint: string;
}

/** The MIME type emitted for one accepted encoding. */
export function previewFrameMimeType(format: PreviewFrameFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

/** Decoded byte length of a base64 data URL, without allocating image bytes. */
export function previewFrameDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** Whether one value names an accepted image encoding. */
function isPreviewFrameFormat(value: unknown): value is PreviewFrameFormat {
  return value === "png" || value === "jpeg" || value === "webp";
}

/** Reject a request with a stable, caller-facing message. */
function invalid(message: string): never {
  throw new RangeError(message);
}

/** Validate one output edge and return it as an integer. */
function frameEdge(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 16 || value > PREVIEW_FRAME_MAX_EDGE) {
    invalid(`${name} must be an integer between 16 and ${PREVIEW_FRAME_MAX_EDGE}`);
  }
  return value;
}

/** Turn one reduced beat into a numeric value, rejecting malformed triples. */
function frameBeat(value: readonly number[]): Beat {
  if (!isBeat(value)) {
    invalid("beat must be a reduced [whole, numerator, denominator] triple");
  }
  return normalizeBeat(value);
}

/**
 * Validate a frame request and fill in defaults.
 *
 * The caller must name exactly one of `seconds` or `beat`. A missing edge keeps
 * the 16:9 default aspect; an explicit edge derives the other. Throws a
 * `RangeError` for malformed input so the public facade reports
 * `invalid_request` rather than a rendering failure.
 */
export function normalizePreviewFrameRequest(request: unknown): PreviewFrameSpec {
  if (!isRecord(request)) {
    invalid("Preview frame request must be an object");
  }
  const hasSeconds = request.seconds !== undefined && request.seconds !== null;
  const hasBeat = request.beat !== undefined && request.beat !== null;
  if (hasSeconds === hasBeat) {
    invalid('Preview frame request must contain exactly one of "seconds" or "beat"');
  }

  let seconds: number | null = null;
  let beat: Beat | null = null;
  if (hasSeconds) {
    const value = request.seconds;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalid("seconds must be a finite number");
    }
    seconds = value;
  } else {
    const value = request.beat;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        invalid("beat must be a finite number or a reduced triple");
      }
      beat = fromNumber(value);
    } else if (Array.isArray(value)) {
      beat = frameBeat(value);
    } else {
      invalid("beat must be a finite number or a reduced triple");
    }
  }

  const widthValue = request.width;
  const heightValue = request.height;
  let width: number;
  let height: number;
  if (widthValue === undefined || widthValue === null) {
    if (heightValue === undefined || heightValue === null) {
      width = DEFAULT_WIDTH;
      height = DEFAULT_HEIGHT;
    } else {
      if (
        typeof heightValue !== "number" ||
        !Number.isSafeInteger(heightValue) ||
        heightValue < 16
      ) {
        invalid("height must be an integer");
      }
      height = heightValue;
      width = Math.round((height * 16) / 9);
    }
  } else if (heightValue === undefined || heightValue === null) {
    if (typeof widthValue !== "number" || !Number.isSafeInteger(widthValue) || widthValue < 16) {
      invalid("width must be an integer");
    }
    width = widthValue;
    height = Math.round((width * 9) / 16);
  } else {
    if (typeof widthValue !== "number") {
      invalid("width must be an integer");
    }
    if (typeof heightValue !== "number") {
      invalid("height must be an integer");
    }
    width = widthValue;
    height = heightValue;
  }
  width = frameEdge(width, "width");
  height = frameEdge(height, "height");
  if (width * height > PREVIEW_FRAME_MAX_PIXELS) {
    invalid(`frame area must not exceed ${PREVIEW_FRAME_MAX_PIXELS} pixels`);
  }

  const format = request.format ?? "png";
  if (!isPreviewFrameFormat(format)) {
    invalid('format must be "png", "jpeg", or "webp"');
  }
  const qualityValue = request.quality ?? 0.92;
  if (
    typeof qualityValue !== "number" ||
    !Number.isFinite(qualityValue) ||
    qualityValue < 0 ||
    qualityValue > 1
  ) {
    invalid("quality must be a number between 0 and 1");
  }

  return Object.freeze({
    seconds,
    beat,
    width,
    height,
    format,
    quality: qualityValue,
  });
}

/** Freeze one encoded frame, including its beat triple. */
export function frozenPreviewFrameImage(frame: PreviewFrameImage): PreviewFrameImage {
  return Object.freeze({
    ...frame,
    beat: Object.freeze([...frame.beat]) as Beat,
  });
}

/** Numeric beat for a frame result, preserving the triple's exact value. */
export function previewFrameBeatValue(beat: readonly number[]): number {
  return beatValue(beat);
}
