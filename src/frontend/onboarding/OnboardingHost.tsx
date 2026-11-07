/**
 * First-run walkthrough: the entry question and the anchored coach cards.
 *
 * The host owns only the answer and the active step id. Step existence is
 * derived from the live shell: a chart opening, a workspace switch, or leaving
 * the home screen removes the steps that no longer apply. The card never takes
 * over the target: the dimmed layer is pointer-transparent, so the highlighted
 * control can still be used while the guide is open.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { Button } from "../../design/components/button/Button.tsx";
import { Icon, type IconName } from "../../design/components/icon/Icon.tsx";
import { IconButton } from "../../design/components/button/IconButton.tsx";
import {
  getModalScrimSnapshot,
  Modal,
  subscribeModalScrim,
} from "../../design/components/modal/Modal.tsx";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../core/edit/state/visibility.ts";
import { getSidebarItems, subscribeSidebarItems } from "../../core/shell/registries/sidebar.ts";
import { useTranslation } from "../../i18n/react.ts";
import type { MessageKey } from "../../i18n/index.ts";
import {
  RESTART_ONBOARDING_EVENT,
  START_ONBOARDING_EVENT,
  readOnboardingRecord,
  writeOnboardingRecord,
  type OnboardingLaunch,
  type OnboardingChoice,
} from "./state.ts";
import {
  buildOnboardingSteps,
  onboardingStepOrder,
  type OnboardingPlacement,
  type OnboardingStep,
  type OnboardingStepId,
} from "./steps.ts";
import { getOnboardingAnchor, useOnboardingAnchorVersion } from "./anchors.ts";
import { drawerPaneIdFromTarget, holdDrawerPane } from "../chrome/drawer/drawerPanes.ts";
import { openInspector } from "../screens/editor/inspector/controller.ts";
import { openWelcomeImportDialog } from "../screens/welcome/welcomeImportDialog.ts";
import {
  getHelpTutorial,
  getHelpTutorials,
  subscribeHelpTutorials,
  type HelpTutorialDefinition,
} from "../../core/help/tutorialRegistry.ts";

const CARD_GAP = 16;
const VIEWPORT_EDGE = 12;

const CHOICES: readonly {
  id: OnboardingChoice;
  icon: IconName;
}[] = [
  { id: "rpe", icon: "open" },
  { id: "new", icon: "new" },
  { id: "none", icon: "help" },
];

function automatedHost(): boolean {
  return (globalThis as { __REDUX_TEST_API__?: unknown }).__REDUX_TEST_API__ === true;
}

function firstRunChoice(): boolean {
  return !automatedHost() && !readOnboardingRecord().completed;
}

interface TourState {
  stepId: string;
  tutorialId?: string;
}

interface CardPlacement {
  left: number;
  top: number;
  side: OnboardingPlacement;
}

/** Pick the first registered anchor that still has a visible box. */
function findTarget(targets: readonly string[]): HTMLElement | null {
  for (const key of targets) {
    const node = getOnboardingAnchor(key);
    if (!node) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) {
      return node;
    }
  }
  return null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Place the card outside the target when possible, then clamp to the viewport. */
function placeCard(
  target: DOMRect | null,
  preferred: OnboardingPlacement,
  width: number,
  height: number,
): CardPlacement {
  if (!target) {
    return {
      left: clamp((window.innerWidth - width) / 2, VIEWPORT_EDGE, window.innerWidth - width),
      top: clamp((window.innerHeight - height) / 2, VIEWPORT_EDGE, window.innerHeight - height),
      side: "auto",
    };
  }
  const gap = CARD_GAP;
  const space = {
    left: target.left,
    right: window.innerWidth - target.right,
    top: target.top,
    bottom: window.innerHeight - target.bottom,
  };
  const fits = {
    left: space.left >= width + gap,
    right: space.right >= width + gap,
    top: space.top >= height + gap,
    bottom: space.bottom >= height + gap,
  };
  const order: OnboardingPlacement[] =
    preferred === "auto"
      ? ["right", "left", "bottom", "top"]
      : [preferred, "right", "left", "bottom", "top"];
  const side = order.find((candidate) => fits[candidate as keyof typeof fits]) ?? "bottom";
  const centeredTop = target.top + target.height / 2 - height / 2;
  const centeredLeft = target.left + target.width / 2 - width / 2;
  let left = centeredLeft;
  let top = centeredTop;
  if (side === "left") {
    left = target.left - gap - width;
  } else if (side === "right") {
    left = target.right + gap;
  } else if (side === "top") {
    top = target.top - gap - height;
  } else {
    top = target.bottom + gap;
  }
  return {
    left: clamp(left, VIEWPORT_EDGE, window.innerWidth - width - VIEWPORT_EDGE),
    top: clamp(top, VIEWPORT_EDGE, window.innerHeight - height - VIEWPORT_EDGE),
    side,
  };
}

