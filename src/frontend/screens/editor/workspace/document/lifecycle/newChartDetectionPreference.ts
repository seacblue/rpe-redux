/**
 * The remembered answer to "detect timing when creating a chart?".
 *
 * The four new-chart answers are deliberately split: the first two become a
 * setting, while "once" and "skip" affect only the chart being created. Keeping
 * that distinction here makes the prompt and the API path share one rule.
 */
import { values } from "../../../../../../core/state/values.ts";

/** What future new-chart actions should do without asking. */
export type TimingDetectionPreference = "ask" | "always" | "never";

/** What the new-chart lifecycle should wait for after the chart is created. */
export type NewChartDetectionTrigger = "ask-after-audio" | "detect-after-audio" | "none";

/** The four answers the new-chart prompt can return. */
export type NewChartDetectionChoice = "always" | "never" | "once" | "skip";

/** The setting row that stores the remembered answer. */
export const TIMING_DETECTION_SETTING_KEY = "timing-detection-on-new-chart";

/** One resolved answer: whether to queue detection and what to remember. */
export interface NewChartDetectionDecision {
  detect: boolean;
  preference: TimingDetectionPreference;
}

/** Convert the remembered preference into the first-audio lifecycle action. */
export function newChartDetectionTrigger(
  preference: TimingDetectionPreference,
): NewChartDetectionTrigger {
  if (preference === "ask") {
    return "ask-after-audio";
  }
  return preference === "always" ? "detect-after-audio" : "none";
}

/** Accept only the three known preference values. */
export function normalizeTimingDetectionPreference(value: unknown): TimingDetectionPreference {
  return value === "always" || value === "never" ? value : "ask";
}

/**
 * Resolve one new-chart answer.
 *
 * `null` means the prompt was not shown (the remembered preference decides) or
 * was dismissed before an answer; in both cases no new preference is written.
 */
export function resolveNewChartDetection(
  preference: TimingDetectionPreference,
  choice: NewChartDetectionChoice | null,
): NewChartDetectionDecision {
  if (choice === "always") {
    return { detect: true, preference: "always" };
  }
  if (choice === "never") {
    return { detect: false, preference: "never" };
  }
  if (choice === "once") {
    return { detect: true, preference };
  }
  if (choice === "skip") {
    return { detect: false, preference };
  }
  return { detect: preference === "always", preference };
}

/** Read the remembered answer, falling back to asking. */
export function readTimingDetectionPreference(): TimingDetectionPreference {
  return normalizeTimingDetectionPreference(
    values.byId.has(TIMING_DETECTION_SETTING_KEY)
      ? values.byId.get<unknown>(TIMING_DETECTION_SETTING_KEY)
      : "ask",
  );
}

/** Persist a remembered answer through the settings value. */
export function writeTimingDetectionPreference(preference: TimingDetectionPreference): void {
  if (values.byId.has(TIMING_DETECTION_SETTING_KEY)) {
    values.byId.set(TIMING_DETECTION_SETTING_KEY, preference);
  }
}
