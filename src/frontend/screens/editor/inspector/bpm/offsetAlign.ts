/**
 * The armed state and lifecycle behind "align to a timeline line".
 *
 * The target offset math lives in `offsetAlignMath.ts` so it stays testable
 * without the DOM; this module owns the pick state, the toast, and the runtime
 * side effects of arming and disarming.
 */
import { createValue } from "../../../../../core/state/values.ts";
import { t } from "../../../../../i18n/index.ts";
import { showToast } from "../../../../../design/patterns/ToastHost.tsx";
import type { EditorRuntime } from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { collapseWorkspaceMode } from "../../workspace/container/workspaceModeActions.ts";
import { getWorkspaceModeState } from "../../workspace/container/workspaceModes.ts";

/** Whether a timeline click is currently being captured to set the offset. */
export const offsetAlignArmed = createValue<boolean>({ initial: false });

/**
 * Arm the pick: reveal the timeline, pause the transport, and highlight lines.
 *
 * Aligning needs a still playhead and a visible timeline, so the expanded
 * inspector collapses back to the workspace and the transport pauses. The
 * highlight is a runtime-only appearance flag rather than a setting, so arming
 * never rewrites the author's saved guide colours.
 */
export function armOffsetAlign(runtime: EditorRuntime | null): boolean {
  if (!runtime) {
    return false;
  }
  runtime.providers.playback.playback.pause();
  runtime.timeline.viewport.setPlaybackActive(false);
  if (getWorkspaceModeState().id !== "") {
    collapseWorkspaceMode(runtime);
  }
  runtime.timeline.appearance.alignHighlight = true;
  runtime.timeline.changed();
  offsetAlignArmed.set(true);
  showToast(t("editorPanels.inspector.form.bpm.alignToast"), "info");
  return true;
}

/** Leave the pick and restore the configured guide highlighting. */
export function disarmOffsetAlign(runtime: EditorRuntime | null): void {
  if (!offsetAlignArmed.get()) {
    return;
  }
  offsetAlignArmed.set(false);
  if (!runtime || !runtime.timeline.appearance.alignHighlight) {
    return;
  }
  runtime.timeline.appearance.alignHighlight = false;
  runtime.timeline.changed();
}
