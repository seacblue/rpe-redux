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
}

/** Publish the scroll range for the currently visible multi-line area. */
export function syncMultiLineChrome(
  layout: MultiLineChromeLayout,
  area: TimelineArea,
  width: number,
): void {
  const session = layout.getSession();
  const visible =
    area === "notes" ? session.notesMode !== "single" : session.eventsMode === "multi";
  const count = layout.panelCount(area);
  const total =
    count * layout.panelWidth(width, area) + Math.max(0, count - 1) * layout.panelGap(width, area);
  const maximum = Math.max(0, total - width);
  const scroll =
    typeof layout.multiLineScroll === "number"
      ? layout.multiLineScroll
      : (layout.multiLineScroll[area] ?? 0);
  const max = String(maximum);
  const value = String(Math.min(maximum, Math.max(0, scroll)));
  const previous = layout.multiLineScrollState.snapshot.get();
  if (previous.visible === visible && previous.max === max && previous.value === value) {
    return;
  }
  layout.multiLineScrollState.snapshot.set({ visible, max, value });
}
