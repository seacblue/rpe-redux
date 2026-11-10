/**
 * The document drawer: an inspector content mode for document-wide pages.
 *
 * The drawer has no rail of its own: its pane entries live in the window's
 * single sidebar beside the inspector. This module owns the registered panes,
 * their order, and the published open/pane state. Opening a pane replaces the
 * inspector body with that page, so a programmatic entry never changes a hidden
 * state the user cannot see.
 *
 * The open/pane record here is the only drawer selection state. Core reads it
 * through the late-bound reader in `core/shell/drawerPane.ts`; no second copy is
 * written anywhere.
 *
 * The open state is sticky. Leaving the drawer body, moving into the stage,
 * changing the selection, or scrolling never closes it; only a second press on
 * the active sidebar entry, the inspector's close button, or an explicit close
 * request does. Escape and outside presses belong to other surfaces and do not
 * dismiss an inspector mode.
 *
 * A guided step that anchors to a drawer page holds that page open. While the
 * hold lasts, closing the page, switching to another drawer page, or replacing
 * it with an inspector pane is refused, because the step would lose its target.
 */
import { useSyncExternalStore, type ComponentType } from "react";
import { Contributions } from "../../../core/state/contributions.ts";
import type { IconName } from "../../../design/components/icon/Icon.tsx";
import { bindDrawerPaneReader } from "../../../core/shell/drawerPane.ts";
import { bindDrawerOpener } from "../../../core/shell/drawerOpen.ts";
import {
  registerHelpTutorial,
  type HelpTutorialDefinition,
} from "../../../core/help/tutorialRegistry.ts";

/** One document-wide pane the drawer can show. */
export interface DrawerPaneDefinition {
  id: string;
  order: number;
  /** Message key for the sidebar entry and the inspector header. */
  label: string;
  icon: IconName;
  /** The pane body: whatever faces the page needs. */
  body: ComponentType;
  /** Stays hidden while the editor has no document. */
  requiresDocument?: boolean;
  /** Pane-owned anchored walkthrough opened from the inspector header. */
  tutorial?: HelpTutorialDefinition;
  /**
   * Whether the page changes the chart or its assets.
   *
   * A read-only document keeps the page visible but makes its body inert, so
   * its controls cannot start an edit the session would refuse.
   */
  editsChart?: boolean;
}

/** Which page is showing and whether the inspector is in drawer mode. */
export interface DrawerState {
  open: boolean;
  pane: string;
}

const panes = new Contributions<DrawerPaneDefinition>();
const listeners = new Set<() => void>();
const holds = new Map<string, number>();
let state: DrawerState = Object.freeze({ open: false, pane: "" });

/** Notifies every subscriber; the only notification path. */
function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Replaces the drawer state and notifies every subscriber; the only writer. */
function publish(next: DrawerState): void {
  if (next.open === state.open && next.pane === state.pane) {
    return;
  }
  state = Object.freeze(next);
  notify();
}

/** True while a guided step keeps this page open. */
function isHeld(id: string): boolean {
  return (holds.get(id) ?? 0) > 0;
}

/** Adds a drawer pane and returns the disposer that removes it. */
export function registerDrawerPane(pane: DrawerPaneDefinition): () => void {
  const disposeTutorial = pane.tutorial ? registerHelpTutorial(pane.tutorial) : undefined;
  let disposePane: (() => void) | undefined;
  try {
    disposePane = panes.register(pane);
  } catch (error) {
    disposeTutorial?.();
    throw error;
  }
  return () => {
    disposeTutorial?.();
    disposePane?.();
  };
}

const PANE_ANCHOR_PREFIX = "drawer-pane-";

/** Stable DOM id for a drawer pane's sidebar trigger and guided-step anchor. */
export function drawerPaneDomId(id: string): string {
  return `${PANE_ANCHOR_PREFIX}${id}`;
}

/** Reads the drawer page named by one guided-step target, or null for others. */
export function drawerPaneIdFromTarget(target: string): string | null {
  if (!target.startsWith(PANE_ANCHOR_PREFIX)) {
    return null;
  }
  const id = target.slice(PANE_ANCHOR_PREFIX.length);
  return id || null;
}

