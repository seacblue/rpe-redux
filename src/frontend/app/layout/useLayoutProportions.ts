/**
 * React binding for the shell's panel sizes.
 *
 * The stored scale values and the factors their contents actually paint at are
 * published on the document root, so the stylesheet can derive every panel size
 * without a layout pass in JavaScript. The content factor includes the display
 * density, the host factor, the continuous viewport factor, and the viewport
 * ceiling; the box and everything drawn inside it read that one number, so
 * neither can keep growing after the panel reaches a bound.
 *
 * The seam on each panel edits painted pixels and stores the equivalent scale,
 * which is what keeps a drag and the settings slider writing one value.
 */
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { values } from "../../../core/state/values.ts";
import { useSetting } from "../../screens/settings/useSetting.ts";
import {
  LAYOUT_REGIONS,
  displayScale,
  formatScale,
  regionBounds,
  regionPixels,
  regionScale,
  scaleForPixels,
  type LayoutRegionId,
  type LayoutViewport,
} from "../../../core/shell/layoutProportions.ts";
import { hostLayoutScale, viewportLayoutScale } from "./layoutScale.ts";

/**
 * Subscribe to the viewport size and the display's pixel ratio.
 *
 * Moving the window to a display with a different scale does not always resize
 * the window, so the resolution media query is watched beside `resize`. The query
 * matches one ratio at a time, so it is re-armed for the new ratio after each
 * change.
 */
function subscribeViewport(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  let media: MediaQueryList | null = null;
  const onResolutionChange = () => {
    armResolution();
    listener();
  };
  const armResolution = () => {
    media?.removeEventListener("change", onResolutionChange);
    media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    media.addEventListener("change", onResolutionChange);
  };
  armResolution();
  return () => {
    window.removeEventListener("resize", listener);
    media?.removeEventListener("change", onResolutionChange);
  };
}

/**
 * The density factor the shell is drawn at.
 *
 * A CSS pixel is already the host's scaled unit, so a 4K panel at 200% reads like a
 * 1080p panel and needs nothing extra. A 4K panel at 100% does not: the same 90px
 * toolbar is a third of the visual size, and a profile that looked right on a
 * laptop looks like a strip of hairline icons there. This factor restores the
 * authored visual size by following the panel's pixel ratio, and is flat for the
 * ordinary 1x and 2x cases.
 *
 * It is clamped so an exotic display cannot blow the chrome up beyond its own
 * range; the model multiplies it into every painted size, so the default sizes in
 * this profile differ from display to display.
 */
function densityFactor(): number {
  const ratio = window.devicePixelRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }
  return Math.min(1.6, Math.max(1, ratio));
}

/** Read the display density through the viewport subscription. */
function useDensity(): number {
  return useSyncExternalStore(subscribeViewport, densityFactor, () => 1);
}

/**
 * Read the viewport size and every display factor React can re-render against.
 *
 * The host factor is shared by both hosts, so a profile paints the same size in
 * the app window and in a browser page. The viewport factor is the continuous
 * window or page share, recomputed on every resize.
 */
export function useViewportSize(): LayoutViewport {
  const width = useSyncExternalStore(
    subscribeViewport,
    () => window.innerWidth,
    () => window.innerWidth,
  );
  const height = useSyncExternalStore(
    subscribeViewport,
    () => window.innerHeight,
    () => window.innerHeight,
  );
  return {
    width,
    height,
    density: useDensity(),
    hostScale: hostLayoutScale(),
    viewportScale: viewportLayoutScale(width, height),
  };
}

/** One region's live size and the write its seam performs. */
export interface LayoutRegionController {
  /** The painted size in CSS pixels. */
  value: number;
  min: number;
  max: number;
  /** The painted size restored by a double click. */
  defaultValue: number;
  /** The factor the region's own contents paint at. */
  contentScale: number;
  /** Store a proposed painted pixel size as the equivalent scale. */
  setPixels(pixels: number): void;
}

/**
 * Publish every region's stored scale and its painted content factor.
 *
 * One pair of custom properties per region carries the numbers: the stylesheet
 * multiplies the authored size by the content factor, so the box and its contents
 * cannot drift apart. The stored scale stays published for the settings row and
 * for the fallback the stylesheet uses before this effect runs.
 */
