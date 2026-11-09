/** Workspace authoring surface: canvas slots, layer selector, stage toasts, and thumbnail. */
import { useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import { useSetting } from "../../../../settings/useSetting.ts";
import { LayerButtonsOverlay } from "../../timeline/layers/LayerButtonsOverlay.tsx";
import { TimelineThumbnailView } from "../../timeline/overview/TimelineThumbnail.tsx";
import { TimelineCanvases } from "../../timeline/surface/TimelineCanvases.tsx";
import {
  getEditorRegionSnapshot,
  subscribeToEditorRegions,
  type EditorRegionSnapshot,
} from "../../runtime/commands/viewControls.ts";

/** Builds the canvas visibility classes from the effective region snapshot. */
function editorClassName(regions: EditorRegionSnapshot): string {
  const classes = ["editor"];
  const showNotes = regions.showNotes;
  const showEvents = regions.showEvents;
  const multiLineActive = regions.multiLineActive;
  const multiLineMode = regions.multiLineMode;
  const multiLineMerge = regions.multiLineMerge;
  if (!showNotes) {
    classes.push("notes-hidden");
  }
  if (!showEvents) {
    classes.push("events-hidden");
  }
  // Multi-line editing shows one field at a time, so the region controls act
  // as an exclusive choice; merged notes keep the single-field width.
  if (multiLineActive && multiLineMode === "notes" && showNotes) {
    classes.push("multi-notes");
    if (!multiLineMerge) {
      classes.push("multi-fill");
    }
  }
  if (multiLineActive && multiLineMode === "events" && showEvents) {
    classes.push("multi-events");
    classes.push("multi-fill");
  }
  if (!multiLineActive && !showNotes && showEvents) {
    classes.push("events-only");
  }
  return classes.join(" ");
}

/**
 * Owns the authoring surface below the workspace seam: it maps the region
 * snapshot to visibility classes and mounts the canvas, toast, and thumbnail
 * slots in order. Timeline behavior and document state live elsewhere.
 */
export function Editor() {
  const regions = useSyncExternalStore(
    subscribeToEditorRegions,
    getEditorRegionSnapshot,
    getEditorRegionSnapshot,
  );
  const densityBarsEnabled = useSetting("timeline-density-bars-enabled", true);
  const exclusiveWidthSetting = useSetting("timeline-exclusive-width", "75");
  const exclusiveWidth = Math.max(0, Math.min(100, Number(exclusiveWidthSetting) || 0));
  const exclusiveRatio = exclusiveWidth / 100;
  const stripWidthSetting = useSetting("timeline-overview-strip-width", "24");
  const stripWidth = Math.max(0, Math.min(64, Number(stripWidthSetting) || 0));
  const className = `${editorClassName(regions)}${densityBarsEnabled ? "" : " density-bars-hidden"}`;
  useLayoutEffect(() => {
    // The grid tracks and canvas hosts change together. Resolve the new sizes in
    // the layout phase so the first painted frame already uses the final layout.
    window.dispatchEvent(new Event("resize"));
  }, [className, exclusiveWidth, stripWidth]);
  return (
    <div
      className={className}
      style={
        {
          "--timeline-exclusive-width": `${exclusiveWidth}%`,
          "--timeline-exclusive-ratio": exclusiveRatio,
          "--timeline-strip-width": `${stripWidth}px`,
        } as CSSProperties
      }
    >
      <div className="canvases">
        <TimelineCanvases />
        {/* The layer selector is a cell of the canvas grid, not an overlay. */}
        <LayerButtonsOverlay />
        <TimelineThumbnailView />
      </div>
    </div>
  );
}
