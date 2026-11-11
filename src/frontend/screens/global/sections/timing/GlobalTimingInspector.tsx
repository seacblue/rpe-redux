/**
 * Timing inspector for the drawer.
 *
 * Renders the BPM panel for either the selected timing point's attributes or
 * the chart offset, depending on which row the author picked in the workspace.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useEditorRuntime } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import { useEditorSession } from "../../../editor/workspace/runtime/providers/SessionProvider.tsx";
import { BpmPanel } from "../../../editor/inspector/bpm/BpmPanel.tsx";
import { retainBpmForm } from "../../../editor/inspector/bpm/model.ts";
import { timingInspectorTarget } from "./timingSelection.ts";

/** Keeps the BPM form bound to the session chart and renders the selected timing target. */
export function GlobalTimingInspector() {
  const runtime = useEditorRuntime();
  const sessionRuntime = useEditorSession();
  // Follow document replacement: the form must rebind to the session a document
  // installs later, not the one captured when this pane first mounted.
  const session = useSyncExternalStore(
    sessionRuntime.subscribe,
    () => sessionRuntime.current,
    () => sessionRuntime.current,
  );
  const target = useSyncExternalStore(
    timingInspectorTarget.subscribe,
    timingInspectorTarget.get,
    timingInspectorTarget.get,
  );
  useEffect(() => {
    if (!runtime) {
      return;
    }
    const releaseBpmForm = retainBpmForm(runtime.ui.bpmForm, session);
    const show = () => {
      if (session.chart) {
        runtime.ui.bpmForm.show(session);
      }
    };
    show();
    session.addEventListener("change", show);
    return () => {
      session.removeEventListener("change", show);
      releaseBpmForm();
    };
  }, [runtime, session]);
  return <BpmPanel showTitle={false} mode={target} />;
}
