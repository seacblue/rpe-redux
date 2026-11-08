/**
 * The settings dialog.
 *
 * Category pages are one continuous scroll rather than swapped panels: the
 * section at the top of the viewport owns the heading breadcrumb, the expanded
 * rail group, and the travelling selection bar. A strong seam between page
 * sections keeps adjacent categories from reading as one page. Search results
 * still stack their matching pages inside the same scroller. A plain reopen resumes the
 * last category and offset and keeps the search text and its results; a deep link
 * still lands on the page it names. Page bodies mount one idle slice at a time, so
 * a large catalog cannot stall the opening frame.
 */
import { SettingsNavigation } from "./SettingsNavigation.tsx";
import { SettingsFields } from "./SettingsFields.tsx";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  searchSettings,
  settingsDefinitions,
  settingsFields,
  settingsNavigationChildren,
  settingsNavigationPath,
  settingsNavigationTarget,
  settingsNavigations,
  settingsPageSearchText,
  navigationPathFrom,
  subscribeSettingsCatalog,
} from "./settingsCatalog.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";
import type { SettingsNavigation as SettingsNavigationDefinition } from "../../../core/settings/types.ts";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { EmptyState } from "../../../design/components/empty-state/EmptyState.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import type { Theme } from "../../../core/theme/themes.ts";
import { CLOSE_SETTINGS_EVENT, OPEN_SETTINGS_EVENT } from "./settingsWindowController.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { CATALOGS } from "../../../i18n/messages/index.ts";
import { values } from "../../../core/state/values.ts";
import { settingsPageFor } from "./settingsContributions.ts";
import { syncRuntimePortSetting } from "../../platform/desktop/runtimePorts.ts";
import { deleteCustomBackground } from "../../platform/desktop/customBackground.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { replacedApplicationDataReference } from "./applicationDataLifecycle.ts";
import { matchesSettingsSearch } from "./settingsSearch.ts";
import { useSettingVisibility } from "./useSetting.ts";
import { developerReveal } from "../../../core/state/developerReveal.ts";
import { setShortcutRecording } from "./shortcuts/recordingState.ts";
import {
  readSettingsScrollMemory,
  writeSettingsScrollMemory,
  type SettingsScrollMemory,
} from "./settingsScrollMemory.ts";
import { SettingsPageSkeleton, useSettingsPageHydration } from "./settingsPageHydration.tsx";
import "./settingsFeatures.ts";

type Field = SettingDefinition;
interface SettingsRequest {
  category?: string;
}

const DEVELOPER_NAVIGATION: SettingsNavigationDefinition = Object.freeze({
  key: "developer",
  label: "settings.category.developer.label",
  icon: "monitor",
});

/**
 * A section's scroll offset inside the panels container.
 *
 * `offsetTop` is a layout measurement, so it stays in CSS pixels while the
 * dialog plays its opening transform. `getBoundingClientRect` includes that
 * transform, which would make the restored position drift as the scale settles.
 * The container's top border is added so the offset still matches its border
 * box if the scroller ever gains one.
 */
function settingsSectionOffset(container: HTMLElement, section: HTMLElement): number {
  return section.offsetTop + container.clientTop;
}

