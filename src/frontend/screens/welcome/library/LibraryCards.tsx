/**
 * The home library's rows and tiles.
 *
 * Entries carry the title, composer, and difficulty for the carousel; the
 * selected entry's remaining metadata lives in the detail pane. A click selects
 * only: opening is the detail pane's own Open button, so a stray click on a card
 * never replaces the chart being edited.
 *
 * The card also owns the right-click menu and the two transient card states:
 * the "new" marker for a just-imported chart, and the skeleton that stands in
 * while a confirmed delete is in flight.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "../../../../i18n/react.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { AsyncImage } from "../../../../design/components/image/AsyncImage.tsx";
import { usePresenceList } from "../../../../design/patterns/usePresenceList.ts";
import type { LibraryView } from "../libraryView.ts";
import { matchesLibraryQuery, type LibraryEntry } from "./libraryEntries.ts";
import { ProjectDialogs } from "./ProjectDialogs.tsx";
import {
  ContextMenuPopup,
  createContextMenuState,
  type ContextMenuAction,
  type ContextMenuSnapshot,
} from "../../../overlays/contextMenu/ContextMenuPopup.tsx";
import { ContextMenuRows } from "../../../overlays/contextMenu/ContextMenuRows.tsx";

/** Stable key for the presence list; defined once so the hook's effect is stable. */
const entryKey = (entry: LibraryEntry): string => entry.key;

/** How long a newly imported chart keeps its marker. */
const NEW_ENTRY_MARKER_MS = 2800;

/** Cover image that lets the shared decode handshake choose the placeholder. */
function CardCover({ url }: { url: string }) {
  return (
    <span className="project-cover-frame" aria-hidden="true">
      <AsyncImage
        src={url}
        alt=""
        className="project-cover"
        fallback={<span className="project-cover-placeholder" />}
      />
    </span>
  );
}

/** Placeholder anatomy shared by the first-read skeleton and a pending delete. */
function CardSkeleton() {
  return (
    <span className="project-information">
      <span className="project-cover-frame" />
      <span className="project-copy">
        <span className="project-title-skeleton" />
        <span className="project-composer-skeleton" />
      </span>
    </span>
  );
}

/**
 * Track keys that appeared after the library's first settled read.
 *
 * The first non-empty list is the library's existing content, not a burst of
 * new charts, so it never animates or carries a marker. A key that shows up
 * later is an import or a new document.
 */
function useNewEntryKeys(entries: readonly LibraryEntry[], loaded: boolean): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const timers = useRef(new Map<string, number>());
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(() => new Set());

  useLayoutEffect(() => {
    if (seen.current === null && !(loaded || entries.length > 0)) {
      return;
    }
    const keys = new Set(entries.map(entryKey));
    if (seen.current === null) {
      seen.current = keys;
      return;
    }
    const added = [...keys].filter((key) => !seen.current?.has(key));
    seen.current = keys;
    if (!added.length) {
      return;
    }
    setNewKeys((previous) => {
      const next = new Set(previous);
      for (const key of added) {
        next.add(key);
      }
      return next;
    });
    for (const key of added) {
      const timer = timers.current.get(key);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      timers.current.set(
        key,
        window.setTimeout(() => {
          timers.current.delete(key);
          setNewKeys((previous) => {
            if (!previous.has(key)) {
              return previous;
            }
            const next = new Set(previous);
            next.delete(key);
            return next;
          });
        }, NEW_ENTRY_MARKER_MS),
      );
    }
  }, [entries, loaded]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) {
        window.clearTimeout(timer);
      }
      activeTimers.clear();
    };
  }, []);

  return newKeys;
}

