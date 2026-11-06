/**
 * Release-note language selection, inline styling, and block parsing.
 *
 * A published release body carries `CHANGELOG.md`, which lists Chinese first and
 * English second under `### 中文` / `### English` headings. The changelog modal
 * renders only the section that matches the interface language, so one external
 * source serves both languages. Bodies without those headings render unchanged,
 * which keeps notes written before the bilingual format readable.
 *
 * Two inline annotations are recognized inside the selected section:
 *
 * - `@name` credits GitHub users: the preview renders the mention bold and
 *   underlined, so a "thanks" line reads as a distinct acknowledgement.
 * - `<red>text</red>` colors a run of text. The tag name is the color and the
 *   supported names are the theme tokens below, so notes follow the active light
 *   or dark theme instead of pinning a hex value. GitHub drops the unknown tag,
 *   so the same line reads as plain words on the release page.
 *
 * Unknown or unbalanced tags stay literal text, so ordinary prose can still use
 * angle brackets without a parser error.
 */
import type { Language } from "../../../../i18n/index.ts";
import { compareVersions } from "../../../../core/utils/version.ts";

/** Heading text that opens a language section. */
const LANGUAGE_HEADINGS: Record<Language, string> = {
  zh: "中文",
  en: "English",
};

/** Named colours a release note may apply to a run of text. */
export const RELEASE_NOTE_COLORS = [
  "accent",
  "red",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

/** One colour name a release note may use. */
export type ReleaseNoteColor = (typeof RELEASE_NOTE_COLORS)[number];

/**
 * Semantic aliases for the colour names.
 *
 * They let an author say what the text means (`warning`) while the preview still
 * resolves one canonical class, and they keep the palette small.
 */
const COLOR_ALIASES: Record<string, ReleaseNoteColor> = {
  accent: "accent",
  red: "red",
  danger: "red",
  yellow: "yellow",
  warning: "yellow",
  green: "green",
  blue: "blue",
  purple: "purple",
  gray: "gray",
  grey: "gray",
  muted: "gray",
};

/** One inline run of release-note text. */
export type ReleaseNoteInline =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string }
  | { kind: "color"; color: ReleaseNoteColor; content: readonly ReleaseNoteInline[] };

/** One rendered block of release-note text. */
export type ReleaseNoteBlock =
  | { kind: "heading"; content: readonly ReleaseNoteInline[] }
  | { kind: "list"; items: readonly (readonly ReleaseNoteInline[])[] }
  | { kind: "paragraph"; content: readonly ReleaseNoteInline[] };

/** One published release, as much of it as the changelog needs. */
export interface ReleaseNotesSource {
  version: string;
  publishedAt: string;
  notes: string;
}

/** The release whose notes the changelog shows. */
export interface ChangelogRelease {
  version: string;
  publishedAt: string;
  /** The section of the published body written in the requested language. */
  notes: string;
}

/** GitHub usernames: letters, digits, and inner hyphens, up to 39 characters. */
const MENTION = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/u;
/** A character that would make an adjacent `@` part of a word or an address. */
const MENTION_LEFT_BOUNDARY = /[A-Za-z0-9._%+@-]/u;
/** `<name>` opens a colour run; the tag name is the colour. */
const COLOR_OPEN = /^<([A-Za-z][A-Za-z-]*)>/u;
/** `</name>` closes the colour run it names. */
const COLOR_CLOSE = /^<\/([A-Za-z][A-Za-z-]*)>/u;

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
 * When the body has no language headings, the whole body is returned unchanged
 * so notes written before the bilingual format stay readable. A body that has
 * language headings but none for `language` yields an empty string, letting the
 * caller fall back to another release instead of showing the wrong language.
 */
