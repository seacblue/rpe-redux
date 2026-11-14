/**
 * Persistence and restart signals for the first-run walkthrough.
 *
 * The record remembers how the player described themselves and whether the
 * walkthrough was finished. A restart signal lets Help replay the choice modal
 * without reloading the application.
 */
import { isRecord } from "../../core/utils/guards.ts";
import { PREFERENCE_SECTIONS, preferences } from "../../core/state/preferences.ts";
/** The three answers offered by the first-run choice modal. */
export type OnboardingChoice = "rpe" | "new" | "none";

/** A replayable walkthrough path; the choice modal's "none" path is excluded. */
export type OnboardingTourChoice = Exclude<OnboardingChoice, "none">;

/** Options sent to the mounted walkthrough host when a caller starts a tour. */
export interface OnboardingLaunch {
  choice: OnboardingTourChoice;
  /** Built-in step ids and registered tutorial step ids share this slot. */
  stepId?: string;
  /** Registered custom tutorial id; omitted for the built-in editor tour. */
  tutorialId?: string;
  /** True only while resolving the first-run choice modal. */
  firstRun?: boolean;
}

/** Stored walkthrough state; an absent or malformed record is a first run. */
export interface OnboardingRecord {
  completed: boolean;
  choice: OnboardingChoice | null;
}

/** Window event that asks the mounted host to show the choice modal again. */
export const RESTART_ONBOARDING_EVENT = "redux-restart-onboarding";

/** Window event that asks the mounted host to begin the anchored walkthrough. */
export const START_ONBOARDING_EVENT = "redux-start-onboarding";

const FIRST_RUN: OnboardingRecord = Object.freeze({
  completed: false,
  choice: null,
});

function isChoice(value: unknown): value is OnboardingChoice {
  return value === "rpe" || value === "new" || value === "none";
}

/** Read the persisted answer, treating malformed data as a first run. */
export function readOnboardingRecord(): OnboardingRecord {
  const value = preferences.read<unknown>(PREFERENCE_SECTIONS.onboarding, null);
  if (!isRecord(value)) {
    return FIRST_RUN;
  }
  return {
    completed: value.completed === true,
    choice: isChoice(value.choice) ? value.choice : null,
  };
}

/** Persist the answer and completion flag for this and later launches. */
export function writeOnboardingRecord(record: OnboardingRecord): void {
  preferences.write(PREFERENCE_SECTIONS.onboarding, record);
}

/** Pick the last meaningful walkthrough path, defaulting to the new-chart path. */
export function onboardingReplayChoice(): OnboardingTourChoice {
  return readOnboardingRecord().choice === "rpe" ? "rpe" : "new";
}

/** Start the shared anchored walkthrough without reopening its choice modal. */
export function startOnboardingTour(launch: OnboardingLaunch): void {
  // Replays are help actions, not a new first run; closing one must not make
  // the choice modal appear again on the next launch.
  writeOnboardingRecord({ completed: true, choice: launch.choice });
  window.dispatchEvent(
    new CustomEvent<OnboardingLaunch>(START_ONBOARDING_EVENT, {
      detail: { ...launch, firstRun: false },
    }),
  );
}

/** Re-open the choice modal and clear the completed flag. */
export function restartOnboarding(): void {
  writeOnboardingRecord({ completed: false, choice: null });
  window.dispatchEvent(new Event(RESTART_ONBOARDING_EVENT));
}
