/**
 * The toolbar frame.
 *
 * The shared host filters registered entries by the authoring surface and hands
 * them to its `toolbarRows` renderer. Entries keep registry order and the
 * transport host stays in its stable trailing position; window placement is
 * host-owned rather than a theme choice.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { Splitter } from "../../../design/components/splitter/Splitter.tsx";
import { toolbar, type ToolbarEntry } from "../../../core/shell/registries/toolbar.ts";
import { values } from "../../../core/state/values.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { useLayoutRegion, useViewportSize } from "../../app/layout/useLayoutProportions.ts";
import { TransportHost } from "../transport/TransportHost.tsx";
import { DefaultToolbarRows } from "./DefaultToolbarRows.tsx";
import { ToolbarScrollbar } from "./ToolbarScrollbar.tsx";
import type { ToolbarOverflowState } from "./toolbarOverflow.ts";

/** The surface's own toolbar rows; omitted falls back to the shared action rows. */
type ToolbarRows = ComponentType<{
  entries: readonly ToolbarEntry[];
  flow?: "rows" | "single" | "grid";
}>;

/**
 * The toolbar frame.
 *
 * Rows come from the registry, so a feature or plugin adds to them by
 * registering rather than by editing this file. Commands that live in a menu
 * draw no toolbar node. A toolbar that overflows scrolls as one surface under a
 * single horizontal bar; there are no arrow buttons to step through it.
 */
export function Toolbar({
  hidden = false,
  rows: SurfaceToolbarRows,
}: {
  hidden?: boolean;
  /** The active surface's toolbar rows; omitted uses the default action rows. */
  rows?: ToolbarRows;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarOverflow, setToolbarOverflow] = useState<ToolbarOverflowState>({
    isNarrow: false,
    canScrollStart: false,
    canScrollEnd: false,
  });
  const entries = useSyncExternalStore(toolbar.subscribe, toolbar.getSnapshot);
  useSyncExternalStore(values.byId.subscribeAll, values.getVersion);
  // A horizontal run has no vertical scroll to give a normal wheel to, so the
  // toolbar maps the wheel onto its own axis. Both rows and the shared bar move
  // together, because the rows are the scroll region and the bar follows them.
  useEffect(() => {
    const node = toolbarRef.current;
    if (!node) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      if (node.dataset.toolbarOverflow !== "true") {
        return;
      }
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      for (const line of node.querySelectorAll<HTMLElement>(".redux-toolbar-line")) {
        line.scrollLeft += delta;
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  const row1 = entries.some((entry) => entry.row === 1);
  const row2 = entries.some((entry) => entry.row === 2);
  const rows = Number(row1) + Number(row2);
  const ToolbarRows = SurfaceToolbarRows ?? DefaultToolbarRows;
  const progressSeam = useLayoutRegion("progress", useViewportSize());
  const { t } = useTranslation();
  return (
    <div
      ref={toolbarRef}
      className="redux-toolbar"
      role="toolbar"
      hidden={hidden || rows === 0}
      data-rows={rows}
      data-toolbar-narrow={toolbarOverflow.isNarrow ? "true" : "false"}
      data-toolbar-overflow={toolbarOverflow.isNarrow ? "true" : "false"}
      data-toolbar-scroll-start={toolbarOverflow.canScrollStart ? "true" : "false"}
      data-toolbar-scroll-end={toolbarOverflow.canScrollEnd ? "true" : "false"}
    >
      <div className="redux-toolrows" id="toolbar-rows">
        <ToolbarRows entries={entries} />
      </div>
      <Splitter
        orientation="vertical"
        className="layout-splitter--progress"
        label={t("chrome.splitter.progress")}
        value={progressSeam.value}
        min={progressSeam.min}
        max={progressSeam.max}
        defaultValue={progressSeam.defaultValue}
        onChange={progressSeam.setPixels}
        invert
      />
      <ToolbarScrollbar toolbarRef={toolbarRef} onStateChange={setToolbarOverflow} />
      <TransportHost />
    </div>
  );
}
