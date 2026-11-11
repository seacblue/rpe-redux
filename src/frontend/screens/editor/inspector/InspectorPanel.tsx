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
  useDrawerPaneHeld,
  useDrawerPanes,
  useDrawerState,
} from "../../../chrome/drawer/drawerPanes.ts";
import { DrawerPaneView } from "../../../chrome/drawer/DrawerPaneView.tsx";
import {
  collapseWorkspaceMode,
  expandWorkspaceMode,
} from "../workspace/container/workspaceModeActions.ts";
import {
  useActiveWorkspaceMode,
  type WorkspaceModeDefinition,
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
  const [displayedMode, setDisplayedMode] = useState<WorkspaceModeDefinition | null>(
    activeWorkspaceMode,
  );
  const [modeExpanded, setModeExpanded] = useState(activeWorkspaceMode !== null);
  // Keep the task mounted through the collapse transition, then hand the body
  // back to the compact page. The opening write is deferred one frame so the
  // panel starts from its compact layout before the width expands; the closing
  // write starts the shrink immediately and clears the content after it ends.
  useEffect(() => {
    if (activeWorkspaceMode) {
      const openTimer = window.setTimeout(() => {
        setDisplayedMode(activeWorkspaceMode);
        setModeExpanded(true);
      }, 0);
      return () => window.clearTimeout(openTimer);
    }
    const collapseTimer = window.setTimeout(() => setModeExpanded(false), 0);
    const clearTimer = window.setTimeout(() => setDisplayedMode(null), 220);
    return () => {
      window.clearTimeout(collapseTimer);
      window.clearTimeout(clearTimer);
    };
  }, [activeWorkspaceMode]);
  const activeDrawerPane = drawerState.open
    ? (drawerPanes.find(
        (pane) =>
          pane.id === drawerState.pane && (!pane.requiresDocument || visibility.hasDocument),
      ) ?? null)
    : null;
  const modeSurface = displayedMode !== null;
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
  const navigationEntry = availableItems.find((item) => item.panelId === activePane);
  const headerLabel =
    displayedMode?.label ??
    activeDrawerPane?.label ??
    activeDefinition?.label ??
    navigationEntry?.label ??
    "chrome.inspector.label";
  const headerIcon: IconName = displayedMode?.icon
    ? displayedMode.icon
    : activeDrawerPane?.icon
      ? activeDrawerPane.icon
      : (activeDefinition?.icon ??
        (navigationEntry ? iconName(navigationEntry.icon) : "panelRight"));
  const showHeader = modeSurface || activeDrawerPane !== null || activePane !== "";
  const expandMode = activeDefinition?.workspaceMode;
  const escapeCloseTimer = useRef<number | null>(null);
  /** Closes the expanded task, the drawer page, or the active pane. */
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
    if (runtime && activeWorkspaceMode && activePane === "") {
      collapseWorkspaceMode(runtime);
      return;
    }
    if (runtime && activePane !== "") {
      closeInspector(runtime.ui.activeInspector);
      return;
    }
  }, [activeDrawerPane, activePane, activeWorkspaceMode, drawerHeld, runtime]);
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
  const DisplayedMode = displayedMode?.component;
  return (
    <aside
      id="inspector"
      ref={mergeRefs(inspector, surface.attach.inspector, onboardingAnchorRef("inspector"))}
      className={`inspector panel${activeDrawerPane ? " is-drawer" : ""}${readOnly ? " is-readonly" : ""}`}
      data-mode-surface={modeSurface ? "true" : undefined}
      data-mode-expanded={modeSurface && modeExpanded ? "true" : undefined}
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
            label={t("chrome.inspector.help")}
            tooltip={false}
            onClick={() =>
              openInspectorGuide(
                displayedMode?.id ?? activeDrawerPane?.id ?? activePane ?? activeWorkspaceMode?.id,
              )
            }
          />
          <div className="inspector-status-actions">
            {(displayedMode || expandMode) && (
              <IconButton
                className={`inspector-status-expand${displayedMode ? " is-expanded" : ""}`}
                icon="external"
                label={t(
                  displayedMode ? "chrome.workspace.backToTimeline" : "chrome.inspector.expand",
                )}
                tooltip={false}
                aria-expanded={displayedMode ? true : false}
                aria-controls="inspector"
                onClick={() => {
                  if (displayedMode) {
                    if (activeWorkspaceMode) {
                      collapseWorkspaceMode(runtime);
                    }
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
              disabled={drawerHeld || (modeSurface && !activeWorkspaceMode)}
              onClick={() => {
                closeActive();
              }}
            />
          </div>
        </div>
      )}
      <div className="inspector-content" data-mode-surface={modeSurface ? "true" : undefined}>
        <div
          data-panel="empty"
          hidden={modeSurface || activeDrawerPane !== null || activePane !== ""}
        >
          {emptySlot ? (
            <ThemeUiNodeView tree={emptySlot} bindings={{ items: themeItems, expanded: true }} />
          ) : navigation.entries.length > 0 ? (
            <InspectorNavigation entries={navigation.entries} />
          ) : (
            <div className="inspector-empty-placeholder">{t("chrome.inspector.empty")}</div>
          )}
        </div>
        {modeSurface && DisplayedMode && (
          <div data-panel="workspace-mode" className="inspector-mode-surface">
            <DisplayedMode />
          </div>
        )}
        {inspectorRuntime &&
          panels.map(({ id, component: Panel, editsChart }) => {
            const locked = readOnly && editsChart === true;
            return (
              <div
                key={id}
                ref={onboardingAnchorRef(`inspector-panel-${id}`)}
                data-panel={id}
                data-readonly={locked ? "true" : undefined}
                inert={locked || undefined}
                aria-disabled={locked || undefined}
                hidden={modeSurface || activeDrawerPane !== null || activePane !== id}
              >
                <Panel />
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
