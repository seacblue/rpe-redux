/**
 * Shell panel sizes.
 *
 * The workspace takes whatever the chrome around it leaves. Each panel around it
 * holds a size that is its authored size times one scale factor, so the same
 * profile looks the same at 1080p and at 1440p: growing the window hands the new
 * pixels to the canvas instead of inflating every button around it. That scale is
 * also the factor the panel's contents scale by, so one number sizes the track
 * and everything drawn inside it — a taller toolbar holds taller buttons, a wider
 * inspector holds larger fields.
 *
 * A width panel still answers to the window: at a large scale on a narrow window
 * it lands on its viewport ceiling, and its contents scale down with the box
 * instead of spilling out of it.
 *
 * The model lives beside the shell registry because the settings catalog and the
 * React seam both read it: one definition feeds the range control, the drag
 * gesture, and the stylesheet clamp.
 */

/** A shell region whose size the user adjusts. */
export type LayoutRegionId = "toolbar" | "statusbar" | "inspector" | "sidebar" | "progress";

/** One region's setting key, authored size, and the range it may occupy. */
export interface LayoutRegionDefinition {
  /** Settings key that stores the scale as a decimal string. */
  readonly key: string;
  /** Viewport axis the region is measured against. */
  readonly axis: "width" | "height";
  /** The scale a fresh profile starts with, which paints the authored size. */
  readonly defaultScale: number;
  /** The scale the range control and the drag gesture accept. */
  readonly minScale: number;
  readonly maxScale: number;
  /** The size the region and its contents were authored for, in CSS pixels. */
  readonly basePixels: number;
  /** Optional viewport ceiling, matching the stylesheet's own cap. */
  readonly maxViewportShare?: number;
}

/** A viewport size in CSS pixels. */
export interface LayoutViewport {
  width: number;
  height: number;
}

/** Every adjustable shell region. The title bar stays a fixed caption row. */
export const LAYOUT_REGIONS: Readonly<Record<LayoutRegionId, LayoutRegionDefinition>> = {
  toolbar: {
    key: "layout-toolbar-scale",
    axis: "height",
    defaultScale: 1,
    minScale: 0.62,
    maxScale: 1.8,
    // Two 36px rows, the frame's vertical padding, the row padding, and the 1px
    // frame border. The border does not scale with the rest, so the authored
    // height carries a pixel of slack: at the smallest scale the two rows still
    // fit inside the frame instead of clipping by a fraction of a pixel.
    basePixels: 90,
  },
  statusbar: {
    key: "layout-statusbar-scale",
    axis: "height",
    defaultScale: 1,
    // One caption row: it may grow, but it may not shrink below its own text.
    minScale: 0.9,
    maxScale: 1.6,
    basePixels: 36,
  },
  inspector: {
    key: "layout-inspector-scale",
    axis: "width",
    defaultScale: 1,
    minScale: 0.65,
    maxScale: 1.9,
    basePixels: 400,
    // A wide panel never takes more than this share of the window, so the
    // workspace keeps room at any scale the user picks.
    maxViewportShare: 0.57,
  },
  sidebar: {
    key: "layout-sidebar-scale",
    axis: "width",
    defaultScale: 1,
    minScale: 0.85,
    maxScale: 1.7,
    basePixels: 56,
  },
  progress: {
    key: "layout-progress-scale",
    axis: "width",
    defaultScale: 1,
    minScale: 0.55,
    maxScale: 1.6,
    // The width the transport card was authored for; the column it sits in is this
    // plus its two inline insets.
    basePixels: 480,
    // The card shares its row with the two toolbar rows, so a wide card leaves
    // nothing for the commands. Half the window is the widest it may claim.
    maxViewportShare: 0.5,
  },
};

/** The viewport dimension a region is measured against. */
function axisSize(region: LayoutRegionDefinition, viewport: LayoutViewport): number {
  return region.axis === "width" ? viewport.width : viewport.height;
}

/** A scale the region accepts, falling back to its authored size when unreadable. */
function requestedScale(region: LayoutRegionDefinition, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return region.defaultScale;
  }
  return Math.min(Math.max(scale, region.minScale), region.maxScale);
}

/** The pixel range a region may occupy at the current viewport. */
export function regionBounds(
  region: LayoutRegionDefinition,
  viewport: LayoutViewport,
): { min: number; max: number } {
  const ceiling =
    region.maxViewportShare === undefined
      ? Number.POSITIVE_INFINITY
      : axisSize(region, viewport) * region.maxViewportShare;
  const max = Math.round(Math.min(region.basePixels * region.maxScale, ceiling) * 100) / 100;
  const min = Math.round(Math.min(region.basePixels * region.minScale, max) * 100) / 100;
  return { min: Math.max(min, 0), max: Math.max(max, 0) };
}

/**
 * The pixels one scale paints at this viewport.
 *
 * This is the box the stylesheet draws, so the seam and the assistive readout use
 * the same number. A width panel that would cross its viewport ceiling lands on
 * the ceiling instead, and its contents scale down with it.
 */
export function regionPixels(
  region: LayoutRegionDefinition,
  scale: number,
  viewport: LayoutViewport,
): number {
  const requested = region.basePixels * requestedScale(region, scale);
  const { min, max } = regionBounds(region, viewport);
  return Math.min(Math.max(Math.round(requested * 100) / 100, min), max);
}

/**
 * The scale the contents actually paint at.
 *
 * The authored size paints exactly 1. A panel held short by its viewport ceiling
 * reports the smaller factor, so its buttons and text shrink with the box
 * instead of overflowing it.
 */
export function regionScale(
  region: LayoutRegionDefinition,
  scale: number,
  viewport: LayoutViewport,
): number {
  if (!(region.basePixels > 0)) {
    return 1;
  }
  const pixels = regionPixels(region, scale, viewport);
  return Math.round((pixels / region.basePixels) * 10000) / 10000;
}

/** The scale that paints one pixel size, kept inside the range the control accepts. */
export function scaleForPixels(
  region: LayoutRegionDefinition,
  pixels: number,
  viewport: LayoutViewport,
): number {
  if (!(region.basePixels > 0) || !Number.isFinite(pixels)) {
    return region.defaultScale;
  }
  const { min, max } = regionBounds(region, viewport);
  const bounded = Math.min(Math.max(pixels, min), max);
  return Math.min(Math.max(bounded / region.basePixels, region.minScale), region.maxScale);
}

/** A scale as the decimal string the value store and CSS both read. */
export function formatScale(scale: number): string {
  return String(Number(scale.toFixed(4)));
}