/** Resolve the current id, or the closest applicable step when it vanished. */
function resolveStepIndex(steps: readonly OnboardingStep[], stepId: string): number {
  if (!steps.length) {
    return -1;
  }
  const direct = steps.findIndex((step) => step.id === stepId);
  if (direct >= 0) {
    return direct;
  }
  const targetOrder = onboardingStepOrder(stepId as OnboardingStepId);
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  steps.forEach((step, index) => {
    const nextDistance = Math.abs(onboardingStepOrder(step.id as OnboardingStepId) - targetOrder);
    if (nextDistance < distance) {
      best = index;
      distance = nextDistance;
    }
  });
  return best;
}

/** Resolve an Extension tutorial step into the shared coach-card shape. */
function customTutorialStep(
  tutorial: HelpTutorialDefinition,
  index: number,
  tRaw: (key: string, params?: Record<string, string | number>) => string,
): OnboardingStep {
  const step = tutorial.steps[index];
  const resolve = (value: string | { key: string; params?: Record<string, string | number> }) =>
    typeof value === "string" ? tRaw(value) : tRaw(value.key, value.params);
  return {
    id: `custom:${tutorial.id}:${step.id}`,
    targets: step.targets ?? [],
    placement: step.placement ?? "auto",
    title: resolve(step.title),
    body: resolve(step.body),
    bullets: step.bullets?.map((bullet) => ({ label: resolve(bullet), description: "" })),
    activate: step.activate ?? tutorial.activate,
  };
}

