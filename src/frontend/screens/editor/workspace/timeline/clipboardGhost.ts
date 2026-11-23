/**
 * Projects the app-private clipboard for the timeline's translucent ghost.
 *
 * This module owns only clipboard targeting. Note and event surfaces keep their
 * existing skin renderers, so the ghost follows the same visual language as a
 * committed object without introducing a second procedural shape.
 */
import {
  projectClipboard,
  type ClipboardProjection,
} from "../../../../../core/edit/clipboard/operations.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { TimelineGestures } from "./interaction/timelineGestures.ts";
import type { TimelineViewport } from "./viewport/timelineViewport.ts";

/** Timeline state needed to resolve a clipboard ghost projection. */
export interface ClipboardGhostReceiver {
  readonly appearance: { readonly clipboardGhostEnabled?: boolean };
  readonly gestures: Pick<TimelineGestures, "clipboardPointer" | "clipboardMode">;
  readonly viewport: Pick<TimelineViewport, "snappedBeatTriple">;
  getSession(): EditorSession;
}

/** Projects clipboard contents at the current pointer target, or returns null. */
export function projectClipboardGhost(
  receiver: ClipboardGhostReceiver,
  targetLineIndex = receiver.getSession().lineIndex,
): ClipboardProjection | null {
  if (receiver.appearance.clipboardGhostEnabled === false || !receiver.gestures.clipboardPointer) {
    return null;
  }
  const session = receiver.getSession();
  const pointerBeat = receiver.viewport.snappedBeatTriple(receiver.gestures.clipboardPointer.y);
  const projection = projectClipboard(session, pointerBeat, {
    ...receiver.gestures.clipboardMode,
    targetLineIndex,
    preview: true,
  });
  return projection.notes.length || projection.events.length ? projection : null;
}
