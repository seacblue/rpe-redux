/**
 * Texture alignment, hold geometry, and skew sampling shared by preview,
 * timeline, and hit testing. Pure geometry: callers supply measured textures or
 * line controls and receive quads, intervals, or shear values, with no canvas
 * state involved.
 */
import { ControlCurve } from "../../../../core/global/chart/runtime/scene.ts";
import type { JudgeLine, JudgeLineNote } from "../../../../core/global/chart/chart.ts";

export interface NoteTextureMetrics {
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly usefulX: number;
  readonly usefulY: number;
  readonly usefulWidth: number;
  readonly usefulHeight: number;
}

export interface AlignedTextureQuad {
  readonly centerOffsetX: number;
  readonly centerOffsetY: number;
  readonly width: number;
  readonly height: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface AlignedTextureOptions {
  /**
   * Mirror the texture's V axis. Hold art is authored head-down while a quad's
   * local +Y points from head to tail, so flipping V lands the authored head on
   * the quad's head edge.
   */
  readonly flipV?: boolean;
}

export interface HoldUsefulInterval {
  readonly head: { x: number; y: number };
  readonly tail: { x: number; y: number };
}

/**
 * The painted span of a Hold.
 *
 * A Hold's caps are centred half a cap beyond each anchor, so the painted
 * span extends past the head by the head cap and past the tail by the tail
 * cap. The anchors remain the interpolation endpoints for picking.
 */
export function holdUsefulInterval(area: {
  readonly head: { x: number; y: number };
  readonly tail: { x: number; y: number };
}): HoldUsefulInterval {
  return { head: { ...area.head }, tail: { ...area.tail } };
}

/** Resolve the complete texture quad aligned by its useful area. */
export function alignedTextureQuad(
  metrics: NoteTextureMetrics,
  logicalWidth: number,
  logicalHeight: number,
  options: AlignedTextureOptions = {},
): AlignedTextureQuad | null {
  if (
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    metrics.textureWidth <= 0 ||
    metrics.textureHeight <= 0 ||
    metrics.usefulWidth <= 0 ||
    metrics.usefulHeight <= 0
  ) {
    return null;
  }
  const flipV = options.flipV === true;
  const scaleX = logicalWidth / metrics.usefulWidth;
  const scaleY = logicalHeight / metrics.usefulHeight;
  const width = metrics.textureWidth * scaleX;
  const height = metrics.textureHeight * scaleY;
  const centerOffsetY = -logicalHeight / 2 - metrics.usefulY * scaleY + height / 2;
  return {
    centerOffsetX: -logicalWidth / 2 - metrics.usefulX * scaleX + width / 2,
    // Mirroring V moves the useful rows to the other half of the full texture,
    // so the shift that keeps those rows centred on the logical box mirrors too.
    centerOffsetY: flipV ? (centerOffsetY === 0 ? 0 : -centerOffsetY) : centerOffsetY,
    width,
    height,
    u0: 0,
    v0: flipV ? 1 : 0,
    u1: 1,
    v1: flipV ? 0 : 1,
  };
}

/** Fitted cap and body geometry for one Hold, in the anchors' coordinate space. */
export interface HoldLayout {
  /** Centre of the head cap, half a cap beyond the head anchor. */
  readonly headCap: { x: number; y: number };
  /** Centre of the tail cap, half a cap beyond the tail anchor. */
  readonly tailCap: { x: number; y: number };
  /** Body start at the head anchor. */
  readonly bodyHead: { x: number; y: number };
  /** Body end at the tail anchor. */
  readonly bodyTail: { x: number; y: number };
  /** Longitudinal cap lengths outside the anchors; zero when hidden. */
  readonly headCapLength: number;
  readonly tailCapLength: number;
  /** Full head-to-tail span painted by the body. */
  readonly bodyLength: number;
}

/** Mutable target for reusing Hold layout storage in a rendering batch. */
export interface HoldLayoutScratch {
  headCap: { x: number; y: number };
  tailCap: { x: number; y: number };
  bodyHead: { x: number; y: number };
  bodyTail: { x: number; y: number };
  headCapLength: number;
  tailCapLength: number;
  bodyLength: number;
}

/** Create storage for a Hold layout that can be reused by a renderer. */
export function createHoldLayoutScratch(): HoldLayoutScratch {
  return {
    headCap: { x: 0, y: 0 },
    tailCap: { x: 0, y: 0 },
    bodyHead: { x: 0, y: 0 },
    bodyTail: { x: 0, y: 0 },
    headCapLength: 0,
    tailCapLength: 0,
    bodyLength: 0,
  };
}

/** Fill a reusable Hold layout target without allocating geometry objects. */
export function holdLayoutInto(
  target: HoldLayoutScratch,
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
  headCapLength: number,
  tailCapLength = headCapLength,
  fallbackDirection?: { readonly x: number; readonly y: number },
): HoldLayout {
  const deltaX = tailX - headX;
  const deltaY = tailY - headY;
  const length = Math.hypot(deltaX, deltaY);
  const head = Math.max(0, headCapLength);
  const tail = Math.max(0, tailCapLength);
  const unitX = length > 0 ? deltaX / length : (fallbackDirection?.x ?? 0);
  const unitY = length > 0 ? deltaY / length : (fallbackDirection?.y ?? 0);
  target.headCap.x = headX - unitX * (head / 2);
  target.headCap.y = headY - unitY * (head / 2);
  target.tailCap.x = tailX + unitX * (tail / 2);
  target.tailCap.y = tailY + unitY * (tail / 2);
  target.bodyHead.x = headX;
  target.bodyHead.y = headY;
  target.bodyTail.x = tailX;
  target.bodyTail.y = tailY;
  target.headCapLength = head;
  target.tailCapLength = tail;
  target.bodyLength = length;
  return target;
}

/**
 * Resolve a Hold's cap anchors and full body span.
 *
 * Each cap is centred half a cap length beyond its anchor, matching the
 * recorder and the upstream Phira layout. The body covers the whole
 * head-to-tail span, so overlapping or nested Holds cannot expose a short
 * Hold's cap through the middle of a longer body. A zero-length Hold has no
 * head-to-tail axis, so its caller supplies the fall direction for the caps.
 */
export function holdLayout(
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
  headCapLength: number,
  tailCapLength = headCapLength,
  fallbackDirection?: { readonly x: number; readonly y: number },
): HoldLayout {
  return holdLayoutInto(
    {
      headCap: { x: 0, y: 0 },
      tailCap: { x: 0, y: 0 },
      bodyHead: { x: 0, y: 0 },
      bodyTail: { x: 0, y: 0 },
      headCapLength: 0,
      tailCapLength: 0,
      bodyLength: 0,
    },
    headX,
    headY,
    tailX,
    tailY,
    headCapLength,
    tailCapLength,
    fallbackDirection,
  );
}

/**
 * Rotation that maps a texture's local +Y axis onto the Hold head-to-tail
 * vector: `atan2(headX - tailX, tailY - headY)`.
 */
export function holdAxisRotation(
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
): number {
  return Math.atan2(headX - tailX, tailY - headY);
}

/**
 * The angle used to draw a Hold, including the no-body case.
 *
 * A speed-zero Hold, or one whose tail has reached the line, has no head-to-tail
 * axis, so `holdAxisRotation` would be zero; the caller's line angle is used
 * instead.
 */
export function holdRenderRotation(
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
  fallbackRotation: number,
): number {
  return Math.hypot(headX - tailX, headY - tailY) > 0.5
    ? holdAxisRotation(headX, headY, tailX, tailY)
    : fallbackRotation;
}

/** Convert a skew angle in degrees into the horizontal shear used by both renderers. */
export function noteSkewShear(skewDegrees: number): number {
  return Math.tan((skewDegrees * Math.PI) / 180);
}

/**
 * The line's skew sampler, or null when the control cannot tilt a note.
 *
 * Matches the preview runtime: one control point is the neutral value and does
 * not enable skew, while two or more points interpolate by floor distance.
 */
export function noteSkewCurve(
  line: Pick<JudgeLine, "skewControl"> | null | undefined,
): ControlCurve | null {
  const points = line?.skewControl;
  return points && points.length > 1 ? new ControlCurve(points, "skew") : null;
}

/**
 * Skew angle for a note in the static timeline.
 *
 * The timeline cannot sample the moving preview distance, so it uses the
 * distance where the note meets the line: `yOffset`. Holds never shear, which
 * keeps them aligned with the preview runtime.
 */
export function noteSkewAtHit(
  curve: ControlCurve | null,
  note: Pick<JudgeLineNote, "type" | "positionX" | "yOffset">,
): number {
  if (!curve || note.type === 2) {
    return 0;
  }
  return (note.positionX ?? 0) * curve.value(note.yOffset ?? 0);
}
