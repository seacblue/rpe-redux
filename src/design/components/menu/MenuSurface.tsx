/**
 * Menu rows and the surface that contains them.
 *
 * Title-bar menus and pointer context menus show the same row anatomy: optional
 * icon, label, checked mark, and shortcut. The surface owns only the menu role
 * and shared shell; sites own their actions and dismissal.
 */
import type { FocusEvent, PointerEvent, ReactNode } from "react";
import { Button } from "../button/Button.tsx";
import { Icon } from "../icon/Icon.tsx";

/** The menu role wrapper that owns row spacing and the shared surface shell. */
export function MenuSurface({
  label,
  className = "",
  state,
  children,
  onKeyDown,
}: {
  label: string;
  className?: string;
  /** `closing` keeps the surface mounted for its exit animation. */
  state?: "open" | "closing";
  children: ReactNode;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={`redux-menu-surface${className ? ` ${className}` : ""}`}
      role="menu"
      aria-label={label}
      data-state={state}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** One actionable menu row: icon, label, detail, check mark, shortcut, and submenu chevron. */
export function MenuItem({
  label,
  icon,
  shortcut,
  detail,
  checked = false,
  danger = false,
  disabled = false,
  expandable = false,
  expanded,
  id,
  role = "menuitem",
  className = "",
  title,
  onClick,
  onFocus,
  onPointerEnter,
}: {
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: ReactNode;
  detail?: ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a right chevron for a row that opens a submenu. */
  expandable?: boolean;
  expanded?: boolean;
  id?: string;
  role?: string;
  className?: string;
  title?: string;
  onClick?(): void;
  onFocus?(event: FocusEvent<HTMLButtonElement>): void;
  onPointerEnter?(event: PointerEvent<HTMLButtonElement>): void;
}) {
  return (
    <Button
      id={id}
      type="button"
      role={role}
      variant="plain"
      className={`redux-menu-row${danger ? " is-danger" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      title={title}
      aria-haspopup={expandable ? "menu" : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={onClick}
      onFocus={onFocus}
      onPointerEnter={onPointerEnter}
    >
      {icon && <span className="redux-menu-row-icon">{icon}</span>}
      <span className="redux-menu-row-label">{label}</span>
      {detail && <span className="redux-menu-row-detail">{detail}</span>}
      {checked && (
        <span className="redux-menu-row-check" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
      )}
      {shortcut && <span className="redux-menu-row-shortcut">{shortcut}</span>}
      {expandable && <Icon name="chevronRight" size={14} className="redux-menu-row-chevron" />}
    </Button>
  );
}

/** A hairline group divider with the separator role. */
export function MenuSeparator() {
  return <div className="redux-menu-separator" role="separator" />;
}
