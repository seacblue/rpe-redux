/**
 * The two catalogs, assembled from one file per namespace.
 *
 * English is the source of truth: `MessageKey` is derived from it, so a key
 * that English does not declare cannot be typed, and the Chinese catalog is
 * annotated with `Record<MessageKey, string>` so a key that English declares and
 * Chinese forgets is a compile error rather than a string that silently renders
 * in the wrong language.
 *
 * Namespaces are split by where the text lives in `src/`, not by who reads it:
 * a reviewer looking at `src/frontend/screens/settings/` knows the text is in the settings
 * namespace without searching for it.
 */
import type { Catalog } from "../types.ts";

import enCommon from "./en/common.ts";
import enDesign from "./en/design.ts";
import enModel from "./en/model.ts";
import enSystem from "./en/system.ts";
import enShortcuts from "./en/shortcuts.ts";
import enChrome from "./en/chrome.ts";
import enWindowControls from "./en/windowControls.ts";
import enWorkspace from "./en/workspace.ts";
import enWorkspaceProgress from "./en/workspaceProgress.ts";
import enDocumentErrors from "./en/documentErrors.ts";
import enEditor from "./en/editor.ts";
import enEditorPanels from "./en/editorPanels.ts";
import enTimingDetection from "./en/timingDetection.ts";
import enSettings from "./en/settings.ts";
import enSkinWorkbench from "./en/skinWorkbench.ts";
import enStartup from "./en/startup.ts";
import enCapabilities from "./en/capabilities.ts";

import zhCommon from "./zh/common.ts";
import zhDesign from "./zh/design.ts";
import zhModel from "./zh/model.ts";
import zhSystem from "./zh/system.ts";
import zhShortcuts from "./zh/shortcuts.ts";
import zhChrome from "./zh/chrome.ts";
import zhWindowControls from "./zh/windowControls.ts";
import zhWorkspace from "./zh/workspace.ts";
import zhWorkspaceProgress from "./zh/workspaceProgress.ts";
import zhDocumentErrors from "./zh/documentErrors.ts";
import zhEditor from "./zh/editor.ts";
import zhEditorPanels from "./zh/editorPanels.ts";
import zhTimingDetection from "./zh/timingDetection.ts";
import zhSettings from "./zh/settings.ts";
import zhSkinWorkbench from "./zh/skinWorkbench.ts";
import zhStartup from "./zh/startup.ts";
import zhCapabilities from "./zh/capabilities.ts";

/** English: the reference catalog every other language is checked against. */
export const en = {
  ...enCommon,
  ...enDesign,
  ...enModel,
  ...enSystem,
  ...enShortcuts,
  ...enChrome,
  ...enWindowControls,
  ...enWorkspace,
  ...enWorkspaceProgress,
  ...enDocumentErrors,
  ...enEditor,
  ...enEditorPanels,
  ...enTimingDetection,
  ...enSettings,
  ...enSkinWorkbench,
  ...enStartup,
  ...enCapabilities,
};

/** Every key the interface can ask for. Derived, never hand-written. */
export type MessageKey = keyof typeof en;

/** Chinese, required to cover every English key. */
export const zh: Record<MessageKey, string> = {
  ...zhCommon,
  ...zhDesign,
  ...zhModel,
  ...zhSystem,
  ...zhShortcuts,
  ...zhChrome,
  ...zhWindowControls,
  ...zhWorkspace,
  ...zhWorkspaceProgress,
  ...zhDocumentErrors,
  ...zhEditor,
  ...zhEditorPanels,
  ...zhTimingDetection,
  ...zhSettings,
  ...zhSkinWorkbench,
  ...zhStartup,
  ...zhCapabilities,
};

/**
 * The catalog for one language, widened to `Catalog`.
 *
 * `zh` is built from the same spread shape as `en`, so its own inferred type is
 * a literal-keyed object; widening it keeps `t()`'s lookup a plain index.
 */
export const CATALOGS: Record<"en" | "zh", Catalog> = { en, zh };
