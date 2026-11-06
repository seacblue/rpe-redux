/**
 * The changelog modal body: the running version's notes, rendered.
 *
 * Notes are the published GitHub release body, the same external source the
 * release page shows. The body already lists Chinese first and English second,
 * so the caller selects the section for the active language. This surface shows
 * nothing else: no version facts, update controls, or release history.
 */
import { useTranslation } from "../../../../i18n/react.ts";
import { compareVersions } from "../../../../core/utils/version.ts";
import { ReleaseNotesBody } from "./ReleaseNotesBody.tsx";
import { selectLanguageNotes } from "./releaseNotes.ts";
import { useUpdateState } from "./useUpdateState.ts";

/** The changelog modal body. */
export function ChangelogContent(): React.JSX.Element {
  const { t, language } = useTranslation();
  const state = useUpdateState();
  const published = state.releases
    .map((release) => ({
      version: release.version,
      notes: selectLanguageNotes(release.notes, language),
    }))
    .filter((entry) => entry.notes.length > 0);
  // Prefer the running version's notes; a build that predates its own release
  // falls back to the newest published notes.
  const current = published.find(
    (entry) => compareVersions(entry.version, state.currentVersion) === 0,
  );
  const notes = current?.notes ?? published[0]?.notes ?? "";

  if (!notes) {
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
      <ReleaseNotesBody notes={notes} />
    </div>
  );
}
