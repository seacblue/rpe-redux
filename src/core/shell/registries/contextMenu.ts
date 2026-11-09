/**
 * The right-click menu registry: the one place a feature or plugin contributes
 * a row to a context menu.
 *
 * Menu sites own their pointer handling and snapshots. This registry only holds
 * rows, their surface names, predicates, and runners; the shared row renderer
 * under `frontend/overlays/contextMenu/` reads it and draws the matching rows.
 * Nothing here renders or queries the DOM.
 *
 * A row names one or more surfaces rather than binding to a component, so a
 * single contribution can appear in the timeline, the progress card, and later
 * menu sites without the contributor knowing which host opened it.
 */
import type { ActionContext, ContextMenuTarget } from "./toolbar.ts";
import { Contributions } from "../../state/contributions.ts";

/** Surfaces that may offer a contributed row as a right-click menu. */
export type ContextMenuSurface = ActionContext | "progress";

/** One right-click menu row contributed by a feature or plugin. */
export interface ContextMenuItem {
  id: string;
  order: number;
  /** Every surface that should draw this row. */
  contexts: readonly ContextMenuSurface[];
  /**
   * A message key, or already rendered text when the contribution has none.
   *
   * Every menu surface resolves it with `tRaw`, which returns an unmigrated
   * literal unchanged.
   */
  label: string;
  /** A glyph name the design system knows; see `design/components/icon/Icon.tsx`. */
  icon?: string;
  /** Destructive commands keep the danger ink in menus and context lists. */
  danger?: boolean;
  /** Display text for a row that does not name a registered shortcut. */
  shortcut?: string;
  /**
   * The shortcut whose live binding supplies the row's keyboard hint.
   *
   * The menu resolves it through `shortcutRegistry`, so a rebind is visible
   * without the contributor tracking the preference. Extension registrations
   * strip this field: a package cannot claim a host shortcut.
   */
  shortcutId?: string;
  /** Whether the menu should offer this row right now. */
  visible?(): boolean;
  /** Whether the row can run right now. */
  enabled?(): boolean;
  /** Draws a separator before this row when another row already precedes it. */
  separatorBefore?: boolean;
  /** The command; the menu target describes the object under the pointer. */
  run(target?: ContextMenuTarget): unknown;
}

/** Ordered contribution registry for right-click menu rows. */
export const contextMenu = new Contributions<ContextMenuItem>();
