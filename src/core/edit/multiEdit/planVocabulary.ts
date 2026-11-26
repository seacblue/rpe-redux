/** Owns the batch-edit vocabulary: the fields and operations the panel offers. */
import type { MessageKey } from "../../../i18n/index.ts";
import type { Beat } from "../../global/chart/timing/beat.ts";
import type { LineEventValue } from "../../global/chart/chart.ts";
import type { BatchParameters, MultiEditKind } from "./parameters.ts";
import type { SelectionEditResult } from "../selection/edits.ts";
import { noteFields } from "../../global/chart/noteFields.ts";

type BatchVocabularyEntry = readonly [string, MessageKey];

export const NOTE_BATCH_FIELDS: readonly BatchVocabularyEntry[] = [
  ["x", "editor.commands.multiEdit.channel.x"],
  ["speed", "editor.commands.multiEdit.channel.speed"],
  ["size", "editor.commands.multiEdit.channel.size"],
  ["yOffset", "editor.commands.multiEdit.channel.yOffset"],
  ["visibleTime", "editor.commands.multiEdit.channel.visibleTime"],
  ["alpha", "editor.commands.multiEdit.channel.alpha"],
  ["t1", "editor.commands.multiEdit.channel.t1"],
  ["t2", "editor.commands.multiEdit.channel.t2"],
  ["line", "editor.commands.multiEdit.channel.line"],
  ["hitSound", "editor.commands.multiEdit.channel.hitSound"],
  ["judgeArea", "editor.commands.multiEdit.channel.judgeArea"],
  ["red", "editor.commands.multiEdit.channel.red"],
  ["green", "editor.commands.multiEdit.channel.green"],
  ["blue", "editor.commands.multiEdit.channel.blue"],
];

/** Return built-in and currently registered Extension note channels. */
export function noteBatchFields(): readonly (readonly [string, string])[] {
  return Object.freeze([
    ...NOTE_BATCH_FIELDS,
    ...noteFields
      .list()
      .filter((field) => field.batch !== false)
      .map((field) => [field.field, field.label] as const),
  ]);
}

export const EVENT_BATCH_FIELDS: readonly BatchVocabularyEntry[] = [
  ["both", "editor.commands.multiEdit.eventField.both"],
  ["start", "editor.commands.multiEdit.eventField.start"],
  ["end", "editor.commands.multiEdit.eventField.end"],
  ["easing", "editor.commands.multiEdit.eventField.easing"],
  ["t1", "editor.commands.multiEdit.eventField.t1"],
  ["t2", "editor.commands.multiEdit.eventField.t2"],
  ["line", "editor.commands.multiEdit.eventField.line"],
  ["linkgroup", "editor.commands.multiEdit.eventField.linkgroup"],
];

export const BATCH_OPERATIONS: readonly BatchVocabularyEntry[] = [
  ["By", "editor.commands.multiEdit.operation.by"],
  ["To", "editor.commands.multiEdit.operation.to"],
  ["Times", "editor.commands.multiEdit.operation.times"],
  ["Max", "editor.commands.multiEdit.operation.max"],
  ["Min", "editor.commands.multiEdit.operation.min"],
  ["Flip", "editor.commands.multiEdit.operation.flip"],
];

/**
 * A note or an event as a batch edit addresses it: both shapes carry the beat
 * range, and every other field is read and written by name.
 */
export interface BatchItem {
  startTime: Beat;
  endTime: Beat;
  type?: unknown;
  positionX?: unknown;
  start?: LineEventValue;
  end?: LineEventValue;
  shader?: unknown;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: number | boolean;
  bezierPoints?: number[];
  [field: string]: unknown;
}

/** A batch parameter set plus the one option the panel keeps outside it. */
export type BatchEditOptions = Partial<BatchParameters> & {
  eventApplicationMode?: string;
  /** Restrict an event batch edit to one selected event track. */
  eventType?: string;
};

/** One planned edit: the object before and after, and where it lands. */
export interface BatchChange {
  kind: MultiEditKind;
  type: string;
  index: number;
  before: BatchItem;
  after: BatchItem;
  lineIndex: number;
  copy: boolean;
  priority?: number;
}

/** The chart a batch edit would produce, plus the changes behind it. */
export interface MultiEditResult extends SelectionEditResult {
  changes: BatchChange[];
}
