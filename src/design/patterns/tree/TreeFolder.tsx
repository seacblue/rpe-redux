/**
 * Shared folder box for the asset and judge-line trees.
 *
 * Both trees render the same anatomy: an optional reorder grip, a disclosure
 * button, a folder icon, an editable name slot, a count, hover actions, and a
 * grid-row collapse body. This primitive owns that anatomy and the drop-target,
 * selected, dragging, and folded states; callers pass data and row content.
 */
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import { Button } from "../../components/button/Button.tsx";
import { Icon, type IconName } from "../../components/icon/Icon.tsx";

export interface TreeFolderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "onSelect"
> {
  /** Accessible name of the folder group. */
  label: string;
  /** The folder owns the current selection. */
  selected?: boolean;
  /** A folder drag is in progress. */
  dragging?: boolean;
  /** A compatible drag is hovering this folder. */
  dropTarget?: boolean;
  /** The body is collapsed; the body stays mounted for the fold animation. */
  folded?: boolean;
  rootRef?: Ref<HTMLElement>;
  headerRef?: Ref<HTMLDivElement>;
  headerClassName?: string;
  bodyClassName?: string;
  rowsClassName?: string;
  /** Caller-owned reorder grip. */
  dragHandle?: ReactNode;
  /** Whether a non-draggable tree should keep the old grip column. */
  reserveDragSpace?: boolean;
  icon?: IconName;
  iconClassName?: string;
  /** Custom name control, for example the inline rename field. */
  name?: ReactNode;
  count?: ReactNode;
  /** Hover actions; the caller owns their buttons. */
  actions?: ReactNode;
  /** Keep actions visible even without hover, for an inline rename row. */
  actionsPersistent?: boolean;
  onToggle?(): void;
  onSelectName?(): void;
  onNameDoubleClick?(): void;
  /** Selects the folder when its header surface, rather than a control, is pressed. */
  onHeaderClick?(): void;
  /** Accessible disclosure label while folded. */
  expandLabel?: string;
  /** Accessible disclosure label while expanded. */
  collapseLabel?: string;
  children: ReactNode;
}

/** One folder box with its header, count, actions, and collapsible body. */
export function TreeFolder({
  label,
  selected = false,
  dragging = false,
  dropTarget = false,
  folded = false,
  rootRef,
  headerRef,
  headerClassName = "",
  bodyClassName = "",
  rowsClassName = "",
  dragHandle,
  reserveDragSpace = true,
  icon = "folder",
  iconClassName = "",
  name,
  count,
  actions,
  actionsPersistent = false,
  onToggle,
  onSelectName,
  onNameDoubleClick,
  onHeaderClick,
  expandLabel,
  collapseLabel,
  children,
  className = "",
  ...rest
}: TreeFolderProps): React.JSX.Element {
  const { t } = useTranslation();
  const rootClass = [
    "redux-tree-folder",
    selected ? "is-selected" : "",
    dragging ? "is-dragging" : "",
    dropTarget ? "drop-target" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const iconClass = ["redux-tree-folder-icon", iconClassName].filter(Boolean).join(" ");
  return (
    <section {...rest} ref={rootRef} className={rootClass} role="group" aria-label={label}>
      <div
        ref={headerRef}
        className={`redux-tree-folder-header ${headerClassName}`.trim()}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onHeaderClick?.();
          }
        }}
      >
        {dragHandle ??
          (reserveDragSpace ? (
            <span className="redux-tree-folder-grip-spacer" aria-hidden="true" />
          ) : null)}
        <Button
          type="button"
          variant="plain"
          className="redux-tree-folder-disclosure"
          aria-expanded={!folded}
          aria-label={folded ? expandLabel : collapseLabel}
          data-tip-title={t(folded ? "common.action.expand" : "common.action.collapse")}
          onClick={onToggle}
        >
          <Icon name="chevronDown" size={14} />
        </Button>
        <Icon name={icon} size={16} className={iconClass} />
        <span className="redux-tree-folder-heading" onClick={onHeaderClick}>
          {name ?? (
            <Button
              type="button"
              variant="plain"
              className="redux-tree-folder-name"
              onClick={(event) => {
                event.stopPropagation();
                onSelectName?.();
              }}
              onDoubleClick={onNameDoubleClick}
            >
              {label}
            </Button>
          )}
          {count != null && <small className="redux-tree-folder-count">{count}</small>}
        </span>
        {actions != null && (
          <span
            className="redux-tree-folder-actions"
            data-persistent={actionsPersistent ? "true" : undefined}
          >
            {actions}
          </span>
        )}
      </div>
      <div
        className={`redux-tree-folder-body ${bodyClassName}`.trim()}
        data-folded={folded ? "true" : undefined}
        aria-hidden={folded || undefined}
        inert={folded || undefined}
      >
        <div className={`redux-tree-folder-rows ${rowsClassName}`.trim()}>{children}</div>
      </div>
    </section>
  );
}
