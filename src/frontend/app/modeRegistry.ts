/**
 * The one authoring surface the frame renders.
 *
 * There are no top-level modes to look up any more: the editor is the surface,
 * and document-wide pages are Inspector pages that expand over the workspace.
 * The registry stays so a surface still declares its own workspace, inspector,
 * rail, and toolbar rows rather than the frame importing the editor directly.
 */
import { editorMode } from "../screens/editor/mode.tsx";
import type { WorkspaceSurfaceDefinition } from "./modeContract.ts";

/** The registered authoring surface. */
export const activeSurface: WorkspaceSurfaceDefinition = editorMode;
