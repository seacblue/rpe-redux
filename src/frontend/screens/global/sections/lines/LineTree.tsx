/**
 * The judge-line folder tree: one flat folder level, multi-select rows, hover
 * delete actions, and inline folder/line creation. The list is a static
 * selector; structural edits happen through the property controls and footer.
 *
 * Selection keys are line ids rather than indices because deleting a line
 * changes every later index; the mounted panel above this view owns that stable
 * selection. Shift-drag marquees rows in the list layout, but rows and folders
 * never start a move operation.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { createLine, type Chart, type JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { deleteLine } from "../../../../../core/global/chart/line/lineEdits.ts";
import { lineGroupIndex, groupNames } from "../../../../../core/global/chart/line/lineGroups.ts";
import {
  addLineGroup,
  removeLineGroup,
  renameLineGroup,
  reorderLineGroup,
} from "../../../../../core/global/chart/line/lineTreeEdits.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { t } from "../../../../../i18n/index.ts";
import { lineGroupLabels } from "../../../editor/workspace/lineLabels.ts";
import { lineTreeKey } from "./lineTreeModel.ts";
import {
  LineTreeCreatePrompt,
  MAX_BATCH_LINES,
  type CreatePrompt,
} from "./LineTreeCreatePrompt.tsx";
import { LineTreeFooter, LineTreeMarqueeBox } from "./LineTreeChrome.tsx";
import { useLineTreeMarquee } from "./useLineTreeMarquee.ts";
import { FolderDropSection, LineCard, LineFolderSection, LineRow } from "./LineTreeRows.tsx";
import type { GlobalView } from "../../globalView.ts";

/** Props supplied by the mounted line panel; selection ids stay stable across edits. */
interface LineTreeProps {
  session: EditorSession;
  chart: Chart;
  showGroups: boolean;
  selectedLineIds: ReadonlySet<string>;
  /** The folder selected in folder mode, or null while a line is selected. */
  folderGroup: number | null;
  collapsedGroups: ReadonlySet<string>;
  scrollTopRef: { current: number | null };
  treeLayout: GlobalView;
  onToggleGroup(name: string): void;
  onSelectionChange(ids: ReadonlySet<string>): void;
  onSelectLine(index: number, scrollTop: number): void;
  onSelectFolder(group: number | null): void;
  onCommit(label: string, chart: Chart, index?: number): void;
  onNotify(message: string, kind?: string): void;
}

interface GroupRenameDraft {
  index: number;
  value: string;
}

const LONG_PRESS_MS = 480;
const CLICK_SUPPRESS_MS = 250;

