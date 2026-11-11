/**
 * The Workspace mode registry: one document task at a time expands the
 * inspector over the workspace.
 *
 * A registered mode owns the wide Inspector page (a studio). The timeline is
 * the implicit `""` mode and stays mounted behind it. This module owns the
 * registry, the single active-mode id, and the inspector pane to restore when
 * the mode closes; it never mounts a surface itself.
 */
import { useSyncExternalStore, type ComponentType } from "react";
import { Contributions } from "../../../../../core/state/contributions.ts";
import type { IconName } from "../../../../../design/components/icon/Icon.tsx";
import type { MessageKey } from "../../../../../i18n/index.ts";

/** One expanded Inspector task page. */
export interface WorkspaceModeDefinition {
  /** Stable id shared with the Inspector page that expands into it. */
  id: string;
  order: number;
  label: MessageKey;
  icon: IconName;
  component: ComponentType;
  /** Close the mode when the editor has no document. */
  requiresDocument?: boolean;
}

/** The active mode plus the pane the expand action left behind. */
export interface WorkspaceModeState {
  /** Empty while the timeline is showing. */
  id: string;
  /** Inspector pane to restore when the mode closes; empty when there was none. */
  returnPane: string;
}

const modes = new Contributions<WorkspaceModeDefinition>();
const listeners = new Set<() => void>();
let state: WorkspaceModeState = Object.freeze({ id: "", returnPane: "" });

/** Notifies every subscriber; the only notification path for mode state. */
function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Replaces the state and notifies every subscriber; the only writer. */
function publish(next: WorkspaceModeState): void {
  if (next.id === state.id && next.returnPane === state.returnPane) {
    return;
  }
  state = Object.freeze(next);
  notify();
}

/** Adds one expanded-inspector mode and returns the disposer that removes it. */
export function registerWorkspaceMode(mode: WorkspaceModeDefinition): () => void {
  return modes.register(mode);
}

/** The registered modes, in `order`. */
export const getWorkspaceModes = modes.getSnapshot;
/** Subscribes to mode registration changes. */
export const subscribeWorkspaceModes = modes.subscribe;

/** The current mode state. */
export const getWorkspaceModeState = (): WorkspaceModeState => state;

/** Subscribes to active-mode and return-pane changes. */
export function subscribeWorkspaceMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads one registered mode, or null for the timeline or an unknown id. */
export function workspaceModeById(id: string): WorkspaceModeDefinition | null {
  return id ? (modes.node(id) ?? null) : null;
}

/**
 * Opens one expanded-inspector mode.
 *
 * The id must be registered. Opening a mode that is already active keeps the
 * stored return pane; opening a different mode replaces the active page without
 * leaving a second workspace mounted. A blank or unknown id performs no write.
 */
export function openWorkspaceMode(id: string, returnPane = ""): boolean {
  const value = id.trim();
  if (!value || !modes.node(value)) {
    return false;
  }
  if (state.id === value) {
    return true;
  }
  publish({ id: value, returnPane });
  return true;
}

/**
 * Closes the active mode and returns the inspector pane remembered by the
 * expand action. A no-op on the timeline returns an empty pane.
 */
export function closeWorkspaceMode(): string {
  const returnPane = state.returnPane;
  publish({ id: "", returnPane: "" });
  return returnPane;
}

/** Switches to the timeline when the mode is active. */
export function returnToTimelineMode(): void {
  closeWorkspaceMode();
}

/** Reads the registered modes. */
export function useWorkspaceModes(): readonly WorkspaceModeDefinition[] {
  return useSyncExternalStore(subscribeWorkspaceModes, getWorkspaceModes, getWorkspaceModes);
}

/** Reads the complete active-mode state. */
export function useWorkspaceModeState(): WorkspaceModeState {
  return useSyncExternalStore(subscribeWorkspaceMode, getWorkspaceModeState, getWorkspaceModeState);
}

/** Reads the active mode id, or `""` while the timeline is showing. */
export function useActiveWorkspaceModeId(): string {
  return useSyncExternalStore(
    subscribeWorkspaceMode,
    () => state.id,
    () => state.id,
  );
}

/** Reads the active mode definition, or null while the timeline is showing. */
export function useActiveWorkspaceMode(): WorkspaceModeDefinition | null {
  return useSyncExternalStore(
    subscribeWorkspaceMode,
    () => workspaceModeById(state.id),
    () => workspaceModeById(state.id),
  );
}
