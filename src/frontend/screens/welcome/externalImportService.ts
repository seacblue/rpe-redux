/**
 * Late-bound entry point for the home screen's external chart import button.
 *
 * The button renders above the editor assembly, so the mounted home runtime
 * binds the real action here instead of threading a callback through the shell.
 */
import { createLateBound } from "../../../core/utils/lateBound.ts";

const binding = createLateBound<() => Promise<void>>();

/** Connect the mounted home runtime's external chart chooser. */
export function connectExternalImport(choose: () => Promise<void>): () => void {
  return binding.bind(choose);
}

/** Open the external chart picker when the editor has connected one. */
export function requestExternalImport(): void {
  void binding
    .value()?.()
    .catch(() => undefined);
}
