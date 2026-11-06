/**
 * Release-note language selection and block parsing.
 *
 * A published release body carries `CHANGELOG.md`, which lists Chinese first and
 * English second under `### 中文` / `### English` headings. The changelog modal
 * renders only the section that matches the interface language, so one external
 * source serves both languages. Bodies without those headings render unchanged,
 * which keeps notes written before the bilingual format readable.
 */
import type { Language } from "../../../../i18n/index.ts";

/** Heading text that opens a language section. */
const LANGUAGE_HEADINGS: Record<Language, string> = {
  zh: "中文",
  en: "English",
};

/** One rendered block of release-note text. */
export type ReleaseNoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "paragraph"; text: string };

/** The language marker in a heading line, or null when the line is not one. */
function languageHeading(line: string): string | null {
  const match = /^#{2,3}\s*(.+?)\s*$/u.exec(line.trim());
  return match ? (match[1] ?? null) : null;
}

/** Whether a line opens the requested language's section. */
function isLanguageHeading(line: string, language: Language): boolean {
  return languageHeading(line) === LANGUAGE_HEADINGS[language];
}

/** Whether a line opens a section for a different language. */
function isOtherLanguageHeading(line: string): boolean {
  const heading = languageHeading(line);
  return heading !== null && Object.values(LANGUAGE_HEADINGS).some((value) => value === heading);
}

/**
 * The part of `notes` written in `language`.
 *
 * When the body has no language headings, the whole body is returned unchanged.
 */
export function selectLanguageNotes(notes: string, language: Language): string {
  const lines = notes.split(/\r?\n/u);
  const start = lines.findIndex((line) => isLanguageHeading(line, language));
  if (start < 0) {
    return notes.trim();
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isOtherLanguageHeading(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Split selected release-note text into headings, bullet lists, and paragraphs.
 *
 * `**Section**` lines become headings and `- ` lines become list items, which is
 * the shape the changelog file uses inside each language. Everything else stays
 * a paragraph so older free-form notes keep their line breaks as sentences.
 */
export function parseReleaseNoteBlocks(notes: string): readonly ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushItems = () => {
    if (items.length > 0) {
      blocks.push({ kind: "list", items });
      items = [];
    }
  };
  const flush = () => {
    flushParagraph();
    flushItems();
  };

  for (const raw of notes.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^\*\*(.+)\*\*$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] ?? "" });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      items.push(line.slice(2).trim());
      continue;
    }
    flushItems();
    paragraph.push(line);
  }
  flush();
  return blocks.filter((block) =>
    block.kind === "list" ? block.items.length > 0 : block.text.length > 0,
  );
}
