/**
 * Notes that share a judge time.
 *
 * Two notes are simultaneous when their start maps to the same microsecond of
 * chart time — across every judge line, so a note on a line with a different
 * `bpmfactor` still counts. Both the timeline (which marks them) and the preview
 * (which draws their connector) read the same fact, so it is derived here in the
 * chart domain.
 *
 * `SimultaneousNotesCache` is the incremental form: it keeps per-line times and
 * a multi-set of counts, so a redraw after one line's notes were replaced only
 * revisits that line.
 */
import type { JudgeLineNote } from "../chart.ts";
import type { TempoSource } from "../timing/events.ts";

/**
 * Return every note whose start shares a chart time with another note.
 *
 * Times are compared at microsecond resolution across all judge lines, with each
 * line's `bpmfactor` applied.
 */
export function simultaneousNotes<T extends JudgeLineNote>(
  chart: { judgeLineList?: readonly { notes?: readonly T[]; bpmfactor?: number }[] },
  tempo: TempoSource,
): Set<T> {
  const counts = new Map<number, number>();
  const times = new Map<T, number>();
  for (const line of chart.judgeLineList ?? []) {
    for (const note of line.notes ?? []) {
      const time = Math.round(tempo.seconds(note.startTime, line.bpmfactor ?? 1) * 1000000);
      times.set(note, time);
      counts.set(time, (counts.get(time) ?? 0) + 1);
    }
  }
  return new Set(
    [...times].filter(([, time]) => (counts.get(time) ?? 0) > 1).map(([note]) => note),
  );
}

/** A line's cached note times and the note/factor pair they were computed from. */
interface CachedLineTimes<T extends JudgeLineNote> {
  notes: readonly T[] | undefined;
  factor: number;
  entries: Array<[T, number]>;
}

/** True when `next` keeps every previous note by identity as its prefix. */
function appendsTo<T extends JudgeLineNote>(
  previous: readonly T[] | undefined,
  next: readonly T[] | undefined,
): boolean {
  if (!previous || !next || next.length < previous.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

/** Incremental per-line cache for simultaneous-note detection. */
export class SimultaneousNotesCache<T extends JudgeLineNote = JudgeLineNote> {
  private tempo: TempoSource | null = null;
  /** Stable line id when present, because an edit replaces the line object. */
  private readonly lines = new Map<object | string, CachedLineTimes<T>>();
  private readonly groups = new Map<number, Map<T, number>>();
  private readonly counts = new Map<number, number>();
  private readonly simultaneous = new Set<T>();

  /** Forget every cached line, time and result. */
  clear(): void {
    this.tempo = null;
    this.lines.clear();
    this.groups.clear();
    this.counts.clear();
    this.simultaneous.clear();
  }

  /**
   * Refresh the cache for `chart` and return the simultaneous-note set.
   *
   * Only lines whose note array or BPM factor changed are recomputed; changing
   * the tempo source clears the cache.
   */
  update(
    chart: {
      judgeLineList?: readonly {
        id?: string;
        notes?: readonly T[];
        bpmfactor?: number;
      }[];
    },
    tempo: TempoSource,
  ): Set<T> {
    if (this.tempo !== tempo) {
      this.clear();
      this.tempo = tempo;
    }
    const seen = new Set<object | string>();
    for (const line of chart.judgeLineList ?? []) {
      if (typeof line !== "object" || line === null) {
        continue;
      }
      const key = typeof line.id === "string" ? line.id : line;
      seen.add(key);
      const factor = line.bpmfactor ?? 1;
      const cached = this.lines.get(key);
      if (cached && cached.notes === line.notes && cached.factor === factor) {
        continue;
      }
      if (cached && cached.factor === factor && appendsTo(cached.notes, line.notes)) {
        // Placement appends to the same line. The cached note times are still
        // valid and only the new notes need a tempo lookup and a group update.
        const notes = line.notes ?? [];
        const entries = cached.entries;
        for (let index = cached.notes?.length ?? 0; index < notes.length; index += 1) {
          const note = notes[index];
          const time = Math.round(tempo.seconds(note.startTime, factor) * 1000000);
          entries.push([note, time]);
          this.add(note, time);
        }
        this.lines.set(key, { notes: line.notes, factor, entries });
        continue;
      }
      if (cached) {
        this.remove(cached.entries);
      }
      const entries: Array<[T, number]> = [];
      for (const note of line.notes ?? []) {
        const time = Math.round(tempo.seconds(note.startTime, factor) * 1000000);
        entries.push([note, time]);
        this.add(note, time);
      }
      this.lines.set(key, { notes: line.notes, factor, entries });
    }
    for (const [key, cached] of this.lines) {
      if (!seen.has(key)) {
        this.remove(cached.entries);
        this.lines.delete(key);
      }
    }
    return this.simultaneous;
  }

  /** Register one note occurrence and mark its time group as simultaneous. */
  private add(note: T, time: number): void {
    let group = this.groups.get(time);
    if (!group) {
      group = new Map();
      this.groups.set(time, group);
    }
    const total = this.counts.get(time) ?? 0;
    group.set(note, (group.get(note) ?? 0) + 1);
    this.counts.set(time, total + 1);
    if (total === 1) {
      for (const member of group.keys()) {
        this.simultaneous.add(member);
      }
    } else if (total > 1) {
      this.simultaneous.add(note);
    }
  }

  /** Remove cached occurrences, keeping members simultaneous only while their group stays shared. */
  private remove(entries: Array<[T, number]>): void {
    for (const [note, time] of entries) {
      const group = this.groups.get(time);
      if (!group) {
        continue;
      }
      const occurrences = group.get(note) ?? 0;
      const total = this.counts.get(time) ?? 0;
      if (occurrences <= 1) {
        group.delete(note);
        this.simultaneous.delete(note);
      } else {
        group.set(note, occurrences - 1);
      }
      const nextTotal = Math.max(0, total - 1);
      if (nextTotal > 1) {
        if (occurrences <= 1) {
          this.simultaneous.delete(note);
        }
      } else {
        for (const member of group.keys()) {
          this.simultaneous.delete(member);
        }
      }
      if (nextTotal) {
        this.counts.set(time, nextTotal);
      } else {
        this.counts.delete(time);
        this.groups.delete(time);
      }
    }
  }
}
