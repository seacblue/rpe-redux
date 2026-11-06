/**
 * Cross-surface state for the timing detector.
 *
 * The timing drawer opens the dialog, a new chart leaves a pending request, and
 * the document loader reports that audio arrived. Those surfaces do not share a
 * React parent, so the small amount of state they exchange lives here rather
 * than in a component that happens to be mounted.
 */
import { createValue } from "../../../../../core/state/values.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";

/** Why the dialog opened. */
export type TimingDetectionSource = "manual" | "new-chart" | "audio-ready";

/** One open request; the id remounts the dialog when it is reopened. */
export interface TimingDetectionRequest {
  id: number;
  source: TimingDetectionSource;
}

const openRequest = createValue<TimingDetectionRequest | null>({ initial: null });
const pending = createValue<EditorSession | null>({
  initial: null,
  equals: Object.is,
});
const pendingMode = createValue<"ask" | "detect" | null>({ initial: null });
const audioRevision = createValue<number>({ initial: 0 });
let nextRequest = 0;

/** Subscribe to dialog open/close changes. */
export const subscribeTimingDetectionRequest = openRequest.subscribe;
/** Read the current request, or null while the dialog is closed. */
export const getTimingDetectionRequest = openRequest.get;

/** Open the detector; the host owns the modal and the analysis. */
export function openTimingDetection(source: TimingDetectionSource = "manual"): void {
  openRequest.set({ id: ++nextRequest, source });
}

/** Close the detector without cancelling any separately queued work. */
export function closeTimingDetection(): void {
  openRequest.set(null);
}

/** Subscribe to the pending marker shown by the timing drawer. */
export const subscribeTimingDetectionPending = pending.subscribe;
/** Read the session whose chart should be detected once audio is available. */
export const getTimingDetectionPending = pending.get;

/** Mark one new chart as waiting for its first audio file. */
export function markTimingDetectionPending(
  session: EditorSession,
  mode: "ask" | "detect" = "detect",
): void {
  pending.set(session);
  pendingMode.set(mode);
}

/** Clear the marker for one session, or for whichever session is pending. */
export function clearTimingDetectionPending(session?: EditorSession): void {
  if (!session || pending.get() === session) {
    pending.set(null);
    pendingMode.set(null);
  }
}

/** Consume the marker only when it belongs to the current session. */
export function takeTimingDetectionPending(session: EditorSession): "ask" | "detect" | null {
  if (pending.get() !== session) {
    return null;
  }
  const mode = pendingMode.get();
  pending.set(null);
  pendingMode.set(null);
  return mode;
}

/** Subscribe to the audio-load revision used by a waiting dialog. */
export const subscribeTimingDetectionAudio = audioRevision.subscribe;
/** Read the audio-load revision. */
export const getTimingDetectionAudioRevision = audioRevision.get;

/** Announce that a new track is decoded and playable. */
export function notifyTimingDetectionAudioLoaded(): void {
  audioRevision.set(audioRevision.get() + 1);
}