export function useLayoutProportions(): void {
  const toolbar = useSetting<string>(
    LAYOUT_REGIONS.toolbar.key,
    formatScale(LAYOUT_REGIONS.toolbar.defaultScale),
  );
  const statusbar = useSetting<string>(
    LAYOUT_REGIONS.statusbar.key,
    formatScale(LAYOUT_REGIONS.statusbar.defaultScale),
  );
  const inspector = useSetting<string>(
    LAYOUT_REGIONS.inspector.key,
    formatScale(LAYOUT_REGIONS.inspector.defaultScale),
  );
  const sidebar = useSetting<string>(
    LAYOUT_REGIONS.sidebar.key,
    formatScale(LAYOUT_REGIONS.sidebar.defaultScale),
  );
  const progress = useSetting<string>(
    LAYOUT_REGIONS.progress.key,
    formatScale(LAYOUT_REGIONS.progress.defaultScale),
  );
  // A window dragged to a denser or larger display re-reads the factors rather
  // than keeping the ones the first frame reported.
  const { width, height, density = 1, hostScale = 1, viewportScale = 1 } = useViewportSize();
  useLayoutEffect(() => {
    const display = { width, height, density, hostScale, viewportScale };
    const style = document.documentElement.style;
    style.setProperty("--layout-density", formatScale(density));
    style.setProperty("--layout-display-scale", formatScale(displayScale(display)));
    const publish = (id: LayoutRegionId, stored: string, hostContentScale?: number) => {
      const region = LAYOUT_REGIONS[id];
      style.setProperty(`--layout-${id}-scale`, stored);
      style.setProperty(
        `--layout-${id}-content-scale`,
        formatScale(regionScale(region, Number(stored), display, hostContentScale)),
      );
    };
    // The transport card is hosted by the toolbar, so its content floor follows
    // the toolbar's painted content factor instead of the authored one.
    const toolbarContentScale = regionScale(LAYOUT_REGIONS.toolbar, Number(toolbar), display);
    publish("toolbar", toolbar);
    publish("statusbar", statusbar);
    publish("inspector", inspector);
    publish("sidebar", sidebar);
    publish("progress", progress, toolbarContentScale);
    return () => {
      style.removeProperty("--layout-density");
      style.removeProperty("--layout-display-scale");
      for (const id of Object.keys(LAYOUT_REGIONS) as LayoutRegionId[]) {
        style.removeProperty(`--layout-${id}-scale`);
        style.removeProperty(`--layout-${id}-content-scale`);
      }
    };
  }, [
    width,
    height,
    density,
    hostScale,
    viewportScale,
    toolbar,
    statusbar,
    inspector,
    sidebar,
    progress,
  ]);
}

/**
 * Read one region's scale as the live controller its splitter edits.
 *
 * `hostContentScale` is the painted content factor of the region that hosts this
 * one; only a region with a content floor uses it. The transport card passes the
 * toolbar's factor so its own seam stops where its readouts stop fitting.
 */
export function useLayoutRegion(
  id: LayoutRegionId,
  viewport: LayoutViewport,
  hostContentScale?: number,
): LayoutRegionController {
  const region = LAYOUT_REGIONS[id];
  const stored = useSetting<string>(region.key, formatScale(region.defaultScale));
  const scale = Number(stored);
  const { min, max } = regionBounds(region, viewport, hostContentScale);
  const { width, height, density, hostScale, viewportScale } = viewport;
  const setPixels = useCallback(
    (pixels: number) => {
      const next = scaleForPixels(
        region,
        pixels,
        { width, height, density, hostScale, viewportScale },
        hostContentScale,
      );
      values.byId.set(region.key, formatScale(next));
    },
    [region, width, height, density, hostScale, viewportScale, hostContentScale],
  );
  return {
    value: regionPixels(region, scale, viewport, hostContentScale),
    min,
    max,
    defaultValue: regionPixels(region, region.defaultScale, viewport, hostContentScale),
    contentScale: regionScale(region, scale, viewport, hostContentScale),
    setPixels,
  };
}
