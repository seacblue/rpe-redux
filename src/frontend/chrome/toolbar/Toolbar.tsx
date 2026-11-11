/**
 * The toolbar frame.
 *
 * The shared host filters registered entries by the authoring surface and hands
 * them to its `toolbarRows` renderer. Entries keep registry order and the
 * transport host stays in its stable trailing position; window placement is
 * host-owned rather than a theme choice.
 */
import { useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { toolbar, type ToolbarEntry } from "../../../core/shell/registries/toolbar.ts";
import { values } from "../../../core/state/values.ts";
import { TransportHost } from "../transport/TransportHost.tsx";
import { DefaultToolbarRows } from "./DefaultToolbarRows.tsx";
import { ToolbarScrollControls } from "./ToolbarScrollControls.tsx";
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
 * draw no toolbar node.
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
  const row1 = entries.some((entry) => entry.row === 1);
  const row2 = entries.some((entry) => entry.row === 2);
  const rows = Number(row1) + Number(row2);
  const ToolbarRows = SurfaceToolbarRows ?? DefaultToolbarRows;
  return (
    <div
      ref={toolbarRef}
      className="redux-toolbar"
      role="toolbar"
      hidden={hidden || rows === 0}
      data-rows={rows}
      data-toolbar-narrow={toolbarOverflow.isNarrow ? "true" : "false"}
      data-toolbar-scroll-start={toolbarOverflow.canScrollStart ? "true" : "false"}
      data-toolbar-scroll-end={toolbarOverflow.canScrollEnd ? "true" : "false"}
    >
      <div className="redux-toolrows">
        <ToolbarRows entries={entries} />
      </div>
      <ToolbarScrollControls toolbarRef={toolbarRef} onStateChange={setToolbarOverflow} />
      <TransportHost />
    </div>
  );
}
