/**
 * Late-bound entry point for the welcome screen's PhiEditer import button.
 *
 * The import dialog renders above the editor assembly, so the mounted home
 * runtime binds the folder chooser here instead of threading a callback through
 * every shell surface.
 */
import { createLateBound } from "../../../core/utils/lateBound.ts";

const binding = createLateBound<() => Promise<void>>();

/** Connect the mounted home runtime's PhiEditer folder chooser. */
export function connectPeImport(choose: () => Promise<void>): () => void {
  return binding.bind(choose);
}

/** Open the PhiEditer folder chooser when the editor has connected one. */
export function requestPeImport(): void {
  void binding
    .value()?.()
    .catch(() => undefined);
}