const triggerNodes = new Map<string, HTMLElement>();

/** Bind the sidebar button that opens one drawer pane. */
export function bindDrawerPaneTrigger(id: string, node: HTMLElement | null): () => void {
  if (node) {
    triggerNodes.set(id, node);
  } else {
    triggerNodes.delete(id);
  }
  return () => {
    if (triggerNodes.get(id) === node) {
      triggerNodes.delete(id);
    }
  };
}

/** Focus the sidebar trigger after the drawer closes. */
export function focusDrawerPaneTrigger(id: string): void {
  triggerNodes.get(id)?.focus();
}

/** The registered panes, in `order`. */
export const getDrawerPanes = panes.getSnapshot;
/** Subscribes to pane registration changes. */
export const subscribeDrawerPanes = panes.subscribe;
/** The current drawer state. */
export const getDrawerState = (): DrawerState => state;
/** Subscribes to drawer open/pane and hold changes. */
export function subscribeDrawer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Keeps one drawer page open until the returned lock is released.
 *
 * The page opens when the hold starts, so an anchored step always has a target.
 * Holds are counted: overlapping walkthrough steps and a development remount
 * release only their own lock. An unknown page id returns a no-op lock.
 */
export function holdDrawerPane(id: string): () => void {
  const value = id.trim();
  if (!value || !panes.getSnapshot().some((pane) => pane.id === value)) {
    return () => {};
  }
  holds.set(value, (holds.get(value) ?? 0) + 1);
  openDrawerPane(value);
  notify();
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    const remaining = (holds.get(value) ?? 1) - 1;
    if (remaining > 0) {
      holds.set(value, remaining);
    } else {
      holds.delete(value);
    }
    notify();
  };
}

/** Whether one drawer page is currently held open by a guided step. */
export function useDrawerPaneHeld(id: string | null): boolean {
  return useSyncExternalStore(
    subscribeDrawer,
    () => id !== null && isHeld(id),
    () => false,
  );
}

/**
 * Opens the inspector's drawer mode on one page.
 *
 * Every entry point — sidebar press, menu command, shortcut, session restore,
 * core API — opens through here, so the page is always visible when it becomes
 * active and the selection has exactly one write entry. An invalid id performs
 * no write. A held page cannot be replaced by another page, because that would
 * take the guided step's target away.
 */
export function openDrawerPane(id: string): boolean {
  const value = id.trim();
  if (!value || !panes.getSnapshot().some((pane) => pane.id === value)) {
    return false;
  }
  if (state.open && state.pane !== value && isHeld(state.pane)) {
    return false;
  }
  publish({ open: true, pane: value });
  return true;
}

/**
 * Leaves drawer mode, keeping the last page selected for the next open.
 *
 * A page held by a guided step stays open; the guide releases the hold when it
 * leaves the anchored step.
 */
export function closeDrawer(): void {
  if (state.open && isHeld(state.pane)) {
    return;
  }
  publish({ ...state, open: false });
}

/**
 * Toggles one page: pressing the active page while open leaves drawer mode,
 * unless a guided step holds that page open.
 */
export function toggleDrawerPane(id: string): void {
  if (state.open && state.pane === id) {
    closeDrawer();
    return;
  }
  openDrawerPane(id);
}

/** Reads the panes in registration order. */
export function useDrawerPanes(): readonly DrawerPaneDefinition[] {
  return useSyncExternalStore(subscribeDrawerPanes, getDrawerPanes, getDrawerPanes);
}

/** Reads the drawer state; the selector keeps the returned snapshot stable. */
export function useDrawerState(): DrawerState {
  return useSyncExternalStore(subscribeDrawer, getDrawerState, getDrawerState);
}

// The core-side opener and reader (SDK) reach this module through late
// bindings, so core never imports frontend code and never stores a second copy.
bindDrawerOpener(openDrawerPane);
bindDrawerPaneReader(() => state.pane);
