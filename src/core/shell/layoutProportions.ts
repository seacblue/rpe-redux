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
 * The display's density multiplies every painted size, so one stored scale keeps
 * its authored visual size when the window moves to a denser panel. Two more
 * factors multiply the same way: the host factor makes the web build a quarter
 * larger than the desktop app, and the viewport factor follows the window or page
 * size continuously. Pixels in this model are the painted CSS pixels the seam
 * sees, not the authored ones; the scale stays the portable number the settings
 * row and the drag write.
 *
 * A width panel still answers to the window: at a large scale on a narrow window
 * it lands on its viewport ceiling, and its contents scale down with the box
 * instead of spilling out of it. A panel may also have a content floor, which is
 * the authored minimum its own controls demand, scaled by the content scale of
 * the region that hosts it.
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
  /** The scale a fresh profile starts with, multiplied by the display density. */
  readonly defaultScale: number;
  /** The scale the range control and the drag gesture accept. */
  readonly minScale: number;
  readonly maxScale: number;
  /** The size the region and its contents were authored for, in CSS pixels. */
  readonly basePixels: number;
  /** Optional viewport ceiling, in painted CSS pixels. */
  readonly maxViewportShare?: number;
  /**
   * Optional authored width the region's own controls need at content scale 1.
   *
   * The floor is multiplied by the host region's content scale, so a card inside
   * a scaled toolbar keeps enough room for its readouts instead of letting the
   * drag collapse it below them.
   */
  readonly contentFloorPixels?: number;
}

/** A viewport size in painted CSS pixels, with the factors its scale multiplies by. */
export interface LayoutViewport {
  width: number;
  height: number;
  /** The display pixel ratio; absent or unreadable reads as 1. */
  density?: number;
  /** The host factor, shared by the desktop app and the web page. */
  hostScale?: number;
  /** The continuous window or page factor shared by every region. */
  viewportScale?: number;
}

/**
 * The share of the authored size a fresh profile paints.
 *
 * The panels and their contents start at three quarters of the authored desktop
 * density. The authored size stays the reference the stylesheet and the maximum
 * bound use, so a profile can still grow a panel back to its authored size or
 * beyond.
 */
export const DEFAULT_LAYOUT_SCALE = 0.75;

/** Every adjustable shell region. The title bar stays a fixed caption row. */
export const LAYOUT_REGIONS: Readonly<Record<LayoutRegionId, LayoutRegionDefinition>> = {
  toolbar: {
    key: "layout-toolbar-scale",
    axis: "height",
    defaultScale: DEFAULT_LAYOUT_SCALE,
    minScale: 0.62,
    maxScale: 1.8,
    // Two 36px rows, the gap between them, the frame's vertical padding, the row
    // padding, and the 1px frame border. The border does not scale with the rest,
    // so the authored height carries a pixel of slack: at the smallest scale the
    // two rows still fit inside the frame instead of clipping by a fraction of a
    // pixel.
    basePixels: 96,
  },
  statusbar: {
    key: "layout-statusbar-scale",
    axis: "height",
    defaultScale: DEFAULT_LAYOUT_SCALE,
    // One caption row with its action. The footer compresses its own padding so
    // this floor still paints a usable bar.
    minScale: 0.65,
    maxScale: 1.6,
    basePixels: 36,
  },
  inspector: {
    key: "layout-inspector-scale",
    axis: "width",
    defaultScale: DEFAULT_LAYOUT_SCALE,
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
    defaultScale: DEFAULT_LAYOUT_SCALE,
    minScale: 0.65,
    maxScale: 1.7,
    basePixels: 56,
  },
  progress: {
    key: "layout-progress-scale",
    axis: "width",
    defaultScale: DEFAULT_LAYOUT_SCALE,
    minScale: 0.65,
    maxScale: 1.6,
    // The width the transport card was authored for; the column it sits in is this
    // plus its two inline insets.
    basePixels: 480,
    // The card shares its row with the two toolbar rows, so a wide card leaves
    // nothing for the commands. Half the window is the widest it may claim.
    maxViewportShare: 0.5,
    // The readouts and the scrubber still need this width when the card sits at
    // its smallest scale. It is authored at the default toolbar scale and grows
    // with the toolbar's content scale.
    contentFloorPixels: 312,
  },
};

/** The viewport dimension a region is measured against. */
function axisSize(region: LayoutRegionDefinition, viewport: LayoutViewport): number {
  return region.axis === "width" ? viewport.width : viewport.height;
}

/** A display factor, with a missing or unreadable value reading as 1. */
function factor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

