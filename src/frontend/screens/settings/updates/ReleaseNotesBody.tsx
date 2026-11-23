/**
 * The rendered body of one release's notes.
 *
 * The text is the published release body, already narrowed to the interface
 * language by the caller. Lines shaped like `**Section**` become headings and
 * `- ` lines become list items; anything else renders as a paragraph. Inline
 * spans come from `parseReleaseNoteInline`: plain runs stay text, backticks
 * become code, `@name` becomes a bold underlined credit, and color runs become
 * theme-coloured spans. Fenced code blocks render as literal preformatted text.
 */
import { openExternalUrl } from "../../../../core/platform/desktop/openExternal.ts";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { parseReleaseNoteBlocks, type ReleaseNoteInline } from "./releaseNotes.ts";

/** Render one parsed inline run, recursing into colour spans. */
function ReleaseNoteSpans({
  content,
}: {
  content: readonly ReleaseNoteInline[];
}): React.JSX.Element {
  return (
    <>
      {content.map((span, index) => {
        if (span.kind === "mention") {
          return (
            <strong key={index} className="redux-release-note-mention">
              @{span.name}
            </strong>
          );
        }
        if (span.kind === "code") {
          return (
            <code key={index} className="redux-release-note-inline-code">
              {span.text}
            </code>
          );
        }
        if (span.kind === "color") {
          return (
            <span key={index} className={`redux-release-note-color-${span.color}`}>
              <ReleaseNoteSpans content={span.content} />
            </span>
          );
        }
        return span.text;
      })}
    </>
  );
}

/** Release-note text as headings, bullet lists, and paragraphs. */
export function ReleaseNotesBody({ notes, sourceUrl }: { notes: string; sourceUrl?: string }) {
  const { t } = useTranslation();
  const blocks = parseReleaseNoteBlocks(notes);
  const openSource = () => {
    if (!sourceUrl) {
      return;
    }
    void openExternalUrl(sourceUrl).catch((reason: unknown) => {
      showToast({
        message: t("settings.action.openLinkFailed", {
          message: reason instanceof Error ? reason.message : String(reason),
        }),
        level: "error",
        source: t("settings.updates.releaseLink"),
      });
    });
  };
  return (
    <div className="redux-release-notes">
      {sourceUrl ? (
        <p className="redux-release-note-source">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openSource();
            }}
          >
            {t("settings.updates.releaseLink")}
          </a>
        </p>
      ) : null}
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h4 key={index}>
              <ReleaseNoteSpans content={block.content} />
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <ReleaseNoteSpans content={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={index} className="redux-release-note-code-block">
              <code>{block.content}</code>
            </pre>
          );
        }
        return (
          <p key={index}>
            <ReleaseNoteSpans content={block.content} />
          </p>
        );
      })}
    </div>
  );
}
