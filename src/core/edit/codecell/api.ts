/**
 * Mounted Code Cell request seam.
 *
 * The active editor binds its adapter on mount and drops the binding on
 * teardown, so a transport treats a missing binding as unavailable.
 */
import { createLateBound } from "../../utils/lateBound.ts";
import type { CodeCellAdapter } from "./adapter.ts";

/** Mounted Code Cell seam; the HTTP transport forwards requests to the active editor. */
export interface MountedCodeCellApi extends Pick<CodeCellAdapter, "handle"> {}

const codeCellBinding = createLateBound<MountedCodeCellApi>();

/** Binds the mounted adapter; returns an idempotent disposer. */
export function connectCodeCellApi(adapter: MountedCodeCellApi): () => void {
  return codeCellBinding.bind(adapter);
}

/** The active adapter, or null while no editor is mounted. */
export function getCodeCellApi(): MountedCodeCellApi | null {
  return codeCellBinding.value();
}
