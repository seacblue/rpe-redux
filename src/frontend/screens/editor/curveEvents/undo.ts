/**
 * Routes the draft's undo/redo bindings before the chart's own history.
 *
 * While the curve overlay is active, the live undo and redo shortcuts walk the
 * draw draft and consume the event so one press never undoes both the stroke and
 * a chart edit.
 */
import { matches } from "../../../../core/shortcuts/keyMatching.ts";
import { shortcutRegistry } from "../../../../core/shortcuts/registry.ts";
import { curvePreviewMode } from "./mode.ts";
import { isTextTarget } from "./overlayModel.ts";
import { curvePreviewState, redoCurveEdit, undoCurveEdit } from "./store.ts";

/** Whether the draw draft consumes the event as a registered undo or redo. */
export function claimCurveDraftShortcut(event: KeyboardEvent): boolean {
  if (!curvePreviewMode.get() || event.isComposing) {
    return false;
  }
  if (isTextTarget(event.target) || curvePreviewState.get().editMode !== "draw") {
    return false;
  }
  if (shortcutRegistry.bindingsOf("edit.redo").some((binding) => matches(event, binding))) {
    return redoCurveEdit();
  }
  if (shortcutRegistry.bindingsOf("edit.undo").some((binding) => matches(event, binding))) {
    return undoCurveEdit();
  }
  return false;
}
