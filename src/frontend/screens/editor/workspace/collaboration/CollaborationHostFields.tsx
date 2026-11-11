/**
 * Desktop collaboration hosting fields and their network guidance.
 *
 * The browser host supplies its endpoint directly, while the desktop host
 * chooses between the managed tunnel and the local LAN bridge here.
 */
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { suggestedLanPort } from "./collaborationRuntime.tsx";
import type { CollaborationHostMode } from "./collaborationSettings.ts";

/** Renders the desktop-only hosting mode and LAN port controls. */
export function CollaborationHostFields({
  hostMode,
  lanPort,
  onHostModeChange,
  onLanPortChange,
}: {
  hostMode: CollaborationHostMode;
  lanPort: string;
  onHostModeChange(next: CollaborationHostMode): void;
  onLanPortChange(next: string): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FieldRow
        label={t("workspace.collaboration.hostMode")}
        footer={
          <span className="redux-field-description">
            {t(
              hostMode === "lan"
                ? "workspace.collaboration.hostModeHint.lan"
                : "workspace.collaboration.hostModeHint.tunnel",
            )}
          </span>
        }
        control={(id) => (
          <Select
            id={id}
            value={hostMode}
            onChange={(event) =>
              onHostModeChange(event.currentTarget.value as CollaborationHostMode)
            }
          >
            <option value="tunnel">{t("workspace.collaboration.hostMode.tunnel")}</option>
            <option value="lan">{t("workspace.collaboration.hostMode.lan")}</option>
          </Select>
        )}
      />
      {hostMode === "lan" && (
        <FieldRow
          label={t("workspace.collaboration.lanPort")}
          control={(id) => (
            <Input
              id={id}
              type="number"
              min="1024"
              max="65535"
              step="1"
              value={lanPort}
              placeholder={suggestedLanPort}
              onChange={(event) => onLanPortChange(event.currentTarget.value)}
            />
          )}
        />
      )}
    </>
  );
}
