/**
 * Shared right-click menu rows.
 *
 * Every menu site composes the same three sources: toolbar actions that name
 * the surface, rows from the context-menu registry, and the site's own snapshot
 * actions. `menuRowModel.ts` resolves the first two against the shared
 * visibility and enablement rule; this component draws those rows beside the
 * site's own, keeping shortcut hints, icons, danger ink, and separators uniform.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { displayText } from "../../../core/shortcuts/keys.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { contextMenu } from "../../../core/shell/registries/contextMenu.ts";
import type { ContextMenuSurface } from "../../../core/shell/registries/contextMenu.ts";
import { toolbar, type ContextMenuTarget } from "../../../core/shell/registries/toolbar.ts";
import { Icon, iconName } from "../../../design/components/icon/Icon.tsx";
import { MenuItem, MenuSeparator } from "../../../design/components/menu/MenuSurface.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { ContextMenuAction } from "./ContextMenuPopup.tsx";
import { resolveContextMenuRows, resolveMenuRow } from "./menuRowModel.ts";
import { recordDiagnosticAction } from "../../../core/diagnostics/interactionLog.ts";

/**
 * One of the calling site's own rows.
 *
 * `shortcutId` names a registered binding whose live text becomes the hint;
 * `detail` carries the secondary text a chooser row draws before the shortcut.
 * Both are optional, so a plain `ContextMenuAction` remains a valid row.
 */
export interface ContextMenuRowAction extends ContextMenuAction {
  /** A registered binding whose live text supplies this row's keyboard hint. */
  shortcutId?: string;
  /** Secondary text drawn before the shortcut, such as a chooser's timing. */
  detail?: ReactNode;
  /** Preview this row's object while the pointer is on it. */
  onHover?(): void;
  /** Remove the preview when the pointer leaves or the row is chosen. */
  onLeave?(): void;
}

/** What one menu site passes to the shared row renderer. */
export interface ContextMenuRowsProps {
  /**
   * The surface whose toolbar and contributed rows are collected.
   *
   * Omitted when the site has no registry surface; the renderer then draws only
   * the site's own rows.
   */
  surface?: ContextMenuSurface;
  /** The object under the pointer, forwarded to contributed runners. */
  target?: ContextMenuTarget;
  /** The calling site's own rows, drawn after contributed rows. */
  actions?: readonly ContextMenuRowAction[];
  /** Closes the menu that hosts these rows. */
  close(): void;
  /** Optional header drawn above every row. */
  leading?: ReactNode;
}

/** The live keyboard hint for a site row, falling back to its literal text. */
function siteShortcut(action: ContextMenuRowAction): string {
  const primary = action.shortcutId ? shortcutRegistry.bindingsOf(action.shortcutId)[0] : undefined;
  return primary ? displayText(primary) : (action.shortcut ?? "");
}

/** Render toolbar, registry, and site rows in one keyboard-navigable menu. */
export function ContextMenuRows({
  surface,
  target,
  actions = [],
  close,
  leading,
}: ContextMenuRowsProps) {
  const { tRaw } = useTranslation();
  useSyncExternalStore(toolbar.subscribe, toolbar.getSnapshot, toolbar.getSnapshot);
  useSyncExternalStore(contextMenu.subscribe, contextMenu.getSnapshot, contextMenu.getSnapshot);

  const rows: ReactNode[] = [];
  // A separator is only useful after a row, so the first row never gets one and
  // two adjacent separator-before rows collapse into a single hairline.
  let lastWasSeparator = true;
  const addSeparator = (): void => {
    if (lastWasSeparator) {
      return;
    }
    rows.push(<MenuSeparator key={`separator:${rows.length}`} />);
    lastWasSeparator = true;
  };
  const addRow = (row: ReactNode): void => {
    rows.push(row);
    lastWasSeparator = false;
  };

  for (const row of resolveContextMenuRows(surface, target)) {
    if (row.separatorBefore || row.danger) {
      addSeparator();
    }
    addRow(
      <MenuItem
        key={row.key}
        id={row.id}
        label={tRaw(row.label)}
        icon={row.icon ? <Icon name={iconName(row.icon)} size={14} /> : undefined}
        shortcut={row.shortcut}
        checked={row.checked}
        danger={row.danger}
        disabled={row.disabled}
        onClick={() => {
          close();
          row.select();
        }}
      />,
    );
  }

  for (const action of actions) {
    const { disabled } = resolveMenuRow(action);
    if (action.danger === true) {
      addSeparator();
    }
    addRow(
      <MenuItem
        key={`site:${action.id}`}
        id={action.id}
        label={action.label}
        icon={action.icon ? <Icon name={iconName(action.icon)} size={14} /> : undefined}
        detail={action.detail}
        shortcut={siteShortcut(action)}
        danger={action.danger === true}
        disabled={disabled}
        onPointerEnter={disabled ? undefined : action.onHover}
        onPointerLeave={disabled ? undefined : action.onLeave}
        onClick={() => {
          action.onLeave?.();
          close();
          recordDiagnosticAction(action.id, "context_menu", "completed");
          action.run();
        }}
      />,
    );
  }

  return (
    <>
      {leading}
      {rows}
    </>
  );
}
