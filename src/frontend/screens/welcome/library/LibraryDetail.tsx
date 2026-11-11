/**
 * The left-hand selected-chart card for the home library, plus the placeholder
 * shown before a chart is selected.
 *
 * The card floats above a neutral page with a soft 3D tilt and a matte 16:9
 * cover. Its body carries the title, composer, charter and difficulty, plus the
 * three selection actions. Without a selected entry the column keeps the same
 * card shape and action row, but the cover and the four fields become neutral
 * rule lines instead of fabricated metadata. It owns the cover fade and the
 * audio preview; opening, exporting, and deleting stay with the published card
 * actions.
 */
import { useEffect, useRef } from "react";
import { AsyncImage } from "../../../../design/components/image/AsyncImage.tsx";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { LibraryPreviewAudio } from "./libraryPreviewAudio.ts";
import type { LibraryEntry } from "./libraryEntries.ts";
import { canOperateOnLibraryEntry } from "./libraryDetailState.ts";
import { bindBackgroundVolume } from "../../../platform/backgroundVolume.ts";

/** Cover layer that fades in the selected project's artwork. */
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
  entry: LibraryEntry | null;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t } = useTranslation();
  const actionable = canOperateOnLibraryEntry(entry);
  return (
    <div className="redux-library-card-actions">
      <Button
        variant="outlined"
        size="lg"
        block
        disabled={!actionable}
        aria-disabled={!actionable}
        onClick={() => {
          if (actionable) {
            onExport(entry);
          }
        }}
      >
        <Icon name="export" size={16} />
        {t("workspace.welcome.library.export")}
      </Button>
      <Button
        variant="danger"
        size="lg"
        block
        disabled={!actionable}
        aria-disabled={!actionable}
        onClick={() => {
          if (actionable) {
            onDelete(entry);
          }
        }}
      >
        <Icon name="trash" size={16} />
        {t("workspace.welcome.library.delete")}
      </Button>
      <Button
        variant="solid"
        size="lg"
        block
        disabled={!actionable}
        aria-disabled={!actionable}
        onClick={() => {
          if (actionable) {
            onOpen(entry);
          }
        }}
      >
        <Icon name="open" size={16} />
        {t("workspace.welcome.library.open")}
      </Button>
    </div>
  );
}

/** Empty card shown while the library has charts but none is selected. */
function DetailPrompt({
  onOpen,
  onExport,
  onDelete,
}: {
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      className="redux-library-detail redux-library-detail-placeholder"
      aria-label={t("workspace.welcome.library.detail.select")}
    >
      <article className="redux-library-card redux-library-card-placeholder" aria-hidden="true">
        <div className="redux-library-card-media redux-library-placeholder-media">
          <span className="redux-image-skeleton is-plain" aria-hidden="true" />
        </div>
        <div className="redux-library-card-body">
          <span className="redux-library-placeholder-title">
            <span className="redux-library-placeholder-line is-title" />
          </span>
          <span className="redux-library-placeholder-composer">
            <span className="redux-library-placeholder-line is-composer" />
          </span>
          <div className="redux-library-placeholder-meta">
            <span className="redux-library-placeholder-meta-row">
              <span className="redux-library-placeholder-line is-charter" />
            </span>
            <span className="redux-library-placeholder-meta-row">
              <span className="redux-library-placeholder-line is-level" />
            </span>
          </div>
          <DetailActions entry={null} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
        </div>
      </article>
    </aside>
  );
}

/** Selected-chart card with cover, metadata, actions, and armed preview audio. */
export function LibraryDetail({
  entry,
  visible,
  preview,
  onOpen,
  onExport,
  onDelete,
}: {
  entry: LibraryEntry | null;
  /** The home page is the visible surface; leaving it stops the preview. */
  visible: boolean;
  /** Preview audio starts after the user makes an explicit selection. */
  preview: boolean;
  onOpen(entry: LibraryEntry): void;
  onExport(entry: LibraryEntry): void;
  onDelete(entry: LibraryEntry): void;
}) {
  const { t } = useTranslation();
  const player = useRef<LibraryPreviewAudio | null>(null);
  useEffect(() => {
    const audio = new LibraryPreviewAudio(() => undefined);
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
    return <DetailPrompt onOpen={onOpen} onExport={onExport} onDelete={onDelete} />;
  }
  return (
    <aside className="redux-library-detail">
      <article className="redux-library-card">
        <div className="redux-library-card-media">
          <DetailCover url={entry.cover} />
        </div>
        <div className="redux-library-card-body">
          <div className="redux-library-card-summary" key={entry.key}>
            <h2 className="redux-library-card-title">{entry.title}</h2>
            <p className="redux-library-card-composer">{entry.composer || "—"}</p>
            <dl className="redux-library-card-meta">
              <div>
                <dt>{t("workspace.welcome.library.field.charter")}</dt>
                <dd>{entry.charter || "—"}</dd>
              </div>
              <div>
                <dt>{t("workspace.welcome.library.field.level")}</dt>
                <dd>{entry.level || "—"}</dd>
              </div>
            </dl>
          </div>
          <DetailActions entry={entry} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
        </div>
      </article>
    </aside>
  );
}