/** The settings dialog, owned here and opened through `OPEN_SETTINGS_EVENT`. */
export function SettingsWindow({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  const { t, language } = useTranslation();
  // The frame owns the flag: the shell only says "open this category" through a
  // window event, and the shared dialog follows `open` from here.
  const [open, setOpen] = useState(false);
  // Content stays mounted through the exit transition, then drops so a closed
  // window neither renders a large catalog nor pays for hidden layout.
  const [contentMounted, setContentMounted] = useState(false);
  const contentVisible = open || contentMounted;
  // A closed window cannot own the keyboard, so any shortcut capture ends with it.
  useEffect(() => {
    if (!open) {
      setShortcutRecording(false);
    }
  }, [open]);
  // The window draws its own heading, so it also names itself for the dialog.
  const titleId = useId();
  const [category, setCategory] = useState<string>(() => {
    // Before the first request the window starts on the first root; a plain open
    // replaces this with the remembered reading position.
    const first = settingsNavigations().find((entry) => !entry.parent);
    return first ? settingsNavigationTarget(first.key) : "";
  });
  const [expandedNavigationKeys, setExpandedNavigationKeys] = useState<ReadonlySet<string>>(() => {
    // One root is open at a time, and the window opens on General, so the
    // initial expansion is simply the active page's path.
    const expanded = new Set<string>();
    for (const entry of settingsNavigationPath(category)) {
      if (settingsNavigationChildren(entry.key).length > 0) {
        expanded.add(entry.key);
      }
    }
    return expanded;
  });
  // Search survives close/open, so the field keeps its text and the same result
  // set. Filtering reads a deferred copy so a long query cannot make typing
  // wait for the whole catalog to be re-matched.
  const [query, setQuery] = useState("");
  const searchQuery = useDeferredValue(query);
  useSyncExternalStore(subscribeSettingsCatalog, settingsDefinitions, settingsDefinitions);
  const revealed = useSyncExternalStore(
    developerReveal.subscribe,
    developerReveal.get,
    developerReveal.get,
  );
  const categories = useMemo(
    () => (revealed ? [...settingsNavigations(), DEVELOPER_NAVIGATION] : settingsNavigations()),
    [revealed],
  );
  const pageEntries = useMemo(() => {
    const pages: SettingsNavigationDefinition[] = [];
    /** Collect the leaf pages below one navigation root. */
    const collect = (entry: SettingsNavigationDefinition) => {
      const children = settingsNavigationChildren(entry.key);
      if (!children.length) {
        pages.push(entry);
        return;
      }
      for (const child of children) {
        collect(child);
      }
    };
    for (const entry of categories) {
      if (!entry.parent) {
        collect(entry);
      }
    }
    return pages;
  }, [categories]);
  // One page body mounts per idle slice. The active page and the pages that
  // currently match the search render immediately; everything else keeps a
  // skeleton until the queue reaches it, which keeps the opening frame short.
  const pageKeys = useMemo(() => pageEntries.map((entry) => entry.key), [pageEntries]);
  const { readyPages, reset: resetPageHydration } = useSettingsPageHydration({
    open,
    pageKeys,
  });
  const fields = settingsDefinitions();
  const visibility = useSettingVisibility(fields);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const pendingScroll = useRef<{ key: string; offset: number } | null>(null);
  const lastScroll = useRef<SettingsScrollMemory | null>(null);
  const scrollWriteTimer = useRef(0);
  const [scrollVersion, setScrollVersion] = useState(0);

  /** Write the pending reading position now and cancel the debounce. */
  const flushScrollMemory = useCallback(() => {
    if (scrollWriteTimer.current) {
      window.clearTimeout(scrollWriteTimer.current);
      scrollWriteTimer.current = 0;
    }
    if (lastScroll.current) {
      writeSettingsScrollMemory(lastScroll.current);
    }
  }, []);

  /** Debounce a reading-position write and skip positions that did not change. */
  const rememberScroll = useCallback((category: string, offset: number) => {
    const next = { category, offset: Math.max(0, Math.round(offset)) };
    const previous = lastScroll.current;
    if (previous?.category === next.category && previous.offset === next.offset) {
      return;
    }
    lastScroll.current = next;
    if (scrollWriteTimer.current) {
      window.clearTimeout(scrollWriteTimer.current);
    }
    scrollWriteTimer.current = window.setTimeout(() => {
      scrollWriteTimer.current = 0;
      if (lastScroll.current) {
        writeSettingsScrollMemory(lastScroll.current);
      }
    }, 250);
  }, []);

  /** Queue a section scroll for the next layout pass. */
  const requestScroll = useCallback((key: string, offset = 0) => {
    pendingScroll.current = { key, offset: Math.max(0, offset) };
    setScrollVersion((version) => version + 1);
  }, []);

  // Closing flushes the latest position even when the debounce has not fired.
  useEffect(() => {
    if (!open) {
      return;
    }
    return flushScrollMemory;
  }, [open, flushScrollMemory]);

  // A page is active when its section has crossed the top of the scroll area.
  // The same state feeds the heading breadcrumb, the expanded root, and the
  // travelling rail, so a wheel scroll and a nav click land on the same view.
  const activateCategory = useCallback(
    (target: string, scroll = false) => {
      setCategory(target);
      setExpandedNavigationKeys((current) => {
        const next = new Set<string>();
        for (const entry of settingsNavigationPath(target)) {
          if (settingsNavigationChildren(entry.key).length > 0) {
            next.add(entry.key);
          }
        }
        if (next.size === current.size && [...next].every((key) => current.has(key))) {
          return current;
        }
        return next;
      });
      if (scroll) {
        requestScroll(target);
      }
    },
    [requestScroll],
  );

  /** Open a category by key, falling back to the first root for unknown links. */
  const openCategory = useCallback(
    (next: string) => {
      // A deep link names a root or a page. An unknown key falls back to the
      // first root so a stale link still opens a usable page.
      const known =
        (next === "developer" && developerReveal.get()) ||
        categories.some((entry) => entry.key === next) ||
        settingsNavigations().some((entry) => entry.key === next);
      const fallback =
        categories.find((entry) => !entry.parent)?.key ??
        settingsNavigations().find((entry) => !entry.parent)?.key ??
        "";
      const target = settingsNavigationTarget(known ? next : fallback);
      setQuery("");
      activateCategory(target, true);
    },
    [activateCategory, categories],
  );

  // A plain open returns to the last reading position and keeps the search text
  // and its result set. A deep link names a page, so it leaves search to show
  // the page it was asked for; an unknown remembered page falls back to the
  // first category without disturbing the search.
  const openSettingsRequest = useCallback(
    (requested?: string) => {
      if (requested) {
        openCategory(requested);
        return;
      }
      // The ref is newer than the debounced preference write when the dialog is
      // reopened in the same session; the preference covers a fresh launch.
      const remembered = lastScroll.current ?? readSettingsScrollMemory();
      const page = remembered
        ? pageEntries.find((entry) => entry.key === remembered.category)
        : undefined;
      if (remembered && page) {
        activateCategory(page.key);
        if (!query.trim()) {
          requestScroll(page.key, remembered.offset);
        }
        return;
      }
      const fallback =
        categories.find((entry) => !entry.parent)?.key ??
        settingsNavigations().find((entry) => !entry.parent)?.key ??
        "";
      activateCategory(settingsNavigationTarget(fallback), !query.trim());
    },
    [activateCategory, categories, openCategory, pageEntries, query, requestScroll],
  );

  const searching = query.trim().length > 0;
  // The first keystroke matches immediately; later edits run against the
  // deferred text, so the field stays responsive while the catalog settles.
  const activeSearchQuery = searchQuery.trim() ? searchQuery : query;

  // Search results always start at the top of the shared scroller. Without
  // this, typing while a lower category is on screen leaves the viewport in
  // the middle of the result stack, which reads as a broken scroll position.
  useEffect(() => {
    if (!open || !searching) {
      return;
    }
    pendingScroll.current = null;
    panelsRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, searching]);

  // Clearing the search returns to the category that owns the header, rather
  // than leaving the scroller at the top of whichever page happens to be first.
  const changeQuery = useCallback(
    (next: string) => {
      if (query.trim() && !next.trim()) {
        requestScroll(category);
      }
      setQuery(next);
    },
    [category, query, requestScroll],
  );

  // The search matches *rendered* text, so a language switch changes the result
  // for the same query and has to invalidate the memo.
  const matches = useMemo(
    () => new Set(searchSettings(activeSearchQuery).map((field) => field.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `searchSettings` reads the catalog directly, so `language` is the only signal React can see
    [activeSearchQuery, language],
  );

  // The shell asks for a category through a window event, so the top bar and the
  // inspector rail can deep-link into the dialog without threading callbacks.
  // The listener follows the current catalog so an Extension page registered
  // after the first render is still a valid restore target.
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<SettingsRequest>).detail;
      openSettingsRequest(detail?.category);
      setContentMounted(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, listener);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, listener);
  }, [openSettingsRequest]);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(CLOSE_SETTINGS_EVENT, close);
    return () => window.removeEventListener(CLOSE_SETTINGS_EVENT, close);
  }, []);

  /** Whether a field passes its visibility gate and the active search. */
  const shown = (field: Field) => {
    return visibility(field) && (searching ? matches.has(field.key) : true);
  };
  // A category with no schema rows is still a search result when its keywords
  // or its page-owned values match, which is what keeps the skin, backup,
  // extension, help and shortcut pages reachable from the same box as the
  // row-based pages.
  const categoryMatchesSearch = (id: string) => {
    const keywords = settingsPageFor(id)?.keywords;
    return Boolean(
      (keywords && matchesSettingsSearch(t(keywords), activeSearchQuery, CATALOGS.en[keywords])) ||
      settingsPageSearchText(id).some((text) => matchesSettingsSearch(text, activeSearchQuery)),
    );
  };
  /** Whether a page has a matching row or matching search keywords. */
  const categoryHasMatches = (id: string) => {
    const navigationKeys = [id, ...settingsNavigationChildren(id).map((entry) => entry.key)];
    return (
      navigationKeys.some((key) =>
        fields.some((field) => field.navigation === key && matches.has(field.key)),
      ) ||
      (searching && categoryMatchesSearch(id))
    );
  };
  const matchingNavigationKeys = new Set(
    categories.filter((entry) => categoryHasMatches(entry.key)).map((entry) => entry.key),
  );
  for (const entry of categories) {
    if (entry.parent && matchingNavigationKeys.has(entry.key)) {
      matchingNavigationKeys.add(entry.parent);
    }
  }
  /**
   * Whether one page body may mount now. The active page and the current
   * search results never wait behind the idle queue.
   */
  const pageBodyReady = (key: string) =>
    readyPages.has(key) ||
    (!searching && key === category) ||
    (searching && matchingNavigationKeys.has(key));
  /** Whether a visible page still shows a skeleton. */
  const pageContentPending = pageEntries.some(
    (entry) => (!searching || matchingNavigationKeys.has(entry.key)) && !pageBodyReady(entry.key),
  );

  /** Commit one setting value to the shared value store. */
  const commit = (field: Field, value: SettingValue) => {
    const previous =
      field.control === "file" && field.storage === "application-data" && values.byId.has(field.key)
        ? values.byId.get<unknown>(field.key)
        : undefined;
    values.byId.set(field.key, value);
    syncRuntimePortSetting(field.key, value);
    const replaced = replacedApplicationDataReference(previous, value);
    if (replaced && isDesktop()) {
      void deleteCustomBackground(replaced).catch((error: unknown) => {
        console.error("Could not remove the replaced settings image", error);
      });
    }
  };
  const closeSettings = () => setOpen(false);
  const activeCategory = categories.find((entry) => entry.key === category);
  const activePath = activeCategory ? navigationPathFrom(categories, activeCategory.key) : [];
  // The wheel is the other way to move between pages. A page becomes active as
  // its section crosses the top of the scroll area; the title, expanded root,
  // and travelling rail all read the same category state. Alignment runs in the
  // layout pass so a reopened window paints at the remembered offset instead of
  // showing the previous one for a frame.
  useLayoutEffect(() => {
    if (!open || searching) {
      return;
    }
    const requested = pendingScroll.current;
    if (!requested) {
      return;
    }
    let frame = 0;
    let attempts = 0;
    let observer: ResizeObserver | null = null;
    const timers: number[] = [];
    /** Scroll the pending section to its remembered offset. */
    const align = () => {
      const container = panelsRef.current;
      const pending = pendingScroll.current;
      // A hidden dialog has no layout boxes to measure; the frame retry waits
      // for the modal to become visible.
      if (!container || !pending || !container.offsetHeight) {
        return;
      }
      const section = sectionRefs.current.get(pending.key);
      if (!section) {
        if (attempts++ < 4) {
          frame = requestAnimationFrame(align);
        } else {
          pendingScroll.current = null;
        }
        return;
      }
      const sectionTop = settingsSectionOffset(container, section);
      container.scrollTo({ top: sectionTop + pending.offset, behavior: "auto" });
      rememberScroll(pending.key, container.scrollTop - sectionTop);
    };
    /** Abandon the pending scroll and stop watching layout. */
    const cancel = () => {
      if (pendingScroll.current === requested) {
        pendingScroll.current = null;
      }
      observer?.disconnect();
      observer = null;
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
    // Align before the first paint, then retry on the next frame in case the
    // modal became visible after this layout pass.
    align();
    frame = requestAnimationFrame(align);
    // Re-align while asynchronous page content settles so the requested
    // category lands at the target offset.
    const container = panelsRef.current;
    if (container) {
      observer = new ResizeObserver(() => {
        if (pendingScroll.current === requested) {
          align();
        }
      });
      for (const section of sectionRefs.current.values()) {
        observer.observe(section);
      }
    }
    // Page bodies hydrate one idle slice at a time, so sections above the target
    // keep changing height for longer than a settled page would. Keep re-aligning
    // through that window; any wheel, pointer, or key input still cancels it.
    for (const delay of [120, 400, 800, 1400, 2000, 2600]) {
      timers.push(window.setTimeout(align, delay));
    }
    timers.push(window.setTimeout(cancel, 3000));
    window.addEventListener("wheel", cancel, { passive: true, once: true });
    if (container) {
      container.addEventListener("pointerdown", cancel, { capture: true, once: true });
      container.addEventListener("keydown", cancel, { capture: true, once: true });
    }
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("wheel", cancel);
      container?.removeEventListener("pointerdown", cancel, true);
      container?.removeEventListener("keydown", cancel, true);
      if (pendingScroll.current === requested) {
        pendingScroll.current = null;
      }
    };
  }, [open, searching, scrollVersion, rememberScroll]);

  useEffect(() => {
    if (!open || searching) {
      return;
    }
    const container = panelsRef.current;
    if (!container) {
      return;
    }
    let frame = 0;
    /** Derive the active section from the scroll position. */
    const sync = () => {
      frame = 0;
      if (pendingScroll.current) {
        return;
      }
      const sections = [...sectionRefs.current.values()].filter((section) => !section.hidden);
      let activeSection = sections[0];
      const first = activeSection?.dataset.settingsSection;
      if (!activeSection || !first) {
        return;
      }
      let active = first;
      // Use the same layout offset as `align` so the rail switches only once
      // the page has arrived, independent of the dialog transform.
      const threshold = container.scrollTop + 1;
      for (const section of sections) {
        if (settingsSectionOffset(container, section) > threshold) {
          break;
        }
        activeSection = section;
      }
      active = activeSection.dataset.settingsSection ?? active;
      // A short final page may never reach the threshold, so the bottom of the
      // list belongs to it explicitly.
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
        const last = sections.at(-1);
        if (last) {
          activeSection = last;
          active = last.dataset.settingsSection ?? active;
        }
      }
      const sectionTop = settingsSectionOffset(container, activeSection);
      rememberScroll(active, container.scrollTop - sectionTop);
      if (active !== category) {
        activateCategory(active);
      }
    };
    /** Coalesce scroll and resize work into one animation frame. */
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(sync);
      }
    };
    sync();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [open, searching, category, activateCategory, rememberScroll]);

  return (
    <Modal
      open={open}
      onClose={closeSettings}
      onClosed={() => {
        // A native close (Escape or the dialog itself) bypasses `onClose`, and
        // the content may already be unmounted when the exit transition ends.
        setOpen(false);
        setContentMounted(false);
        resetPageHydration();
      }}
      labelledBy={titleId}
      closeButton={false}
      className="redux-settings"
    >
      {contentVisible ? (
        <div className="redux-settings-shell">
          <SettingsNavigation
            open={open}
            categories={categories}
            category={category}
            query={query}
            matchingNavigationKeys={matchingNavigationKeys}
            expandedNavigationKeys={expandedNavigationKeys}
            onToggleNavigation={(key) => {
              setExpandedNavigationKeys((current) => {
                const next = new Set(current);
                if (next.has(key)) {
                  next.delete(key);
                } else {
                  // Opening one root closes the others so the sidebar never grows
                  // past the window.
                  for (const entry of categories) {
                    if (!entry.parent && entry.key !== key) {
                      next.delete(entry.key);
                    }
                  }
                  next.add(key);
                }
                return next;
              });
            }}
            setCategory={openCategory}
            setQuery={changeQuery}
          />
          <div className="redux-settings-body">
            <header className="redux-settings-heading">
              <div>
                <h2 id={titleId}>
                  {searching
                    ? t("settings.search.heading", { query: query.trim() })
                    : activePath.map((entry, index) => (
                        <span key={entry.key} className="redux-settings-breadcrumb-item">
                          {index > 0 && (
                            <span
                              className="redux-settings-breadcrumb-separator"
                              aria-hidden="true"
                            >
                              ›
                            </span>
                          )}
                          {t(entry.label)}
                        </span>
                      ))}
                </h2>
              </div>
              <IconButton icon="close" label={t("settings.action.close")} onClick={closeSettings} />
            </header>

            <div
              className="redux-settings-panels"
              ref={panelsRef}
              data-searching={searching ? "true" : "false"}
              aria-busy={pageContentPending}
            >
              {searching && !pageEntries.some((entry) => matchingNavigationKeys.has(entry.key)) && (
                <EmptyState
                  icon="search"
                  title={t("settings.search.emptyTitle")}
                  description={t("settings.search.emptyDescription")}
                  className="redux-settings-search-empty"
                />
              )}
              {pageEntries.map((entry) => {
                const panelFields = settingsFields(entry.key);
                // Every page names itself once. A page group whose title repeats
                // the navigation label is suppressed by `SettingsFields`, so the
                // page title is the only copy of that name in the content column.
                const page = settingsPageFor(entry.key);
                const pageLabel = t(entry.label);
                const showPageTitle = !page?.hideTitle;
                const visible = searching ? matchingNavigationKeys.has(entry.key) : true;
                const Page = page?.component;
                return (
                  <section
                    key={entry.key}
                    ref={(section) => {
                      if (section) {
                        sectionRefs.current.set(entry.key, section);
                      } else {
                        sectionRefs.current.delete(entry.key);
                      }
                    }}
                    className="redux-settings-panel"
                    data-category={entry.key}
                    data-settings-section={entry.key}
                    data-settings-ready={pageBodyReady(entry.key) ? "true" : "false"}
                    hidden={!visible}
                  >
                    {searching &&
                      visible &&
                      !panelFields.some((field) => matches.has(field.key)) &&
                      Page && (
                        <div className="redux-settings-search-path" data-settings-path>
                          {navigationPathFrom(categories, entry.key).map((pathEntry, index) => (
                            <span key={pathEntry.key} data-settings-path-entry={pathEntry.key}>
                              {index > 0 && <span aria-hidden="true"> › </span>}
                              {t(pathEntry.label)}
                            </span>
                          ))}
                        </div>
                      )}
                    {!searching && showPageTitle && (
                      <h3 className="redux-settings-page-title">{pageLabel}</h3>
                    )}
                    {pageBodyReady(entry.key) ? (
                      <>
                        {panelFields.length > 0 && (
                          <SettingsFields
                            fields={panelFields}
                            shown={shown}
                            onCommitValue={commit}
                            onOpenCategory={openCategory}
                            searching={searching}
                            pageTitle={showPageTitle ? pageLabel : undefined}
                          />
                        )}
                        {Page && (
                          <Page
                            theme={theme}
                            setTheme={setTheme}
                            openCategory={openCategory}
                            active={open && category === entry.key}
                            query={searching ? activeSearchQuery : ""}
                          />
                        )}
                      </>
                    ) : (
                      <SettingsPageSkeleton />
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
