/**
 * Renders the layer-style overlap picker at the pointer position.
 *
 * The picker uses the shared menu renderer for consistent row anatomy, but it
 * stays a left-click chooser and never inherits right-click commands.
 */
import { useEffect, useSyncExternalStore } from "react";
import { ContextMenuPopup } from "../contextMenu/ContextMenuPopup.tsx";
import { ContextMenuRows } from "../contextMenu/ContextMenuRows.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { overlapMenu } from "./overlapMenu.ts";
import { overlapMenuContextSurface } from "./overlapMenuModel.ts";

/** Hosts the overlap picker and clears transient hover highlights when it closes. */
export function OverlapMenuHost() {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(overlapMenu.subscribe, overlapMenu.get, overlapMenu.get);
  useEffect(() => {
    if (!snapshot) {
      return undefined;
    }
    return () => snapshot.onClose?.();
  }, [snapshot]);
  return (
    <ContextMenuPopup
      store={overlapMenu}
      label={t("editor.overlap.title")}
      className="overlap-picker"
      initialFocus="container"
    >
      {(snapshot, close) => (
        <ContextMenuRows
          surface={overlapMenuContextSurface()}
          actions={snapshot.actions}
          close={close}
          leading={<div className="overlap-picker-heading">{snapshot.title}</div>}
        />
      )}
    </ContextMenuPopup>
  );
}
