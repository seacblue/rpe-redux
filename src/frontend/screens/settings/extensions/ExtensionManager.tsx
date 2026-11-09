/**
 * The Extensions settings group.
 *
 * The page owns the safe-mode notice, the installed-extension list, and the
 * install dialog; individual cards only enable, disable, or remove a package.
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n/react.ts";
import { registerSettingsPage } from "../settingsContributions.ts";
import type { MessageKey } from "../../../../i18n/index.ts";
import { getExtensionStartupState } from "../../../platform/extensionLoader.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { ExtensionListView } from "./ExtensionListView.tsx";
import { ExtensionInstallDialog } from "./ExtensionInstallDialog.tsx";

/**
 * The settings page owns the page-level safe-mode notice, the installed
 * extension list, and the install dialog.
 */
export function ExtensionManager() {
  const { t } = useTranslation();
  const [installOpen, setInstallOpen] = useState(false);
  const startup = getExtensionStartupState();
  const safeModeReason =
    startup.reason === "request"
      ? t("startup.safeMode.requested")
      : t(`settings.extensions.safeMode.${startup.reason ?? "unknown"}` as MessageKey);

  return (
    <section className="redux-setting-group redux-extension-manager">
      {startup.safeMode && (
        <InlineAlert className="extension-safe-mode">
          {t("settings.extensions.review.safeMode", { value: safeModeReason })}
        </InlineAlert>
      )}
      <div className="redux-extension-manager-heading">
        <div>
          <h2>{t("settings.extensions.installed.title")}</h2>
          {startup.safeMode && (
            <p className="redux-setting-description">
              {t("settings.extensions.install.safeModeHint")}
            </p>
          )}
        </div>
      </div>
      <ExtensionListView />
      <div className="redux-footer-bar">
        <div className="redux-footer-actions">
          <Button variant="solid" disabled={startup.safeMode} onClick={() => setInstallOpen(true)}>
            {t("settings.extensions.install.open")}
          </Button>
        </div>
      </div>
      {installOpen && <ExtensionInstallDialog onClose={() => setInstallOpen(false)} />}
    </section>
  );
}

registerSettingsPage("extensions", {
  keywords: "settings.search.extensionKeywords",
  component: ExtensionManager,
});
