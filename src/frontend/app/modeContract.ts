/**
 * The single authoring surface the window frame renders.
 *
 * The shell no longer swaps between top-level modes: the stage is always the
 * editor, the inspector shows the selected object, and a large document page can
 * expand the inspector over the workspace. What remains configurable is the pieces of that
 * one surface — the workspace, the inspector, the rail, and the editor-only
 * toolbar rows — so the frame still names a slot instead of a component.
 */
import type { ComponentType } from "react";
import type { ToolbarEntry } from "../../core/shell/registries/toolbar.ts";
import type { MessageKey } from "../../i18n/index.ts";

/** The shared sidebar rail's content and semantics. */
export interface SurfaceSidebar {
  /** Accessible name for the rail. */
  label: MessageKey;
  /** Tool rails use toolbar semantics; page navigation uses navigation. */
  role: "toolbar" | "navigation";
}

/** The one authoring surface. */
export interface WorkspaceSurfaceDefinition {
  workspace: ComponentType<{ hidden?: boolean }>;
  /** Omitted when the surface has no inspector column. */
  inspector?: ComponentType<{ hidden?: boolean }>;
  sidebar: SurfaceSidebar;
  /** Draws the surface's toolbar rows; omitted uses the default action rows. */
  toolbarRows?: ComponentType<{
    entries: readonly ToolbarEntry[];
    /** Theme-selected flow: registered rows, one line, or a grid. */
    flow?: "rows" | "single" | "grid";
  }>;
}
