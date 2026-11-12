/**
 * View models for the notes pane: one descriptor per editable note property and
 * the cell that carries them.
 *
 * Beat descriptors also carry commit, nudge, and acceptance rules, so the view
 * can edit an exact beat without reading the chart.
 */
import { createValue, type ValueCell } from "../../../../../core/state/values.ts";
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";

export interface PropertyControl {
  value: string;
}

export interface NotePropertyField {
  key: string;
  label: string;
  kind: "select" | "beat" | "number" | "duration" | "text" | "color" | "boolean" | "slider";
  /** Text value of a select, number, duration or text control; empty for a beat control. */
  value: string;
  /** Whether a focused control owns a local draft that a session refresh must preserve. */
  preservesDraft: boolean;
  /** True when the chart already authors this optional value, so hiding can keep it editable. */
  present?: boolean;
  placeholder?: string;
  /** The committed beat of a beat control, read from the chart. */
  beat?: Beat;
  /** Write a beat to the chart. A refused beat never reaches this; a throw is reported. */
  applyBeat?: (beat: Beat) => void;
  /** Exact move by one grid division, owned by the panel that knows the division. */
  nudge?: (beat: Beat, direction: number) => Beat;
  /** Extra rule a beat must satisfy before it may be written (a Hold's end follows its start). */
  accepts?: (beat: Beat) => boolean;
  options?: [string, string][];
  step?: number;
  min?: string;
  max?: string;
  /** Tooltip content for a field whose label cannot carry the guidance. */
  tipDescription?: string;
  /** Whether the control takes typed input at all; a derived beat is read-only. */
  disabled?: boolean;
  /** Whether the current value differs from the field's creation default. */
  dirty?: boolean;
  /** Restore this field to its creation default through the owning commit path. */
  reset?: () => void;
  apply?: (control: PropertyControl) => void;
  /** Marks the note draft active when this field gains focus. */
  focus?: () => void;
  /** Publishes the note properties after this field loses focus. */
  blur?: () => void;
  wheel?: (direction: number) => string | null;
}

export interface NotePropertiesSnapshot {
  revision: number;
  fields: NotePropertyField[];
  empty: boolean;
  emptyHint: string;
}

export interface NotesInspectorState {
  properties: ValueCell<NotePropertiesSnapshot | null>;
  livePosition: ValueCell<string | null>;
  selectedCount: ValueCell<number | null>;
}

/** Creates note inspector state for one mounted editor tree. */
export function createNotesInspectorState(): NotesInspectorState {
  return {
    properties: createValue<NotePropertiesSnapshot | null>({ initial: null }),
    livePosition: createValue<string | null>({ initial: null }),
    selectedCount: createValue<number | null>({ initial: null }),
  };
}
