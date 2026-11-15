/**
 * Step definitions for the first-run walkthrough.
 *
 * Steps are derived from the current shell state rather than advanced by a
 * second state machine: opening a chart or leaving the home screen removes the
 * steps that no longer apply. The host keeps one step id and resolves it
 * against this list.
 */
import { getSidebarItems } from "../../core/shell/registries/sidebar.ts";
import type { MessageKey, MessageParams } from "../../i18n/index.ts";
import type { OnboardingChoice } from "./state.ts";

/** Preferred side of the target for the coach card. */
export type OnboardingPlacement = "auto" | "top" | "bottom" | "left" | "right";

/** Surface a step needs open before its target can be used. */
export interface OnboardingActivation {
  kind: "inspector" | "drawer";
  id: string;
}

/** One bullet in the sidebar overview. */
export interface OnboardingBullet {
  label: string;
  description: string;
}

/** Stable ids in the order the walkthrough presents them. */
export type OnboardingStepId =
  "start" | "metadata" | "sidebar" | "view" | "camera" | "notes" | "parameters" | "finish";

/** One rendered walkthrough step. */
export interface OnboardingStep {
  id: string;
  targets: readonly string[];
  placement: OnboardingPlacement;
  title: string;
  body: string;
  bullets?: readonly OnboardingBullet[];
  /** Open this surface before the target can receive input. */
  activate?: OnboardingActivation;
}

/** Inputs that decide which steps currently exist. */
export interface OnboardingContext {
  choice: Exclude<OnboardingChoice, "none">;
  hasDocument: boolean;
}

type Translate = (key: MessageKey, params?: MessageParams) => string;
type TranslateRaw = (key: string, params?: MessageParams) => string;

const STEP_ORDER: readonly OnboardingStepId[] = [
  "start",
  "metadata",
  "sidebar",
  "view",
  "camera",
  "notes",
  "parameters",
  "finish",
];

/** Canonical position of a step; used to find a sane replacement. */
export function onboardingStepOrder(id: OnboardingStepId): number {
  return STEP_ORDER.indexOf(id);
}

/** Description for one registered inspector pane. */
const SIDEBAR_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
  history: "onboarding.sidebar.history",
  "multi-line": "onboarding.sidebar.multiLine",
  curve: "onboarding.sidebar.curve",
  "curve-preview": "onboarding.sidebar.trajectory",
  scripts: "onboarding.sidebar.scripts",
  "code-cell": "onboarding.sidebar.codeCell",
  collaboration: "onboarding.sidebar.collaboration",
  recording: "onboarding.sidebar.recording",
};

function sidebarBullets(t: Translate, tRaw: TranslateRaw): OnboardingBullet[] {
  return getSidebarItems()
    .filter((item) => item.icon.visibility?.get() !== false)
    .sort((left, right) => left.order - right.order)
    .map((item) => {
      const panel = item.panelId ?? item.id;
      return {
        label: tRaw(item.icon.label),
        description: t(SIDEBAR_DESCRIPTIONS[panel] ?? "onboarding.sidebar.generic"),
      };
    });
}

/**
 * Build the currently applicable steps.
 *
 * The home step disappears as soon as a document exists; every editor step then
 * applies, because the editor is the only surface once a chart is open.
 */
export function buildOnboardingSteps(
  context: OnboardingContext,
  t: Translate,
  tRaw: TranslateRaw,
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  const { choice, hasDocument } = context;
  if (!hasDocument) {
    const rpe = choice === "rpe";
    steps.push({
      id: "start",
      targets: [rpe ? "home-import" : "home-new"],
      placement: "top",
      title: t(rpe ? "onboarding.start.rpe.title" : "onboarding.start.new.title"),
      body: t(rpe ? "onboarding.start.rpe.body" : "onboarding.start.new.body"),
    });
  }
  if (hasDocument) {
    steps.push(
      {
        id: "metadata",
        targets: ["metadata-field-name"],
        placement: "left",
        title: t("onboarding.metadata.title"),
        body: t("onboarding.metadata.body"),
        activate: { kind: "inspector", id: "metadata" },
      },
      {
        id: "sidebar",
        targets: ["sidebar"],
        placement: "left",
        title: t("onboarding.sidebar.title"),
        body: t("onboarding.sidebar.body"),
        bullets: sidebarBullets(t, tRaw),
      },
      {
        id: "view",
        targets: ["stage-preview"],
        placement: "bottom",
        title: t("onboarding.view.title"),
        body: t("onboarding.view.body"),
      },
      {
        id: "camera",
        targets: ["free-camera"],
        placement: "bottom",
        title: t("onboarding.camera.title"),
        body: t("onboarding.camera.body"),
      },
      {
        id: "notes",
        targets: ["notes", "stage"],
        placement: "left",
        title: t("onboarding.notes.title"),
        body: t(choice === "rpe" ? "onboarding.notes.rpeBody" : "onboarding.notes.newBody"),
      },
      {
        id: "parameters",
        targets: ["notes"],
        placement: "left",
        title: t("onboarding.parameters.title"),
        body: t("onboarding.parameters.body"),
        activate: { kind: "inspector", id: "notes" },
      },
    );
  }
  steps.push({
    id: "finish",
    targets: [],
    placement: "auto",
    title: t("onboarding.finish.title"),
    body: t("onboarding.finish.body"),
  });
  return steps;
}
