/**
 * SVG guide layer for the workspace sampler.
 *
 * It paints the full-viewport XY guide lines, the bounded scalar scale, the two draft
 * anchors, and the dashed drag path. All geometry arrives precomputed so this file
 * only decides visibility, opacity, and snap highlighting; interaction state
 * stays in the overlay and the sampling session.
 */
import { useId } from "react";
import { useTranslation } from "../../../../../../i18n/react.ts";
import {
  formatSamplingScalar,
  type SamplingGuideCursor,
  type SamplingGeometry,
  type SamplingProjection,
  type SamplingViewport,
  samplingHoveredGuideKey,
} from "./samplingGuides.ts";
import type { SamplingValue } from "../../../../../../core/edit/sampling/sampling.ts";

interface SamplingGuideLayerProps {
  projection: SamplingProjection;
  viewport: SamplingViewport;
  geometry: SamplingGeometry;
  start: SamplingValue | null;
  end: SamplingValue | null;
  startPoint: { x: number; y: number } | null;
  endPoint: { x: number; y: number } | null;
  /** Guide lines and scalar endpoint labels are painted when true. */
  showGuides: boolean;
  /** Whether the nearest guide line is highlighted under the pointer. */
  hoverGuidesEnabled: boolean;
  /** Draft anchor markers and the path are painted when true. */
  showAnchors: boolean;
  /** Stage-local pointer position used to reveal guides outside the frame. */
  cursor: SamplingGuideCursor | null;
  /** Whether the pointer is currently changing the two draft anchors. */
  dragging: boolean;
  /** Opacity multiplier shared by every sampler helper line. */
  guideOpacity: number;
}

/** Portion of the frame dimension used for each outside fade half. */
const GUIDE_FADE_RATIO = 0.3;
/** Size of the pointer readout bubble in stage pixels. */
const READOUT_WIDTH = 156;
const READOUT_HEIGHT = 44;

interface FadeStop {
  position: number;
  opacity: number;
}

/** Clamp a number to the normalized alpha range. */
function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Resolve the continuous alpha at one coordinate around the frame boundary. */
function fadeOpacityAt(value: number, start: number, end: number, fadeDistance: number): number {
  const outside = value < start ? start - value : value > end ? value - end : 0;
  if (outside <= fadeDistance) {
    return 1;
  }
  return clampOpacity(2 - outside / fadeDistance);
}

/** Build the exact piecewise-linear stops for one pixel-continuous axis fade. */
function axisFadeStops(length: number, start: number, end: number): FadeStop[] {
  const safeLength = Math.max(1, Number(length) || 0);
  const safeStart = Math.min(start, end);
  const safeEnd = Math.max(start, end);
  const fadeDistance = Math.max(1, (safeEnd - safeStart) * GUIDE_FADE_RATIO);
  const points = [
    0,
    safeStart - fadeDistance * 2,
    safeStart - fadeDistance,
    safeStart,
    safeEnd,
    safeEnd + fadeDistance,
    safeEnd + fadeDistance * 2,
    safeLength,
  ]
    .map((point) => Math.min(safeLength, Math.max(0, point)))
    .sort((left, right) => left - right);
  const unique = points.filter((point, index) => index === 0 || point !== points[index - 1]);
  return unique.map((position) => ({
    position,
    opacity: fadeOpacityAt(position, safeStart, safeEnd, fadeDistance),
  }));
}

