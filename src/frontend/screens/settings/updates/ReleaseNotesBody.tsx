/**
 * The rendered body of one release's notes.
 *
 * The text is the published release body, already narrowed to the interface
 * language by the caller. Lines shaped like `**Section**` become headings and
 * `- ` lines become list items; anything else renders as a paragraph. Inline
 * spans come from `parseReleaseNoteInline`: plain runs stay text, `@name`
 * becomes a bold underlined credit, and color runs become theme-coloured spans.
 */
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
export function ReleaseNotesBody({ notes }: { notes: string }) {
  const blocks = parseReleaseNoteBlocks(notes);
  return (
    <div className="redux-release-notes">
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
        return (
          <p key={index}>
            <ReleaseNoteSpans content={block.content} />
          </p>
        );
      })}
    </div>
  );
}
