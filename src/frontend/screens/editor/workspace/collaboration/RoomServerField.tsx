/**
 * Room-server address field for collaboration forms.
 *
 * The desktop host can reach a local or LAN endpoint. The static web host needs
 * a public wss:// endpoint, so each host gets its own protocol default.
 */
import { useState } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { isDesktop } from "../../../../../core/platform/environment.ts";
import {
  buildRoomServerUrl,
  parseRoomServerUrlParts,
  type RoomServerUrlParts,
} from "../../../../../core/collaboration/invite.ts";

/** One room-server endpoint editor with address, port, and protocol fields. */
export function RoomServerField({
  value,
  onChange,
  layout = "split",
  showDescription = false,
}: {
  value: string;
  onChange(value: string): void;
  layout?: "split" | "inline";
  showDescription?: boolean;
}) {
  const { t } = useTranslation();
  const desktop = isDesktop();
  const parsedParts = parseRoomServerUrlParts(value, desktop ? "ws" : "wss");
  const [emptyValueProtocol, setEmptyValueProtocol] = useState(parsedParts.protocol);
  const parts = value.trim() ? parsedParts : { ...parsedParts, protocol: emptyValueProtocol };
  const serverUrlHelp = t("workspace.collaboration.serverUrlHint");
  const update = (patch: Partial<RoomServerUrlParts>) => {
    const next = { ...parts, ...patch };
    setEmptyValueProtocol(next.protocol);
    onChange(buildRoomServerUrl(next));
  };
  return (
    <>
      <FieldRow
        layout={layout}
        label={t("workspace.collaboration.serverAddress")}
        footer={
          showDescription ? (
            <span className="redux-field-description">{serverUrlHelp}</span>
          ) : undefined
        }
        control={(id) => (
          <Input
            id={id}
            value={parts.address}
            placeholder={t("workspace.collaboration.serverAddressPlaceholder")}
            onChange={(event) => update({ address: event.currentTarget.value })}
          />
        )}
      />
      <FieldRow
        layout={layout}
        label={t("workspace.collaboration.serverPort")}
        control={(id) => (
          <Input
            id={id}
            type="number"
            min="1"
            max="65535"
            step="1"
            value={parts.port}
            placeholder={t("workspace.collaboration.serverPortPlaceholder")}
            onChange={(event) => update({ port: event.currentTarget.value })}
          />
        )}
      />
      <FieldRow
        layout={layout}
        label={t("workspace.collaboration.secureProtocol")}
        control={(id) => (
          <Input
            id={id}
            type="checkbox"
            checked={parts.protocol === "wss"}
            aria-label={t("workspace.collaboration.secureProtocol")}
            onChange={(event) => update({ protocol: event.currentTarget.checked ? "wss" : "ws" })}
          />
        )}
      />
    </>
  );
}
