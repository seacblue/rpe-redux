/**
 * The row contract shared by the home library's list and grid modes.
 *
 * Every entry is a stored SQLite project; selection, search, and the detail
 * pane only need one shape.
 */
import type { HomeLibraryProject, HomeProjectCardsSnapshot } from "../homeProjectCards.ts";
import { normalizeLibraryGroup } from "./libraryGroups.ts";

/** Where an entry is opened from. */
export type LibraryEntrySource = { kind: "project"; project: HomeLibraryProject };

/** The audio asset a library entry can preview, when it has one. */
export interface LibraryEntryAudio {
  /** Asset name; its extension supplies the blob's content type. */
  name: string;
  /** Direct URL for the library service asset. */
  url?: string;
}

/** One chart as the home library presents it. */
export interface LibraryEntry {
  /** Stable selection key; project ids never collide. */
  key: string;
  title: string;
  composer: string;
  charter: string;
  level: string;
  /** Cover image URL, or an empty string while none is available. */
  cover: string;
  /** Audio track for the song-select preview, or null when there is none. */
  audio: LibraryEntryAudio | null;
  source: LibraryEntrySource;
}

/** Maps the published project snapshot to display rows, preserving its order. */
export function buildLibraryEntries(snapshot: HomeProjectCardsSnapshot | null): LibraryEntry[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.libraryProjects.map((project) => {
    const normalizedProject = {
      ...project,
      group: normalizeLibraryGroup(project.group),
    };
    return {
      key: `project:${project.id}`,
      title: project.name || project.id,
      composer: project.composer,
      charter: project.charter,
      level: project.level,
      cover: project.thumbnailUrl ?? project.coverUrl ?? "",
      audio:
        project.song && project.audioUrl ? { name: project.song, url: project.audioUrl } : null,
      source: { kind: "project", project: normalizedProject },
    };
  });
}

/** Keeps entries whose displayed and detail metadata match the query. */
export function matchesLibraryQuery(entry: LibraryEntry, needle: string): boolean {
  if (!needle) {
    return true;
  }
  return [entry.title, entry.composer, entry.charter, entry.level]
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

/** Keeps an entry when no group is selected or its stored group is selected. */
export function matchesLibraryGroups(
  entry: LibraryEntry,
  selectedGroups: ReadonlySet<string>,
): boolean {
  return selectedGroups.size === 0 || selectedGroups.has(entry.source.project.group);
}
