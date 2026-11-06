/**
 * The update status, actions, and release list shared by the Updates page and the
 * changelog modal.
 *
 * Both surfaces describe the same update state. Layout may differ, but an error,
 * a download bar, a release entry, or a check/install action must not be
 * reimplemented twice.
 */
import type { ReactNode } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { Disclosure } from "../../../../design/components/disclosure/Disclosure.tsx";
import { Progress } from "../../../../design/components/progress/Progress.tsx";
import { openExternalUrl } from "../../../../core/platform/desktop/openExternal.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import type { Language } from "../../../../i18n/index.ts";
import type { GithubRelease } from "../../../../core/platform/desktop/githubReleases.ts";
import { parseReleaseNoteBlocks, selectLanguageNotes } from "./releaseNotes.ts";
import {
  checkForUpdates,
  installBlockReason,
  installUpdate,
  isUpdateBusy,
  type UpdateState,
} from "./updateStore.ts";
import { formatReleaseDate, updateErrorKey, updateStatusText } from "./updatePresentation.ts";

/** One release in the presentation shape both surfaces render. */
export interface ReleaseNote {
  version: string;
  name: string;
  date: string;
  prerelease: boolean;
  notes: string;
  url: string;
}

/** GitHub releases in the shared release shape, with notes in `language`. */
export function releaseNotesFromRemote(
  releases: readonly GithubRelease[],
  language: Language,
): ReleaseNote[] {
  return releases.map((release) => ({
    version: release.version,
    name: release.name,
    date: release.publishedAt,
    prerelease: release.prerelease,
    notes: selectLanguageNotes(release.notes, language),
    url: release.url,
  }));
}

/**
 * The one-line status shared by the facts row and the changelog footer.
 */
export function UpdateStatusText({ state }: { state: UpdateState }) {
  const { t } = useTranslation();
  return <>{updateStatusText(t, state)}</>;
}

/**
 * The update state that is not one of the facts: applied banner, download
 * progress, errors, and the reasons installation is withheld.
 */
export function UpdateStatusNotice({
  state,
  showUnconfigured = false,
}: {
  state: UpdateState;
  showUnconfigured?: boolean;
}) {
  const { t } = useTranslation();
  const blocked = installBlockReason(state);
  return (
    <>
      {showUnconfigured && !state.repo && (
        <p className="redux-update-hint">{t("chrome.changelog.unconfigured")}</p>
      )}
      {state.updated && (
        <div className="redux-update-banner" data-update-banner>
          <strong>{t("settings.updates.updatedBanner")}</strong>
          <span>
            {t("settings.updates.updated", {
              from: state.updated.from_version,
              to: state.updated.to_version,
            })}
          </span>
          {state.updated.backup && (
            <code>{t("settings.updates.backup", { path: state.updated.backup })}</code>
          )}
        </div>
      )}
      {state.phase === "downloading" && (
        <div className="redux-update-progress">
          <Progress
            max={state.total && state.total > 0 ? state.total : 1}
            value={state.total && state.total > 0 ? state.downloaded : undefined}
            label={updateStatusText(t, state)}
          />
        </div>
      )}
      {state.errorCode && (
        <InlineAlert className="redux-update-error">
          {t(updateErrorKey(state.errorCode), { message: state.errorDetail })}
        </InlineAlert>
      )}
      {blocked === "public-key" && Boolean(state.repo) && (
        <p className="redux-update-hint">{t("settings.updates.installUnconfigured")}</p>
      )}
    </>
  );
}

/**
 * Check, install, and release-link actions.
 *
 * `leading` and `extra` carry surface-specific actions without rebuilding the
 * common buttons. The check action is optional; an available release still gets
 * an install action when the surrounding surface owns the check button itself.
 */
export function UpdateActionBar({
  state,
  leading,
  extra,
  requireRepo = false,
  showCheck = true,
  showReleaseLink = false,
}: {
  state: UpdateState;
  leading?: ReactNode;
  extra?: ReactNode;
  requireRepo?: boolean;
  /** Hide the explicit check action; the install action is independent. */
  showCheck?: boolean;
  showReleaseLink?: boolean;
}) {
  const { t } = useTranslation();
  const busy = isUpdateBusy(state.phase);
  const blocked = installBlockReason(state);
  const latestUrl = state.latest?.url ?? "";
  return (
    <div className="redux-update-actions redux-footer-actions">
      {leading}
      {showCheck && (
        <Button
          variant="outlined"
          disabled={busy || (requireRepo && !state.repo)}
          onClick={() => void checkForUpdates()}
        >
          {t("settings.updates.check")}
        </Button>
      )}
      {extra}
      {showReleaseLink && latestUrl && (
        <Button variant="outlined" onClick={() => void openExternalUrl(latestUrl)}>
          {t("settings.updates.releaseLink")}
        </Button>
      )}
      {!state.portable && state.available && state.latest && (
        <Button
          variant="solid"
          disabled={busy || blocked !== null}
          onClick={() => void installUpdate()}
        >
          {t("settings.updates.updateNow")}
        </Button>
      )}
    </div>
  );
}

/** One release body as headings, bullet lists, and paragraphs. */
export function ReleaseNotesBody({ notes }: { notes: string }) {
  const blocks = parseReleaseNoteBlocks(notes);
  return (
    <div className="redux-release-notes">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return <h4 key={index}>{block.text}</h4>;
        }
        if (block.kind === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}

/** The release history, as one collapsible entry per version. */
export function ReleaseNotesList({
  releases,
  currentVersion,
}: {
  releases: readonly ReleaseNote[];
  currentVersion: string;
}) {
  const { t } = useTranslation();
  if (!releases.length) {
    return null;
  }
  return (
    <div className="redux-release-list">
      {releases.map((release, index) => {
        const title = release.name || release.version;
        const current = release.version === currentVersion;
        return (
          <Disclosure
            key={`${release.version}:${release.date}`}
            className="redux-release"
            data-current={current ? "true" : undefined}
            open={index === 0}
            summary={
              <>
                <strong>{title}</strong>
                {release.name && <span className="redux-release-version">{release.version}</span>}
                {release.prerelease && (
                  <span className="redux-release-prerelease">
                    {t("settings.updates.prerelease")}
                  </span>
                )}
                {release.date && (
                  <span className="redux-release-date">
                    {t("settings.updates.date", { date: formatReleaseDate(release.date) })}
                  </span>
                )}
              </>
            }
          >
            {release.notes ? (
              <ReleaseNotesBody notes={release.notes} />
            ) : (
              <p className="redux-release-notes-empty">{t("settings.updates.noNotes")}</p>
            )}
            {release.url && (
              <Button variant="link" onClick={() => void openExternalUrl(release.url)}>
                {t("settings.updates.releaseLink")}
              </Button>
            )}
          </Disclosure>
        );
      })}
    </div>
  );
}