/** First-run answer modal plus the active coach card. */
export function OnboardingHost() {
  const { t, tRaw, language } = useTranslation();
  const [choiceOpen, setChoiceOpen] = useState(firstRunChoice);
  const [choice, setChoice] = useState<Exclude<OnboardingChoice, "none"> | null>(null);
  const [tour, setTour] = useState<TourState | null>(null);
  const tutorials = useSyncExternalStore(
    subscribeHelpTutorials,
    getHelpTutorials,
    getHelpTutorials,
  );
  // Closing the dialog after choosing a path is programmatic, not the player
  // dismissing it; the flag keeps the native close event from choosing "none".
  const resolved = useRef(false);
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  // Sidebar labels are registry data; a late Extension contribution changes the
  // bullet list without changing any shell visibility value.
  const sidebarItems = useSyncExternalStore(
    subscribeSidebarItems,
    getSidebarItems,
    getSidebarItems,
  );
  const modalScrim = useSyncExternalStore(subscribeModalScrim, getModalScrimSnapshot, () => null);
  const steps = useMemo(() => {
    // Both registries and the language are read through plain modules, so the
    // values below are the only signals React can subscribe to.
    void sidebarItems;
    void language;
    if (!choice) {
      return [];
    }
    return buildOnboardingSteps({ choice, hasDocument: visibility.hasDocument }, t, tRaw);
  }, [choice, language, sidebarItems, t, tRaw, visibility.hasDocument]);
  const customTutorial = tour?.tutorialId
    ? (tutorials.find((tutorial) => tutorial.id === tour.tutorialId) ?? null)
    : null;
  const customSteps = customTutorial?.steps ?? [];
  const activeIndex = tour
    ? customTutorial
      ? customSteps.findIndex((step) => step.id === tour.stepId)
      : resolveStepIndex(steps, tour.stepId)
    : -1;
  const activeStep =
    activeIndex >= 0
      ? customTutorial
        ? customTutorialStep(customTutorial, activeIndex, tRaw)
        : steps[activeIndex]
      : null;
  const activeSteps = customTutorial ? customSteps : steps;
  // A step anchored to a drawer page holds that page open until the step ends.
  // Without the hold, the close button, Escape, or the rail could take away the
  // target the card is pointing at.
  const heldDrawerId = useMemo(() => {
    if (activeStep?.activate?.kind === "drawer") {
      return activeStep.activate.id;
    }
    for (const target of activeStep?.targets ?? []) {
      const id = drawerPaneIdFromTarget(target);
      if (id) {
        return id;
      }
    }
    return null;
  }, [activeStep]);
  useEffect(() => {
    if (!heldDrawerId) {
      return undefined;
    }
    return holdDrawerPane(heldDrawerId);
  }, [heldDrawerId]);

  // A step that lives inside an inspector pane opens that pane before the card
  // tries to resolve its anchor. Drawer pages are opened by their hold above.
  const activationKind = activeStep?.activate?.kind;
  const activationId = activeStep?.activate?.id ?? "";
  useEffect(() => {
    if (activationKind === "inspector" && activationId) {
      openInspector(activationId);
    }
  }, [activationId, activationKind]);

  const finish = () => {
    if (choice) {
      writeOnboardingRecord({ completed: true, choice });
    }
    setTour(null);
    setChoice(null);
  };

  /** Begin a selected path and optionally open the RPE import surface. */
  const beginTour = useCallback((launch: OnboardingLaunch) => {
    resolved.current = true;
    writeOnboardingRecord({ completed: launch.firstRun !== true, choice: launch.choice });
    setChoiceOpen(false);
    setChoice(launch.choice);
    const tutorial = launch.tutorialId ? getHelpTutorial(launch.tutorialId) : undefined;
    if (launch.tutorialId && !tutorial) {
      return;
    }
    setTour({
      stepId: launch.stepId ?? tutorial?.steps[0]?.id ?? "start",
      ...(tutorial ? { tutorialId: tutorial.id } : {}),
    });
    if (launch.choice === "rpe" && launch.openImportDialog === true) {
      openWelcomeImportDialog();
    }
  }, []);

  const choose = (next: OnboardingChoice) => {
    resolved.current = true;
    if (next === "none") {
      writeOnboardingRecord({ completed: true, choice: next });
      setChoiceOpen(false);
      setTour(null);
      setChoice(null);
      return;
    }
    beginTour({ choice: next, firstRun: true, openImportDialog: next === "rpe" });
  };

  const next = () => {
    if (!activeStep) {
      return;
    }
    const following = activeSteps[activeIndex + 1];
    if (following) {
      setTour({
        stepId: following.id,
        ...(customTutorial ? { tutorialId: customTutorial.id } : {}),
      });
    } else {
      finish();
    }
  };

  const previous = () => {
    const following = activeSteps[activeIndex - 1];
    if (following) {
      setTour({
        stepId: following.id,
        ...(customTutorial ? { tutorialId: customTutorial.id } : {}),
      });
    }
  };

  useLayoutEffect(() => {
    const restart = () => {
      resolved.current = false;
      setTour(null);
      setChoice(null);
      setChoiceOpen(true);
    };
    window.addEventListener(RESTART_ONBOARDING_EVENT, restart);
    const start = (event: Event) => {
      const launch = (event as CustomEvent<OnboardingLaunch>).detail;
      if (!launch || (launch.choice !== "rpe" && launch.choice !== "new")) {
        return;
      }
      beginTour(launch);
    };
    window.addEventListener(START_ONBOARDING_EVENT, start);
    return () => {
      window.removeEventListener(RESTART_ONBOARDING_EVENT, restart);
      window.removeEventListener(START_ONBOARDING_EVENT, start);
    };
  }, [beginTour]);

  return (
    <>
      <Modal
        open={choiceOpen}
        onClose={() => {
          if (!resolved.current) {
            choose("none");
          }
        }}
        label={t("onboarding.choice.title")}
        closeButton={false}
        className="redux-onboarding-choice-dialog"
        actions={
          <Button variant="outlined" onClick={() => choose("none")}>
            {t("onboarding.action.skip")}
          </Button>
        }
      >
        <div className="redux-onboarding-choices">
          {CHOICES.map((entry) => (
            <Button
              key={entry.id}
              variant="plain"
              className="redux-onboarding-choice"
              data-choice={entry.id}
              autoFocus={entry.id === "rpe"}
              onClick={() => choose(entry.id)}
            >
              <span className="redux-onboarding-choice-icon" aria-hidden="true">
                <Icon name={entry.icon} size={22} />
              </span>
              <span className="redux-onboarding-choice-copy">
                <strong>{t(`onboarding.choice.${entry.id}.title` as MessageKey)}</strong>
                <span>{t(`onboarding.choice.${entry.id}.description` as MessageKey)}</span>
              </span>
            </Button>
          ))}
        </div>
        <p className="redux-onboarding-choice-note">{t("onboarding.choice.note")}</p>
      </Modal>
      {tour && activeStep && (
        <CoachCard
          step={activeStep}
          index={activeIndex}
          total={activeSteps.length}
          suspended={modalScrim !== null}
          onNext={next}
          onPrevious={previous}
          onSkip={finish}
        />
      )}
    </>
  );
}

