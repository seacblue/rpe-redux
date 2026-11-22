/**
 * The remembered, app-private clipboard: the current snapshot plus the pinned
 * and recent entries the clipboard panel lists.
 *
 * Each entry records the line it came from so a paste can restore the original
 * placement, and a `change` event tells persistence when the list is worth
 * writing.
 */
import { t } from "../../../i18n/index.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import type { JudgeLineNote } from "../../global/chart/chart.ts";
import type { ClippedEvent, EditorSession } from "../session/session.ts";

/** The clipboard contents as they are snapshotted and persisted. */
export interface ClipboardSnapshot {
  notes: JudgeLineNote[];
  noteLines: number[];
  events: ClippedEvent[];
  eventLines: number[];
  /** Source layer for each event; absent on entries saved before layers. */
  eventLayers?: number[];
  /** Paste events back onto their source layers rather than the active layer. */
  preserveLayers?: boolean;
}

/** One remembered clipboard snapshot. */
export interface ClipboardHistoryEntry extends ClipboardSnapshot {
  id: string;
  pinned: boolean;
  name: string;
  source: string;
  line: number;
  created: number;
}

/** The `change` event `ClipboardHistory` dispatches, with its payload fields. */
export interface ClipboardHistoryChangeEvent extends Event {
  persist: boolean;
  reason: string;
}

/** The versioned preference payload for the app-private clipboard. */
export interface ClipboardHistoryPersistenceState {
  version: 1;
  entries: ClipboardHistoryEntry[];
  current: ClipboardSnapshot;
  activeId: string | null;
}

/** Creates the empty clipboard state shared by construction and clear. */
function emptyClipboard(): ClipboardSnapshot {
  return {
    notes: [],
    noteLines: [],
    events: [],
    eventLines: [],
    eventLayers: [],
    preserveLayers: false,
  };
}

/** Copies only the clipboard fields, excluding history metadata. */
function snapshotOf(entry: ClipboardSnapshot): ClipboardSnapshot {
  return structuredClone({
    notes: entry.notes,
    noteLines: entry.noteLines ?? [],
    events: entry.events,
    eventLines: entry.eventLines ?? [],
    eventLayers: entry.eventLayers ?? [],
    preserveLayers: entry.preserveLayers === true,
  });
}

/** Validates persisted beats without allowing malformed data into a session. */
function validSnapshot(value: unknown): ClipboardSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<ClipboardSnapshot>;
  if (!Array.isArray(candidate.notes) || !Array.isArray(candidate.events)) {
    return null;
  }
  try {
    for (const note of candidate.notes) {
      beatValue(note.startTime);
      beatValue(note.endTime);
    }
    for (const clipped of candidate.events) {
      if (!clipped || typeof clipped.type !== "string") {
        return null;
      }
      beatValue(clipped.event.startTime);
      beatValue(clipped.event.endTime);
    }
  } catch {
    return null;
  }
  return snapshotOf({
    notes: candidate.notes,
    noteLines: Array.isArray(candidate.noteLines) ? candidate.noteLines : [],
    events: candidate.events,
    eventLines: Array.isArray(candidate.eventLines) ? candidate.eventLines : [],
    eventLayers: Array.isArray(candidate.eventLayers) ? candidate.eventLayers : [],
    preserveLayers: candidate.preserveLayers === true,
  });
}

/** Stores the current clipboard snapshot plus pinned and recent history entries. */
export class ClipboardHistory extends EventTarget {
  limit: number;
  entries: ClipboardHistoryEntry[];
  revision: number;
  current: ClipboardSnapshot;
  activeId: string | null;

  /** Creates an empty history bounded to `limit` entries. */
  constructor(limit = 20) {
    super();
    this.limit = limit;
    this.entries = [];
    this.revision = 0;
    this.current = emptyClipboard();
    this.activeId = null;
  }

  /** Dispatches a `change` event carrying whether it should be persisted. */
  changed(persist = true, reason = ""): void {
    this.revision++;
    const event = new Event("change") as ClipboardHistoryChangeEvent;
    event.persist = persist;
    event.reason = reason;
    this.dispatchEvent(event);
  }

  /** Returns a cloned, versioned payload for the private preference store. */
  persistenceState(): ClipboardHistoryPersistenceState {
    return {
      version: 1,
      entries: structuredClone(this.entries),
      current: structuredClone(this.current),
      activeId: this.activeId,
    };
  }

  /**
   * Loads persisted state when the in-memory history is still untouched.
   *
   * Older releases stored the entries array directly. In that format the most
   * recent entry is the only available current clipboard, so it is promoted to
   * keep cross-chart paste working after an upgrade.
   */
  restore(entries: unknown): void {
    if (this.revision || !this.replacePersisted(entries)) {
      return;
    }
    this.dispatchEvent(new Event("change"));
  }

  /**
   * Adopts a clipboard written by another frontend instance.
   *
   * Remote state never becomes a new persisted write, and an unchanged payload
   * is ignored so polling does not create render work on every tick.
   */
  adopt(entries: unknown): boolean {
    if (!entries || typeof entries !== "object") {
      return false;
    }
    const payload = entries as Partial<ClipboardHistoryPersistenceState>;
    if (payload.version !== 1 && !Array.isArray(entries)) {
      return false;
    }
    if (!this.replacePersisted(entries)) {
      return false;
    }
    this.changed(false, "remote");
    return true;
  }

