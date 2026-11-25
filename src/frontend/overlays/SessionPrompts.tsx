/** App-launch prompt that invites a GitHub star after recurring milestones. */
import { useEffect, useRef } from "react";
import { PREFERENCE_SECTIONS, preferences } from "../../core/state/preferences.ts";
import { isRecord } from "../../core/utils/guards.ts";
import { openExternalUrl } from "../../core/platform/desktop/openExternal.ts";
import { t } from "../../i18n/index.ts";
import { requestChoice, showNotice } from "./modals/prompts.ts";
import { nextLaunchCount, shouldPromptForLaunch } from "./sessionPromptState.ts";

const GITHUB_URL = "https://github.com/seacblue/rpe-redux";
const LAUNCH_COUNT_KEY = "session-prompt.app-launches";
const NEVER_REMIND_KEY = "session-prompt.github-star.never";

type PromptChoice = "go" | "later" | "never";

const PROMPT_CHOICES: readonly PromptChoice[] = ["go", "later", "never"];

/** Returns the durable values section, treating malformed data as empty. */
function storedValues(): Record<string, unknown> {
  const values = preferences.read<unknown>(PREFERENCE_SECTIONS.values, null);
  return isRecord(values) ? values : {};
}

/** Whether the user permanently dismissed the Star prompt. */
function neverRemind(): boolean {
  return storedValues()[NEVER_REMIND_KEY] === true;
}

/** Persists the user's lifetime opt-out without disturbing other value entries. */
function rememberNeverRemind(): void {
  preferences.write(PREFERENCE_SECTIONS.values, {
    ...storedValues(),
    [NEVER_REMIND_KEY]: true,
  });
}

/** Describes the Star prompt without coupling the scheduler to its copy. */
function promptDefinition(): {
  title: string;
  description: string;
  openLabel: string;
  url: string;
} {
  return {
    title: t("chrome.sessionPrompt.star.title"),
    description: t("chrome.sessionPrompt.star.description"),
    openLabel: t("chrome.sessionPrompt.action.openGithub"),
    url: GITHUB_URL,
  };
}

/** Opens one trusted destination and reports opener failures in the shared prompt surface. */
function openPromptDestination(): void {
  const definition = promptDefinition();
  void openExternalUrl(definition.url).catch(() => {
    showNotice({
      title: t("chrome.sessionPrompt.openFailed.title"),
      description: t("chrome.sessionPrompt.openFailed.description"),
    });
  });
}

/** Presents the Star prompt and records only the lifetime opt-out choice. */
async function presentSessionPrompt(): Promise<void> {
  const definition = promptDefinition();
  const choice = await requestChoice({
    title: definition.title,
    description: definition.description,
    entries: PROMPT_CHOICES,
    label: (value) => {
      switch (value) {
        case "go":
          return definition.openLabel;
        case "later":
          return t("chrome.sessionPrompt.action.later");
        case "never":
          return t("chrome.sessionPrompt.action.never");
      }
    },
  });
  if (choice === "never") {
    rememberNeverRemind();
  } else if (choice === "go") {
    openPromptDestination();
  }
}

/** Records one launch and presents the Star prompt at each tenth launch. */
export function SessionPrompts() {
  const recorded = useRef(false);

  useEffect(() => {
    if (recorded.current) {
      return;
    }
    recorded.current = true;
    const values = storedValues();
    const launchCount = nextLaunchCount(values[LAUNCH_COUNT_KEY]);
    preferences.write(PREFERENCE_SECTIONS.values, {
      ...values,
      [LAUNCH_COUNT_KEY]: launchCount,
    });
    if (shouldPromptForLaunch(launchCount, neverRemind())) {
      void presentSessionPrompt();
    }
  }, []);

  // This component owns no visible DOM; the shared modal queue renders the prompt.
  return null;
}