function CoachCard({
  step,
  index,
  total,
  suspended,
  onNext,
  onPrevious,
  onSkip,
}: {
  step: OnboardingStep;
  index: number;
  total: number;
  suspended: boolean;
  onNext(): void;
  onPrevious(): void;
  onSkip(): void;
}) {
  const { t } = useTranslation();
  const anchorVersion = useOnboardingAnchorVersion();
  const cardRef = useRef<HTMLElement>(null);
  const [cardPlacement, setCardPlacement] = useState<CardPlacement | null>(null);
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const stepId = step.id;
  const placement = step.placement;
  const targetSignature = step.targets.join("\u001f");
  const targetKeys = useMemo(
    () => (targetSignature ? targetSignature.split("\u001f") : []),
    [targetSignature],
  );
  // The first paint is deliberately blank: there is no target position to show
  // until the hidden card has been measured against this step's anchor.
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const update = () => {
      const target = findTarget(targetKeys);
      const card = cardRef.current;
      if (!card) {
        return;
      }
      const cardRect = card.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect() ?? null;
      setSpotlight(targetRect);
      setCardPlacement(placeCard(targetRect, placement, cardRect.width, cardRect.height));
      setMeasured(true);
    };
    update();
    const frame = requestAnimationFrame(update);
    const card = cardRef.current;
    const target = findTarget(targetKeys);
    const observer = new ResizeObserver(update);
    if (card) {
      observer.observe(card);
    }
    if (target) {
      observer.observe(target);
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorVersion, placement, targetKeys]);

  useLayoutEffect(() => {
    if (suspended) {
      return;
    }
    const target = findTarget(targetKeys);
    if (stepId === "start" && target) {
      // The opening instruction asks the player to press the highlighted
      // control, so keyboard focus belongs on that control, not the card.
      target.focus({ preventScroll: true });
      return;
    }
    cardRef.current?.focus({ preventScroll: true });
  }, [anchorVersion, stepId, targetKeys, suspended]);

  // Escape belongs to the guide while it is open. Capture on the window so it
  // runs before the Inspector/drawer listener, and stop propagation so the
  // surface underneath never receives the same key press.
  useEffect(() => {
    if (suspended) {
      return undefined;
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSkip();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [onSkip, suspended]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onSkip();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onPrevious();
    }
  };

  return (
    <div
      className={`redux-onboarding-layer${suspended ? " is-suspended" : ""}`}
      aria-live="polite"
      aria-hidden={suspended}
    >
      {measured &&
        (spotlight ? (
          <div
            className="redux-onboarding-spotlight"
            style={{
              left: spotlight.left - 6,
              top: spotlight.top - 6,
              width: spotlight.width + 12,
              height: spotlight.height + 12,
            }}
          />
        ) : (
          <div className="redux-onboarding-scrim" />
        ))}
      <article
        ref={cardRef}
        className={`redux-onboarding-card${cardPlacement ? " is-placed" : ""}`}
        style={cardPlacement ? { left: cardPlacement.left, top: cardPlacement.top } : undefined}
        data-placement={cardPlacement?.side ?? "auto"}
        tabIndex={-1}
        role="region"
        aria-label={t("onboarding.title")}
        onKeyDown={onKeyDown}
      >
        <header className="redux-onboarding-card-heading">
          <div>
            <span className="redux-onboarding-kicker">{t("onboarding.kicker")}</span>
            <span className="redux-onboarding-count">
              {t("onboarding.progress", { current: index + 1, total })}
            </span>
          </div>
          <IconButton icon="close" label={t("onboarding.action.skip")} onClick={onSkip} />
        </header>
        <div className="redux-onboarding-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.bullets && step.bullets.length > 0 && (
          <ul className="redux-onboarding-bullets">
            {step.bullets.map((bullet, bulletIndex) => (
              <li key={`${bulletIndex}-${bullet.label}`}>
                <strong>{bullet.label}</strong>
                <span>{bullet.description}</span>
              </li>
            ))}
          </ul>
        )}
        <footer className="redux-onboarding-actions">
          <div>
            {index > 0 && (
              <Button variant="outlined" onClick={onPrevious}>
                {t("onboarding.action.previous")}
              </Button>
            )}
          </div>
          <div>
            <Button variant="outlined" onClick={onSkip}>
              {t("onboarding.action.skip")}
            </Button>
            <Button variant="solid" onClick={onNext}>
              {index >= total - 1 ? t("onboarding.action.finish") : t("onboarding.action.next")}
            </Button>
          </div>
        </footer>
      </article>
    </div>
  );
}