  /** Applies a legacy or versioned payload and reports whether it changed. */
  private replacePersisted(entries: unknown): boolean {
    if (!entries || typeof entries !== "object") {
      return false;
    }
    const before = JSON.stringify(this.persistenceState());
    const legacy = Array.isArray(entries);
    const payload: Partial<ClipboardHistoryPersistenceState> = legacy
      ? { entries: entries as ClipboardHistoryEntry[] }
      : (entries as Partial<ClipboardHistoryPersistenceState>);
    const ids = new Set<string>();
    this.entries = (Array.isArray(payload.entries) ? payload.entries : [])
      .filter((entry) => {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          ids.has(entry.id) ||
          !Array.isArray(entry.notes) ||
          !Array.isArray(entry.events) ||
          !(entry.notes.length + entry.events.length)
        ) {
          return false;
        }
        if (!validSnapshot(entry)) {
          return false;
        }
        ids.add(entry.id);
        return true;
      })
      .slice(0, this.limit)
      .map((entry) => ({ ...structuredClone(entry), pinned: Boolean(entry.pinned) }));
    const restoredCurrent = payload.version === 1 ? validSnapshot(payload.current) : null;
    const fallbackEntry = this.entries[0];
    this.current =
      restoredCurrent ?? (fallbackEntry ? snapshotOf(fallbackEntry) : emptyClipboard());
    const requestedId = typeof payload.activeId === "string" ? payload.activeId : null;
    this.activeId =
      (requestedId && this.entries.some((entry) => entry.id === requestedId)
        ? requestedId
        : legacy
          ? (fallbackEntry?.id ?? null)
          : null) ?? null;
    return JSON.stringify(this.persistenceState()) !== before;
  }

  /** Captures the session clipboard and promotes or adds its history entry. */
  remember(session: EditorSession): void {
    this.current = snapshotOf({
      notes: session.clipboard,
      noteLines: session.clipboardNoteLines ?? [],
      events: session.eventClipboard,
      eventLines: session.eventClipboardLines ?? [],
      eventLayers: session.eventClipboardLayers ?? [],
      preserveLayers: session.eventClipboardPreserveLayers === true,
    });
    this.activeId = null;
    if (this.current.notes.length + this.current.events.length) {
      const signature = JSON.stringify(this.current);
      const previous = this.entries.find(
        (entry) => JSON.stringify(snapshotOf(entry)) === signature,
      );
      if (previous) {
        this.entries = this.entries.filter((entry) => entry !== previous);
      }
      const entry: ClipboardHistoryEntry = {
        ...structuredClone(this.current),
        id: previous?.id ?? crypto.randomUUID(),
        pinned: previous?.pinned ?? false,
        name: previous?.name ?? "",
        source: session.chart.META.name || t("editor.commands.clipboardHistory.untitledChart"),
        line: session.lineIndex,
        created: Date.now(),
      };
      if (this.entries.length >= this.limit) {
        const oldest = this.entries.findLastIndex((entry) => !entry.pinned);
        if (oldest >= 0) {
          this.entries.splice(oldest, 1);
        }
      }
      if (this.entries.length < this.limit) {
        this.entries.unshift(entry);
        this.activeId = entry.id;
      }
    }
    this.changed(this.activeId !== null);
  }

  /** Replaces the session clipboard with the current snapshot. */
  attach(session: EditorSession): void {
    session.clipboard = structuredClone(this.current.notes);
    session.clipboardNoteLines = structuredClone(
      this.current.noteLines ?? session.clipboard.map(() => session.lineIndex),
    );
    session.eventClipboard = structuredClone(this.current.events);
    session.eventClipboardLines = structuredClone(
      this.current.eventLines ?? session.eventClipboard.map(() => session.lineIndex),
    );
    session.eventClipboardLayers = structuredClone(
      this.current.eventLayers ?? session.eventClipboard.map(() => session.eventLayer),
    );
    session.eventClipboardPreserveLayers = this.current.preserveLayers === true;
  }

  /** Activates a stored entry and copies it into the session; false if unknown. */
  use(session: EditorSession, id: string): boolean {
    const entry = this.entries.find((entry) => entry.id === id);
    if (!entry) {
      return false;
    }
    this.current = snapshotOf({
      notes: entry.notes,
      noteLines: entry.noteLines ?? [],
      events: entry.events,
      eventLines: entry.eventLines ?? [],
      eventLayers: entry.eventLayers ?? [],
      preserveLayers: entry.preserveLayers === true,
    });
    this.activeId = id;
    this.attach(session);
    this.changed(true, "activate");
    return true;
  }

  /** Empties the current clipboard without removing history entries. */
  clearCurrent(session: EditorSession): void {
    this.current = emptyClipboard();
    this.activeId = null;
    this.attach(session);
    this.changed(true, "clear");
  }
  /** Toggles an entry's pinned flag; pinned entries survive pruning. */
  pin(id: string): void {
    const entry = this.entries.find((entry) => entry.id === id);
    if (entry) {
      entry.pinned = !entry.pinned;
      this.changed();
    }
  }
  /** Sets a trimmed, length-limited display name for one entry. */
  rename(id: string, name: unknown): void {
    const entry = this.entries.find((entry) => entry.id === id);
    if (entry) {
      entry.name = String(name).trim().slice(0, 40);
      this.changed(true, "rename");
    }
  }
  /** Removes one entry and clears the active id when it pointed at that entry. */
  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.activeId === id) {
      this.activeId = null;
    }
    this.changed();
  }
  /** Drops every unpinned entry and clears the active id when it was dropped. */
  clearUnpinned(): void {
    this.entries = this.entries.filter((entry) => entry.pinned);
    if (!this.entries.some((entry) => entry.id === this.activeId)) {
      this.activeId = null;
    }
    this.changed();
  }
}
