/**
 * Composes the value cells every inspector pane reads from the editor runtime,
 * once per mounted editor tree.
 *
 * Pane registrations are independent of this module; it only gives each pane a
 * slot, so a pane that was never opened still has stable state for its
 * controller.
 */
import { createValue } from "../../../../core/state/values.ts";
import { createAssetLibraryState } from "../../global/sections/assets/model.ts";
import { createBpmForm } from "./bpm/model.ts";
import { createCurveState } from "./curveNotes/model.ts";
import { createEventInspectorState } from "./events/model.ts";
import { createLinePanelState } from "../../global/sections/lines/model.ts";
import { createMultiEditState } from "./multiEdit/model.ts";
import { createMultiLinePanelState } from "./multiLine/model.ts";
import { createNotesInspectorState } from "./notes/model.ts";
import { createTrajectoryPanelState } from "./trajectory/model.ts";

/** State cells used by inspector panes and their shared inspector controller. */
export function createInspectorUiState() {
  return {
    activeInspector: createValue({ initial: "" }),
    assetLibrary: createAssetLibraryState(),
    bpmForm: createBpmForm(),
    curve: createCurveState(),
    events: createEventInspectorState(),
    linePanel: createLinePanelState(),
    multiEdit: createMultiEditState(),
    multiLinePanel: createMultiLinePanelState(),
    notes: createNotesInspectorState(),
    trajectoryPanel: createTrajectoryPanelState(),
  };
}

export type InspectorUiState = ReturnType<typeof createInspectorUiState>;
