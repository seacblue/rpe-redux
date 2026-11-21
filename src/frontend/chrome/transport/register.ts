/**
 * Registers the shared play and audition controls.
 *
 * They are shared chrome rather than editor-only controls, so the play button
 * and hold-to-audition stay in the toolbar on every document.
 */
import { toolbar } from "../../../core/shell/registries/toolbar.ts";

/** Registers the shared play and audition controls; returns their disposers. */
export function registerTransportControls(): () => void {
  const dispose = [
    toolbar.register({
      kind: "control",
      id: "toolbar.playback",
      order: 20,
      row: 1,
      controlId: "playback",
    }),
    toolbar.register({
      kind: "control",
      id: "toolbar.audition",
      order: 25,
      row: 1,
      controlId: "audition",
    }),
  ];
  return () => dispose.forEach((remove) => remove());
}
