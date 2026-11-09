/**
 * The clickable brand mark in the title bar.
 *
 * The mark is the editor's return-to-library control. It publishes the click
 * through the chrome command seam rather than reaching into the editor, so the
 * editor keeps ownership of the confirmation and of the active room.
 */
import { useSyncExternalStore } from "react";
import { AppIcon } from "../../../design/components/brand/AppIcon.tsx";
import { Button } from "../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { editorChromeCommands } from "../../contracts/editorCommands.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";

/**
 * The compact application mark at the leading edge of the title bar.
 *
 * It stays a plain brand mark at home and becomes a library action in the
 * editor. The shared button primitive supplies focus, keyboard, and press
 * semantics; the mark itself is decorative inside that button.
 */
export function BrandLogo() {
  const { t } = useTranslation();
  const atHome = useSyncExternalStore(
    subscribeToEditorVisibility,
    () => getEditorVisibility().atHome,
    () => getEditorVisibility().atHome,
  );
  const label = t("chrome.menu.file.titleScreen");
  return (
    <Button
      variant="plain"
      className="redux-titlebar-brand"
      aria-label={label}
      aria-disabled={atHome}
      data-tip-title={atHome ? undefined : label}
      tabIndex={atHome ? -1 : undefined}
      onClick={() => {
        if (!atHome) {
          editorChromeCommands()?.navigation.openLibrary();
        }
      }}
    >
      <AppIcon size={20} alt="" className="redux-titlebar-logo" />
    </Button>
  );
}
