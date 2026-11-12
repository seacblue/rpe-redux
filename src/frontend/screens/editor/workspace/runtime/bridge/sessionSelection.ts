/**
 * Applies selection-pane routing only when the selection signature changes.
 * Routing policy lives in `selectionPaneRouting`; the effects are injected by
 * the runtime.
 */
import { EditorSession } from "../../../../../../core/edit/session/session.ts";

import { resolveSelectionPane } from "./selectionPaneRouting.ts";
import { applySelectionPaneAction } from "../commands/selectionPanes.ts";

import type { SelectionPaneEffects } from "../commands/selectionPanes.ts";
/** Inspector effects and live state for routing the current selection. */
export interface SessionSelectionOptions {
  layer(): number;
  state(): {
    multiEditCommitting: boolean;
    trajectoryActive: boolean;
    curveEditorOpen: boolean;
  };
  effects: SelectionPaneEffects;
}
/** Deduplicate selection decisions and apply their ordered UI effects. */
export function createSessionSelection(options: SessionSelectionOptions) {
  let signature = "";
  let lastRevision = -1;
  let lastLineIndex: number | null = null;
  return {
    /** Applies the routing decision when the selection signature changed. */
    route(session: EditorSession, activePane: string): void {
      const pointerSelection = session.selectionRevision !== lastRevision;
      const routing = resolveSelectionPane(session, options.layer(), {
        activePane,
        initialRoute: lastLineIndex === null,
        lineChanged: lastLineIndex !== null && session.lineIndex !== lastLineIndex,
        pointerSelection,
        ...options.state(),
      });
      if (routing.signature !== signature) {
        signature = routing.signature;
        lastRevision = session.selectionRevision;
        applySelectionPaneAction(routing.action, options.effects);
      }
      lastLineIndex = session.lineIndex;
    },
    /** Forgets the last signature so the next selection routes again. */
    reset(): void {
      signature = "";
      lastRevision = -1;
      lastLineIndex = null;
    },
  };
}
