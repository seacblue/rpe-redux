/**
 * The custom window frame's title row.
 *
 * The row is the window's drag surface: `useTitleBarWindowDrag` owns the move
 * gesture, so pressing any non-interactive point on the row moves the window and
 * a drag never activates the content below. The product mark and application
 * menu sit at the leading edge, while update and background-task badges stay at
 * the trailing edge; those controls keep their own pointer behavior. Window
 * controls are rendered separately at the frame edge.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { BrandLogo } from "./BrandLogo.tsx";
import { MenuBar } from "./MenuBar.tsx";
import { useTitleBarWindowDrag } from "./useTitleBarWindowDrag.ts";
import { LongTaskControl } from "./LongTaskControl.tsx";
import { ImportBadge } from "./ImportBadge.tsx";
import { UpdateBadge } from "../../screens/settings/updates/UpdateBadge.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import { useDocumentIdentityValue } from "../../contracts/editorHostReact.tsx";
import { formatDocumentWindowTitle } from "../../contracts/documentIdentity.ts";
import { appTitle, setAppWindowTitle } from "./windowControls/windowTitle.ts";
import { useSetting } from "../../screens/settings/useSetting.ts";
import type { WindowDisplayMode } from "../../platform/desktop/windowDisplay.ts";

/** Custom title row: brand mark, menu, and background-task badges. */
export function TitleBar() {
  const { t, language } = useTranslation();
  const displayMode = useSetting<WindowDisplayMode>("window-display-mode", "windowed");
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const identity = useDocumentIdentityValue();
  const displayName = identity.open ? identity.title || t("chrome.document.untitled") : appTitle();
  const titleBar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next =
      visibility.atHome || !identity.open
        ? appTitle()
        : formatDocumentWindowTitle(displayName, identity.dirty, appTitle());
    setAppWindowTitle(next);
  }, [displayName, identity.dirty, identity.open, language, visibility.atHome]);
  useTitleBarWindowDrag(titleBar);

  return (
    <div className="redux-titlebar" ref={titleBar} data-window-display-mode={displayMode}>
      <div className="redux-titlebar-left">
        <BrandLogo />
        <MenuBar />
      </div>
      <div className="redux-titlebar-drag" />
      <div className="redux-titlebar-right">
        <ImportBadge />
        <UpdateBadge />
        <LongTaskControl />
      </div>
    </div>
  );
}
