/** Owns the batch-edit vocabulary: the fields and operations the panel offers. */
import { t } from "../../../i18n/index.ts";
import type { Beat } from "../../global/chart/timing/beat.ts";
import type { LineEventValue } from "../../global/chart/chart.ts";
import type { BatchParameters, MultiEditKind } from "./parameters.ts";
import type { SelectionEditResult } from "../selection/edits.ts";

export const NOTE_BATCH_FIELDS = [
  ["x", t("editor.commands.multiEdit.channel.x")],
  ["speed", t("editor.commands.multiEdit.channel.speed")],
  ["size", t("editor.commands.multiEdit.channel.size")],
  ["yOffset", t("editor.commands.multiEdit.channel.yOffset")],
  ["visibleTime", t("editor.commands.multiEdit.channel.visibleTime")],
  ["alpha", t("editor.commands.multiEdit.channel.alpha")],
  ["t1", t("editor.commands.multiEdit.channel.t1")],
  ["t2", t("editor.commands.multiEdit.channel.t2")],
  ["line", t("editor.commands.multiEdit.channel.line")],
  ["hitSound", t("editor.commands.multiEdit.channel.hitSound")],
  ["judgeArea", t("editor.commands.multiEdit.channel.judgeArea")],
  ["red", "Red"],
  ["green", "Green"],
  ["blue", "Blue"],
];

export const EVENT_BATCH_FIELDS = [
  ["both", t("editor.commands.multiEdit.eventField.both")],
  ["start", t("editor.commands.multiEdit.eventField.start")],
  ["end", t("editor.commands.multiEdit.eventField.end")],
  ["easing", t("editor.commands.multiEdit.eventField.easing")],
  ["t1", t("editor.commands.multiEdit.eventField.t1")],
  ["t2", t("editor.commands.multiEdit.eventField.t2")],
  ["line", t("editor.commands.multiEdit.eventField.line")],
  ["linkgroup", t("editor.commands.multiEdit.eventField.linkgroup")],
];

export const BATCH_OPERATIONS = [
  ["By", t("editor.commands.multiEdit.operation.by")],
  ["To", t("editor.commands.multiEdit.operation.to")],
  ["Times", t("editor.commands.multiEdit.operation.times")],
  ["Max", t("editor.commands.multiEdit.operation.max")],
  ["Min", t("editor.commands.multiEdit.operation.min")],
  ["Flip", t("editor.commands.multiEdit.operation.flip")],
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
