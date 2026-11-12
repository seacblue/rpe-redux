/**
 * The left-hand selected-chart sleeve for the home library, plus the borderless
 * welcome panel shown before a chart is selected.
 *
 * The cover is the visual anchor: it fills a square frame, carries the title
 * and composer on a dark caption, and holds the difficulty badge and preview
 * control. The body below it keeps the useful library metadata and one primary
 * Open action; exporting and deleting stay available as compact icon actions.
 * Without a selected entry the column shows the welcome panel, whose check-in
 * and fortune live in `LibraryWelcome`. Opening, exporting, and deleting stay
 * with the published card actions.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AsyncImage } from "../../../../design/components/image/AsyncImage.tsx";
import { Button } from "../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { LibraryPreviewAudio } from "./libraryPreviewAudio.ts";
import type { LibraryEntry } from "./libraryEntries.ts";
import { formatCount, formatRelativeTime } from "./libraryFormat.ts";
import { LibraryWelcome } from "./LibraryWelcome.tsx";
import { bindBackgroundVolume } from "../../../platform/backgroundVolume.ts";

/** Cover layer that fades in the selected project's artwork over the empty-cover placeholder. */
function DetailCover({ url }: { url: string }) {
  return (
    <div className="redux-library-detail-cover">
      <span className="redux-library-detail-cover-placeholder" aria-hidden="true" />
      {url && (
        <AsyncImage key={url} src={url} alt="" className="redux-library-detail-cover-layer" />
      )}
    </div>
  );
}

/** Open, export, and delete actions for the selected entry. */
function DetailActions({
  entry,
  onOpen,
  onExport,
  onDelete,
}: {
  entry: LibraryEntry;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="redux-library-card-actions">
      <Button
        variant="solid"
        size="lg"
        className="redux-library-card-open"
        onClick={() => onOpen(entry)}
      >
        <Icon name="open" size={16} />
        {t("workspace.welcome.library.open")}
      </Button>
      <IconButton
        icon="export"
        label={t("workspace.welcome.library.export")}
        variant="outlined"
        size={16}
        className="redux-library-card-action"
        onClick={() => onExport(entry)}
      />
      <IconButton
        icon="trash"
        label={t("workspace.welcome.library.delete")}
        variant="danger"
        size={16}
        className="redux-library-card-action"
        onClick={() => onDelete(entry)}
      />
    </div>
  );
}

/** Selected-chart sleeve with cover, metadata, actions, and armed preview audio. */
export function LibraryDetail({
  entry,
  entries,
  loading,
  visible,
  preview,
  onOpen,
  onExport,
  onDelete,
}: {
  entry: LibraryEntry | null;
  /** Every stored entry, for the welcome panel's library totals. */
  entries: readonly LibraryEntry[];
  /** The library's first read is still in flight. */
  loading: boolean;
  /** The home page is the visible surface; leaving it stops the preview. */
  visible: boolean;
  /** Preview audio starts after the user makes an explicit selection. */
  preview: boolean;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t, language } = useTranslation();
  const player = useRef<LibraryPreviewAudio | null>(null);
  const tiltCard = useRef<HTMLElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  /** Maps the pointer inside the untransformed column to a slight card tilt. */
  const tilt = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") {
      return;
    }
    const card = tiltCard.current;
    if (!card) {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    // Keep the response under three degrees; this is a hint of depth, not a
    // full poster tilt. The column is the measuring box, so the card's own
    // transform never feeds back into the pointer coordinates.
    card.style.setProperty("--sleeve-tilt-x", `${(-y * 4).toFixed(2)}deg`);
    card.style.setProperty("--sleeve-tilt-y", `${(x * 6).toFixed(2)}deg`);
  };
  /** Returns the card to its neutral angle when the pointer leaves the column. */
  const settleTilt = () => {
    const card = tiltCard.current;
    if (!card) {
      return;
    }
    card.style.setProperty("--sleeve-tilt-x", "0deg");
    card.style.setProperty("--sleeve-tilt-y", "0deg");
  };
  useEffect(() => {
    const audio = new LibraryPreviewAudio((playing) => setPreviewPlaying(playing));
    player.current = audio;
    const unbind = bindBackgroundVolume((level) => audio.setBackgroundVolume(level));
    return () => {
      unbind();
      player.current = null;
      audio.dispose();
    };
  }, []);
  useEffect(() => {
    player.current?.select(visible && preview ? entry : null);
  }, [entry, preview, visible]);
  if (!entry) {
    return <LibraryWelcome entries={entries} loading={loading} />;
  }
  const project = entry.source.project;
  const group = project.group || t("editor.home.ungrouped");
  const notes = formatCount(project.noteCount, language);
  const updated = formatRelativeTime(project.updatedAt, language);
  return (
    <aside className="redux-library-detail" onPointerMove={tilt} onPointerLeave={settleTilt}>
      <article ref={tiltCard} className="redux-library-card">
        <div className="redux-library-card-media">
          <DetailCover url={entry.cover} />
          <span className="redux-library-detail-scrim" aria-hidden="true" />
          {entry.level && (
            <span
              className="redux-library-detail-level"
              data-tip-title={`${t("workspace.welcome.library.field.level")}: ${entry.level}`}
            >
              {entry.level}
            </span>
          )}
          {entry.audio && (
            <IconButton
              icon={previewPlaying ? "playbackPause" : "playbackPlay"}
              label={t(
                previewPlaying
                  ? "workspace.welcome.library.preview.pause"
                  : "workspace.welcome.library.preview.play",
              )}
              variant="plain"
              size={16}
              active={previewPlaying}
              className="redux-library-detail-preview"
              onClick={() => {
                if (previewPlaying) {
                  player.current?.suspend();
                } else {
                  player.current?.select(entry);
                }
              }}
            />
          )}
          <div className="redux-library-detail-caption" key={entry.key}>
            <h2 className="redux-library-detail-title">{entry.title}</h2>
            <p className="redux-library-detail-composer">{entry.composer || "—"}</p>
          </div>
        </div>
        <div className="redux-library-card-body">
          <dl className="redux-library-card-meta" key={entry.key}>
            <div>
              <dt>{t("workspace.welcome.library.field.charter")}</dt>
              <dd>{entry.charter || "—"}</dd>
            </div>
            <div>
              <dt>{t("workspace.welcome.library.field.notes")}</dt>
              <dd>{notes}</dd>
            </div>
            <div>
              <dt>{t("editor.home.field.groupLabel")}</dt>
              <dd>{group}</dd>
            </div>
            <div>
              <dt>{t("workspace.welcome.library.field.updated")}</dt>
              <dd>{updated}</dd>
            </div>
          </dl>
          <DetailActions entry={entry} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
        </div>
      </article>
    </aside>
  );
}
