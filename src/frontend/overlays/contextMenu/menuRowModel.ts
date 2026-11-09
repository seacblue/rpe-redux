/**
 * Resolves toolbar and context-menu registrations into the rows one surface
 * draws.
 *
 * Both registries answer the same two questions: `visible` decides whether a
 * row appears at all, and `enabled` decides whether the row may run. Keeping
 * that rule beside the shared menu renderer makes it testable without a DOM and
 * keeps the renderer to presentation.
 */
import { runContextMenuTarget } from "../../../core/edit/timeline/contextMenuTarget.ts";
import { displayText } from "../../../core/shortcuts/keys.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { contextMenu } from "../../../core/shell/registries/contextMenu.ts";
import type {
  ContextMenuItem,
  ContextMenuSurface,
} from "../../../core/shell/registries/contextMenu.ts";
import { actionShortcut, toolbar } from "../../../core/shell/registries/toolbar.ts";
import type { ContextMenuTarget } from "../../../core/shell/registries/toolbar.ts";

/** The two predicates a registry row uses to place and enable itself. */
export interface MenuRowPredicates {
  /** Whether the surface offers the row right now. */
  visible?(): boolean;
  /** Whether the row can run right now. */
  enabled?(): boolean;
}

/** Whether one row is offered, and whether it refuses input. */
export interface MenuRowState {
  /** The row is drawn only when this is true. */
  visible: boolean;
  /** The row is drawn but cannot run when this is true. */
  disabled: boolean;
}

/**
 * Resolves the predicates every menu entry shares.
 *
 * Visibility and enablement are separate answers: a hidden row disappears,
 * while a disabled row keeps its place and refuses the click.
 */
export function resolveMenuRow(entry: MenuRowPredicates): MenuRowState {
  return {
    visible: entry.visible?.() !== false,
    disabled: entry.enabled?.() === false,
  };
}

/** One toolbar or contributed row resolved for a surface. */
export interface ContextMenuRegistryRow {
  /** Stable React key, unique within one menu. */
  key: string;
  /** The element id a row exposes to the editor contract, when it has one. */
  id?: string;
  /** Message key or literal text; the renderer resolves it with `tRaw`. */
  label: string;
  /** A glyph name the design system knows, not a component. */
  icon?: string;
  /** The live keyboard hint, or an empty string when the row has no binding. */
  shortcut: string;
  /** Whether the row paints its checked mark. */
  checked?: boolean;
  /** Destructive commands keep the danger ink. */
  danger: boolean;
  /** The row stays visible but cannot run. */
  disabled: boolean;
  /** Draw a separator above this row when another row already precedes it. */
  separatorBefore: boolean;
  /** Runs the command with the menu target, unless the row is disabled. */
  select(): void;
}

/** The live keyboard hint for a contributed row. */
function entryShortcut(entry: ContextMenuItem): string {
  if (!entry.shortcutId) {
    return entry.shortcut ?? "";
  }
  const primary = shortcutRegistry.bindingsOf(entry.shortcutId)[0];
  return primary ? displayText(primary) : "";
}

/**
 * Collects the toolbar and contributed rows one surface draws.
 *
 * Toolbar commands come first, then contributed rows, both in registration
 * order. A row whose `visible` predicate is false is left out; a disabled row
 * is kept so the menu can show the command and refuse the click.
 */
export function resolveContextMenuRows(
  surface: ContextMenuSurface | undefined,
  target?: ContextMenuTarget,
): ContextMenuRegistryRow[] {
  const rows: ContextMenuRegistryRow[] = [];

  for (const entry of toolbar.getSnapshot()) {
    if (entry.kind !== "action" || !entry.run) {
      continue;
    }
    if (!surface || !entry.contexts?.some((context) => context === surface)) {
      continue;
    }
    const state = resolveMenuRow(entry);
    if (!state.visible) {
      continue;
    }
    const run = entry.run;
    rows.push({
      key: `toolbar:${entry.id}`,
      id: entry.domId,
      label: entry.label,
      icon: entry.icon,
      shortcut: actionShortcut(entry),
      checked: entry.checked?.() === true,
      danger: entry.destructive === true,
      disabled: state.disabled,
      separatorBefore: entry.separatorBefore === true,
      select: () => {
        if (!state.disabled) {
          runContextMenuTarget(run, target);
        }
      },
    });
  }

  for (const entry of contextMenu.getSnapshot()) {
    if (!surface || !entry.contexts?.includes(surface) || typeof entry.run !== "function") {
      continue;
    }
    const state = resolveMenuRow(entry);
    if (!state.visible) {
      continue;
    }
    rows.push({
      key: `contributed:${entry.id}`,
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      shortcut: entryShortcut(entry),
      danger: entry.danger === true,
      disabled: state.disabled,
      separatorBefore: entry.separatorBefore === true,
      select: () => {
        if (!state.disabled) {
          entry.run(target);
        }
      },
    });
  }

  return rows;
}
