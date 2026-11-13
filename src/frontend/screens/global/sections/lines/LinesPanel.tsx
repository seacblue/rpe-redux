/**
 * Mounts the line form for the current snapshot.
 *
 * The revision keys the properties face, so its uncontrolled fields remount
 * instead of reconciling stale default values. The line list face stays mounted
 * across commits: folder disclosure, the add-group form, and drag state must
 * survive adding, renaming, or moving lines.
 *
 * The selection itself is shared with the toolbar (`editor.lineSelection`); a
 * selected folder uses `editor.lineFolderGroup` instead and leaves the line
 * selection empty. The two modes are mutually exclusive. A multi-line selection
 * is only a set of lines; it does not enable multi-line timeline editing. That
 * switch stays in the multi-line inspector.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LinePanelView } from "./LinePanel.tsx";
import type { LineInspectorView } from "./LinePanel.tsx";
import { useEditorRuntimeValue } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import type { LinePanelSnapshot } from "./model.ts";
import { lineTreeKey } from "./lineTreeModel.ts";
import {
  bindLineSelectionInvariant,
  setSelectedLineFolder,
  setSelectedLineIndices,
} from "./lineSelectionMode.ts";
import { lineGroupLabels } from "../../../editor/workspace/lineLabels.ts";
import { values } from "../../../../../core/state/values.ts";
import { OPEN_LINE_PROPERTIES_EVENT } from "../../../../../core/shell/shellEventNames.ts";
import type { GlobalView } from "../../globalView.ts";

const EMPTY_SELECTION: readonly number[] = Object.freeze([]);
const EMPTY_ID_SELECTION: ReadonlySet<string> = Object.freeze(new Set<string>());

/** The toolbar-owned selection, as indices into the current chart. */
function useSharedLineSelection(): readonly number[] {
  return useSyncExternalStore(
    useCallback((listener) => values.byId.subscribe("editor.lineSelection", listener), []),
    useCallback(
      () => values.byId.get<readonly number[]>("editor.lineSelection") ?? EMPTY_SELECTION,
      [],
    ),
    () => EMPTY_SELECTION,
  );
}

/** The selected folder in folder mode, or null while lines are selected. */
function useSharedLineFolderGroup(): number | null {
  return useSyncExternalStore(
    useCallback((listener) => values.byId.subscribe("editor.lineFolderGroup", listener), []),
    useCallback(() => values.byId.get<number | null>("editor.lineFolderGroup") ?? null, []),
    () => null,
  );
}

/** Mounts the line form for the current snapshot and keeps the toolbar selection in sync. */
export function LinesPanel({
  showTitle = true,
  variant = "all",
}: {
  showTitle?: boolean;
  variant?: "all" | "tree" | "properties" | "stacked" | "split";
} = {}) {
  const linePanel = useEditorRuntimeValue(
    (runtime) => runtime.ui.linePanel,
    null as LinePanelSnapshot | null,
  );
  const textureTriggerRef = useRef<HTMLButtonElement>(null);
  const [textureBrowserOpen, setTextureBrowserOpen] = useState(false);
  const [lineView, setLineView] = useState<LineInspectorView>("lines");
  const layout: GlobalView = "list";
  const [collapsedLineGroups, setCollapsedLineGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const chart = linePanel?.props.session.chart;
  const lineIndex = linePanel?.props.session.lineIndex ?? 0;
  const lines = chart?.judgeLineList ?? [];
  const labels = lineGroupLabels(chart);
  const existing = new Set(lines.map((unused, index) => lineTreeKey(lines, index)));
  const primary = lineTreeKey(lines, lineIndex);
  const sharedSelection = useSharedLineSelection();
  const sharedFolderGroup = useSharedLineFolderGroup();
  const selectedFromToolbar = new Set(
    sharedSelection
      .filter((index) => Number.isInteger(index) && index >= 0 && index < lines.length)
      .map((index) => lineTreeKey(lines, index)),
  );
  const present = new Set([...selectedFromToolbar].filter((id) => existing.has(id)));
  // Folder mode is only valid with an empty line selection, so the two modes
  // never describe different selections at the same time.
  const folderGroup =
    sharedFolderGroup !== null &&
    Number.isInteger(sharedFolderGroup) &&
    sharedFolderGroup >= 0 &&
    sharedFolderGroup < labels.length &&
    sharedSelection.length === 0
      ? sharedFolderGroup
      : null;
  // Selection is derived from stable line ids, not remounted form state. A
  // selection that no longer contains the active line collapses to that line.
  // Folder mode has no selected line, but the active line stays highlighted.
  const selectedLineIds =
    folderGroup !== null ? EMPTY_ID_SELECTION : present.has(primary) ? present : new Set([primary]);
  const effectiveLineView: LineInspectorView =
    variant === "properties" ? "properties" : variant === "tree" ? "lines" : lineView;

  useEffect(() => {
    // Bind the selection-mode rule before any external writer can set a line
    // selection while the tree is open.
    bindLineSelectionInvariant();
    const showProperties = () => setLineView("properties");
    window.addEventListener(OPEN_LINE_PROPERTIES_EVENT, showProperties);
    return () => window.removeEventListener(OPEN_LINE_PROPERTIES_EVENT, showProperties);
  }, []);

  // Entering the global sidebar with several toolbar-selected lines should land
  // on the batch form. Once the panel is open, changing the selection must not
  // interrupt tree interaction.
  const hadSnapshot = useRef(false);
  useEffect(() => {
    const becameAvailable = !hadSnapshot.current && linePanel !== null;
    hadSnapshot.current = linePanel !== null;
    if (variant === "all" && becameAvailable && selectedLineIds.size > 1) {
      setLineView("properties");
    }
  }, [linePanel, selectedLineIds.size, variant]);

  const toggleLineGroup = (name: string) => {
    setCollapsedLineGroups((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const changeTextureBrowser = (open: boolean) => {
    setTextureBrowserOpen(open);
    if (!open) {
      requestAnimationFrame(() => {
        textureTriggerRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const changeLineSelection = (ids: ReadonlySet<string>) => {
    // Read the session's current chart rather than the render snapshot: a drop
    // commits a reorder immediately before it reports the moved block, so the
    // stable ids must be resolved against the new indices.
    const currentLines = linePanel?.props.session.chart.judgeLineList ?? lines;
    const indexById = new Map(
      currentLines.map((unused, index) => [lineTreeKey(currentLines, index), index] as const),
    );
    const indices = [...ids]
      .map((id) => indexById.get(id))
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    setSelectedLineIndices(indices);
  };

  const selectFolder = (group: number | null) => setSelectedLineFolder(group);

  if (!linePanel) {
    return null;
  }
  return (
    <LinePanelView
      {...linePanel.props}
      snapshotRevision={linePanel.revision}
      selectedLineIds={selectedLineIds}
      selectedFolderGroup={folderGroup}
      collapsedLineGroups={collapsedLineGroups}
      onToggleLineGroup={toggleLineGroup}
      onLineSelectionChange={changeLineSelection}
      onSelectFolder={selectFolder}
      lineView={effectiveLineView}
      onLineViewChange={setLineView}
      treeLayout={layout}
      textureBrowserOpen={textureBrowserOpen}
      textureTriggerRef={textureTriggerRef}
      onTextureBrowserOpen={changeTextureBrowser}
      showTitle={showTitle}
      variant={variant}
    />
  );
}
