/**
 * Imperative entry point for the changelog modal.
 *
 * The modal queue owns stacking and focus; this module only presents the shared
 * changelog body, so Help, the update badge, and the post-update launch path all
 * open the same surface. Notes come from the published GitHub Releases, and
 * opening the surface refreshes them when the store has not fetched yet.
 */
import { createElement } from "react";
import { t } from "../../../../i18n/index.ts";
import { dismissModal, presentModal } from "../../../overlays/modals/modalQueue.ts";
import { bindChangelogLauncher } from "./changelogLauncher.ts";
import { ChangelogContent, ChangelogTitleMeta } from "./ChangelogContent.tsx";
import { checkForUpdates, getUpdateState, refreshUpdateSettings } from "./updateStore.ts";

const CHANGELOG_ID = "help.changelog";

/** Whether the build has a release repository whose published notes it can show. */
export function changelogAvailable(): boolean {
  return Boolean(getUpdateState().repo);
}

/** Open the read-only release modal; returns whether it opened. */
export function openChangelog(): boolean {
  refreshUpdateSettings();
  if (!changelogAvailable()) {
    return false;
  }
  if (getUpdateState().releases.length === 0) {
    // The notes are external; an unopened surface still fetches them so the
    // modal fills in as the request completes.
    void checkForUpdates();
  }
  const close = () => dismissModal(CHANGELOG_ID);
  presentModal(CHANGELOG_ID, {
    label: t("chrome.menu.help.changelog"),
    titleMeta: createElement(ChangelogTitleMeta),
    className: "redux-changelog-dialog",
    onClose: close,
    children: createElement(ChangelogContent),
  });
  return true;
}

bindChangelogLauncher(openChangelog);
