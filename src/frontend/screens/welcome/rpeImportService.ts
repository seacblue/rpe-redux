/**
 * Late-bound entry point for the welcome screen's RPE migration button.
 *
 * The button is rendered above the editor assembly, so it cannot receive the
 * home runtime through props without threading it through every shell surface.
 * The mounted editor binds the real migration action here.
 */
import { createLateBound } from "../../../core/utils/lateBound.ts";

const binding = createLateBound<() => Promise<void>>();

/** Connect the mounted home runtime's RPE folder chooser. */
export function connectRpeImport(choose: () => Promise<void>): () => void {
  return binding.bind(choose);
}

/** Open the RPE folder chooser when the editor has connected one. */
export function requestRpeImport(): void {
  void binding
    .value()?.()
    .catch(() => undefined);
}
