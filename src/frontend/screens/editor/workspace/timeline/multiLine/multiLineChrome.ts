/**
 * Computes and publishes the scroll range for the active multi-line timeline area so
 * the shared scrollbar matches the canvas panel layout.
 *
 * Panel geometry is read from the viewport; this module owns only the snapshot
 * publication.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TimelineArea, MultiLineScroll } from "../../../../../../core/edit/timeline/types.ts";
import type { MultiLineScrollState } from "./multiLineScrollBinding.ts";

/**
 * The viewport calculations needed to publish the multi-line scroll snapshot.
 * The canvas owns the full vertical space, so this seam only publishes scrolling.
 */
export interface MultiLineChromeLayout {
  readonly multiLineScrollState: MultiLineScrollState;
  readonly multiLineScroll: number | MultiLineScroll;
  getSession(): EditorSession;
  panelCount(area?: TimelineArea): number;
  panelWidth(width: number, area?: TimelineArea): number;
  panelGap(width: number, area?: TimelineArea): number;
  panelStride(width: number, area?: TimelineArea): number;
  visiblePanelRange(width: number, area?: TimelineArea): [number, number];
}

/** Publish the scroll range for the currently visible multi-line area. */
export function syncMultiLineChrome(
  layout: MultiLineChromeLayout,
  area: TimelineArea,
  width: number,
): void {
  const session = layout.getSession();
  const active = area === "notes" ? session.notesMode !== "single" : session.eventsMode === "multi";
  const validWidth = width > 0;
  const count = layout.panelCount(area);
  const total =
    count * layout.panelWidth(width, area) + Math.max(0, count - 1) * layout.panelGap(width, area);
  const maximum = Math.max(0, total - width);
  const scroll =
    typeof layout.multiLineScroll === "number"
      ? layout.multiLineScroll
      : (layout.multiLineScroll[area] ?? 0);

  const [firstPanel, lastPanel] = validWidth ? layout.visiblePanelRange(width, area) : [0, 0];
  layout.multiLineScrollState.snapshot.update({
    area: area === "notes" ? "notes" : "events",
    visible: active && validWidth && maximum > 0,
    max: String(maximum),
    value: String(Math.min(maximum, Math.max(0, scroll))),
    step: String(layout.panelStride(width, area)),
    firstPanel: String(firstPanel),
    lastPanel: String(lastPanel),
    panelCount: String(count),
  });
}
