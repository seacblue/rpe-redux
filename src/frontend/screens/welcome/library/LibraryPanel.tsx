/**
 * The chart library section of the home screen.
 *
 * It owns the local query and presentation mode, renders the search and view
 * controls, and asks the welcome page to select or open an entry. The selection
 * itself lives one level up because the detail pane is its sibling.
 */
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LibrarySortField } from "../../../../core/global/library/client.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { EmptyState } from "../../../../design/components/empty-state/EmptyState.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { SearchField } from "../../../../design/components/input/SearchField.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Segmented } from "../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../design/components/select/Select.tsx";
import { LibraryActions } from "./LibraryActions.tsx";
import { LibraryCards } from "./LibraryCards.tsx";
import { getHomeProjectCardsSnapshot, subscribeHomeProjectCards } from "../homeProjectCards.ts";
import { getLibraryView, setLibraryView, type LibraryView } from "../libraryView.ts";
import { getLibrarySort, type LibrarySort } from "../librarySort.ts";
import {
  buildLibraryEntries,
  matchesLibraryGroups,
  matchesLibraryQuery,
  type LibraryEntry,
} from "./libraryEntries.ts";
import { registerLibraryShortcuts } from "./libraryShortcuts.ts";
import {
  createLibraryNavigationScheduler,
  type LibraryNavigationState,
} from "./libraryNavigation.ts";
import { useAnchoredPopover } from "../../../../design/patterns/useAnchoredPopover.ts";
import { getLibraryGroupFilter, setLibraryGroupFilter } from "../libraryGroupFilter.ts";

/**
 * Placeholder counts for the first library read. They cover the card region of
 * a typical window in either view; a shorter window clips the extra rows so
 * the skeleton itself never grows a scrollbar.
 */
const LIBRARY_SKELETON_ROWS = 20;
/** Wider tiles leave fewer rows visible; extra tiles fill a tall grid view. */
const LIBRARY_SKELETON_TILES = 30;
const EMPTY_GROUPS: ReadonlySet<string> = new Set();

