/**
 * The changelog modal: its rendered body and the version/date title fact.
 *
 * Notes are the published GitHub release body, the same external source the
 * release page shows. The body already lists Chinese first and English second,
 * so this surface selects the section for the active language. Current-release
 * notes and update notes are separate modes; only the latter owns update actions,
 * and those actions lock while the update flow is downloading or installing.
 */
import { useEffect } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { ReleaseNotesBody } from "./ReleaseNotesBody.tsx";
import {
  formatReleaseDate,
  selectChangelogRelease,
  selectUpdateChangelogRelease,
} from "./releaseNotes.ts";
import { changelogUpdateAction } from "./updatePresentation.ts";
import { useUpdateState } from "./useUpdateState.ts";

/** Which release-note concept the modal is presenting. */
export type ChangelogMode = "current" | "update";

/** The changelog modal body. */
export function ChangelogContent({
  mode = "current",
}: {
  mode?: ChangelogMode;
}): React.JSX.Element {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const release =
    mode === "update"
      ? selectUpdateChangelogRelease(state.releases, state.currentVersion, language)
      : selectChangelogRelease(state.releases, state.currentVersion, language);

  if (!release) {
    return (
      <div className="redux-changelog">
        <p className="redux-changelog-hint">
          {state.phase === "checking"
            ? t("settings.updates.checking")
            : t("chrome.changelog.empty")}
        </p>
      </div>
    );
  }
  return (
    <div className="redux-changelog">
      <ReleaseNotesBody notes={release.notes} />
    </div>
  );
}

/**
 * The version and date the modal title shows, e.g. `(1.0.1, 2026-11-6)`.
 *
 * It subscribes to the update store because the notes are fetched after the
 * modal opens, so the heading gains its facts as soon as the release arrives.
 */
export function ChangelogTitleMeta({
  mode = "current",
}: {
  mode?: ChangelogMode;
}): React.JSX.Element | null {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const release =
    mode === "update"
      ? selectUpdateChangelogRelease(state.releases, state.currentVersion, language)
      : selectChangelogRelease(state.releases, state.currentVersion, language);
  if (!release) {
    return null;
  }
  const date = formatReleaseDate(release.publishedAt);
  return (
    <span className="redux-changelog-title-meta">
      {date ? t("chrome.changelog.titleMeta", { version: release.version, date }) : release.version}
    </span>
  );
}

/** Footer actions for an available update, ordered from secondary to primary. */
export function ChangelogUpdateActions({
  onSkip,
  onLater,
  onUpdate,
  onComplete,
}: {
  onSkip(): void;
  onLater(): void;
  onUpdate(): void;
  onComplete(): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const state = useUpdateState();
  const action = changelogUpdateAction(state.phase);
  useEffect(() => {
    if (state.phase === "scheduled" || state.phase === "installed") {
      onComplete();
    }
  }, [onComplete, state.phase]);
  return (
    <>
      <Button variant="outlined" onClick={onSkip} disabled={action.locked}>
        {t("chrome.changelog.skipVersion")}
      </Button>
      <Button variant="outlined" onClick={onLater} disabled={action.locked}>
        {t("chrome.changelog.later")}
      </Button>
      <Button variant="solid" onClick={onUpdate} disabled={action.locked} aria-busy={action.locked}>
        {t(action.labelKey)}
      </Button>
    </>
  );
}