/** Case-insensitive, trimmed comparison used to reject duplicate group names. */
function sameGroupName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export function LineTree({
  session,
  chart,
  showGroups,
  selectedLineIds,
  folderGroup,
  collapsedGroups,
  scrollTopRef,
  treeLayout,
  onToggleGroup,
  onSelectionChange,
  onSelectLine,
  onSelectFolder,
  onCommit,
  onNotify,
}: LineTreeProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const [createPrompt, setCreatePrompt] = useState<CreatePrompt | null>(null);
  const [renameGroup, setRenameGroup] = useState<GroupRenameDraft | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressRecord = useRef<{ fired: boolean } | null>(null);
  const suppressAddClick = useRef(false);
  const suppressTimer = useRef<number | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => chart.judgeLineList ?? [], [chart]);
  const rawNames = useMemo(() => groupNames(chart), [chart]);
  const labels = useMemo(() => lineGroupLabels(chart), [chart]);
  const folderSelected = folderGroup !== null;
  // Folder mode highlights the chosen folder. Line mode still derives the
  // footer's target folder from the active line, but folder rows stay unselected
  // because a line is the one selected row.
  const activeGroup = Math.min(
    Math.max(folderSelected ? folderGroup : lineGroupIndex(lines[session.lineIndex]), 0),
    Math.max(0, labels.length - 1),
  );
  const buckets = useMemo(() => {
    const next: number[][] = labels.map(() => []);
    // Flat order is the line number, so pushing in order keeps every folder
    // ascending even after lines move between folders.
    lines.forEach((line, index) => {
      const group = Math.min(Math.max(lineGroupIndex(line), 0), labels.length - 1);
      next[group]?.push(index);
    });
    return next;
  }, [labels, lines]);
  const lineIndices = useMemo(
    () => new Map(lines.map((line, index) => [lineTreeKey(lines, index), index])),
    [lines],
  );
  // A paged chart can hold far more rows than a DOM list can mount. Show a
  // window around the active line and leave navigation to line jump.
  const LARGE_TREE_LIMIT = 400;
  const largeTree = lines.length > 10_000;
  const windowed = (indices: readonly number[]): readonly number[] => {
    if (!largeTree || indices.length <= LARGE_TREE_LIMIT) {
      return indices;
    }
    const active = indices.indexOf(session.lineIndex);
    const center = active >= 0 ? active : 0;
    const start = Math.max(
      0,
      Math.min(indices.length - LARGE_TREE_LIMIT, center - Math.floor(LARGE_TREE_LIMIT / 2)),
    );
    return indices.slice(start, start + LARGE_TREE_LIMIT);
  };

  const selected = new Set<string>(folderSelected ? [] : selectedLineIds);
  if (!folderSelected && !selected.size) {
    selected.add(lineTreeKey(lines, session.lineIndex));
  }
  const selectedIndices = new Set(
    [...selected].flatMap((key) => {
      const index = lineIndices.get(key);
      return index === undefined ? [] : [index];
    }),
  );
  useLayoutEffect(() => {
    if (listRef.current && scrollTopRef.current !== null) {
      listRef.current.scrollTop = Math.max(0, scrollTopRef.current);
    }
  }, [scrollTopRef]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
      if (suppressTimer.current !== null) {
        window.clearTimeout(suppressTimer.current);
      }
    };
  }, []);

  const createPromptOpen = createPrompt !== null;
  useEffect(() => {
    if (!createPromptOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      const input = createInputRef.current;
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [createPromptOpen]);

  const currentScroll = () => listRef.current?.scrollTop ?? 0;

  /** The selected line nearest the row that left the set, unless the current
   * line is still selected and the removed row was not that line. */
  const focusAfterRemoval = (removed: number, next: ReadonlySet<string>): number => {
    const currentKey = lineTreeKey(lines, session.lineIndex);
    if (removed !== session.lineIndex && next.has(currentKey)) {
      return session.lineIndex;
    }
    let best = session.lineIndex;
    let bestDistance = Infinity;
    for (const id of next) {
      const index = lineIndices.get(id);
      if (index === undefined) {
        continue;
      }
      const distance = Math.abs(index - removed);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  };

  /** Toggles Shift multi-selection for a row and focuses the remaining selection. */
  const selectRow = (index: number, event?: ReactMouseEvent<HTMLElement>) => {
    const key = lineTreeKey(lines, index);
    const next = new Set(selected);
    if (event?.shiftKey) {
      if (next.has(key)) {
        if (next.size > 1) {
          next.delete(key);
        }
      } else {
        next.add(key);
      }
    } else {
      next.clear();
      next.add(key);
    }
    if (!next.size) {
      next.add(key);
    }
    const focusIndex = next.has(key) ? index : focusAfterRemoval(index, next);
    onSelectionChange(next);
    onSelectLine(focusIndex, currentScroll());
  };

  /** Selects a folder instead of its first line; line focus stays unchanged. */
  const selectGroup = (group: number) => {
    onSelectFolder(group);
  };

  const { marquee, beginMarquee } = useLineTreeMarquee({
    listRef,
    rowRefs,
    lines,
    selectedIds: selected,
    lineIndices,
    focusAfterRemoval,
    currentScroll,
    onSelectionChange,
    onSelectLine,
  });

  /** Appends a batch of lines with the supplied name or the shared Untitled default. */
  const addLines = (group: number, amount: number, name?: string) => {
    const count = Math.max(1, Math.min(MAX_BATCH_LINES, Math.trunc(amount)));
    const start = lines.length;
    const groupIndex = labels.length ? group : 0;
    const additions = Array.from({ length: count }, () => ({
      ...createLine(name && count === 1 ? name : t("model.line.untitled")),
      Group: groupIndex,
    }));
    const next: Chart = labels.length
      ? { ...chart, judgeLineList: [...lines, ...additions] }
      : {
          ...chart,
          // Adding the first line to an empty tree recreates the default group.
          judgeLineGroup: ["Default"],
          judgeLineList: [...lines, ...additions],
        };
    onCommit(
      count === 1
        ? t("editorPanels.linePanel.addLabel")
        : t("editorPanels.linePanel.addLinesLabel"),
      next,
      start + count - 1,
    );
  };

  /** Inserts groups after the active folder, resolving duplicate names. */
  const addGroups = (amount: number, name?: string) => {
    const count = Math.max(1, Math.min(MAX_BATCH_LINES, Math.trunc(amount)));
    let next = chart;
    let insertAt = Math.min(labels.length, activeGroup + 1);
    let created = 0;
    for (let offset = 0; offset < count; offset += 1) {
      const existing = groupNames(next);
      let groupName =
        name && count === 1 ? name.trim() : t("model.line.group", { index: existing.length + 1 });
      if (name && count === 1 && !groupName) {
        onNotify(t("editorPanels.linePanel.groupNameRequired"), "warning");
        return;
      }
      if (existing.some((current) => sameGroupName(current, groupName))) {
        if (count === 1) {
          onNotify(t("editorPanels.linePanel.duplicateGroupName"), "warning");
          return;
        }
        let suffix = existing.length + 1;
        do {
          groupName = t("model.line.group", { index: suffix++ });
        } while (existing.some((current) => sameGroupName(current, groupName)));
      }
      const from = existing.length;
      next = addLineGroup(next, groupName);
      if (from !== insertAt) {
        next = reorderLineGroup(next, from, insertAt);
      }
      insertAt += 1;
      created += 1;
    }
    if (!created) {
      return;
    }
    onCommit(t("editorPanels.linePanel.addGroupLabel"), next, session.lineIndex);
    // A newly created folder has no line to focus, so select the folder itself.
    onSelectFolder(insertAt - 1);
  };

  /** Validates and commits the pending create prompt, then closes it. */
  const confirmCreate = () => {
    if (!createPrompt) {
      return;
    }
    const prompt = createPrompt;
    if (prompt.mode === "count") {
      const amount = Number(prompt.value);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BATCH_LINES) {
        onNotify(t("editorPanels.linePanel.addLinesInvalid"), "warning");
        return;
      }
      if (prompt.kind === "line") {
        addLines(prompt.group, amount);
      } else {
        addGroups(amount);
      }
    } else {
      const name = prompt.value.trim();
      if (!name) {
        onNotify(
          t(
            prompt.kind === "line"
              ? "editorPanels.linePanel.lineNameRequired"
              : "editorPanels.linePanel.groupNameRequired",
          ),
          "warning",
        );
        return;
      }
      if (prompt.kind === "line") {
        addLines(prompt.group, 1, name);
      } else {
        addGroups(1, name);
      }
    }
    setCreatePrompt(null);
  };

  /** Starts the long-press timer that opens the batch-count prompt. */
  const beginCreatePress = (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: "line" | "group",
  ) => {
    if (event.button !== 0) {
      return;
    }
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
    const anchor = event.currentTarget;
    const record = { fired: false };
    longPressRecord.current = record;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      record.fired = true;
      setCreatePrompt({
        kind,
        group: activeGroup,
        anchor,
        mode: "count",
        value: "1",
      });
    }, LONG_PRESS_MS);
  };

  /** Cancels the long-press timer and suppresses the click it would also fire. */
  const endCreatePress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const fired = longPressRecord.current?.fired ?? false;
    longPressRecord.current = null;
    if (fired) {
      suppressAddClick.current = true;
      if (suppressTimer.current !== null) {
        window.clearTimeout(suppressTimer.current);
      }
      suppressTimer.current = window.setTimeout(() => {
        suppressAddClick.current = false;
        suppressTimer.current = null;
      }, CLICK_SUPPRESS_MS);
    }
  };

  /** Opens the single-name prompt unless a long press just handled this click. */
  const clickCreate = (kind: "line" | "group", event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressAddClick.current) {
      suppressAddClick.current = false;
      return;
    }
    setCreatePrompt({
      kind,
      group: activeGroup,
      anchor: event.currentTarget,
      mode: "name",
      value: kind === "line" ? t("model.line.untitled") : "",
    });
  };

  /** Deletes one line and focuses the nearest remaining line. */
  const deleteRow = (index: number) => {
    const next = deleteLine(chart, index);
    const remaining = next.judgeLineList?.length ?? 0;
    const target = Math.max(0, Math.min(index, remaining - 1));
    onCommit(t("editorPanels.linePanel.deleteLabel"), next, target);
  };

  const selectedGroupHasLines = (buckets[activeGroup]?.length ?? 0) > 0;
  const deleteEnabled = selectedGroupHasLines || labels.length > 0;

  /** Deletes the active folder's lines, or the folder itself when empty. */
  const deleteSelected = () => {
    const bucket = buckets[activeGroup] ?? [];
    if (!bucket.length) {
      if (!labels.length) {
        return;
      }
      try {
        onCommit(
          t("editorPanels.linePanel.deleteGroupLabel"),
          removeLineGroup(chart, activeGroup),
          session.lineIndex,
        );
        onSelectFolder(labels.length > 1 ? Math.max(0, activeGroup - 1) : null);
      } catch (error) {
        onNotify(error instanceof Error ? error.message : String(error), "error");
      }
      return;
    }
    if (!lines.length) {
      return;
    }
    const index = bucket.includes(session.lineIndex)
      ? session.lineIndex
      : bucket[bucket.length - 1];
    deleteRow(index);
  };

  /** Opens inline rename for a folder. */
  const startGroupRename = (index: number) => {
    setRenameGroup({ index, value: rawNames[index] ?? "" });
  };

  /** Validates the inline rename and commits it, or reports the conflict. */
  const commitGroupRename = () => {
    if (!renameGroup) {
      return;
    }
    const name = renameGroup.value.trim();
    if (!name) {
      onNotify(t("editorPanels.linePanel.groupNameRequired"), "warning");
      return;
    }
    if (
      rawNames.some(
        (existing, index) => index !== renameGroup.index && sameGroupName(existing, name),
      )
    ) {
      onNotify(t("editorPanels.linePanel.duplicateGroupName"), "warning");
      return;
    }
    if (name === (rawNames[renameGroup.index] ?? "").trim()) {
      setRenameGroup(null);
      return;
    }
    const index = renameGroup.index;
    setRenameGroup(null);
    onCommit(
      t("editorPanels.linePanel.renameGroupLabel"),
      renameLineGroup(chart, index, name),
      session.lineIndex,
    );
  };

  /** Renders one line row with its stable id and current selection state. */
  const renderRow = (index: number, line: JudgeLine, group: number) => {
    const key = lineTreeKey(lines, index);
    return (
      <LineRow
        key={key}
        line={line}
        index={index}
        group={group}
        active={index === session.lineIndex}
        selected={marquee?.hits.has(key) ?? selectedIndices.has(index)}
        rowRef={(row) => {
          if (row) {
            rowRefs.current.set(index, row);
          } else {
            rowRefs.current.delete(index);
          }
        }}
        onPointerDown={beginMarquee}
        onSelect={selectRow}
      />
    );
  };

  return (
    <>
      <div
        ref={listRef}
        className="line-tree"
        data-empty={!lines.length && !labels.length ? "true" : undefined}
        data-layout={treeLayout}
        data-marquee={marquee ? "true" : undefined}
        role="tree"
        aria-label={t("editorPanels.linePanel.title")}
        aria-multiselectable="true"
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
        }}
      >
        {!lines.length && !labels.length ? (
          <EmptyState
            icon="grid"
            title={t("editorPanels.linePanel.emptyState.title")}
            description={t("editorPanels.linePanel.emptyState.description")}
          />
        ) : treeLayout === "grid" ? (
          <div className="line-grid">
            {labels.map((label, group) => (
              <FolderDropSection
                key={`${group}:${label}`}
                group={group}
                label={label}
                className="line-grid-group"
              >
                <header
                  className="line-grid-group-header"
                  data-selected={folderSelected && group === activeGroup ? "true" : undefined}
                  aria-current={folderSelected && group === activeGroup ? "true" : undefined}
                  onClick={() => selectGroup(group)}
                >
                  <Icon name="folder" size={15} />
                  <span className="line-grid-group-label">{label}</span>
                  <small>
                    {t("editorPanels.linePanel.count", {
                      count: buckets[group]?.length ?? 0,
                    })}
                  </small>
                </header>
                <div className="line-grid-cards">
                  {buckets[group]?.length ? (
                    windowed(buckets[group]).map((index) => {
                      const line = lines[index];
                      if (!line) {
                        return null;
                      }
                      const key = lineTreeKey(lines, index);
                      return (
                        <LineCard
                          key={key}
                          chart={chart}
                          line={line}
                          index={index}
                          active={index === session.lineIndex}
                          selected={marquee?.hits.has(key) ?? selectedIndices.has(index)}
                          rowRef={(row) => {
                            if (row) {
                              rowRefs.current.set(index, row);
                            } else {
                              rowRefs.current.delete(index);
                            }
                          }}
                          onPointerDown={beginMarquee}
                          onSelect={selectRow}
                        />
                      );
                    })
                  ) : (
                    <p className="line-list-group-empty">
                      {t("editorPanels.linePanel.emptyGroup")}
                    </p>
                  )}
                  {largeTree && (buckets[group]?.length ?? 0) > LARGE_TREE_LIMIT ? (
                    <p className="line-list-group-empty">
                      {t("editorPanels.linePanel.largeChartWindow", {
                        shown: LARGE_TREE_LIMIT,
                        total: buckets[group]?.length ?? 0,
                      })}
                    </p>
                  ) : null}
                </div>
              </FolderDropSection>
            ))}
          </div>
        ) : (
          labels.map((label, group) => {
            const renaming = renameGroup?.index === group;
            const folded = collapsedGroups.has(label);
            return (
              <LineFolderSection
                key={`${group}:${label}`}
                group={group}
                label={label}
                selected={folderSelected && group === activeGroup}
                folded={folded}
                name={
                  renaming ? (
                    <Input
                      className="line-folder-rename"
                      value={renameGroup.value}
                      aria-label={t("editorPanels.linePanel.groupNamePlaceholder")}
                      autoFocus
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setRenameGroup((current) => (current ? { ...current, value } : current));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitGroupRename();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setRenameGroup(null);
                        }
                      }}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="plain"
                      className="redux-tree-folder-name"
                      onClick={() => selectGroup(group)}
                      onDoubleClick={() => {
                        if (showGroups) {
                          startGroupRename(group);
                        }
                      }}
                    >
                      {label}
                    </Button>
                  )
                }
                count={t("editorPanels.linePanel.count", {
                  count: buckets[group]?.length ?? 0,
                })}
                actionsPersistent={renaming}
                actions={
                  renaming ? (
                    <>
                      <Button
                        type="button"
                        variant="plain"
                        className="redux-tree-folder-action"
                        aria-label={t("common.action.confirm")}
                        data-tip-title={t("common.action.confirm")}
                        onClick={commitGroupRename}
                      >
                        <Icon name="check" size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="plain"
                        className="redux-tree-folder-action"
                        aria-label={t("common.action.cancel")}
                        data-tip-title={t("common.action.cancel")}
                        onClick={() => setRenameGroup(null)}
                      >
                        <Icon name="close" size={16} />
                      </Button>
                    </>
                  ) : undefined
                }
                onToggle={() => onToggleGroup(label)}
                onSelectName={() => selectGroup(group)}
                onHeaderClick={() => selectGroup(group)}
                expandLabel={t("editorPanels.linePanel.expandGroup", { name: label })}
                collapseLabel={t("editorPanels.linePanel.collapseGroup", { name: label })}
              >
                {buckets[group]?.length ? (
                  windowed(buckets[group]).map((index) => renderRow(index, lines[index], group))
                ) : (
                  <EmptyState
                    variant="inline"
                    title={t("editorPanels.linePanel.emptyGroup")}
                    className="line-list-group-empty"
                  />
                )}
                {largeTree && (buckets[group]?.length ?? 0) > LARGE_TREE_LIMIT ? (
                  <p className="line-list-group-empty">
                    {t("editorPanels.linePanel.largeChartWindow", {
                      shown: LARGE_TREE_LIMIT,
                      total: buckets[group]?.length ?? 0,
                    })}
                  </p>
                ) : null}
              </LineFolderSection>
            );
          })
        )}
      </div>
      <LineTreeFooter
        deleteEnabled={deleteEnabled}
        selectedGroupHasLines={selectedGroupHasLines}
        onBeginCreatePress={beginCreatePress}
        onEndCreatePress={endCreatePress}
        onCreate={clickCreate}
        onDelete={deleteSelected}
      />

      <LineTreeMarqueeBox box={marquee} />
      <LineTreeCreatePrompt
        prompt={createPrompt}
        labels={labels}
        inputRef={createInputRef}
        onValueChange={(value) =>
          setCreatePrompt((current) => (current ? { ...current, value } : current))
        }
        onCancel={() => setCreatePrompt(null)}
        onConfirm={confirmCreate}
      />
    </>
  );
}
