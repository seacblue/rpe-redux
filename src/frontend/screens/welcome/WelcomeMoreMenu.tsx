/**
 * The home screen's overflow menu.
 *
 * It carries home actions that have no dedicated control: the desktop RPE
 * migration dialog, the desktop application-data folder, and About. The rows
 * come from the shared context-menu renderer, so their anatomy matches every
 * other menu; the popup stays the app's standard anchored menu, with identical
 * focus, Escape, and outside-click dismissal.
 */
import { useSyncExternalStore, type MouseEvent } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { toolbar } from "../../../core/shell/registries/toolbar.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
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
    // The capture handler owns the close half of the toggle, so opening never
    // replaces an existing snapshot and replays the native popover's motion.
    if (moreMenu.get() !== null) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // RPE migration and the data folder are native-host workflows. The web
    // build keeps the chart-file import button and its own storage page.
    const rpeAction = isDesktop()
      ? {
          id: "welcome.import-rpe",
          label: t("workspace.welcome.importRpe"),
          icon: "folder" as const,
          run: openWelcomeImportDialog,
        }
      : null;
    const dataFolderAction = isDesktop()
      ? {
          id: "welcome.open-data-folder",
          label: t("settings.field.open-data-folder.label"),
          icon: "open" as const,
          run: () => {
            const action = toolbar.node("files.openAppData");
            if (action?.kind === "action") {
              action.run?.();
            }
          },
        }
      : null;
    moreMenu.set({
      owner: event.currentTarget,
      x: rect.right,
      y: rect.bottom + 4,
      align: "end",
      actions: [
        ...(rpeAction ? [rpeAction] : []),
        ...(dataFolderAction ? [dataFolderAction] : []),
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
          // light-dismiss listener can close and reopen the menu. The click
          // closes through the store, so the popup does not replay its motion.
          if (moreMenu.get() !== null) {
            event.preventDefault();
            event.stopPropagation();
            moreMenu.set(null);
          }
        }}
        onPointerDown={(event) => {
          // `popover="auto"` treats the trigger as an outside press. Keep that
          // light dismissal from firing before the click toggles the menu.
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
