/**
 * React portal for the document-level modal scrim. It subscribes to the modal
 * stack in `Modal.tsx` and forwards pointer dismissal to the active modal.
 */
import { createPortal } from "react-dom";
import { useSyncExternalStore, type CSSProperties } from "react";
import {
  activeModalBlocksScrimDismiss,
  getModalScrimSnapshot,
  requestActiveModalCancel,
  subscribeModalScrim,
} from "./Modal.tsx";

/** React-owned document-level scrim for the native modal stack. */
export function ModalScrimPortal() {
  const snapshot = useSyncExternalStore(
    subscribeModalScrim,
    getModalScrimSnapshot,
    getModalScrimSnapshot,
  );
  if (!snapshot || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      className="redux-modal-scrim"
      aria-hidden="true"
      data-state={snapshot.state}
      style={{ "--modal-scrim-layer": snapshot.layer } as CSSProperties}
      onPointerDown={() => {
        if (!activeModalBlocksScrimDismiss()) {
          requestActiveModalCancel();
        }
      }}
    />,
    document.body,
  );
}
