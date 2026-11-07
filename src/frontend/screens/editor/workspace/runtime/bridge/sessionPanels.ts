/**
 * Refreshes the inspector panes after a session change, routing each pane to its
 * own renderer. Pane internals stay with the inspector; this module owns only
 * which pane refreshes.
 */
import { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import type { Beat } from "../../../../../../core/global/chart/timing/beat.ts";

import { renderProperties } from "../../../inspector/notes/noteInspector.ts";
import { renderEventInspector } from "../../../inspector/events/eventInspector.ts";
import type { EditorUiState } from "../composition/editorUiState.ts";

import type { Timeline } from "../../timeline/surface/timeline.ts";
import type { LayerButtons } from "../../timeline/layers/layerButtons.ts";
import type { MultiEditPanel } from "../../../inspector/multiEdit/multiEdit.ts";
import type { MultiLinePanel } from "../../../inspector/multiLine/MultiLinePanel.tsx";

import { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** Feature handles the session publication refreshes. */
export interface SessionPanelOptions {
  ui: EditorUiState;
  timeline: Pick<Timeline, "setPreview" | "changed"> & {
    gestures: Pick<Timeline["gestures"], "eventPlacementType">;
  };
  layerButtons: Pick<LayerButtons, "render">;
  multiEdit: Pick<MultiEditPanel, "sync">;
  multiLinePanel: Pick<MultiLinePanel, "render">;
  currentBeat(): number;
  reportError(error: unknown): void;
  notify(message: string, level?: string, duration?: number): void;
  nudgeBeatInput(value: Beat, direction: number): Beat | null;
}
/** Refresh only the relevant panel contents, leaving routing to its own module. */
export function createSessionPanels(runtime: SessionPanelOptions) {
  return {
    /** Refreshes the active pane plus the note and event inspectors. */
    refresh(session: EditorSession, currentTempo: TempoMap, activePane: string): void {
      runtime.layerButtons.render();
      if (activePane === "multi") {
        runtime.multiEdit.sync();
      }
      if (activePane === "multi-line") {
        runtime.multiLinePanel.render();
      }
      renderProperties(
        session,
        runtime.ui.notes,
        currentTempo,
        runtime.reportError,
        runtime.nudgeBeatInput,
      );
      if (!session.liveEventEdit) {
        renderEventInspector(
          session,
          currentTempo,
          runtime.currentBeat,
          runtime.reportError,
          runtime.notify,
          runtime.nudgeBeatInput,
          runtime.timeline,
          runtime.ui.events,
        );
      }
      if (session.eventSelection.size) {
        const firstEventKey = session.eventSelection.values().next().value ?? "";
        runtime.timeline.gestures.eventPlacementType = firstEventKey.split(":")[0];
      }
    },
  };
}
