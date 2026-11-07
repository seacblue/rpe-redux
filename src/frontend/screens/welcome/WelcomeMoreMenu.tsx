/**
 * The home screen's overflow menu.
 *
 * It carries home actions that have no dedicated control: the RPE migration
 * dialog, the application-data folder, and About. The rows come from the shared
 * context-menu renderer, so their anatomy matches every other menu; the popup
 * stays the app's standard anchored menu, with identical focus, Escape, and
 * outside-click dismissal.
 */
import { useSyncExternalStore, type MouseEvent } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { toolbar } from "../../../core/shell/registries/toolbar.ts";
import { onboardingAnchorRef } from "../../onboarding/anchors.ts";
import {
  ContextMenuPopup,
  createContextMenuState,
  type ContextMenuSnapshot,
} from "../../overlays/contextMenu/ContextMenuPopup.tsx";
import { ContextMenuRows } from "../../overlays/contextMenu/ContextMenuRows.tsx";
import { openSettings } from "../settings/settingsWindowController.ts";
import { openWelcomeImportDialog } from "./welcomeImportDialog.ts";

const moreMenu = createContextMenuState<ContextMenuSnapshot>();

/** More menu trigger and its non-duplicate home actions. */
export function WelcomeMoreMenu() {
  const { t } = useTranslation();
  const menu = useSyncExternalStore(moreMenu.subscribe, moreMenu.get, moreMenu.get);

  /** Anchor the menu below the trigger and align the menu's right edge to it. */
  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    // A second click while the popup is already open must not replace its
    // snapshot. Replacing it makes the native popover replay its enter motion.
    if (moreMenu.get() !== null) {
      event.preventDefault();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    moreMenu.set({
      owner: event.currentTarget,
      x: rect.right,
      y: rect.bottom + 4,
      align: "end",
      actions: [
        {
          id: "welcome.import-rpe",
          label: t("workspace.welcome.importRpe"),
          icon: "folder",
          run: openWelcomeImportDialog,
        },
        {
          id: "welcome.open-data-folder",
          label: t("settings.field.open-data-folder.label"),
          icon: "open",
          run: () => {
            const action = toolbar.node("files.openAppData");
            if (action?.kind === "action") {
              action.run?.();
            }
          },
        },
        {
          id: "welcome.about",
          label: t("chrome.menu.help.about"),
          icon: "star",
          run: () => openSettings("about"),
        },
      ],
    });
  };

  return (
    <div className="redux-welcome-more-menu">
      <IconButton
        ref={onboardingAnchorRef("home-rpe")}
        icon="more"
        label={t("workspace.welcome.more")}
        className="redux-welcome-more"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClickCapture={(event) => {
          // Capture the second activation before the browser's auto-popover
          // light-dismiss listener can close the already-open menu.
          if (moreMenu.get() !== null) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPointerDown={(event) => {
          // `popover="auto"` treats the trigger as an outside press. Keep a
          // second click from dismissing and immediately reopening the menu.
          if (moreMenu.get() !== null) {
            event.preventDefault();
          }
        }}
        onClick={openMenu}
      />
      <ContextMenuPopup
        store={moreMenu}
        label={t("workspace.welcome.moreMenu")}
        className="redux-welcome-more-popup"
      >
        {(snapshot, close) => <ContextMenuRows actions={snapshot.actions} close={close} />}
      </ContextMenuPopup>
    </div>
  );
}
