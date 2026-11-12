/**
 * The application menu trigger in the custom title bar.
 *
 * The theme chooses one hamburger sheet or expanded title-bar triggers. Each
 * section shows its command list on hover after a short delay or on click.
 * Moving the pointer away collapses the open section after a short grace
 * period; an outside click, Escape, or a command dismisses it too. Developer
 * commands stay out of this surface and use their shortcuts; the developer
 * settings page owns the environment summary and the performance monitor.
 * Commands still come from the toolbar registry, so labels, availability,
 * shortcuts, and actions stay shared with the toolbar and shortcut editor.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../i18n/react.ts";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import {
  MenuItem,
  MenuSeparator,
  MenuSurface,
} from "../../../design/components/menu/MenuSurface.tsx";
import { usePresence } from "../../../design/patterns/usePresence.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import { SHORTCUT_DISPATCHED_EVENT } from "../../../core/shell/shellEventNames.ts";
import {
  actionAvailable,
  actionShortcut,
  runAction,
  toolbar,
  type ToolbarAction,
  type ToolbarEntry,
} from "../../../core/shell/registries/toolbar.ts";
import { useThemeChrome } from "../../app/useThemeChrome.ts";
import { useThemeUi } from "../../app/useThemeUi.ts";
import { ThemeUiNodeView } from "../../platform/themeUi.tsx";
import { APPLICATION_MENUS, type MenuSpec } from "./menuSpec.ts";

const HOVER_OPEN_MS = 240;
/** How long an open section stays visible after the pointer leaves it. */
const HOVER_CLOSE_MS = 600;

/** Indexes the registered toolbar actions by id for menu lookups. */
function actionMap(entries: readonly ToolbarEntry[]): Map<string, ToolbarAction> {
  const byId = new Map<string, ToolbarAction>();
  for (const entry of entries) {
    if (entry.kind === "action") {
      byId.set(entry.id, entry);
    }
  }
  return byId;
}

