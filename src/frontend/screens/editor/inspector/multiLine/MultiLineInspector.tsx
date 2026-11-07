/**
 * Mounts the multi-line form for the active editor session.
 *
 * The form is keyed by session identity rather than snapshot revision: repainting
 * the pane after a selection must keep the mounted list and its scroll position,
 * while replacing the session still starts the form with fresh drafts.
 */
import { MultiLinePanelView } from "./MultiLinePanel.tsx";
import { useEditorRuntimeValue } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { MultiLinePanelSnapshot } from "./model.ts";

const sessionKeys = new WeakMap<EditorSession, number>();
let nextSessionKey = 0;

/** Returns the stable React key assigned to one editor session. */
function sessionKey(session: EditorSession): number {
  const existing = sessionKeys.get(session);
  if (existing !== undefined) {
    return existing;
  }
  nextSessionKey += 1;
  sessionKeys.set(session, nextSessionKey);
  return nextSessionKey;
}

/** Mounts the multi-line form with a session key. */
export function MultiLineInspector() {
  const multiLinePanel = useEditorRuntimeValue(
    (runtime) => runtime.ui.multiLinePanel,
    null as MultiLinePanelSnapshot | null,
  );
  return (
    <>
      {multiLinePanel && (
        <MultiLinePanelView
          key={sessionKey(multiLinePanel.props.session)}
          {...multiLinePanel.props}
        />
      )}
    </>
  );
}
