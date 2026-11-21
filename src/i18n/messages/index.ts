/**
 * The catalogs, assembled from one file per namespace.
 *
 * The startup screen needs only a small set of namespaces. The rest are
 * registered when the editor shell loads, so the startup graph does not carry
 * the settings, editor, chart, welcome, or Extension text catalogs.
 *
 * English remains the source of truth: `MessageKey` is derived from every
 * English namespace, including the deferred ones. The Chinese runtime catalog
 * covers the initial namespaces; `ZhCatalogCheck` keeps the deferred Chinese
 * types complete at compile time, and the catalog suite checks the merged pair.
 */
import type { Catalog } from "../types.ts";

import enCommon from "./en/common.ts";
import enDesign from "./en/design.ts";
import enSystem from "./en/system.ts";
import enStartup from "./en/startup.ts";
import enChrome from "./en/chrome.ts";
import enWindowControls from "./en/windowControls.ts";
import enSettingsStartup from "./en/settingsStartup.ts";
import type enModel from "./en/model.ts";
import type enShortcuts from "./en/shortcuts.ts";
import type enWorkspace from "./en/workspace.ts";
import type enWelcomeLibrary from "./en/welcomeLibrary.ts";
import type enWelcomeReview from "./en/welcomeReview.ts";
import type enWorkspaceProgress from "./en/workspaceProgress.ts";
import type enDocumentErrors from "./en/documentErrors.ts";
import type enEditor from "./en/editor.ts";
import type enEditorPanels from "./en/editorPanels.ts";
import type enTimingDetection from "./en/timingDetection.ts";
import type enSettings from "./en/settings.ts";
import type enSettingsStepper from "./en/settingsStepper.ts";
import type enSettingsLayout from "./en/settingsLayout.ts";
import type enLayoutEditor from "./en/layoutEditor.ts";
import type enSkinWorkbench from "./en/skinWorkbench.ts";
import type enCapabilities from "./en/capabilities.ts";

import zhCommon from "./zh/common.ts";
import zhDesign from "./zh/design.ts";
import zhSystem from "./zh/system.ts";
import zhStartup from "./zh/startup.ts";
import zhChrome from "./zh/chrome.ts";
import zhWindowControls from "./zh/windowControls.ts";
import zhSettingsStartup from "./zh/settingsStartup.ts";
import type zhModel from "./zh/model.ts";
import type zhShortcuts from "./zh/shortcuts.ts";
import type zhWorkspace from "./zh/workspace.ts";
import type zhWelcomeLibrary from "./zh/welcomeLibrary.ts";
import type zhWelcomeReview from "./zh/welcomeReview.ts";
import type zhWorkspaceProgress from "./zh/workspaceProgress.ts";
import type zhDocumentErrors from "./zh/documentErrors.ts";
import type zhEditor from "./zh/editor.ts";
import type zhEditorPanels from "./zh/editorPanels.ts";
import type zhTimingDetection from "./zh/timingDetection.ts";
import type zhSettings from "./zh/settings.ts";
import type zhSettingsStepper from "./zh/settingsStepper.ts";
import type zhSettingsLayout from "./zh/settingsLayout.ts";
import type zhLayoutEditor from "./zh/layoutEditor.ts";
import type zhSkinWorkbench from "./zh/skinWorkbench.ts";
import type zhCapabilities from "./zh/capabilities.ts";

/** Startup graph: the chrome and startup namespaces, no product-page text. */
export const en = {
  ...enCommon,
  ...enDesign,
  ...enSystem,
  ...enStartup,
  ...enChrome,
  ...enWindowControls,
  ...enSettingsStartup,
} as const;

/** Every key the interface can ask for, including deferred namespaces. */
type FullEn = typeof en &
  typeof enModel &
  typeof enShortcuts &
  typeof enWorkspace &
  typeof enWelcomeLibrary &
  typeof enWelcomeReview &
  typeof enWorkspaceProgress &
  typeof enDocumentErrors &
  typeof enEditor &
  typeof enEditorPanels &
  typeof enTimingDetection &
  typeof enSettings &
  typeof enSettingsStepper &
  typeof enSettingsLayout &
  typeof enLayoutEditor &
  typeof enSkinWorkbench &
  typeof enCapabilities;
export type MessageKey = keyof FullEn;

const zhInitial = {
  ...zhCommon,
  ...zhDesign,
  ...zhSystem,
  ...zhStartup,
  ...zhChrome,
  ...zhWindowControls,
  ...zhSettingsStartup,
} as const;

/** Startup graph Chinese catalog; deferred namespaces register with the shell. */
export const zh: Catalog = zhInitial;

/** Compile-time completeness check for the deferred Chinese namespaces. */
type FullZh = typeof zhInitial &
  typeof zhModel &
  typeof zhShortcuts &
  typeof zhWorkspace &
  typeof zhWelcomeLibrary &
  typeof zhWelcomeReview &
  typeof zhWorkspaceProgress &
  typeof zhDocumentErrors &
  typeof zhEditor &
  typeof zhEditorPanels &
  typeof zhTimingDetection &
  typeof zhSettings &
  typeof zhSettingsStepper &
  typeof zhSettingsLayout &
  typeof zhLayoutEditor &
  typeof zhSkinWorkbench &
  typeof zhCapabilities;
type AssertNever<T extends never> = T;
export type ZhCatalogCheck = AssertNever<Exclude<MessageKey, keyof FullZh>>;

/** The catalog for one language, widened to `Catalog`. */
export const CATALOGS: Record<"en" | "zh", Catalog> = { en, zh };
