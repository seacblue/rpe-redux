/**
 * The home library's rows and tiles.
 *
 * Entries carry the title, composer, and difficulty for the carousel; the
 * selected entry's remaining metadata lives in the detail pane. A click selects
 * only: opening is the detail pane's own Open button, so a stray click on a card
 * never replaces the chart being edited.
 */
import { t } from "../../../../i18n/index.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { AsyncImage } from "../../../../design/components/image/AsyncImage.tsx";
import type { LibraryView } from "../libraryView.ts";
import type { LibraryEntry } from "./libraryEntries.ts";
import { ProjectDialogs } from "./ProjectDialogs.tsx";

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

/** Props for the library card list. */
export interface LibraryCardsProps {
  entries: readonly LibraryEntry[];
  selectedKey: string | null;
  view: LibraryView;
  onActivate(entry: LibraryEntry): void;
}

/** Renders library entries as rows or tiles. */
export function LibraryCards({
  entries,
  selectedKey,
  view,
  onActivate,
}: LibraryCardsProps): React.JSX.Element {
  return (
    <>
      <div className="redux-library-cards" data-view={view}>
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const project = entry.source.project;
          return (
            <Button
              type="button"
              variant="plain"
              className="project-card"
              data-selected={selected}
              data-project-id={project.id}
              key={entry.key}
              aria-current={selected ? "true" : undefined}
              onClick={() => onActivate(entry)}
            >
              <span className="project-information">
                <CardCover key={`${entry.key}:${entry.cover}`} url={entry.cover} />
                <span className="project-copy">
                  <span className="project-title">{entry.title}</span>
                  <span className="project-composer">{entry.composer}</span>
                </span>
                {entry.level && (
                  <span
                    className="project-level"
                    data-tip-title={`${t("workspace.welcome.library.field.level")}: ${entry.level}`}
                  >
                    {entry.level}
                  </span>
                )}
              </span>
            </Button>
          );
        })}
      </div>
      <ProjectDialogs />
    </>
  );
}
