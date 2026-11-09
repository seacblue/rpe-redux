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
 * A Hold's caps fit inside its head-to-tail anchors: the head cap starts at the
 * head anchor and the tail cap ends at the tail anchor. The anchors are
 * therefore the outermost painted points, with no half-cap extension.
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
  /** Centre of the head cap after fitting it inside the anchor span. */
  readonly headCap: { x: number; y: number };
  /** Centre of the tail cap after fitting it inside the anchor span. */
  readonly tailCap: { x: number; y: number };
  /** Body start, meeting the head cap's inner edge. */
  readonly bodyHead: { x: number; y: number };
  /** Body end, meeting the tail cap's inner edge. */
  readonly bodyTail: { x: number; y: number };
  /** Longitudinal cap lengths after fitting; zero when that cap is hidden. */
  readonly headCapLength: number;
  readonly tailCapLength: number;
  /** Distance between the body endpoints. */
  readonly bodyLength: number;
}

/**
 * Fit a Hold's head cap, body, and tail cap inside its head-to-tail anchors.
 *
 * The caps occupy the ends of the anchor span and the body fills the middle, so
 * the painted Hold never extends past the note's start or end. When the caps
 * together are longer than the span, both shrink proportionally. A Hold shorter
 * than half a CSS pixel has no room to fit them and keeps its authored caps on
 * the anchors instead.
 */
export function holdLayout(
  headX: number,
  headY: number,
  tailX: number,
  tailY: number,
  headCapLength: number,
  tailCapLength = headCapLength,
): HoldLayout {
  const deltaX = tailX - headX;
  const deltaY = tailY - headY;
  const length = Math.hypot(deltaX, deltaY);
  const requestedHead = Math.max(0, headCapLength);
  const requestedTail = Math.max(0, tailCapLength);
  const requestedTotal = requestedHead + requestedTail;
  if (length <= 0.5) {
    return {
      headCap: { x: headX, y: headY },
      tailCap: { x: tailX, y: tailY },
      bodyHead: { x: headX, y: headY },
      bodyTail: { x: tailX, y: tailY },
      headCapLength: requestedHead,
      tailCapLength: requestedTail,
      bodyLength: 0,
    };
  }
  const scale = requestedTotal > length ? length / requestedTotal : 1;
  const head = requestedHead * scale;
  const tail = requestedTail * scale;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  return {
    headCap: { x: headX + unitX * (head / 2), y: headY + unitY * (head / 2) },
    tailCap: { x: tailX - unitX * (tail / 2), y: tailY - unitY * (tail / 2) },
    bodyHead: { x: headX + unitX * head, y: headY + unitY * head },
    bodyTail: { x: tailX - unitX * tail, y: tailY - unitY * tail },
    headCapLength: head,
    tailCapLength: tail,
    bodyLength: Math.max(0, length - head - tail),
  };
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
