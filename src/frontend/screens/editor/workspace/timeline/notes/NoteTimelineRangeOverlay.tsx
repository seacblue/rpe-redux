/**
 * Renders the note timeline's floating X-range controls.
 * The controls move the shared note camera; they never select or reposition
 * multi-line panels.
 */
import { useSyncExternalStore } from "react";
import { IconButton } from "../../../../../../design/components/button/IconButton.tsx";
import { t } from "../../../../../../i18n/index.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { viewControls } from "../../runtime/commands/viewControls.ts";

const DEFAULT_CAMERA_X = 0;

/** Show the three-button X-range control over the bottom of the note field. */
export function NoteTimelineRangeOverlay() {
  const cameraX = Number(
    useSyncExternalStore(
      displayValues.cameraX.subscribe,
      displayValues.cameraX.get,
      displayValues.cameraX.get,
    ),
  );
  const atDefault = Math.abs(cameraX - DEFAULT_CAMERA_X) < 0.5;
  return (
    <div
      className="note-timeline-range-overlay"
      role="group"
      aria-label={t("editorPanels.timeline.noteRange.group")}
    >
      <IconButton
        icon="chevronLeft"
        size="small"
        label={t("editorPanels.timeline.noteRange.left")}
        onClick={() => viewControls.moveCameraX(-1)}
      />
      <IconButton
        icon="home"
        size="small"
        label={t("editorPanels.timeline.noteRange.reset")}
        disabled={atDefault}
        onClick={() => viewControls.resetCamera()}
      />
      <IconButton
        icon="chevronRight"
        size="small"
        label={t("editorPanels.timeline.noteRange.right")}
        onClick={() => viewControls.moveCameraX(1)}
      />
    </div>
  );
}