/** Placeholder rows shown while the first library page is read. */
function LibrarySkeleton({ view }: { view: LibraryView }) {
  const count = view === "grid" ? LIBRARY_SKELETON_TILES : LIBRARY_SKELETON_ROWS;
  return (
    <div className="redux-library-cards" data-view={view} data-skeleton="true" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span className="project-card is-skeleton" key={index}>
          <span className="project-information">
            <span className="project-cover-frame" />
            <span className="project-copy">
              <span className="project-title-skeleton" />
              <span className="project-composer-skeleton" />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** Library section: search, sort, view switch, cards, and empty states. */
export function LibraryPanel({
  selectedKey,
  onSelect,
}: {
  selectedKey: string | null;
  onSelect(key: string, preview: boolean): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LibraryView>(getLibraryView);
  const [sort, setSortState] = useState<LibrarySort>(getLibrarySort);
  const [selectedGroups, setSelectedGroups] = useState<ReadonlySet<string> | null>(() => {
    const saved = getLibraryGroupFilter();
    return saved === null ? null : new Set(saved);
  });
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);
  const cards = useSyncExternalStore(
    subscribeHomeProjectCards,
    getHomeProjectCardsSnapshot,
    getHomeProjectCardsSnapshot,
  );
  const entries = useMemo(() => buildLibraryEntries(cards), [cards]);
  const needle = query.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          matchesLibraryGroups(entry, selectedGroups ?? EMPTY_GROUPS) &&
          matchesLibraryQuery(entry, needle),
      ),
    [entries, needle, selectedGroups],
  );
  const groupOptions = useMemo(() => {
    const values = new Set(entries.map((entry) => entry.source.project.group));
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [entries]);
  const allGroups = useMemo(() => new Set(groupOptions), [groupOptions]);
  const effectiveSelectedGroups = selectedGroups ?? allGroups;
  const groupFilterActive = groupOptions.some((group) => !effectiveSelectedGroups.has(group));
  const groupFilterAnchor = useRef<HTMLButtonElement>(null);
  const [groupFilterHost, setGroupFilterHost] = useState<HTMLElement | null>(null);
  const attachGroupFilterAnchor = useCallback((node: HTMLButtonElement | null) => {
    groupFilterAnchor.current = node;
    setGroupFilterHost(node?.closest(".redux-app-root") ?? null);
    if (!node) {
      setGroupFilterOpen((open) => (open ? false : open));
    }
  }, []);
  const groupFilterPanel = useRef<HTMLElement>(null);
  const groupFilterPopover = useAnchoredPopover({
    open: groupFilterOpen,
    anchor: groupFilterAnchor,
    panel: groupFilterPanel,
    onClose: () => setGroupFilterOpen(false),
    align: "end",
    gap: 6,
    maxHeight: 480,
  });
  // Q/E walk the rows the search currently shows. The registry registration is
  // stable, so the handler reads the latest list and selection from a ref that
  // commits after each render instead of re-registering (and resetting a
  // user's custom key) on every change.
  const navigate = useRef<LibraryNavigationState>({
    entries: [],
    selectedKey: null,
    select: () => undefined,
  });
  const navigationScheduler = useRef<ReturnType<typeof createLibraryNavigationScheduler> | null>(
    null,
  );
  /** Publishes any selection to the navigation cursor immediately. */
  const selectKey = useCallback(
    (key: string, preview: boolean) => {
      const nextKey = preview && navigate.current.selectedKey === key ? null : key;
      navigationScheduler.current?.sync(nextKey);
      navigate.current.selectedKey = nextKey;
      onSelect(key, preview);
    },
    [onSelect],
  );
  const selectEntry = useCallback(
    (entry: LibraryEntry, preview: boolean) => selectKey(entry.key, preview),
    [selectKey],
  );
  useLayoutEffect(() => {
    navigate.current = { entries: visibleEntries, selectedKey, select: selectKey };
  }, [selectedKey, selectKey, visibleEntries]);
  useEffect(() => {
    const scheduler = createLibraryNavigationScheduler(
      () => navigate.current,
      (callback) => window.requestAnimationFrame(callback),
      (frame) => window.cancelAnimationFrame(frame),
    );
    navigationScheduler.current = scheduler;
    return () => {
      scheduler.dispose();
      navigationScheduler.current = null;
    };
  }, []);
  useEffect(
    () =>
      registerLibraryShortcuts({
        previous: () => navigationScheduler.current?.move(-1),
        next: () => navigationScheduler.current?.move(1),
      }),
    [],
  );
  useEffect(() => {
    if (selectedGroups !== null) {
      setLibraryGroupFilter([...selectedGroups]);
    }
  }, [selectedGroups]);
  // The empty state owns the creation actions, so the footer does not repeat
  // them underneath. A ready empty library is the only state that moves them.
  const libraryEmpty =
    cards !== null &&
    (cards.phase === "ready" || cards.phase === "degraded") &&
    entries.length === 0 &&
    !needle;
  /** Applies and persists a new presentation mode. */
  const chooseView = (next: LibraryView) => {
    setView(next);
    setLibraryView(next);
  };
  /** Applies a sort locally and asks the service to reload in that order. */
  const chooseSort = (next: LibrarySort) => {
    setSortState(next);
    cards?.onSort(next);
  };
  /** Toggles one stored group without closing the multi-select popover. */
  const toggleGroup = (group: string) => {
    setSelectedGroups((previous) => {
      const next = new Set(previous ?? groupOptions);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };
  const openEntry = useCallback(
    (entry: LibraryEntry) => cards?.onOpenProject(entry.source.project.id),
    [cards],
  );
  const exportEntry = useCallback(
    (entry: LibraryEntry) => cards?.onExportProject(entry.source.project.id),
    [cards],
  );
  const renameEntry = useCallback(
    (entry: LibraryEntry) => cards?.onRenameProject(entry.source.project),
    [cards],
  );
  const editGroupEntry = useCallback(
    (entry: LibraryEntry, groups: readonly string[]) =>
      cards?.onEditGroup(entry.source.project, groups),
    [cards],
  );
  const deleteEntry = useCallback(
    (entry: LibraryEntry) => cards?.onDelete(entry.source.project),
    [cards],
  );
  // Each option names both the field and the direction, so the control never
  // leaves the user guessing what its arrow means.
  const newest = t("workspace.welcome.library.sort.newest");
  const oldest = t("workspace.welcome.library.sort.oldest");
  const ascending = t("workspace.welcome.library.sort.az");
  const descending = t("workspace.welcome.library.sort.za");
  const sortOptions = [
    ["updated:desc", `${t("workspace.welcome.library.sort.updated")}, ${newest}`],
    ["updated:asc", `${t("workspace.welcome.library.sort.updated")}, ${oldest}`],
    ["created:desc", `${t("workspace.welcome.library.sort.created")}, ${newest}`],
    ["created:asc", `${t("workspace.welcome.library.sort.created")}, ${oldest}`],
    ["name:asc", `${t("workspace.welcome.library.sort.name")}, ${ascending}`],
    ["name:desc", `${t("workspace.welcome.library.sort.name")}, ${descending}`],
    ["composer:asc", `${t("workspace.welcome.library.sort.composer")}, ${ascending}`],
    ["composer:desc", `${t("workspace.welcome.library.sort.composer")}, ${descending}`],
    ["charter:asc", `${t("workspace.welcome.library.sort.charter")}, ${ascending}`],
    ["charter:desc", `${t("workspace.welcome.library.sort.charter")}, ${descending}`],
  ] as const;
  const groupFilterPanelView = (
    <section
      ref={groupFilterPanel}
      className={`redux-library-group-filter-popover${groupFilterOpen ? " is-open" : ""}`}
      role="dialog"
      aria-label={t("workspace.welcome.library.filter.label")}
      aria-hidden={!groupFilterOpen}
      inert={!groupFilterOpen}
      data-placement={groupFilterPopover.side}
      style={groupFilterPopover.style}
    >
      <div className="redux-library-group-filter-list">
        {groupOptions.length === 0 ? (
          <span className="redux-library-group-filter-empty">
            {t("workspace.welcome.library.filter.empty")}
          </span>
        ) : (
          groupOptions.map((group) => {
            const label = group;
            const id = `library-group-filter-${group}`;
            return (
              <label className="redux-library-group-filter-row" htmlFor={id} key={group}>
                <span className="redux-library-group-filter-label">{label}</span>
                <Input
                  id={id}
                  type="checkbox"
                  checked={effectiveSelectedGroups.has(group)}
                  aria-label={label}
                  onChange={() => toggleGroup(group)}
                />
              </label>
            );
          })
        )}
      </div>
    </section>
  );
  return (
    <section className="redux-welcome-library">
      <div className="redux-library-toolbar">
        <SearchField
          className="redux-library-search"
          value={query}
          onChange={setQuery}
          label={t("workspace.welcome.search.placeholder")}
          placeholder={t("workspace.welcome.search.placeholder")}
          clearLabel={t("common.action.clearSearch")}
        />
        <div className="redux-library-toolbar-actions">
          <Select
            className="redux-library-sort-select"
            aria-label={t("workspace.welcome.library.sort.label")}
            value={`${sort.field}:${sort.direction}`}
            disabled={!cards}
            onChange={(event) => {
              const [field, direction] = event.currentTarget.value.split(":");
              chooseSort({
                field: field as LibrarySortField,
                direction: direction === "asc" ? "asc" : "desc",
              });
            }}
          >
            {sortOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="redux-library-group-filter">
            <IconButton
              ref={attachGroupFilterAnchor}
              icon="filter"
              size="md"
              label={t("workspace.welcome.library.filter.label")}
              active={groupFilterOpen || groupFilterActive}
              aria-haspopup="dialog"
              aria-expanded={groupFilterOpen}
              onClick={() => setGroupFilterOpen((open) => !open)}
            />
            {groupFilterHost && createPortal(groupFilterPanelView, groupFilterHost)}
          </div>
          <Segmented
            className="redux-library-view-switch"
            ariaLabel={t("workspace.welcome.library.view.label")}
            value={view}
            options={[
              {
                value: "list",
                label: <Icon name="list" size={16} />,
                ariaLabel: t("workspace.welcome.library.view.list"),
                title: t("workspace.welcome.library.view.list"),
              },
              {
                value: "grid",
                label: <Icon name="grid" size={16} />,
                ariaLabel: t("workspace.welcome.library.view.grid"),
                title: t("workspace.welcome.library.view.grid"),
              },
            ]}
            onChange={chooseView}
          />
        </div>
      </div>
      {cards?.phase === "loading" && !entries.length && <LibrarySkeleton view={view} />}
      {cards?.stale && cards.error && !needle && (
        <p className="hint redux-library-stale" role="status">
          {t("workspace.welcome.library.stale", { message: cards.error })}
        </p>
      )}
      {cards && cards.phase === "failed" && (
        <div className="redux-library-empty" role="alert">
          <span className="redux-library-empty-icon" aria-hidden="true">
            <Icon name="folder" size={28} />
          </span>
          <strong>{t("workspace.welcome.library.unavailable")}</strong>
          <span className="redux-library-empty-copy">{cards.error}</span>
          <Button variant="outlined" onClick={cards.onRetry}>
            {t("workspace.welcome.library.retry")}
          </Button>
        </div>
      )}
      {cards && (
        <LibraryCards
          entries={entries}
          query={needle}
          groups={effectiveSelectedGroups}
          loaded={cards.phase === "ready" || cards.phase === "degraded"}
          selectedKey={selectedKey}
          view={view}
          removingProjectId={cards.removingProjectId}
          onSelect={selectEntry}
          onOpen={openEntry}
          onExport={exportEntry}
          onRename={renameEntry}
          onEditGroup={editGroupEntry}
          onDelete={deleteEntry}
        />
      )}
      {libraryEmpty && (
        <div className="redux-library-empty">
          <span className="redux-library-empty-icon" aria-hidden="true">
            <Icon name="folder" size={28} />
          </span>
          <strong>{t("workspace.welcome.library.empty")}</strong>
          <span className="redux-library-empty-copy">
            {t("workspace.welcome.library.emptyDescription")}
          </span>
        </div>
      )}
      {needle && !visibleEntries.length && (
        <EmptyState
          variant="inline"
          title={t("workspace.welcome.search.empty")}
          className="redux-library-search-empty"
        />
      )}
      <LibraryActions />
    </section>
  );
}
