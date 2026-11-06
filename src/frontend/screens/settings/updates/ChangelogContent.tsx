/**
 * The changelog modal: its rendered body and the version/date title fact.
 *
 * Notes are the published GitHub release body, the same external source the
 * release page shows. The body already lists Chinese first and English second,
 * so this surface selects the section for the active language. It shows nothing
 * else: no version cards, update controls, or release history.
 */
import { useTranslation } from "../../../../i18n/react.ts";
import { ReleaseNotesBody } from "./ReleaseNotesBody.tsx";
import { formatReleaseDate, selectChangelogRelease } from "./releaseNotes.ts";
import { useUpdateState } from "./useUpdateState.ts";

/** The changelog modal body. */
export function ChangelogContent(): React.JSX.Element {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const release = selectChangelogRelease(state.releases, state.currentVersion, language);

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
export function ChangelogTitleMeta(): React.JSX.Element | null {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const release = selectChangelogRelease(state.releases, state.currentVersion, language);
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
