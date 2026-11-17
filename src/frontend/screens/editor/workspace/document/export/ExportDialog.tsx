/**
 * Renders the export question and the shared prompt shell. The folder and file
 * name are chosen in the system save dialog after the user confirms. The prompt
 * state and the write belong to `exportPrompt`; this file draws the dialog and
 * keeps the last question visible through its exit animation.
 */
import { useState } from "react";
import { FieldRow } from "../../../../../../design/components/field/FieldRow.tsx";
import { Select } from "../../../../../../design/components/select/Select.tsx";
import type { ChartExportFormat } from "../../../../../../core/global/document/export.ts";
import { useTranslation } from "../../../../../../i18n/react.ts";
import {
  PromptDialog,
  usePromptAction,
  useQueuedPrompt,
} from "../../../../../overlays/modals/QueuedPrompt.tsx";
import {
  closeExportPrompt,
  getExportPrompt,
  subscribeExportPrompt,
  type ExportPrompt,
} from "./exportPrompt.ts";

/**
 * The export dialog.
 *
 * It asks about the document rather than about a panel, so it hangs off the
 * window frame. The native save dialog owns the destination folder and file
 * name. The question itself lives in `exportPrompt`; this file only draws it.
 */
export function ExportDialog() {
  const { request, open } = useQueuedPrompt(subscribeExportPrompt, getExportPrompt);
  if (!request) {
    return null;
  }
  return <ExportBody key={request.id} request={request} open={open} />;
}

/** The dialog body for one queued export question. */
function ExportBody({ request, open }: { request: ExportPrompt; open: boolean }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ChartExportFormat>(request.initial.format);
  // The request takes itself down once the file is written; only a failed write
  // keeps the dialog open so the same options can be tried again.
  const action = usePromptAction(closeExportPrompt, { closeOnSuccess: false });
  return (
    <PromptDialog
      requestId={`export:${request.id}`}
      open={open}
      onClose={closeExportPrompt}
      label={request.title}
      className="redux-export-dialog"
      error={action.error}
      pending={action.pending}
      submitLabel={t("editor.dialogs.exportDialog.export")}
      cancelLabel={t("workspace.dialogs.dismiss")}
      onSubmit={() => action.run(() => request.submit({ name: request.initial.name, format }))}
    >
      <FieldRow
        layout="inline"
        className="modal-field"
        label={t("editor.dialogs.exportDialog.format")}
        control={(id) => (
          <Select
            id={id}
            value={format}
            onChange={(event) => setFormat(event.target.value as ChartExportFormat)}
          >
            <option value="pez">{t("editor.dialogs.exportDialog.formatPez")}</option>
            <option value="pec">{t("editor.dialogs.exportDialog.formatPec")}</option>
            <option value="official">{t("editor.dialogs.exportDialog.formatOfficial")}</option>
          </Select>
        )}
      />
    </PromptDialog>
  );
}
