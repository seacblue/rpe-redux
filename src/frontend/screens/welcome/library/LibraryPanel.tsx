/**
 * The chart library section of the home screen.
 *
 * It owns the local query and presentation mode, renders the search and view
 * controls, and asks the welcome page to select or open an entry. The selection
 * itself lives one level up because the detail pane is its sibling.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { LibrarySortField } from "../../../../core/global/library/client.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { EmptyState } from "../../../../design/components/empty-state/EmptyState.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { SearchField } from "../../../../design/components/input/SearchField.tsx";
import { Segmented } from "../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../design/components/select/Select.tsx";
import { LibraryActions } from "./LibraryActions.tsx";
import { LibraryCards } from "./LibraryCards.tsx";
import { getHomeProjectCardsSnapshot, subscribeHomeProjectCards } from "../homeProjectCards.ts";
import { getLibraryView, setLibraryView, type LibraryView } from "../libraryView.ts";
import { getLibrarySort, type LibrarySort } from "../librarySort.ts";
import { buildLibraryEntries, matchesLibraryQuery } from "./libraryEntries.ts";

/** Placeholder rows shown while the first library page is read. */
function LibrarySkeleton({ view }: { view: LibraryView }) {
  return (
    <div className="redux-library-cards" data-view={view} data-skeleton="true" aria-hidden="true">
      {Array.from({ length: view === "grid" ? 6 : 5 }, (_, index) => (
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
  onSelect(key: string): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LibraryView>(getLibraryView);
  const [sort, setSortState] = useState<LibrarySort>(getLibrarySort);
  const cards = useSyncExternalStore(
    subscribeHomeProjectCards,
    getHomeProjectCardsSnapshot,
    getHomeProjectCardsSnapshot,
  );
  const entries = useMemo(() => buildLibraryEntries(cards), [cards]);
  const needle = query.trim().toLocaleLowerCase();
  const visibleEntries = entries.filter((entry) => matchesLibraryQuery(entry, needle));
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
  // Each option names both the field and the direction, so the control never
  // leaves the user guessing what its arrow means.
  const newest = t("workspace.welcome.library.sort.newest");
  const oldest = t("workspace.welcome.library.sort.oldest");
  const ascending = t("workspace.welcome.library.sort.az");
  const descending = t("workspace.welcome.library.sort.za");
  const sortOptions = [
    ["updated:desc", `${t("workspace.welcome.library.sort.updated")} · ${newest}`],
    ["updated:asc", `${t("workspace.welcome.library.sort.updated")} · ${oldest}`],
    ["created:desc", `${t("workspace.welcome.library.sort.created")} · ${newest}`],
    ["created:asc", `${t("workspace.welcome.library.sort.created")} · ${oldest}`],
    ["name:asc", `${t("workspace.welcome.library.sort.name")} · ${ascending}`],
    ["name:desc", `${t("workspace.welcome.library.sort.name")} · ${descending}`],
    ["composer:asc", `${t("workspace.welcome.library.sort.composer")} · ${ascending}`],
    ["composer:desc", `${t("workspace.welcome.library.sort.composer")} · ${descending}`],
    ["charter:asc", `${t("workspace.welcome.library.sort.charter")} · ${ascending}`],
    ["charter:desc", `${t("workspace.welcome.library.sort.charter")} · ${descending}`],
  ] as const;
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
          entries={visibleEntries}
          selectedKey={selectedKey}
          view={view}
          onActivate={(entry) => onSelect(entry.key)}
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
          <LibraryActions />
        </div>
      )}
      {needle && !visibleEntries.length && (
        <EmptyState
          variant="inline"
          title={t("workspace.welcome.search.empty")}
          className="redux-library-search-empty"
        />
      )}
      {!libraryEmpty && <LibraryActions />}
    </section>
  );
}
