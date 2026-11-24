/**
 * Edge-mounted actions for the home library.
 *
 * Creation controls stay at the lower-left edge and reveal import on hover.
 * Actions for the selected chart stay at the lower-right edge, where opening
 * is the primary control and export/delete expand to its left.
 */
import { Button } from "../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { IMPORT_CHART_EVENT } from "../../../../core/shell/shellEventNames.ts";
import { documents } from "../../editor/workspace/document/lifecycle/service.ts";
import { onboardingAnchorRef } from "../../../onboarding/anchors.ts";
import type { LibraryEntry } from "./libraryEntries.ts";

/** Render the edge-mounted creation and selected-chart actions. */
export function LibraryFloatingActions({
  entry,
  opening,
  onOpen,
  onExport,
  onDelete,
}: {
  entry: LibraryEntry | null;
  opening: boolean;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t } = useTranslation();
  const openDisabled = opening || !entry;
  const newLabel = t("workspace.welcome.library.action.new");
  const importLabel = t("workspace.welcome.library.action.import");
  const openLabel = t("workspace.welcome.library.open");
  const exportLabel = t("workspace.welcome.library.export");
  const deleteLabel = t("workspace.welcome.library.delete");
  return (
    <div className="redux-welcome-floating-actions">
      <div className="redux-welcome-floating-create">
        <IconButton
          ref={onboardingAnchorRef("home-new")}
          icon="plus"
          label={newLabel}
          variant="solid"
          className="redux-welcome-floating-new"
          data-onboarding="new"
          onClick={() => documents.newDocument()}
        />
        <IconButton
          ref={onboardingAnchorRef("home-import")}
          icon="open"
          label={importLabel}
          variant="outlined"
          className="redux-welcome-floating-import"
          data-onboarding="import"
          onClick={() => window.dispatchEvent(new Event(IMPORT_CHART_EVENT))}
        />
      </div>
      <div className="redux-welcome-floating-entry" data-disabled={openDisabled || undefined}>
        {entry && (
          <>
            <IconButton
              icon="trash"
              label={deleteLabel}
              variant="danger"
              className="redux-welcome-floating-delete"
              onClick={() => onDelete(entry)}
            />
            <IconButton
              icon="export"
              label={exportLabel}
              variant="outlined"
              className="redux-welcome-floating-export"
              onClick={() => onExport(entry)}
            />
          </>
        )}
        <Button
          variant="solid"
          className="redux-welcome-floating-open"
          aria-label={openLabel}
          data-tip-title={openLabel}
          disabled={openDisabled}
          onClick={() => {
            if (entry) {
              onOpen(entry);
            }
          }}
        >
          <Icon name="playbackPlay" size={18} />
        </Button>
      </div>
    </div>
  );
}
