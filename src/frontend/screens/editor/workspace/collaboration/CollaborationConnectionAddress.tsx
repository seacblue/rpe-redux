/**
 * Read-only room endpoint row for the host's collaboration panel.
 *
 * The endpoint is separate from the invite link so a host can diagnose or
 * share the network address without exposing the room credential.
 */
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";

/** Displays and copies the endpoint that guests should use for this room. */
export function CollaborationConnectionAddress({
  address,
  onCopy,
}: {
  address: string;
  onCopy(): void;
}) {
  const { t } = useTranslation();
  return (
    <FieldRow
      label={t("workspace.collaboration.connectionAddress")}
      control={
        <div className="collab-room-endpoint">
          <code className="collab-field-value" title={address}>
            {address}
          </code>
          <IconButton
            size="small"
            icon="copy"
            label={t("workspace.collaboration.copyConnectionAddress")}
            onClick={onCopy}
          />
        </div>
      }
    />
  );
}
