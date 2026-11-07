/** The title-bar entry point to the changelog. */
import { ChipButton } from "../../../../design/components/chip/ChipButton.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { openUpdateChangelog } from "./changelog.ts";
import { shouldShowUpdateBadge } from "./updatePresentation.ts";
import { useUpdateState } from "./useUpdateState.ts";

/** A title-bar pill that opens the changelog when a newer release is known. */
export function UpdateBadge() {
  const { t } = useTranslation();
  const state = useUpdateState();
  if (!shouldShowUpdateBadge(state) || !state.latest) {
    return null;
  }
  return (
    <ChipButton
      className="redux-update-badge"
      icon="refresh"
      data-tip-title={t("chrome.updates.badgeHint")}
      onClick={openUpdateChangelog}
    >
      {t("chrome.updates.badge", { version: state.latest.version })}
    </ChipButton>
  );
}
