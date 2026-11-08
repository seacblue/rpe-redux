/** Renders the asset library's queued name and rename dialog. */

import { useRef } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import {
  PromptDialog,
  usePromptAction,
  useQueuedPrompt,
} from "../../../../overlays/modals/QueuedPrompt.tsx";
import {
  closeAssetPrompt,
  getAssetPrompt,
  subscribeAssetPrompt,
  type AssetNamePrompt,
} from "./assetPrompts.ts";

/** Renders the next queued asset name prompt. */
export function AssetDialogs(): React.JSX.Element | null {
  const { request, open } = useQueuedPrompt(subscribeAssetPrompt, getAssetPrompt);
  if (!request) {
    return null;
  }
  return <AssetNameDialog key={request.id} request={request} open={open} />;
}

/** Name prompt shared by folder creation and asset rename. */
function AssetNameDialog({ request, open }: { request: AssetNamePrompt; open: boolean }) {
  const { t } = useTranslation();
  const action = usePromptAction(closeAssetPrompt);
  const input = useRef<HTMLInputElement | null>(null);
  const apply = () => action.run(() => request.submit(input.current?.value ?? ""));
  return (
    <PromptDialog
      requestId={`asset:${request.id}`}
      open={open}
      onClose={closeAssetPrompt}
      label={request.title}
      description={request.description}
      className="redux-asset-dialog"
      error={action.error}
      pending={action.pending}
      submitLabel={t("common.action.apply")}
      cancelLabel={t("workspace.dialogs.dismiss")}
      onSubmit={apply}
    >
      <FieldRow
        layout="inline"
        className="modal-field"
        htmlFor={`asset-name-${request.id}`}
        label={request.label}
        control={
          <Input
            id={`asset-name-${request.id}`}
            ref={input}
            type="text"
            placeholder={request.placeholder}
            defaultValue={request.value}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
        }
      />
    </PromptDialog>
  );
}
