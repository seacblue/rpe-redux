/** Describes a line-local note change so render caches can preserve safe derived data. */

/** Classifies whether a note change preserves its timing and interval structure. */
export type NoteChangeKind = "visual" | "timing" | "structure";

/** Exact note indexes changed by one committed chart publication. */
export interface NoteChangeHint {
  readonly lineIndex: number;
  readonly noteIndexes: readonly number[];
  readonly kind: NoteChangeKind;
  /** Whether same-beat overlap ranks may have changed. */
  readonly overlapChanged: boolean;
}
