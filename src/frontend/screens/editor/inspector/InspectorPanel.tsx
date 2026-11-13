/**
 * Owns the inspector frame and its pane registry boundary.
 *
 * The panel subscribes to visibility and mounts the pane selected by the core
 * controller. A document drawer page is the inspector's second content mode: it
 * replaces the body, keeps the same header, and never becomes a separate surface.
 * Opening one closes the pane it hides so no invisible pane keeps publishing a
 * preview. Individual panes own their fields and chart edits; this frame
 * duplicates neither. Unless a theme supplies its own `inspector.empty` slot,
 * the empty state renders the registered sidebar as a two-column text grid.
 *
 * A split page expands into its workspace mode by growing this same panel: the
 * page is mounted once and its geometry follows two overlapping progress numbers
 * (`--inspector-morph-shift` for the arrangement, `--inspector-morph-grow` for
 * the fill). The fill starts while the arrangement is still moving, so the list
 * keeps its compact content width and the detail face becomes the wide column
 * without the motion stopping between the two beats. No second page copy is
 * mounted and no scroll position is carried.
 *
 * Selecting another Inspector route while a task is open either takes the task
 * over in place (another page that declares a mode) or lands the frame on the
 * compact rectangle in one frame (a plain pane). The close control lands the
 * same way: a control the user pressed names its destination, so it does not
 * play an exit first. Only the collapse control morphs, because it keeps the
 * same page and only changes its size.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../../i18n/react.ts";
import { mergeRefs } from "../../../platform/mergeRefs.ts";
import { onboardingAnchorRef } from "../../../onboarding/anchors.ts";
import { useInspectorSurface } from "./InspectorDomSurface.tsx";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../workspace/runtime/composition/EditorRuntime.tsx";
import { useInspectorRuntime } from "../workspace/runtime/providers/InspectorProvider.tsx";
import { closeInspector, inspectorPanels, openInspector } from "./controller.ts";
import {
  CLOSE_INSPECTOR_EVENT,
  OPEN_INSPECTOR_EVENT,
} from "../../../../core/shell/shellEventNames.ts";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { Icon, iconName, type IconName } from "../../../../design/components/icon/Icon.tsx";
import { useThemeUi } from "../../../app/useThemeUi.ts";
import { ThemeUiNodeView, type ThemeUiItem } from "../../../platform/themeUi.tsx";
import { InspectorNavigation } from "./InspectorNavigation.tsx";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../core/edit/state/visibility.ts";
import {
  useSidebarNavigation,
  type SidebarNavigationItem,
} from "../../../chrome/sidebar/navigation.ts";
import {
  closeDrawer,
  focusDrawerPaneTrigger,
  getDrawerPanes,
  getDrawerState,
  useDrawerPaneHeld,
  useDrawerPanes,
  useDrawerState,
} from "../../../chrome/drawer/drawerPanes.ts";
import { DrawerPaneView } from "../../../chrome/drawer/DrawerPaneView.tsx";
import { InspectorPage } from "../../../chrome/inspectorPage/InspectorPage.tsx";
import {
  collapseWorkspaceMode,
  expandWorkspaceMode,
  switchWorkspaceMode,
  workspaceModeForPane,
  workspacePaneForMode,
} from "../workspace/container/workspaceModeActions.ts";
import {
  closeWorkspaceMode,
  useActiveWorkspaceMode,
  useWorkspaceModeState,
} from "../workspace/container/workspaceModes.ts";
import { guideSectionForContext } from "../../../overlays/help/onboardingGuideContent.ts";
import {
  openOnboardingGuide,
  openOnboardingTutorial,
} from "../../../overlays/help/onboardingGuide.ts";
// Each pane owns a `register.ts` seam beside its view. The glob keeps this
// frame closed to extension: adding a pane does not edit the shell.
import.meta.glob("./**/register.ts", { eager: true });

