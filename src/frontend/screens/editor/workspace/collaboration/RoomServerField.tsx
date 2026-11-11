/**
 * Room-server address field for collaboration forms.
 *
 * The desktop host can reach a local or LAN endpoint. The static web host needs
 * a public wss:// endpoint, so it gets its own placeholder and an explicit hint.
 */
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { isDesktop } from "../../../../../core/platform/environment.ts";

/** One room-server address input with its host-specific placeholder and hint. */
export function RoomServerField({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  const { t } = useTranslation();
  const desktop = isDesktop();
  return (
    <>
      <FieldRow
        label={t("workspace.collaboration.serverUrl")}
        control={(id) => (
          <Input
            id={id}
            value={value}
            placeholder={t(
              desktop
                ? "workspace.collaboration.serverUrlPlaceholder"
                : "workspace.collaboration.serverUrlWebPlaceholder",
            )}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        )}
      />
      {!desktop && <p className="hint">{t("workspace.collaboration.serverUrlWebHint")}</p>}
    </>
  );
}
