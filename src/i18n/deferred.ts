/**
 * The product-page catalogs loaded with the editor shell.
 *
 * Keeping these out of `messages/index.ts` lets the startup screen ship only the
 * chrome/startup text. The shell registers this table before it renders, so the
 * settings, editor, chart, welcome, and Extension surfaces see their strings.
 */
import { registerCoreCatalog } from "./index.ts";
import enModel from "./messages/en/model.ts";
import enShortcuts from "./messages/en/shortcuts.ts";
import enWorkspace from "./messages/en/workspace.ts";
import enWelcomeLibrary from "./messages/en/welcomeLibrary.ts";
import enWelcomeReview from "./messages/en/welcomeReview.ts";
import enWorkspaceProgress from "./messages/en/workspaceProgress.ts";
import enDocumentErrors from "./messages/en/documentErrors.ts";
import enEditor from "./messages/en/editor.ts";
import enEditorPanels from "./messages/en/editorPanels.ts";
import enTimingDetection from "./messages/en/timingDetection.ts";
import enSettings from "./messages/en/settings.ts";
import enSettingsStepper from "./messages/en/settingsStepper.ts";
import enSettingsLayout from "./messages/en/settingsLayout.ts";
import enLayoutEditor from "./messages/en/layoutEditor.ts";
import enSkinWorkbench from "./messages/en/skinWorkbench.ts";
import enCapabilities from "./messages/en/capabilities.ts";

import zhModel from "./messages/zh/model.ts";
import zhShortcuts from "./messages/zh/shortcuts.ts";
import zhWorkspace from "./messages/zh/workspace.ts";
import zhWelcomeLibrary from "./messages/zh/welcomeLibrary.ts";
import zhWelcomeReview from "./messages/zh/welcomeReview.ts";
import zhWorkspaceProgress from "./messages/zh/workspaceProgress.ts";
import zhDocumentErrors from "./messages/zh/documentErrors.ts";
import zhEditor from "./messages/zh/editor.ts";
import zhEditorPanels from "./messages/zh/editorPanels.ts";
import zhTimingDetection from "./messages/zh/timingDetection.ts";
import zhSettings from "./messages/zh/settings.ts";
import zhSettingsStepper from "./messages/zh/settingsStepper.ts";
import zhSettingsLayout from "./messages/zh/settingsLayout.ts";
import zhLayoutEditor from "./messages/zh/layoutEditor.ts";
import zhSkinWorkbench from "./messages/zh/skinWorkbench.ts";
import zhCapabilities from "./messages/zh/capabilities.ts";

/** Deferred English namespaces, exposed for the catalog parity suite. */
export const enDeferred = {
  ...enModel,
  ...enShortcuts,
  ...enWorkspace,
  ...enWelcomeLibrary,
  ...enWelcomeReview,
  ...enWorkspaceProgress,
  ...enDocumentErrors,
  ...enEditor,
  ...enEditorPanels,
  ...enTimingDetection,
  ...enSettings,
  ...enSettingsStepper,
  ...enSettingsLayout,
  ...enLayoutEditor,
  ...enSkinWorkbench,
  ...enCapabilities,
};

/** Deferred Chinese namespaces, paired with `enDeferred`. */
export const zhDeferred = {
  ...zhModel,
  ...zhShortcuts,
  ...zhWorkspace,
  ...zhWelcomeLibrary,
  ...zhWelcomeReview,
  ...zhWorkspaceProgress,
  ...zhDocumentErrors,
  ...zhEditor,
  ...zhEditorPanels,
  ...zhTimingDetection,
  ...zhSettings,
  ...zhSettingsStepper,
  ...zhSettingsLayout,
  ...zhLayoutEditor,
  ...zhSkinWorkbench,
  ...zhCapabilities,
};

/** Merge the deferred namespaces into the live catalogs. */
export function registerDeferredCatalogs(): void {
  registerCoreCatalog({ en: enDeferred, zh: zhDeferred });
}
