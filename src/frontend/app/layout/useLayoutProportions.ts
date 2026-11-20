/**
 * React binding for the shell's panel sizes.
 *
 * The scale values are published on the document root so the stylesheet can
 * derive every panel size without a layout pass in JavaScript. The same number is
 * the contents' scale, so a panel that grows draws larger buttons, glyphs, type,
 * and gaps instead of an empty track around authored contents.
 *
 * The seam on each panel edits pixels and stores the equivalent scale, which is
 * what keeps a drag and the settings slider writing one value.
 */
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { values } from "../../../core/state/values.ts";
import { useSetting } from "../../screens/settings/useSetting.ts";
import {
  LAYOUT_REGIONS,
  formatScale,
  regionBounds,
  regionPixels,
  regionScale,
  scaleForPixels,
  type LayoutRegionId,
  type LayoutViewport,
} from "../../../core/shell/layoutProportions.ts";

/** Subscribe to the viewport's CSS size. */
function subscribeViewport(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/**
 * The density factor one region is drawn at.
 *
 * A CSS pixel is already the host's scaled unit, so a 4K panel at 200% reads like a
 * 1080p panel and needs nothing extra. A 4K panel at 100% does not: the same 90px
 * toolbar is a third of the visual size, and a profile that looked right on a
 * laptop looks like a strip of hairline icons there. This factor restores the
 * authored visual size by following the panel's pixel ratio, and is flat for the
 * ordinary 1x and 2x cases.
 */
function densityFactor(): number {
  const ratio = window.devicePixelRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }
  // Clamped so an exotic display cannot blow the chrome up beyond its own range.
  return Math.min(1.6, Math.max(1, ratio));
}

/** Subscribe to a density change, which follows the window and the display. */
function subscribeDensity(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  window.addEventListener("redux-display-change", listener);
  return () => {
    window.removeEventListener("resize", listener);
    window.removeEventListener("redux-display-change", listener);
  };
}

/** Read the viewport size React can re-render against. */
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
  return { width, height };
}

/** One region's live size and the write its seam performs. */
export interface LayoutRegionController {
  /** The painted size in CSS pixels. */
  value: number;
  min: number;
  max: number;
  /** The size restored by a double click. */
  defaultValue: number;
  /** Store a proposed pixel size as the equivalent scale. */
  setPixels(pixels: number): void;
}

/**
 * Publish every region's scale.
 *
 * One custom property per region carries the number: the stylesheet multiplies
 * the authored size by it, so the box and its contents cannot drift apart.
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
  // A window dragged to a denser or larger display re-reads this rather than
  // keeping the factors the first monitor reported.
  const density = useSyncExternalStore(subscribeDensity, densityFactor, () => 1);
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--layout-density", formatScale(density));
    style.setProperty("--layout-toolbar-scale", toolbar);
    style.setProperty("--layout-statusbar-scale", statusbar);
    style.setProperty("--layout-inspector-scale", inspector);
    style.setProperty("--layout-sidebar-scale", sidebar);
    style.setProperty("--layout-progress-scale", progress);
    return () => {
      style.removeProperty("--layout-density");
      style.removeProperty("--layout-toolbar-scale");
      style.removeProperty("--layout-statusbar-scale");
      style.removeProperty("--layout-inspector-scale");
      style.removeProperty("--layout-sidebar-scale");
      style.removeProperty("--layout-progress-scale");
    };
  }, [density, toolbar, statusbar, inspector, sidebar, progress]);
}

/** Read one region's scale as the live controller its splitter edits. */
export function useLayoutRegion(
  id: LayoutRegionId,
  viewport: LayoutViewport,
): LayoutRegionController {
  const region = LAYOUT_REGIONS[id];
  const stored = useSetting<string>(region.key, formatScale(region.defaultScale));
  const scale = Number(stored);
  const { min, max } = regionBounds(region, viewport);
  const { width, height } = viewport;
  const setPixels = useCallback(
    (pixels: number) => {
      const next = scaleForPixels(region, pixels, { width, height });
      values.byId.set(region.key, formatScale(next));
    },
    [region, width, height],
  );
  return {
    value: regionPixels(region, scale, viewport),
    min,
    max,
    defaultValue: regionPixels(region, region.defaultScale, viewport),
    setPixels,
  };
}

/** The contents scale one region paints at, read outside React. */
export function regionContentScale(id: LayoutRegionId, viewport: LayoutViewport): number {
  const region = LAYOUT_REGIONS[id];
  const stored = values.byId.has(region.key)
    ? values.byId.get<string>(region.key)
    : formatScale(region.defaultScale);
  return regionScale(region, Number(stored), viewport);
}
