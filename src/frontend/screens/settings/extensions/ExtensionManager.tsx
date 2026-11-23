/**
 * The Extensions settings group.
 *
 * The page owns the safe-mode notice, the installed-extension list, and the
 * install dialog; individual cards only enable, disable, or remove a package.
 * A package dropped on the window arrives here through `requestLocalPackageReview`
 * and opens the ordinary review dialog with that path pre-filled.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../i18n/react.ts";
import { registerSettingsPage, type SettingsPageContext } from "../settingsContributions.ts";
import type { MessageKey } from "../../../../i18n/index.ts";
import {
  getExtensionStartupState,
  refreshPackagedExtensions,
} from "../../../platform/extensionLoader.ts";
import { useSurfacePolling } from "../useSurfacePolling.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { ExtensionListView } from "./ExtensionListView.tsx";
import { ExtensionInstallDialog } from "./ExtensionInstallDialog.tsx";
import {
  subscribePendingLocalPackage,
  takePendingLocalPackage,
} from "../settingsWindowController.ts";

/**
 * The settings page owns the page-level safe-mode notice, the installed
 * extension list, and the install dialog.
 */
export function ExtensionManager({ active }: SettingsPageContext) {
  const { t } = useTranslation();
  const [installOpen, setInstallOpen] = useState(false);
  const [zipPickerBusy, setZipPickerBusy] = useState(false);
  // A package drop publishes a path and opens this page; consuming it here keeps
  // the dialog mounted for exactly the review the user asked for.
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  useEffect(() => {
    /** Take one pending package and open its review. */
    const consume = () => {
      const path = takePendingLocalPackage();
      if (!path) {
        return;
      }
      setReviewPath(path);
      setInstallOpen(true);
    };
    consume();
    return subscribePendingLocalPackage(consume);
  }, []);
  // The page stays mounted while the settings window is open; folder discovery
  // and manifest reloads only run while this section is the active one.
  useSurfacePolling(active, refreshPackagedExtensions);
  const startup = getExtensionStartupState();
  const safeModeReason =
    startup.reason === "request"
      ? t("startup.safeMode.requested")
      : t(`settings.extensions.safeMode.${startup.reason ?? "unknown"}` as MessageKey);

  /** Select a local ZIP, then route it through the ordinary review dialog. */
  const selectZip = async () => {
    setZipPickerBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("settings.extensions.install.localArchiveTitle"),
        filters: [{ name: "Extension package", extensions: ["zip"] }],
      });
      if (typeof selected !== "string") {
        return;
      }
      setReviewPath(selected);
      setInstallOpen(true);
    } finally {
      setZipPickerBusy(false);
    }
  };

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
          <Button
            variant="outlined"
            disabled={startup.safeMode || zipPickerBusy}
            onClick={() => void selectZip()}
          >
            {t("settings.extensions.install.localArchive")}
          </Button>
          <Button
            variant="solid"
            disabled={startup.safeMode}
            onClick={() => {
              setReviewPath(null);
              setInstallOpen(true);
            }}
          >
            {t("settings.extensions.install.github")}
          </Button>
        </div>
      </div>
      {installOpen && (
        <ExtensionInstallDialog
          {...(reviewPath ? { initialLocalPath: reviewPath } : {})}
          onClose={() => {
            setInstallOpen(false);
            setReviewPath(null);
          }}
        />
      )}
    </section>
  );
}

registerSettingsPage("extensions", {
  keywords: "settings.search.extensionKeywords",
  component: ExtensionManager,
});