export function selectLanguageNotes(notes: string, language: Language): string {
  const lines = notes.split(/\r?\n/u);
  const start = lines.findIndex((line) => isLanguageHeading(line, language));
  if (start < 0) {
    return lines.some((line) => isOtherLanguageHeading(line)) ? "" : notes.trim();
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
 * Split one segment of text into plain runs, mentions, and colour spans.
 *
 * `closing` is the colour name this segment is nested under, or null at the top
 * level. A colour that never closes stays literal text instead of swallowing the
 * rest of the note.
 */
function parseSegment(
  source: string,
  closing: string | null,
): { nodes: ReleaseNoteInline[]; end: number; closed: boolean } {
  const nodes: ReleaseNoteInline[] = [];
  let plainStart = 0;
  let index = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) {
      nodes.push({ kind: "text", text: source.slice(plainStart, end) });
    }
  };

  while (index < source.length) {
    const character = source[index];
    if (character === "<") {
      const close = COLOR_CLOSE.exec(source.slice(index));
      if (close) {
        if (closing !== null && close[1]?.toLowerCase() === closing) {
          flushPlain(index);
          return { nodes, end: index + close[0].length, closed: true };
        }
        index += 1;
        continue;
      }
      const open = COLOR_OPEN.exec(source.slice(index));
      const name = open ? (open[1] ?? "").toLowerCase() : "";
      const color = name ? COLOR_ALIASES[name] : undefined;
      if (open && color) {
        const innerStart = index + open[0].length;
        const inner = parseSegment(source.slice(innerStart), name);
        if (inner.closed) {
          flushPlain(index);
          nodes.push({ kind: "color", color, content: inner.nodes });
          index = innerStart + inner.end;
          plainStart = index;
          continue;
        }
      }
      index += 1;
      continue;
    }
    if (character === "@") {
      const previous = index > 0 ? (source[index - 1] ?? "") : "";
      const mention = MENTION.exec(source.slice(index));
      if (mention && (previous === "" || !MENTION_LEFT_BOUNDARY.test(previous))) {
        flushPlain(index);
        nodes.push({ kind: "mention", name: mention[1] ?? "" });
        index += mention[0].length;
        plainStart = index;
        continue;
      }
    }
    index += 1;
  }
  flushPlain(source.length);
  return { nodes, end: source.length, closed: false };
}

/** Parse one run of release-note text into styled inline spans. */
export function parseReleaseNoteInline(text: string): readonly ReleaseNoteInline[] {
  return text ? parseSegment(text, null).nodes : [];
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
      blocks.push({
        kind: "paragraph",
        content: parseReleaseNoteInline(paragraph.join(" ").trim()),
      });
      paragraph = [];
    }
  };
  const flushItems = () => {
    if (items.length > 0) {
      blocks.push({ kind: "list", items: items.map((item) => parseReleaseNoteInline(item)) });
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
      blocks.push({ kind: "heading", content: parseReleaseNoteInline(heading[1] ?? "") });
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
    block.kind === "list" ? block.items.length > 0 : block.content.length > 0,
  );
}

/**
 * Format a release timestamp as year-month-day without zero padding.
 *
 * GitHub returns ISO 8601 (`2026-11-06T12:00:00Z`); the changelog title shows
 * `2026-11-6`, matching the date the release page reports. A value without a
 * leading date yields an empty string, and the title omits the date.
 */
export function formatReleaseDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value.trim());
  if (!match) {
    return "";
  }
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`;
}

/**
 * The release whose notes the changelog shows.
 *
 * `releases` is the GitHub list (newest first). The running version wins when it
 * has notes in the requested language; a build that predates its own release
 * falls back to the newest release that has notes. Returns null when nothing is
 * readable yet, so the surface can show its loading or empty hint.
 */
export function selectChangelogRelease(
  releases: readonly ReleaseNotesSource[],
  currentVersion: string,
  language: Language,
): ChangelogRelease | null {
  const published = releases
    .map((release) => ({
      version: release.version,
      publishedAt: release.publishedAt,
      notes: selectLanguageNotes(release.notes, language),
    }))
    .filter((release) => release.notes.length > 0);
  const current = published.find(
    (release) => compareVersions(release.version, currentVersion) === 0,
  );
  return current ?? published[0] ?? null;
}
