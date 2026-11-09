/**
 * The editor's shortcut declarations.
 *
 * A declaration sits next to the code that runs when its key is pressed, so
 * changing what a key does and changing the key itself are one edit in one file.
 * They are gathered in `core/edit/shortcuts.ts`, which registers the
 * categories, compiles the declarations into registry definitions, and keeps
 * `enabledFor` out of the registry — a predicate only the editor's own matcher
 * reads. `frontend/platform/shortcuts/` holds only the DOM listener that calls it.
 *
 * These shapes live here rather than in `core/shortcuts/types.ts` because the
 * registry never sees them: what it registers is an ordinary `ShortcutDefinition`.
 */
import type { ShortcutDefinition } from "../../shortcuts/types.ts";

/** Which half of the timeline an editor action applies to. */
export type EditorShortcutArea = "notes" | "events";

/** The canvas surface that owns keyboard input for an action. */
export type EditorShortcutSurface = "preview" | "timeline";

/** What the editor is looking at when a key is pressed. */
export interface EditorShortcutContext {
  area: EditorShortcutArea;
  hasSelection: boolean;
  /** Whether a two-click Hold or event placement is waiting for its endpoint. */
  hasPendingPlacement?: boolean;
  /** Whether at least one event is selected; sampling reads one event's anchor. */
  hasEventSelection?: boolean;
  /** The sampling pane currently owns the workspace and the preview. */
  samplingActive?: boolean;
  /** Present when pointer focus has established a canvas surface. */
  surface?: EditorShortcutSurface;
  /** The curve trajectory surface owns the editor stage. */
  curveMode?: boolean;
}

/** An editor shortcut: an ordinary registration plus where it applies. */
export interface EditorShortcutDefinition extends ShortcutDefinition {
  /**
   * Whether the shortcut applies in this context; omitted means "always".
   *
   * Context is what makes these bindings different from a global shortcut: `←`
   * moves the selection in one situation and steps back a beat in another.
   */
  enabledFor?: (context: EditorShortcutContext) => boolean;
  /** Restrict this shortcut to one canvas surface; omitted means both. */
  surface?: EditorShortcutSurface;
  /** Keep the action active until the matching key is released. */
  hold?: true;
}