/** Open the browsable guide at the section that owns the active Inspector pane. */
function openInspectorGuide(context?: string): void {
  const tutorialId = context
    ? (inspectorPanels.get().find((panel) => panel.id === context)?.tutorial?.id ??
      getDrawerPanes().find((pane) => pane.id === context)?.tutorial?.id)
    : undefined;
  if (tutorialId && openOnboardingTutorial(tutorialId)) {
    return;
  }
  openOnboardingGuide(guideSectionForContext(context));
}

type InspectorModePhase = "compact" | "opening" | "expanded" | "closing";

/** The two paths the split faces travel along between the compact and task layouts. */
type InspectorGeometry = "blend" | "joined";

/**
 * Reads one phase progress number off the frame.
 *
 * Both phase numbers are registered through `@property`, so `getComputedStyle`
 * returns the interpolated values while the transitions run. A missing or
 * malformed value is reported as the requested endpoint, which makes the
 * reduced-motion and non-animating paths settle on the next frame.
 */
function readInspectorPhase(
  element: HTMLElement | null,
  property: string,
  endpoint: number,
): number {
  if (!element) {
    return endpoint;
  }
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property).trim());
  return Number.isFinite(value) ? value : endpoint;
}

/** Inspector frame and visibility; each pane owns its view and subscriptions. */
export function InspectorPanel({ hidden = false }: { hidden?: boolean }) {
  const { t, tRaw } = useTranslation();
  const inspector = useRef<HTMLElement>(null);
  const surface = useInspectorSurface();
  const runtime = useEditorRuntime();
  const inspectorRuntime = useInspectorRuntime();
  useEffect(() => {
    const openRequested = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && runtime && inspectorRuntime) {
        openInspector(id, runtime.ui.activeInspector);
      }
    };
    const closeRequested = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && runtime && runtime.ui.activeInspector.get() === id) {
        closeInspector(runtime.ui.activeInspector);
      }
    };
    window.addEventListener(OPEN_INSPECTOR_EVENT, openRequested);
    window.addEventListener(CLOSE_INSPECTOR_EVENT, closeRequested);
    return () => {
      window.removeEventListener(OPEN_INSPECTOR_EVENT, openRequested);
      window.removeEventListener(CLOSE_INSPECTOR_EVENT, closeRequested);
    };
  }, [inspectorRuntime, runtime]);
  const activePane = useEditorRuntimeValue((current) => current.ui.activeInspector, "");
  const themeUi = useThemeUi();
  const panels = useSyncExternalStore(
    inspectorPanels.subscribe,
    inspectorPanels.get,
    inspectorPanels.get,
  );
  const navigation = useSidebarNavigation();
  const drawerPanes = useDrawerPanes();
  const drawerState = useDrawerState();
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const emptySlot = themeUi.slots["inspector.empty"];
  const readOnly = visibility.readOnly;
  const availableItems = navigation.entries.filter(
    (entry): entry is SidebarNavigationItem => entry.kind === "item",
  );
  const activeDefinition = panels.find(({ id }) => id === activePane);
  const activeWorkspaceMode = useActiveWorkspaceMode();
  const modeState = useWorkspaceModeState();
  const [modePhase, setModePhase] = useState<InspectorModePhase>(
    activeWorkspaceMode ? "expanded" : "compact",
  );
  // Set when a motion starts from a midpoint: the interrupted run continues
  // with the reverse timings instead of waiting for a delay that belongs to a
  // fresh run.
  const [modeReverse, setModeReverse] = useState(false);
  // The path the faces travel while the motion runs. `"blend"` is the entrance
  // path: the detail face slides in from the right edge while the panel grows.
  // `"joined"` keeps the detail column joined to the list face while the panel
  // gives up or takes back width. The two paths meet at both endpoints, so a
  // motion keeps its path for its whole run and never jumps between them.
  const [modeGeometry, setModeGeometry] = useState<InspectorGeometry>("blend");
  // The surface owns the frame until the collapse has played back to the
  // compact rectangle, even after the mode record is gone.
  const modeSurface = activeWorkspaceMode !== null || modePhase !== "compact";
  const modeDefinition = activeWorkspaceMode;

  /**
   * Starts the collapse of the page the collapse control keeps on screen.
   *
   * The mode record stays authoritative for the whole exit animation, so the
   * frame keeps the page, header, and label that are leaving. The animation
   * clock closes the mode when the geometry has reached the compact rectangle.
   * A collapse requested while the entrance is still running keeps the entrance
   * path and reverses both numbers in place instead of waiting for a delay that
   * belongs to a fresh exit.
   */
  const startCollapse = useCallback(() => {
    const element = inspector.current;
    const read = (property: string) => {
      if (!element) {
        return Number.NaN;
      }
      return Number.parseFloat(getComputedStyle(element).getPropertyValue(property).trim());
    };
    const shift = read("--inspector-morph-shift");
    const grow = read("--inspector-morph-grow");
    const interrupted =
      Number.isFinite(shift) && Number.isFinite(grow) && (shift < 0.999 || grow < 0.999);
    setModeReverse(interrupted);
    if (!interrupted) {
      // A settled entrance retracts along the joined path: the detail column
      // gives up width exactly as fast as the panel closes.
      setModeGeometry("joined");
    }
    setModePhase((phase) => (phase === "closing" || phase === "compact" ? phase : "closing"));
  }, []);

  /**
   * Resumes an exit that has not landed.
   *
   * The mode record is still authoritative while the closing beat runs, so the
   * toggle reverses in place: the interrupted motion continues on its current
   * path from its current geometry instead of restarting the entrance.
   */
  const startExpand = useCallback(() => {
    setModeReverse(true);
    setModePhase((phase) => (phase === "closing" ? "opening" : phase));
  }, []);

  /**
   * Lands the frame on the compact rectangle in one frame.
   *
   * A close, or a route into a page that cannot fill the task, changes the page
   * and the expanded surface in the same commit: the mode record and the surface
   * attribute go together, so there is no exit motion to play. The user pressed
   * a control whose destination is already known, and the workspace is revealed
   * at once instead of by a motion they did not ask to watch. The morph
   * transitions live on the expanded surface rule, so they disappear with the
   * attribute and cannot carry the panel back over a frame.
   */
  const landCompact = useCallback(() => {
    setModeReverse(false);
    setModeGeometry("blend");
    setModePhase("compact");
    closeWorkspaceMode();
    // A close that interrupts the entrance leaves its progress transitions
    // running toward the task geometry. They are invisible once the surface is
    // gone, so drop them on the next frame instead of letting them finish and
    // hand a nonzero progress to the next entrance.
    const element = inspector.current;
    if (element) {
      window.requestAnimationFrame(() => {
        for (const animation of element.getAnimations()) {
          const property = (animation as CSSTransition).transitionProperty;
          if (typeof property === "string" && property.startsWith("--inspector-morph")) {
            animation.cancel();
          }
        }
      });
    }
  }, []);

  // Routing another Inspector page into the frame while a task is open either
  // takes the task over in place or lands the frame on the compact rectangle in
  // one frame. A page that owns a mode takes the task over because the surface
  // is already at the task geometry; a plain pane cannot fill the task, so the
  // frame drops the expanded surface in the same commit the route is taken,
  // even when the task is already leaving. The pane that owns the open mode is
  // never a switch target: it is the page already on screen.
  useEffect(() => {
    if (!activeWorkspaceMode || !modeState.id) {
      return;
    }
    const owner = workspacePaneForMode(modeState.id);
    if (!owner || activePane === owner) {
      return;
    }
    const nextMode = workspaceModeForPane(activePane);
    if (nextMode) {
      // Another page can only take the task over once the surface is open; a
      // route taken mid-exit stays on the exit it is already playing.
      if (modePhase === "opening" || modePhase === "expanded") {
        switchWorkspaceMode(nextMode, modeState.returnPane);
      }
      return;
    }
    // The route is an external change and the frame owns the phase that goes
    // with it, so the compact landing is committed with the pane the user
    // already pressed instead of after another paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    landCompact();
  }, [activePane, activeWorkspaceMode, landCompact, modePhase, modeState.id, modeState.returnPane]);

  // A newly opened mode starts the geometry transition. A mode cleared from
  // outside this frame (document replacement, a direct registry write) still
  // plays the same exit; the timeout keeps that write out of the render pass.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModePhase((phase) => {
        if (activeWorkspaceMode) {
          return phase === "closing" || phase === "expanded" ? phase : "opening";
        }
        return phase === "opening" || phase === "expanded" ? "closing" : phase;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeWorkspaceMode]);

  // The two phase numbers are the motion clock: the phase settles only when the
  // last beat lands, so both arrangement and fill must reach their endpoint.
  // Polling the registered values also covers the reduced motion path, where the
  // transitions complete in the first style flush.
  useEffect(() => {
    if (modePhase !== "opening" && modePhase !== "closing") {
      return undefined;
    }
    const element = inspector.current;
    const target = modePhase === "opening" ? 1 : 0;
    let finished = false;
    let frame = 0;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (modePhase === "closing") {
        if (getDrawerState().open) {
          // A drawer page took over the body while the task was open: the exit
          // lands on the compact rectangle and the drawer is what should show,
          // so no pane is restored behind it.
          closeWorkspaceMode();
        } else {
          // The collapse control owns a single page; the mode record stays
          // authoritative until the last frame, then restores the remembered
          // pane at the same time the compact rectangle settles.
          collapseWorkspaceMode(runtime);
        }
        setModePhase("compact");
        setModeReverse(false);
        setModeGeometry("blend");
        return;
      }
      setModePhase("expanded");
      setModeReverse(false);
    };
    if (!element) {
      finish();
      return undefined;
    }
    const settled = () =>
      Math.abs(readInspectorPhase(element, "--inspector-morph-shift", target) - target) < 0.002 &&
      Math.abs(readInspectorPhase(element, "--inspector-morph-grow", target) - target) < 0.002;
    const check = () => {
      if (finished) {
        return;
      }
      if (settled()) {
        finish();
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    // Window-throttled frames must not strand the phase. A paused transition is
    // under an external clock (automation stepping), so the fallback waits for
    // it instead of cutting the motion short.
    const declared = Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000;
    let timer = 0;
    const scheduleFallback = (delay: number) => {
      timer = window.setTimeout(() => {
        if (finished) {
          return;
        }
        const paused = element
          .getAnimations()
          .some(
            (animation) =>
              (animation as CSSTransition).transitionProperty === "--inspector-morph" &&
              animation.playState === "paused",
          );
        if (paused) {
          scheduleFallback(250);
          return;
        }
        finish();
      }, delay);
    };
    scheduleFallback((Number.isFinite(declared) ? declared : 0) + 200);
    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [modePhase, runtime]);

  const activeDrawerPane = drawerState.open
    ? (drawerPanes.find(
        (pane) =>
          pane.id === drawerState.pane && (!pane.requiresDocument || visibility.hasDocument),
      ) ?? null)
    : null;
  const drawerHeld = useDrawerPaneHeld(activeDrawerPane?.id ?? null);
  // A drawer page replaces the inspector body, so the pane it hides must stop
  // publishing previews. Closing it runs the pane's close lifecycle, which
  // releases the curve draft and batch-edit ghost; closing the drawer returns to
  // an empty inspector rather than restoring the previous pane. Only the
  // closed-to-open transition closes, so a pane opened while the drawer already
  // owns the body is not discarded.
  const drawerWasOpen = useRef(activeDrawerPane !== null);
  useEffect(() => {
    const drawerOpened = activeDrawerPane !== null && !drawerWasOpen.current;
    drawerWasOpen.current = activeDrawerPane !== null;
    if (drawerOpened && runtime && activePane !== "") {
      closeInspector(runtime.ui.activeInspector);
    }
  }, [activeDrawerPane, activePane, runtime]);
  // The mode keeps its page visible even if another pane becomes active behind
  // the expanded surface; that page is the one the mode record names.
  const shownPane = modeSurface && modeDefinition ? modeDefinition.id : activePane;
  const navigationEntry = availableItems.find((item) => item.panelId === activePane);
  const modeLabel = modeSurface ? modeDefinition?.label : undefined;
  const modeIcon = modeSurface ? modeDefinition?.icon : undefined;
  const headerLabel =
    modeLabel ??
    activeDrawerPane?.label ??
    activeDefinition?.label ??
    navigationEntry?.label ??
    "chrome.inspector.label";
  const headerIcon: IconName = modeIcon
    ? modeIcon
    : activeDrawerPane?.icon
      ? activeDrawerPane.icon
      : (activeDefinition?.icon ??
        (navigationEntry ? iconName(navigationEntry.icon) : "panelRight"));
  const showHeader = modeSurface || activeDrawerPane !== null || activePane !== "";
  const expandMode = activeDefinition?.workspaceMode;
  const escapeCloseTimer = useRef<number | null>(null);
  /**
   * Closes the expanded task, the drawer page, or the active pane.
   *
   * A close never plays an exit first: the page the user asked to close and the
   * expanded surface leave in one commit, so the destination they chose is on
   * screen immediately. The collapse control is the only exit that morphs,
   * because it keeps the same page and only changes its size.
   */
  const closeActive = useCallback(() => {
    if (activeDrawerPane) {
      // A guided step anchored to this page keeps it open; closing would leave
      // the card without its target.
      if (drawerHeld) {
        return;
      }
      closeDrawer();
      if (runtime) {
        closeInspector(runtime.ui.activeInspector);
      }
      focusDrawerPaneTrigger(activeDrawerPane.id);
      return;
    }
    if (activeWorkspaceMode || modePhase !== "compact") {
      // The close control and Escape name their destination: the page and the
      // expanded surface leave in the same frame, with no exit between them.
      landCompact();
      if (runtime && runtime.ui.activeInspector.get() !== "") {
        closeInspector(runtime.ui.activeInspector);
      }
      return;
    }
    if (runtime && activePane !== "") {
      closeInspector(runtime.ui.activeInspector);
    }
  }, [
    activeDrawerPane,
    activePane,
    activeWorkspaceMode,
    drawerHeld,
    landCompact,
    modePhase,
    runtime,
  ]);
  // Escape is the last resort: an open dialog, popover, capture surface, or
  // menu consumes it first and prevents or stops the event. Only a plain Escape
  // that reaches the window closes the inspector.
  useEffect(() => {
    if (!showHeader) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }
      // Run after every other Escape listener has had a chance to claim the
      // event. A dialog, popover, menu, or capture surface that handles Escape
      // prevents the default and keeps the inspector open.
      if (escapeCloseTimer.current !== null) {
        window.clearTimeout(escapeCloseTimer.current);
      }
      escapeCloseTimer.current = window.setTimeout(() => {
        escapeCloseTimer.current = null;
        if (!event.defaultPrevented) {
          closeActive();
        }
      }, 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (escapeCloseTimer.current !== null) {
        window.clearTimeout(escapeCloseTimer.current);
        escapeCloseTimer.current = null;
      }
    };
  }, [closeActive, showHeader]);
  const themeItems: ThemeUiItem[] = availableItems.map((item) => ({
    id: item.id,
    label: tRaw(item.label),
    icon: item.icon,
    onActivate: item.onActivate,
    ...(item.visibility ? { visibility: item.visibility } : {}),
    ...(item.indicator ? { indicator: item.indicator } : {}),
  }));
  return (
    <aside
      id="inspector"
      ref={mergeRefs(inspector, surface.attach.inspector, onboardingAnchorRef("inspector"))}
      className={`inspector panel${activeDrawerPane ? " is-drawer" : ""}${readOnly ? " is-readonly" : ""}`}
      data-mode-surface={modeSurface ? "true" : undefined}
      data-mode-phase={modeSurface ? modePhase : undefined}
      data-mode-reverse={modeReverse ? "true" : undefined}
      data-mode-geometry={modeSurface ? modeGeometry : undefined}
      tabIndex={-1}
      aria-label={t("chrome.inspector.label")}
      aria-readonly={readOnly || undefined}
      hidden={hidden}
    >
      {showHeader && (
        <div className="inspector-status">
          <Icon className="inspector-status-icon" name={headerIcon} size={16} />
          <span className="inspector-status-name">{tRaw(headerLabel)}</span>
          <IconButton
            className="inspector-status-help"
            icon="help"
            size="small"
            label={t("chrome.inspector.help")}
            tooltip={false}
            onClick={() =>
              openInspectorGuide(
                modeDefinition?.id ?? activeDrawerPane?.id ?? activePane ?? activeWorkspaceMode?.id,
              )
            }
          />
          <div className="inspector-status-actions">
            {(modeSurface || expandMode) && (
              <IconButton
                className={`inspector-status-expand${modeSurface ? " is-expanded" : ""}`}
                icon={modeSurface ? "inspectorCollapse" : "inspectorExpand"}
                label={t(
                  modeSurface ? "chrome.workspace.backToTimeline" : "chrome.inspector.expand",
                )}
                tooltip={false}
                aria-expanded={modeSurface}
                aria-controls="inspector"
                onClick={() => {
                  if (modePhase === "closing") {
                    startExpand();
                    return;
                  }
                  if (modeSurface) {
                    startCollapse();
                    return;
                  }
                  if (expandMode) {
                    expandWorkspaceMode(expandMode, runtime);
                  }
                }}
              />
            )}
            <IconButton
              className="inspector-status-close"
              icon="close"
              label={t("chrome.inspector.close")}
              disabled={drawerHeld}
              onClick={() => {
                closeActive();
              }}
            />
          </div>
        </div>
      )}
      <div
        className="inspector-body"
        data-mode-surface={modeSurface ? "true" : undefined}
        data-mode-phase={modeSurface ? modePhase : undefined}
      >
        <div
          data-panel="empty"
          className="inspector-pane"
          hidden={modeSurface || activeDrawerPane !== null || activePane !== ""}
        >
          <InspectorPage>
            {emptySlot ? (
              <ThemeUiNodeView tree={emptySlot} bindings={{ items: themeItems, expanded: true }} />
            ) : navigation.entries.length > 0 ? (
              <InspectorNavigation entries={navigation.entries} />
            ) : (
              <div className="inspector-empty-placeholder">{t("chrome.inspector.empty")}</div>
            )}
          </InspectorPage>
        </div>
        {inspectorRuntime &&
          panels.map(({ id, component: Panel, editsChart, layout }) => {
            const locked = readOnly && editsChart === true;
            const isActivePanel = shownPane === id;
            return (
              <div
                key={id}
                ref={onboardingAnchorRef(`inspector-panel-${id}`)}
                data-panel={id}
                className="inspector-pane"
                data-readonly={locked ? "true" : undefined}
                inert={locked || undefined}
                aria-disabled={locked || undefined}
                hidden={activeDrawerPane !== null || !isActivePanel}
              >
                {layout === "split" ? (
                  <Panel />
                ) : (
                  <InspectorPage>
                    <Panel />
                  </InspectorPage>
                )}
              </div>
            );
          })}
        {!modeSurface && activeDrawerPane && (
          <DrawerPaneView key={activeDrawerPane.id} pane={activeDrawerPane} />
        )}
      </div>
    </aside>
  );
}
