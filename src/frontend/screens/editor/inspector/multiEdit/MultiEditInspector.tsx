/**
 * Places the multi-edit form element produced by the panel model.
 *
 * The element is created outside React; this component only supplies its host.
 */
import { useEditorRuntimeValue } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import type { MultiEditPanelSnapshot } from "./model.ts";

/** Hosts the form element published by the panel model. */
export function MultiEditInspector() {
  const multiEditPanel = useEditorRuntimeValue(
    (runtime) => runtime.ui.multiEdit,
    null as MultiEditPanelSnapshot | null,
  );
  return <div>{multiEditPanel?.view}</div>;
}
