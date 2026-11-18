/**
 * React binding for the shell's panel proportions.
 *
 * The share values are published on the document root so the stylesheet can
 * derive every panel size without a layout pass in JavaScript. One region's
 * live pixel size is exposed separately for its drag seam, which edits pixels
 * and stores the equivalent share.
 */
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { values } from "../../../core/state/values.ts";
import { useSetting } from "../../screens/settings/useSetting.ts";
import {
  LAYOUT_REGIONS,
  formatShare,
  regionBounds,
  regionPixels,
  shareForPixels,
  type LayoutRegionId,
  type LayoutViewport,
} from "../../../core/shell/layoutProportions.ts";

/** Subscribe to the viewport's CSS size. */
function subscribeViewport(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
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
  /** Store a proposed pixel size as the equivalent share. */
  setPixels(pixels: number): void;
}

/** Publish every region's share; pixel sizes stay in the stylesheet. */
export function useLayoutProportions(): void {
  const toolbar = useSetting<string>(
    LAYOUT_REGIONS.toolbar.key,
    formatShare(LAYOUT_REGIONS.toolbar.defaultShare),
  );
  const statusbar = useSetting<string>(
    LAYOUT_REGIONS.statusbar.key,
    formatShare(LAYOUT_REGIONS.statusbar.defaultShare),
  );
  const inspector = useSetting<string>(
    LAYOUT_REGIONS.inspector.key,
    formatShare(LAYOUT_REGIONS.inspector.defaultShare),
  );
  const sidebar = useSetting<string>(
    LAYOUT_REGIONS.sidebar.key,
    formatShare(LAYOUT_REGIONS.sidebar.defaultShare),
  );
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--layout-toolbar-share", toolbar);
    style.setProperty("--layout-statusbar-share", statusbar);
    style.setProperty("--layout-inspector-share", inspector);
    style.setProperty("--layout-sidebar-share", sidebar);
    return () => {
      style.removeProperty("--layout-toolbar-share");
      style.removeProperty("--layout-statusbar-share");
      style.removeProperty("--layout-inspector-share");
      style.removeProperty("--layout-sidebar-share");
    };
  }, [toolbar, statusbar, inspector, sidebar]);
}

/** Read one region's share as the live controller its splitter edits. */
export function useLayoutRegion(
  id: LayoutRegionId,
  viewport: LayoutViewport,
): LayoutRegionController {
  const region = LAYOUT_REGIONS[id];
  const stored = useSetting<string>(region.key, formatShare(region.defaultShare));
  const share = Number(stored);
  const { min, max } = regionBounds(region, viewport);
  const { width, height } = viewport;
  const setPixels = useCallback(
    (pixels: number) => {
      const next = shareForPixels(region, pixels, { width, height });
      values.byId.set(region.key, formatShare(next));
    },
    [region, width, height],
  );
  return {
    value: regionPixels(region, share, viewport),
    min,
    max,
    defaultValue: regionPixels(region, region.defaultShare, viewport),
    setPixels,
  };
}
