/**
 * The rendered body of one release's notes.
 *
 * The text is the published release body, already narrowed to the interface
 * language by the caller. Lines shaped like `**Section**` become headings and
 * `- ` lines become list items; anything else renders as a paragraph.
 */
import { parseReleaseNoteBlocks } from "./releaseNotes.ts";

/** Release-note text as headings, bullet lists, and paragraphs. */
export function ReleaseNotesBody({ notes }: { notes: string }) {
  const blocks = parseReleaseNoteBlocks(notes);
  return (
    <div className="redux-release-notes">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return <h4 key={index}>{block.text}</h4>;
        }
        if (block.kind === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