/** Title-bar menu button and the task-level command sections it opens. */
export function MenuBar() {
  const { t, tRaw } = useTranslation();
  const chrome = useThemeChrome();
  const themeUi = useThemeUi();
  const expandedMenu = chrome.titlebar.menu === "expanded";
  const entries = useSyncExternalStore(toolbar.subscribe, toolbar.getSnapshot, toolbar.getSnapshot);
  const atHome = useSyncExternalStore(
    subscribeToEditorVisibility,
    () => getEditorVisibility().atHome,
    () => getEditorVisibility().atHome,
  );
  const menus = APPLICATION_MENUS;
  const byId = useMemo(() => actionMap(entries), [entries]);
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  // The section id survives its state so the popup can play its exit after the
  // trigger has already reported `aria-expanded=false`.
  const [renderedSection, setRenderedSection] = useState<string | null>(null);
  const sheetPresence = usePresence(open);
  const sectionPresence = usePresence(openSection !== null);
  const activeSection = openSection ?? renderedSection;
  const root = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const showing = expandedMenu ? openSection !== null : open;

  // Switching presentation must not leave a popup from the other mode open.
  useEffect(() => {
    // The popup is local state that belongs to the current presentation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
    setOpenSection(null);
  }, [expandedMenu]);

  // Keep the last expanded section for its exit; the trigger itself reports
  // `aria-expanded=false` as soon as the state clears.
  useEffect(() => {
    if (openSection !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRenderedSection(openSection);
    }
  }, [openSection]);

  /** Cancels a pending hover expansion. */
  const cancelHover = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  /** Cancels a pending collapse after the pointer left. */
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => {
    if (!showing) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setOpenSection(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setOpenSection(null);
      }
    };
    const onShortcut = (): void => {
      setOpen(false);
      setOpenSection(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(SHORTCUT_DISPATCHED_EVENT, onShortcut);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(SHORTCUT_DISPATCHED_EVENT, onShortcut);
    };
  }, [showing]);

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) {
        window.clearTimeout(hoverTimer.current);
      }
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
    },
    [],
  );

  /** Opens one section, immediately for focus or after the hover dwell otherwise. */
  const showSection = (id: string, immediate: boolean): void => {
    cancelHover();
    cancelClose();
    if (openSection === id) {
      return;
    }
    // Once a submenu is visible, moving across the five sections switches it at
    // once. Before that, a short dwell prevents accidental menus while the
    // pointer crosses the trigger.
    if (immediate || openSection !== null) {
      setOpenSection(id);
      return;
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setOpenSection(id);
    }, HOVER_OPEN_MS);
  };

  /** Closes the menu and any open section. */
  const close = (): void => {
    cancelHover();
    cancelClose();
    setOpen(false);
    setOpenSection(null);
  };

  /** Collapse the open section after the pointer has left it for a moment. */
  const closeSoon = (): void => {
    cancelHover();
    if (openSection === null) {
      return;
    }
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpenSection(null);
    }, HOVER_CLOSE_MS);
  };

  /**
   * Toggles the click-only sheet. Expanded sections own their hover contract:
   * their trigger clicks are no-ops while the section is already open.
   */
  const toggleMenu = () => {
    cancelHover();
    cancelClose();
    if (open) {
      setOpen(false);
      setOpenSection(null);
      return;
    }
    setOpen(true);
  };

  /** Draw one section's visible commands; both menu presentations share this. */
  const actionRows = (menu: MenuSpec) => {
    const visible = menu.actionIds
      .map((id) => byId.get(id))
      .filter((action): action is ToolbarAction => action !== undefined)
      .filter((action) => action.visible?.() !== false);
    return visible.map((action, index) => {
      const checked = action.checked?.() === true;
      return (
        <Fragment key={action.id}>
          {action.separatorBefore && index > 0 && <MenuSeparator />}
          <MenuItem
            id={`menu-action-${action.id}`}
            label={tRaw(action.label)}
            checked={checked}
            shortcut={actionShortcut(action)}
            danger={action.destructive}
            disabled={!actionAvailable(action) || (menu.id === "view" && atHome)}
            onClick={() => {
              if (runAction(action, "menu")) {
                close();
              }
            }}
          />
        </Fragment>
      );
    });
  };

  if (expandedMenu) {
    return (
      <div
        className="redux-titlebar-menubar"
        ref={root}
        role="menubar"
        aria-label={t("chrome.menu.label")}
      >
        {menus.map((menu) => {
          const sectionOpen = openSection === menu.id;
          return (
            <div
              className="redux-titlebar-menubar-section"
              key={menu.id}
              data-menu-section={menu.id}
              onPointerEnter={() => showSection(menu.id, false)}
              onPointerLeave={closeSoon}
            >
              <Button
                type="button"
                role="menuitem"
                variant="plain"
                className="redux-titlebar-menubar-trigger"
                aria-haspopup="menu"
                aria-expanded={sectionOpen}
                data-active={sectionOpen}
                onClick={() => {
                  cancelHover();
                  // Re-clicking the open section keeps it open; leaving the
                  // menubar, an outside click, Escape, or a command dismisses it.
                  if (!sectionOpen) {
                    setOpenSection(menu.id);
                  }
                }}
                onFocus={() => showSection(menu.id, true)}
              >
                {t(menu.label)}
              </Button>
              {sectionPresence.mounted && activeSection === menu.id && (
                <MenuSurface
                  label={t(menu.label)}
                  className="redux-app-menu-popup redux-titlebar-menubar-popup"
                  state={sectionPresence.closing ? "closing" : "open"}
                >
                  {actionRows(menu)}
                </MenuSurface>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const template = themeUi.components.menuTrigger;
  return (
    <div className="redux-titlebar-menu" ref={root}>
      {template ? (
        <Button
          type="button"
          variant="plain"
          className="redux-titlebar-menu-button theme-menu-trigger"
          aria-label={t("chrome.menu.label")}
          aria-haspopup="menu"
          aria-expanded={open}
          data-active={open}
          data-tip-title={t("chrome.menu.label")}
          onClick={toggleMenu}
        >
          <ThemeUiNodeView
            tree={template}
            bindings={{ label: t("chrome.menu.label"), icon: "linesHorizontal", active: open }}
          />
        </Button>
      ) : (
        <IconButton
          icon="linesHorizontal"
          label={t("chrome.menu.label")}
          className="redux-titlebar-menu-button"
          active={open}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggleMenu}
        />
      )}
      {sheetPresence.mounted && (
        <MenuSurface
          label={t("chrome.menu.label")}
          className="redux-app-menu-sheet"
          state={sheetPresence.closing ? "closing" : "open"}
        >
          {menus.map((menu) => {
            const expanded = openSection === menu.id;
            return (
              <div
                className="redux-app-menu-section"
                key={menu.id}
                data-menu-section={menu.id}
                onPointerEnter={() => showSection(menu.id, false)}
              >
                <MenuItem
                  label={t(menu.label)}
                  expandable
                  expanded={expanded}
                  className="redux-app-menu-section-button"
                  onClick={() => {
                    cancelHover();
                    if (!expanded) {
                      setOpenSection(menu.id);
                    }
                  }}
                  onFocus={() => showSection(menu.id, true)}
                />
                {sectionPresence.mounted && activeSection === menu.id && (
                  <MenuSurface
                    label={t(menu.label)}
                    className="redux-app-menu-popup redux-app-menu-submenu"
                    state={sectionPresence.closing ? "closing" : "open"}
                  >
                    {actionRows(menu)}
                  </MenuSurface>
                )}
              </div>
            );
          })}
        </MenuSurface>
      )}
    </div>
  );
}
