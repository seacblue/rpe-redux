/**
 * The home screen's import dialog.
 *
 * It is the single surface for both migration paths: an RPE installation folder
 * or another supported chart file. The window itself owns the native drop
 * handler, so this dialog mirrors drag state and closes as soon as a drop is
 * handed to the import runtime; the buttons start the same native choosers the
 * old footer actions used.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { FILE_DRAG_EVENT } from "../../../core/shell/shellEventNames.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { requestExternalImport } from "./externalImportService.ts";
import { requestRpeImport } from "./rpeImportService.ts";
import {
  closeWelcomeImportDialog,
  getWelcomeImportDialog,
  subscribeWelcomeImportDialog,
} from "./welcomeImportDialog.ts";

/** Drop target plus the two import entry points, shown over the home screen. */
export function WelcomeImportDialog() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(
    subscribeWelcomeImportDialog,
    getWelcomeImportDialog,
    getWelcomeImportDialog,
  );
  const [dragging, setDragging] = useState(false);

  // The native window owns the actual drop. Mirror its state so the dropzone
  // reads as the active target, then let the global import runtime take over as
  // soon as the paths arrive.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDragState = (event: Event): void => {
      const state = (event as CustomEvent<string>).detail;
      if (state === "drop") {
        setDragging(false);
        closeWelcomeImportDialog();
        return;
      }
      setDragging(state === "enter" || state === "over");
    };
    window.addEventListener(FILE_DRAG_EVENT, onDragState);
    return () => window.removeEventListener(FILE_DRAG_EVENT, onDragState);
  }, [open]);

  /** Close first so the native picker never sits behind the modal scrim. */
  const choose = (request: () => void) => {
    closeWelcomeImportDialog();
    request();
  };

  return (
    <Modal
      open={open}
      onClose={closeWelcomeImportDialog}
      label={t("workspace.welcome.importDialog.title")}
      className="redux-welcome-import-dialog"
      actions={
        <>
          <Button variant="outlined" onClick={closeWelcomeImportDialog}>
            {t("common.action.cancel")}
          </Button>
          <Button variant="outlined" onClick={() => choose(requestExternalImport)}>
            {t("workspace.welcome.importDialog.external")}
          </Button>
          <Button variant="solid" onClick={() => choose(requestRpeImport)}>
            {t("workspace.welcome.importDialog.rpe")}
          </Button>
        </>
      }
    >
      <div
        className="redux-welcome-import-dropzone"
        data-active={dragging}
        role="group"
        aria-label={t("workspace.welcome.importDialog.dropTitle")}
      >
        <span className="redux-welcome-import-drop-icon" aria-hidden="true">
          <Icon name="folder" size={26} />
        </span>
        <strong>
          {t(
            dragging
              ? "workspace.welcome.importDialog.dropActive"
              : "workspace.welcome.importDialog.dropTitle",
          )}
        </strong>
        <span className="redux-welcome-import-drop-formats">
          {t("workspace.welcome.importDialog.dropFormats")}
        </span>
      </div>
    </Modal>
  );
}