/** Props for the library card list. */
export interface LibraryCardsProps {
  /** Every stored entry, before the search filter narrows the visible rows. */
  entries: readonly LibraryEntry[];
  /** Lower-cased search text; filtering never plays the removal animation. */
  query: string;
  /** The library has finished its first read, so the first list is not "new". */
  loaded: boolean;
  selectedKey: string | null;
  view: LibraryView;
  /** Project id whose delete request is in flight. */
  removingProjectId: string | null;
  onSelect(entry: LibraryEntry, preview: boolean): void;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onRename(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}

/** Renders library entries as rows or tiles. */
export function LibraryCards({
  entries,
  query,
  loaded,
  selectedKey,
  view,
  removingProjectId,
  onSelect,
  onOpen,
  onExport,
  onRename,
  onDelete,
}: LibraryCardsProps): React.JSX.Element {
  const { t: translate } = useTranslation();
  const presence = usePresenceList(entries, entryKey);
  const newKeys = useNewEntryKeys(entries, loaded);
  const container = useRef<HTMLDivElement>(null);
  const menu = useMemo(() => createContextMenuState<ContextMenuSnapshot>(), []);
  const removingKey = removingProjectId ? `project:${removingProjectId}` : null;
  const visible = presence.items.filter((entry) => matchesLibraryQuery(entry, query));

  // Keyboard navigation can move the selection beyond the scroll viewport; a
  // card that is already visible must not move the list under the pointer.
  useEffect(() => {
    if (!selectedKey) {
      return;
    }
    const node = [
      ...(container.current?.querySelectorAll<HTMLElement>("[data-entry-key]") ?? []),
    ].find((element) => element.dataset.entryKey === selectedKey);
    node?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  /** Opens the card menu at the pointer and selects the chart it belongs to. */
  const openMenu = (event: MouseEvent<HTMLButtonElement>, entry: LibraryEntry) => {
    event.preventDefault();
    onSelect(entry, false);
    const actions: ContextMenuAction[] = [
      {
        id: "library.open",
        label: translate("workspace.welcome.library.open"),
        icon: "open",
        run: () => onOpen(entry),
      },
      {
        id: "library.export",
        label: translate("workspace.welcome.library.export"),
        icon: "export",
        run: () => onExport(entry),
      },
      {
        id: "library.rename",
        label: translate("workspace.welcome.library.rename"),
        icon: "pencil",
        run: () => onRename(entry),
      },
      {
        id: "library.delete",
        label: translate("workspace.welcome.library.delete"),
        icon: "trash",
        danger: true,
        run: () => onDelete(entry),
      },
    ];
    menu.set({
      owner: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      align: "start",
      actions,
    });
  };

  return (
    <>
      <div className="redux-library-cards" data-view={view} ref={container}>
        {visible.map((entry) => {
          const selected = entry.key === selectedKey;
          const leaving = presence.leaving.has(entry.key);
          const skeleton = entry.key === removingKey || leaving;
          const entering = !skeleton && newKeys.has(entry.key);
          return (
            <Button
              type="button"
              variant="plain"
              className={`project-card${skeleton ? " is-skeleton" : ""}`}
              data-selected={selected && !skeleton}
              data-entering={entering ? "true" : undefined}
              data-leaving={leaving ? "true" : undefined}
              data-entry-key={entry.key}
              data-project-id={entry.source.project.id}
              disabled={skeleton}
              aria-busy={skeleton || undefined}
              key={entry.key}
              aria-current={selected && !skeleton ? "true" : undefined}
              onClick={() => onSelect(entry, true)}
              onContextMenu={(event) => {
                if (!skeleton) {
                  openMenu(event, entry);
                }
              }}
            >
              {skeleton ? (
                <CardSkeleton />
              ) : (
                <span className="project-information">
                  <CardCover key={`${entry.key}:${entry.cover}`} url={entry.cover} />
                  <span className="project-copy">
                    <span className="project-title">{entry.title}</span>
                    <span className="project-composer">{entry.composer}</span>
                  </span>
                  {entry.level && (
                    <span
                      className="project-level"
                      data-tip-title={`${translate("workspace.welcome.library.field.level")}: ${entry.level}`}
                    >
                      {entry.level}
                    </span>
                  )}
                  {entering && (
                    <span className="project-new">
                      {translate("workspace.welcome.library.new")}
                    </span>
                  )}
                </span>
              )}
            </Button>
          );
        })}
      </div>
      <ContextMenuPopup
        store={menu}
        label={translate("workspace.welcome.library.cardMenu")}
        className="redux-library-card-menu"
      >
        {(snapshot, close) => <ContextMenuRows actions={snapshot.actions} close={close} />}
      </ContextMenuPopup>
      <ProjectDialogs />
    </>
  );
}
