/**
 * Presentational rows, cards, and folder anatomy for the judge-line tree.
 *
 * These components only render the folder tree; the tree's selection, marquee,
 * creation, and rename state machine stays in `LineTree.tsx`. List rows are
 * intentionally static: moving a line or folder is not a list gesture.
 */
import { memo, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { TreeFolder } from "../../../../../design/patterns/tree/TreeFolder.tsx";
import type { Chart, JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { t } from "../../../../../i18n/index.ts";
import { lineDisplayName, lineNameLabel } from "../../../editor/workspace/lineLabels.ts";

export interface LineRowProps {
  line: JudgeLine;
  index: number;
  group: number;
  active: boolean;
  selected: boolean;
  rowRef?: Ref<HTMLElement>;
  onPointerDown?(event: React.PointerEvent<HTMLElement>): void;
  onSelect(index: number, event?: ReactMouseEvent<HTMLElement>): void;
}

/** One static line row; selection is the only list-level line action. */
export const LineRow = memo(
  function LineRow({
    line,
    index,
    group,
    active,
    selected,
    rowRef,
    onPointerDown,
    onSelect,
  }: LineRowProps) {
    return (
      <ListRow
        selected={selected}
        ref={rowRef}
        current={active}
        className="line-row"
        role="treeitem"
        aria-selected={selected}
        aria-current={active ? "true" : undefined}
        tabIndex={0}
        data-line-index={index}
        data-group-index={group}
        onPointerDown={onPointerDown}
        onClick={(event) => onSelect(index, event)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(index);
          }
        }}
      >
        <span className="line-list-index">{index}</span>
        <span className="line-list-name">{lineNameLabel(line, index)}</span>
      </ListRow>
    );
  },
  (previous, next) =>
    previous.line === next.line &&
    previous.index === next.index &&
    previous.group === next.group &&
    previous.active === next.active &&
    previous.selected === next.selected,
);

export interface LineCardProps {
  chart: Chart;
  line: JudgeLine;
  index: number;
  active: boolean;
  selected: boolean;
  rowRef?: Ref<HTMLButtonElement>;
  onPointerDown?(event: React.PointerEvent<HTMLElement>): void;
  onSelect(index: number, event?: ReactMouseEvent<HTMLElement>): void;
}

/** One static line card for the optional grid presentation. */
export const LineCard = memo(
  function LineCard({
    chart,
    line,
    index,
    active,
    selected,
    rowRef,
    onPointerDown,
    onSelect,
  }: LineCardProps) {
    const notes = line.numOfNotes ?? line.notes?.length ?? 0;
    return (
      <Button
        type="button"
        ref={rowRef}
        variant="plain"
        className={`line-grid-card${active ? " current" : ""}${selected ? " is-selected" : ""}`}
        role="treeitem"
        data-selected={selected ? "true" : undefined}
        aria-selected={selected}
        aria-current={active ? "true" : undefined}
        data-line-index={index}
        onPointerDown={onPointerDown}
        onClick={(event) => onSelect(index, event)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(index);
          }
        }}
      >
        <span className="line-grid-index">{index}</span>
        <strong className="line-grid-name">{lineDisplayName(chart, index)}</strong>
        <span className="line-grid-meta">
          {t("editorPanels.linePanel.noteCount", { count: notes })}
        </span>
      </Button>
    );
  },
  (previous, next) =>
    previous.chart === next.chart &&
    previous.line === next.line &&
    previous.index === next.index &&
    previous.active === next.active &&
    previous.selected === next.selected,
);

export interface FolderDropSectionProps {
  group: number;
  label: string;
  className: string;
  children: ReactNode;
}

/** A folder box for the optional grid presentation. */
export function FolderDropSection({ group, label, className, children }: FolderDropSectionProps) {
  return (
    <section className={className} data-group-index={group} role="group" aria-label={label}>
      {children}
    </section>
  );
}

export interface LineFolderSectionProps {
  group: number;
  label: string;
  selected: boolean;
  folded: boolean;
  name: ReactNode;
  count: ReactNode;
  actions?: ReactNode;
  actionsPersistent?: boolean;
  onToggle(): void;
  onSelectName(): void;
  /** Selects the folder when its header is pressed outside its own controls. */
  onHeaderClick?(): void;
  onNameDoubleClick?(): void;
  expandLabel: string;
  collapseLabel: string;
  children: ReactNode;
}

/** List-mode folder with the shared disclosure and selection anatomy. */
export function LineFolderSection({
  group,
  label,
  selected,
  folded,
  name,
  count,
  actions,
  actionsPersistent,
  onToggle,
  onSelectName,
  onHeaderClick,
  onNameDoubleClick,
  expandLabel,
  collapseLabel,
  children,
}: LineFolderSectionProps) {
  return (
    <TreeFolder
      label={label}
      className="line-folder"
      selected={selected}
      folded={folded}
      headerClassName="line-folder-header"
      bodyClassName="line-folder-body"
      rowsClassName="line-folder-rows"
      reserveDragSpace={false}
      name={name}
      count={count}
      actions={actions}
      actionsPersistent={actionsPersistent}
      onToggle={onToggle}
      onSelectName={onSelectName}
      onNameDoubleClick={onNameDoubleClick}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      data-group-index={group}
      onHeaderClick={onHeaderClick}
    >
      {children}
    </TreeFolder>
  );
}
