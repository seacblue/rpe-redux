/**
 * Loads the built-in settings pages and custom controls.
 *
 * Each module registers itself as a side effect; importing every built-in
 * contribution here makes it available before the settings window renders. The
 * render path then queries the registries rather than naming a category or key.
 */
import "./appearance/ThemeControl.tsx";
import "./language/LanguageControl.tsx";
import "./skin/SkinSettings.tsx";
import "./files/FilesSettingsPage.tsx";
import "./extensions/ExtensionManager.tsx";
import "./shortcuts/ShortcutsSettings.tsx";
import "./help/UpdateVerifyControl.tsx";
import "./help/DocsOpenControl.tsx";
import "./help/AboutSettings.tsx";
import "./help/HelpSettings.tsx";
import "./help/DeveloperSettings.tsx";
import "./help/onboardingAction.ts";
import "./editing/EditingFeatureAccessControl.tsx";
import "./CodeCellAccessControl.tsx";
