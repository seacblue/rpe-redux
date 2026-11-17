/**
 * Renders the note timeline's floating X-range controls.
 * The controls move the shared note camera; they never select or reposition
 * multi-line panels.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { IconButton } from "../../../../../../design/components/button/IconButton.tsx";
import { t } from "../../../../../../i18n/index.ts";
import { displayValues } from "../../../../settings/editorDisplaySettings.ts";
import { viewControls } from "../../runtime/commands/viewControls.ts";
import { useProximityReveal } from "../interaction/useProximityReveal.ts";

const DEFAULT_CAMERA_X = 0;
const LONG_PRESS_DELAY_MS = 280;
const HOLD_REPEAT_MS = 90;
type CameraDirection = -1 | 1;

/** Show the three-button X-range control over the bottom of the note field. */
export function NoteTimelineRangeOverlay() {
  const { ref: overlayRef, revealed } = useProximityReveal<HTMLDivElement>();
  const [pressedDirection, setPressedDirection] = useState<CameraDirection | null>(null);
  const holdDelay = useRef<number | null>(null);
  const holdRepeat = useRef<number | null>(null);
  const skipNextClick = useRef(false);
  const cameraX = Number(
    useSyncExternalStore(
      displayValues.cameraX.subscribe,
      displayValues.cameraX.get,
      displayValues.cameraX.get,
    ),
  );
  const atDefault = Math.abs(cameraX - DEFAULT_CAMERA_X) < 0.5;

  const clearHoldTimers = (): void => {
    if (holdDelay.current !== null) {
      window.clearTimeout(holdDelay.current);
      holdDelay.current = null;
    }
    if (holdRepeat.current !== null) {
      window.clearInterval(holdRepeat.current);
      holdRepeat.current = null;
    }
  };

  const beginHold = (direction: CameraDirection, event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    clearHoldTimers();
    // A pointer press is itself the first move; suppress the native click so
    // a short press does not move twice.
    skipNextClick.current = true;
    viewControls.moveCameraX(direction);
    setPressedDirection(direction);
    holdDelay.current = window.setTimeout(() => {
      viewControls.moveCameraX(direction);
      holdRepeat.current = window.setInterval(
        () => viewControls.moveCameraX(direction),
        HOLD_REPEAT_MS,
      );
    }, LONG_PRESS_DELAY_MS);
  };

  const endHold = (cancelled = false): void => {
    clearHoldTimers();
    if (cancelled) {
      skipNextClick.current = false;
    }
    setPressedDirection(null);
  };

  const clickMove = (direction: CameraDirection): void => {
    if (skipNextClick.current) {
      skipNextClick.current = false;
      return;
    }
    viewControls.moveCameraX(direction);
  };

  useEffect(() => () => clearHoldTimers(), []);

  return (
    <div
      ref={overlayRef}
      className={`note-timeline-range-overlay proximity-reveal${revealed ? " is-revealed" : ""}`}
      role="group"
      aria-label={t("editorPanels.timeline.noteRange.group")}
    >
      <IconButton
        icon="chevronLeft"
        size="small"
        label={t("editorPanels.timeline.noteRange.left")}
        active={pressedDirection === -1}
        onPointerDown={(event) => beginHold(-1, event)}
        onPointerUp={() => endHold()}
        onPointerCancel={() => endHold(true)}
        onClick={() => clickMove(-1)}
      />
      <IconButton
        icon="home"
        size="small"
        label={t("editorPanels.timeline.noteRange.reset")}
        disabled={atDefault}
        onClick={() => viewControls.resetNoteTimelineCamera()}
      />
      <IconButton
        icon="chevronRight"
        size="small"
        label={t("editorPanels.timeline.noteRange.right")}
        active={pressedDirection === 1}
        onPointerDown={(event) => beginHold(1, event)}
        onPointerUp={() => endHold()}
        onPointerCancel={() => endHold(true)}
        onClick={() => clickMove(1)}
      />
    </div>
  );
}
