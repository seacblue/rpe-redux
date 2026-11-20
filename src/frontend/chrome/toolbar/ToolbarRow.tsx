/**
 * One toolbar row shared by the default chrome rows and the editor rows.
 *
 * The row owns the visible-entry filter, the merged-flow seam cleanup, the
 * container attributes, and the Fragment key. A caller supplies only the node
 * renderer, so its kind set (the editor adds fields) stays its own choice.
 *
 * When the user has arranged the toolbar, the arrangement decides which row an
 * item sits in and in what order, so the registered `row` field is not consulted
 * for placement any more; only its visibility gates still apply.
 *
 * While the layout editor arranges this surface, the row publishes the box of each
 * item it painted and takes the pointer itself. Nothing is wrapped: the row's
 * child selectors are what give every action its one-cell width, and an extra
 * element between them would collapse the whole line.
 */
import { Fragment, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import type { ToolbarEntry, ToolbarRowName } from "../../../core/shell/registries/toolbar.ts";
import {
  layoutEditorOpen,
  layoutEditorSurface,
  paintedLayout,
} from "../../../core/shell/layoutEditorState.ts";
import { hasSurfaceLayout } from "../../../core/shell/layoutArrangement.ts";
import { useLayoutEditSurface } from "../../app/layout/useLayoutEditSurface.ts";
import { arrangedToolbarRow } from "./toolbarArrangement.ts";
import { continuousEntries, visibleToolbarEntries } from "./toolbarEntries.ts";

/** How the toolbar lays rows out: registered rows, one line, or grid columns. */
export type ToolbarRowFlow = "rows" | "single" | "grid";

export interface ToolbarRowProps {
  /** Omitted for a merged single line or grid, where every registered row joins. */
  row?: ToolbarRowName;
  entries: readonly ToolbarEntry[];
  flow?: ToolbarRowFlow;
  /** Draws one entry; the row supplies the translator for runtime labels. */
  renderEntry(entry: ToolbarEntry, tRaw: (key: string) => string): ReactNode;
}

/** One toolbar row; renders nothing when no entry in the row is visible. */
export function ToolbarRow({ row, entries, flow = "rows", renderEntry }: ToolbarRowProps) {
  const { tRaw } = useTranslation();
  const arrangement = useSyncExternalStore(
    paintedLayout.subscribe,
    paintedLayout.get,
    paintedLayout.get,
  );
  const editing = useSyncExternalStore(
    layoutEditorOpen.subscribe,
    layoutEditorOpen.get,
    layoutEditorOpen.get,
  );
  const editingSurface = useSyncExternalStore(
    layoutEditorSurface.subscribe,
    layoutEditorSurface.get,
    layoutEditorSurface.get,
  );
  const lineRef = useRef<HTMLDivElement>(null);
  // An arranged surface has already chosen this row's contents, so the filter
  // must not re-apply the registered row: that would undo every move the user
  // made between the two rows.
  const arranged = row !== undefined && hasSurfaceLayout(arrangement, "toolbar");
  const rowEntries = visibleToolbarEntries(
    arranged ? arrangedToolbarRow(entries, row, arrangement) : entries,
    arranged ? undefined : row,
  );
  const drawn = flow === "rows" ? rowEntries : continuousEntries(rowEntries);
  const isEdited = editing && editingSurface === "toolbar" && row !== undefined;

  useLayoutEditSurface({
    surface: "toolbar",
    slot: (row ?? 1) as 1 | 2,
    axis: "x",
    ids: drawn.map((entry) => entry.id),
    selector: ":scope > *",
    active: isEdited,
    container: lineRef,
  });

  if (drawn.length === 0) {
    return null;
  }
  return (
    <div
      ref={lineRef}
      className="redux-toolbar-line"
      data-toolbar-line={row ?? "all"}
      data-flow={flow}
      data-layout-surface={isEdited ? "toolbar" : undefined}
    >
      {drawn.map((entry) => (
        <Fragment key={entry.id}>{renderEntry(entry, tRaw)}</Fragment>
      ))}
    </div>
  );
}
