/**
 * Shell panel proportions.
 *
 * The workspace keeps whatever the chrome around it leaves. Every other region
 * holds a share of the window along the axis it touches, so growing the window
 * grows the panels instead of handing every new pixel to the canvas. A share is
 * the persisted unit; the pixel bounds here keep each panel usable at any window
 * size, and the stylesheet clamps with the same numbers so a drag never reports
 * a size the browser will not paint.
 *
 * The model lives beside the shell registry because the settings catalog and the
 * React seam both read it: one definition feeds the range control, the drag
 * gesture, and the stylesheet clamp.
 */

/** A shell region whose size is a share of one viewport axis. */
export type LayoutRegionId = "toolbar" | "statusbar" | "inspector" | "sidebar";

/** One region's setting key and the range it may occupy. */
export interface LayoutRegionDefinition {
  /** Settings key that stores the share as a decimal string. */
  readonly key: string;
  /** Viewport axis the region is measured against. */
  readonly axis: "width" | "height";
  /** The share a fresh profile starts with. */
  readonly defaultShare: number;
  /** The share the range control and the drag gesture accept. */
  readonly minShare: number;
  readonly maxShare: number;
  /** The smallest and largest useful size, in CSS pixels. */
  readonly minPixels: number;
  readonly maxPixels: number;
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
    key: "layout-toolbar-share",
    axis: "height",
    defaultShare: 0.131,
    minShare: 0.09,
    maxShare: 0.25,
    minPixels: 94,
    maxPixels: 200,
  },
  statusbar: {
    key: "layout-statusbar-share",
    axis: "height",
    defaultShare: 0.0445,
    minShare: 0.03,
    maxShare: 0.09,
    minPixels: 36,
    maxPixels: 72,
  },
  inspector: {
    key: "layout-inspector-share",
    axis: "width",
    defaultShare: 0.278,
    minShare: 0.18,
    maxShare: 0.45,
    minPixels: 260,
    maxPixels: 720,
    maxViewportShare: 0.57,
  },
  sidebar: {
    key: "layout-sidebar-share",
    axis: "width",
    defaultShare: 0.039,
    minShare: 0.032,
    maxShare: 0.075,
    minPixels: 53,
    maxPixels: 96,
  },
};

/** The viewport dimension a region is measured against. */
function axisSize(region: LayoutRegionDefinition, viewport: LayoutViewport): number {
  return region.axis === "width" ? viewport.width : viewport.height;
}

/**
 * The pixel range a region may occupy at the current viewport.
 *
 * The viewport-relative ceiling is resolved here rather than in CSS, because the
 * seam has to propose the same numbers the browser clamps to.
 */
export function regionBounds(
  region: LayoutRegionDefinition,
  viewport: LayoutViewport,
): { min: number; max: number } {
  const dimension = axisSize(region, viewport);
  const ceiling =
    region.maxViewportShare === undefined
      ? Number.POSITIVE_INFINITY
      : dimension * region.maxViewportShare;
  const max = Math.max(Math.round(Math.min(region.maxPixels, ceiling) * 100) / 100, 0);
  return { min: Math.round(Math.min(region.minPixels, max) * 100) / 100, max };
}

/** One share, resolved to the pixels the region paints at this viewport. */
export function regionPixels(
  region: LayoutRegionDefinition,
  share: number,
  viewport: LayoutViewport,
): number {
  const dimension = axisSize(region, viewport);
  const { min, max } = regionBounds(region, viewport);
  const pixels = (Number.isFinite(share) ? share : region.defaultShare) * dimension;
  return Math.round(Math.min(Math.max(pixels, min), max) * 100) / 100;
}

/**
 * The share that paints one pixel size, kept inside both the pixel bounds and
 * the range the settings control accepts.
 */
export function shareForPixels(
  region: LayoutRegionDefinition,
  pixels: number,
  viewport: LayoutViewport,
): number {
  const dimension = axisSize(region, viewport);
  if (!(dimension > 0) || !Number.isFinite(pixels)) {
    return region.defaultShare;
  }
  const bounded = regionPixels(region, pixels / dimension, viewport);
  return Math.min(Math.max(bounded / dimension, region.minShare), region.maxShare);
}

/** A share as the decimal string the value store persists. */
export function formatShare(share: number): string {
  return String(Number(share.toFixed(5)));
}