/** Workspace sampler guides, anchors, and drag path. */
export function SamplingGuideLayer({
  projection,
  viewport,
  geometry,
  start,
  end,
  startPoint,
  endPoint,
  showGuides,
  hoverGuidesEnabled,
  showAnchors,
  cursor,
  dragging,
  guideOpacity,
}: SamplingGuideLayerProps) {
  const { t } = useTranslation();
  const opacity = Math.min(1, Math.max(0, guideOpacity));
  const maskPrefix = `sampling-${useId().replaceAll(":", "")}`;
  const verticalFade = axisFadeStops(projection.stageWidth, viewport.left, viewport.right);
  const horizontalFade = axisFadeStops(projection.stageHeight, viewport.top, viewport.bottom);
  const cursorRadius = cursor
    ? Math.max(1, Math.min(viewport.width, viewport.height) * GUIDE_FADE_RATIO)
    : 0;
  const hoveredVerticalKey =
    cursor && showGuides && !dragging
      ? samplingHoveredGuideKey(geometry.vertical, cursor.x, hoverGuidesEnabled)
      : null;
  const hoveredHorizontalKey =
    cursor && showGuides && !dragging
      ? samplingHoveredGuideKey(geometry.horizontal, cursor.y, hoverGuidesEnabled)
      : null;
  const readoutVisible = Boolean(cursor && dragging && start && end);
  const readoutX = cursor
    ? Math.min(Math.max(8, cursor.x + 14), Math.max(8, projection.stageWidth - READOUT_WIDTH - 8))
    : 0;
  const readoutY = cursor
    ? Math.min(
        Math.max(8, cursor.y - READOUT_HEIGHT - 14),
        Math.max(8, projection.stageHeight - READOUT_HEIGHT - 8),
      )
    : 0;

  return (
    <svg
      className="sampling-svg"
      width={projection.stageWidth}
      height={projection.stageHeight}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${maskPrefix}-x-gradient`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={projection.stageWidth}
          y2="0"
        >
          {verticalFade.map((stop) => (
            <stop
              key={`x-${stop.position}`}
              offset={stop.position / Math.max(1, projection.stageWidth)}
              stopColor="white"
              stopOpacity={stop.opacity}
            />
          ))}
        </linearGradient>
        <linearGradient
          id={`${maskPrefix}-y-gradient`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="0"
          y2={projection.stageHeight}
        >
          {horizontalFade.map((stop) => (
            <stop
              key={`y-${stop.position}`}
              offset={stop.position / Math.max(1, projection.stageHeight)}
              stopColor="white"
              stopOpacity={stop.opacity}
            />
          ))}
        </linearGradient>
        <mask
          id={`${maskPrefix}-x-mask`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={projection.stageWidth}
          height={projection.stageHeight}
        >
          <rect
            width={projection.stageWidth}
            height={projection.stageHeight}
            fill={`url(#${maskPrefix}-x-gradient)`}
          />
        </mask>
        <mask
          id={`${maskPrefix}-y-mask`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={projection.stageWidth}
          height={projection.stageHeight}
        >
          <rect
            width={projection.stageWidth}
            height={projection.stageHeight}
            fill={`url(#${maskPrefix}-y-gradient)`}
          />
        </mask>
        {cursor && (
          <>
            <radialGradient
              id={`${maskPrefix}-cursor-gradient`}
              gradientUnits="userSpaceOnUse"
              cx={cursor.x}
              cy={cursor.y}
              r={cursorRadius}
            >
              <stop offset="0" stopColor="white" stopOpacity="1" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <mask
              id={`${maskPrefix}-cursor-mask`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={projection.stageWidth}
              height={projection.stageHeight}
            >
              <rect width={projection.stageWidth} height={projection.stageHeight} fill="black" />
              <circle
                cx={cursor.x}
                cy={cursor.y}
                r={cursorRadius}
                fill={`url(#${maskPrefix}-cursor-gradient)`}
              />
              <rect
                x={viewport.left}
                y={viewport.top}
                width={viewport.width}
                height={viewport.height}
                fill="black"
              />
            </mask>
          </>
        )}
      </defs>

      <g opacity={opacity} mask={`url(#${maskPrefix}-x-mask)`}>
        <g mask={`url(#${maskPrefix}-y-mask)`}>
          {showGuides &&
            geometry.vertical.map((line) => (
              <line
                key={`v-${line.key}`}
                className={`sampling-guide-line${line.major ? " is-major" : ""}`}
                data-hovered={hoveredVerticalKey === line.key ? "true" : undefined}
                x1={line.position}
                y1="0"
                x2={line.position}
                y2={projection.stageHeight}
              />
            ))}
          {showGuides &&
            geometry.horizontal.map((line) => (
              <line
                key={`h-${line.key}`}
                className={`sampling-guide-line${line.major ? " is-major" : ""}`}
                data-hovered={hoveredHorizontalKey === line.key ? "true" : undefined}
                x1="0"
                y1={line.position}
                x2={projection.stageWidth}
                y2={line.position}
              />
            ))}

          {showGuides && geometry.scalar && (
            <>
              <text
                className="sampling-scalar-label"
                x={viewport.left + 8}
                y={viewport.top + 16}
                textAnchor="start"
              >
                {geometry.scalar.minLabel}
              </text>
              <text
                className="sampling-scalar-label"
                x={viewport.right - 8}
                y={viewport.top + 16}
                textAnchor="end"
              >
                {geometry.scalar.maxLabel}
              </text>
            </>
          )}
        </g>
      </g>

      {showAnchors && (
        <g className="sampling-anchors">
          {startPoint && endPoint && (
            <line
              className="sampling-anchor-path"
              x1={startPoint.x}
              y1={startPoint.y}
              x2={endPoint.x}
              y2={endPoint.y}
            />
          )}
          {startPoint && (
            <circle
              className="sampling-anchor-point"
              data-anchor="start"
              cx={startPoint.x}
              cy={startPoint.y}
              r={6}
            />
          )}
          {endPoint && (
            <circle
              className="sampling-anchor-point"
              data-anchor="end"
              cx={endPoint.x}
              cy={endPoint.y}
              r={6}
            />
          )}
        </g>
      )}

      {cursor && showGuides && (
        <g opacity={opacity} mask={`url(#${maskPrefix}-cursor-mask)`}>
          {geometry.vertical.map((line) => (
            <line
              key={`cursor-v-${line.key}`}
              className={`sampling-guide-line${line.major ? " is-major" : ""}`}
              data-hovered={hoveredVerticalKey === line.key ? "true" : undefined}
              x1={line.position}
              y1="0"
              x2={line.position}
              y2={projection.stageHeight}
            />
          ))}
          {geometry.horizontal.map((line) => (
            <line
              key={`cursor-h-${line.key}`}
              className={`sampling-guide-line${line.major ? " is-major" : ""}`}
              data-hovered={hoveredHorizontalKey === line.key ? "true" : undefined}
              x1="0"
              y1={line.position}
              x2={projection.stageWidth}
              y2={line.position}
            />
          ))}
        </g>
      )}

      {readoutVisible && cursor && start && end && (
        <g className="sampling-pointer-readout" transform={`translate(${readoutX} ${readoutY})`}>
          <rect width={READOUT_WIDTH} height={READOUT_HEIGHT} rx="4" />
          <text x="10" y="17">
            {t("editorPanels.sampling.anchorStart", {
              value: formatSamplingScalar(start.axis, start.scalar),
            })}
          </text>
          <text x="10" y="35">
            {t("editorPanels.sampling.anchorEnd", {
              value: formatSamplingScalar(end.axis, end.scalar),
            })}
          </text>
        </g>
      )}
    </svg>
  );
}
