/**
 * Editor visibility values.
 *
 * `atHome` and `hasDocument` tell background owners whether editing is actually
 * on screen; the shell sets home when the document closes.
 */
import { createValue } from "../../state/values.ts";

export interface EditorVisibilitySnapshot {
  atHome: boolean;
  hasDocument: boolean;
  /**
   * Whether the open document differs from its last saved state.
   *
   * Chart edits and asset edits both count: a chart whose media was swapped but
   * whose JSON is unchanged still needs a save. `false` at home.
   */
  dirty: boolean;
  /** Whether local user actions are forbidden from changing the chart. */
  readOnly: boolean;
}

const visibility = createValue<EditorVisibilitySnapshot>({
  initial: { atHome: true, hasDocument: false, dirty: false, readOnly: false },
  equals: (a, b) =>
    a.atHome === b.atHome &&
    a.hasDocument === b.hasDocument &&
    a.dirty === b.dirty &&
    a.readOnly === b.readOnly,
});

/** Current home and document state of the editor surface. */
export const getEditorVisibility = visibility.get;
/** Subscribes to visibility changes; returns the unsubscribe. */
export const subscribeToEditorVisibility = visibility.subscribe;
/** Publishes the editor visibility snapshot. */
export const setEditorVisibility = visibility.set;
