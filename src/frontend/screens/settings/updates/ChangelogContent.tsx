/**
 * The changelog modal body.
 *
 * Release notes are the published GitHub Releases, so one external source feeds
 * the GitHub release page and this modal. Each body lists Chinese first and
 * English second under `### 中文` / `### English`; the modal shows the section
 * for the active interface language. The store opens this surface on the first
 * launch after an update and refreshes the notes it shows.
 */
import { Button } from "../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { openSettings } from "../settingsWindowController.ts";
import {
  releaseNotesFromRemote,
  ReleaseNotesList,
  UpdateActionBar,
  UpdateStatusNotice,
  UpdateStatusText,
} from "./UpdatePanels.tsx";
import { useUpdateState } from "./useUpdateState.ts";
import { isPrereleaseVersion } from "../../../../core/utils/version.ts";

/** The changelog modal body with release notes and the shared update actions. */
export function ChangelogContent({ onClose }: { onClose(): void }): React.JSX.Element {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const remote = state.releases.length > 0;
  const releases = releaseNotesFromRemote(state.releases, language);

  return (
    <div className="redux-changelog">
      <header className="redux-changelog-meta">
        <span>
          {t("settings.updates.current", { version: state.currentVersion })}
          {isPrereleaseVersion(state.currentVersion) && (
            <span className="redux-version-channel">{t("settings.version.test")}</span>
          )}
        </span>
        <span className="redux-changelog-source">{t("chrome.changelog.github")}</span>
      </header>

      <div className="redux-changelog-notices">
        <UpdateStatusNotice state={state} showUnconfigured />
      </div>

      <div className="redux-changelog-entries">
        {releases.length > 0 ? (
          <ReleaseNotesList releases={releases} currentVersion={state.currentVersion} />
        ) : state.phase === "checking" ? (
          <p className="redux-changelog-hint">{t("settings.updates.checking")}</p>
        ) : (
          <p className="redux-changelog-hint">{t("chrome.changelog.empty")}</p>
        )}
      </div>

      <footer className="redux-changelog-actions">
        {state.repo && (
          <span className="redux-changelog-status">
            <UpdateStatusText state={state} />
          </span>
        )}
        <UpdateActionBar
          state={state}
          requireRepo
          showCheck={!state.portable}
          showReleaseLink={remote}
          leading={
            <Button
              variant="outlined"
              onClick={() => {
                onClose();
                window.setTimeout(() => openSettings("help"), 220);
              }}
            >
              {t("chrome.changelog.settings")}
            </Button>
          }
        />
      </footer>
    </div>
  );
}