/**
 * The product of every factor an authored pixel is painted at.
 *
 * Display density keeps the authored visual size across panels, the host factor
 * paints every host a quarter larger than the authored baseline, and the viewport
 * factor follows the window or page size continuously. All three multiply the
 * stored scale, so one drag mapping and one content factor cover the display.
 */
export function displayScale(viewport: LayoutViewport): number {
  return factor(viewport.density) * factor(viewport.hostScale) * factor(viewport.viewportScale);
}

/**
 * The content scale a host region paints at.
 *
 * A region with a content floor is hosted by a scaled region; the caller passes
 * that host's content scale. Without one, the display scale is the floor's
 * scale, which is the correct answer for a host at the authored size.
 */
function floorScale(viewport: LayoutViewport, contentScale: number | undefined): number {
  if (contentScale === undefined || !Number.isFinite(contentScale) || contentScale <= 0) {
    return displayScale(viewport);
  }
  return contentScale;
}

/** A scale the region accepts, falling back to its authored size when unreadable. */
function requestedScale(region: LayoutRegionDefinition, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return region.defaultScale;
  }
  return Math.min(Math.max(scale, region.minScale), region.maxScale);
}

/**
 * The painted pixel range a region may occupy at the current viewport.
 *
 * The ceiling is a share of the painted viewport. The minimum is the larger of
 * the authored minimum and the region's content floor, so a drag can never
 * shrink a panel below the controls it holds.
 */
export function regionBounds(
  region: LayoutRegionDefinition,
  viewport: LayoutViewport,
  hostContentScale?: number,
): { min: number; max: number } {
  const display = displayScale(viewport);
  const ceiling =
    region.maxViewportShare === undefined
      ? Number.POSITIVE_INFINITY
      : axisSize(region, viewport) * region.maxViewportShare;
  const max =
    Math.round(Math.min(region.basePixels * region.maxScale * display, ceiling) * 100) / 100;
  const floor =
    region.contentFloorPixels === undefined
      ? 0
      : region.contentFloorPixels * floorScale(viewport, hostContentScale);
  const min =
    Math.round(
      Math.min(Math.max(region.basePixels * region.minScale * display, floor), max) * 100,
    ) / 100;
  return { min: Math.max(min, 0), max: Math.max(max, 0) };
}

/**
 * The painted pixels one scale paints at this viewport.
 *
 * This is the box the stylesheet draws, so the seam and the assistive readout use
 * the same number. A width panel that would cross its viewport ceiling lands on
 * the ceiling instead, and its contents scale down with it.
 */
export function regionPixels(
  region: LayoutRegionDefinition,
  scale: number,
  viewport: LayoutViewport,
  hostContentScale?: number,
): number {
  const requested = region.basePixels * requestedScale(region, scale) * displayScale(viewport);
  const { min, max } = regionBounds(region, viewport, hostContentScale);
  return Math.min(Math.max(Math.round(requested * 100) / 100, min), max);
}

/**
 * The scale the contents actually paint at.
 *
 * Unlike the stored scale, this factor includes the display density and the
 * viewport ceiling. The stylesheet publishes it as the region's content scale, so
 * the box and everything inside it share one number and neither can keep growing
 * after the painted box has reached a bound.
 */
export function regionScale(
  region: LayoutRegionDefinition,
  scale: number,
  viewport: LayoutViewport,
  hostContentScale?: number,
): number {
  if (!(region.basePixels > 0)) {
    return 1;
  }
  const pixels = regionPixels(region, scale, viewport, hostContentScale);
  return Math.round((pixels / region.basePixels) * 10000) / 10000;
}

/**
 * The stored scale that paints one pixel size.
 *
 * The pixels are painted CSS pixels, so the density divides out here and the
 * stored value stays portable across displays. The result is bounded by the same
 * range the settings control accepts, which keeps a drag at the viewport ceiling
 * from writing a value the control would reject.
 */
export function scaleForPixels(
  region: LayoutRegionDefinition,
  pixels: number,
  viewport: LayoutViewport,
  hostContentScale?: number,
): number {
  if (!(region.basePixels > 0) || !Number.isFinite(pixels)) {
    return region.defaultScale;
  }
  const display = displayScale(viewport);
  const { min, max } = regionBounds(region, viewport, hostContentScale);
  const bounded = Math.min(Math.max(pixels, min), max);
  return Math.min(
    Math.max(bounded / (region.basePixels * display), region.minScale),
    region.maxScale,
  );
}

/** A scale as the decimal string the value store and CSS both read. */
export function formatScale(scale: number): string {
  return String(Number(scale.toFixed(4)));
}
