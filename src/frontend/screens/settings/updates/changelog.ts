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
import { dismissModal, MODAL_PRIORITY, presentModal } from "../../../overlays/modals/modalQueue.ts";
import { requestConfirm } from "../../../overlays/modals/prompts.ts";
import { bindChangelogLauncher } from "./changelogLauncher.ts";
import {
  ChangelogContent,
  ChangelogTitleMeta,
  ChangelogUpdateActions,
  type ChangelogMode,
} from "./ChangelogContent.tsx";
import {
  checkForUpdates,
  getUpdateState,
  installUpdate,
  refreshUpdateSettings,
  skipUpdateVersion,
} from "./updateStore.ts";
import { bindUpdatePromptLauncher } from "./updatePromptLauncher.ts";

const CHANGELOG_ID = "help.changelog";

/** Whether the build has a release repository whose published notes it can show. */
export function changelogAvailable(): boolean {
  return Boolean(getUpdateState().repo);
}

/** Open either the current-release notes or the available-update notes. */
export function openChangelog(mode: ChangelogMode = "current"): boolean {
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
  const state = getUpdateState();
  const updateVersion = mode === "update" && state.available ? state.latest?.version : undefined;
  presentModal(CHANGELOG_ID, {
    label: mode === "update" ? t("chrome.changelog.updateTitle") : t("chrome.menu.help.changelog"),
    titleMeta: createElement(ChangelogTitleMeta, { mode }),
    className: "redux-changelog-dialog",
    onClose: close,
    children: createElement(ChangelogContent, { mode }),
    ...(updateVersion
      ? {
          actions: createElement(ChangelogUpdateActions, {
            onSkip: () => {
              skipUpdateVersion(updateVersion);
              close();
            },
            onLater: close,
            onUpdate: () => {
              void installUpdate();
            },
            onComplete: close,
          }),
        }
      : {}),
  });
  return true;
}

/** Open the future-release notes attached to the update badge. */
export function openUpdateChangelog(): boolean {
  return openChangelog("update");
}

bindChangelogLauncher(openChangelog);

bindUpdatePromptLauncher((version) =>
  requestConfirm({
    title: t("settings.updates.restartPrompt.title"),
    description: t("settings.updates.restartPrompt.description", { version }),
    cancelLabel: t("settings.updates.restartPrompt.defer"),
    label: t("settings.updates.restartPrompt.restartNow"),
    priority: MODAL_PRIORITY.consent,
  }),
);
