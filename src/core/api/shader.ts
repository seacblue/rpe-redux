/**
 * Public facade for workspace shader passes.
 *
 * A registered pass is full-screen, ordered relative to chart-authored shader
 * effects, and loaded directly from its GLSL source. The preview consumes it;
 * the export projection decides whether to embed or warn about the pass.
 */
import { extensionActionId } from "../extensions/capabilities.ts";
import {
  workspaceShaderPasses,
  type WorkspaceShaderPassDefinition,
} from "../global/chart/shader/workspacePasses.ts";

/** Create a shader facade for the host or one Extension owner. */
export function createShaderApi(owner?: string) {
  const idFor = (id: string): string => (owner ? extensionActionId(owner, id) : id);
  return Object.freeze({
    /** List the host passes, or only this Extension's passes. */
    list: () => workspaceShaderPasses.list(owner),
    /** Register one full-screen GLSL pass. */
    register: (definition: WorkspaceShaderPassDefinition) =>
      workspaceShaderPasses.register({ ...definition, id: idFor(definition.id) }, owner),
    /** Remove one pass owned by this facade. */
    unregister: (id: string) => workspaceShaderPasses.unregister(idFor(id), owner),
    /** Enable one pass owned by this facade. */
    enable: (id: string) => workspaceShaderPasses.setEnabled(idFor(id), true, owner),
    /** Disable one pass owned by this facade. */
    disable: (id: string) => workspaceShaderPasses.setEnabled(idFor(id), false, owner),
  });
}

/** Complete host facade used by development and automation. */
export const shader = createShaderApi();

export type {
  WorkspaceShaderMaskBinding,
  WorkspaceShaderMaskDefinition,
  WorkspaceShaderPortableDefinition,
  WorkspaceShaderExportMode,
  WorkspaceShaderExportPolicy,
  WorkspaceShaderPassDefinition,
  WorkspaceShaderPassStatus,
  WorkspaceShaderPosition,
  WorkspaceShaderRenderPass,
  WorkspaceShaderWarning,
} from "../global/chart/shader/workspacePasses.ts";
