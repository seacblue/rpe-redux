/** The detached request and result contract for one atomic chart edit. */
import type {
  BpmEntry,
  ChartMeta,
  JudgeLine,
  JudgeLineEvent,
  JudgeLineNote,
} from "../../global/chart/chart.ts";
import type { ChartObjectId } from "../../global/chart/identity.ts";
import type { HistoryEntryOrigin } from "../session/history.ts";

export type TransactionStatus = "committed" | "unchanged" | "rejected" | "conflict" | "unavailable";

/** A JSON-shaped patch. Structural fields are restricted by the transaction owner. */
export type ChartPatch = Readonly<Record<string, unknown>>;

/**
 * Fields owned by the chart topology rather than by one judge line.
 *
 * These fields are intentionally excluded from line patches. Notes and event
 * tracks have their own ID-addressed operations, while the line list itself is
 * not mutable through this interface. This keeps unknown format fields
 * forward-compatible without allowing a patch to replace an identity-bearing
 * container or a derived count.
 */
export const JUDGE_LINE_STRUCTURAL_FIELDS = Object.freeze([
  "id",
  "notes",
  "eventLayers",
  "extended",
  "numOfNotes",
] as const);

type JudgeLineEditableField =
  | "Name"
  | "Group"
  | "Texture"
  | "bpmfactor"
  | "father"
  | "rotateWithFather"
  | "isCover"
  | "zOrder"
  | "anchor"
  | "isGif"
  | "attachUI"
  | "alphaControl"
  | "posControl"
  | "sizeControl"
  | "skewControl"
  | "yControl";

/**
 * The complete typed line-edit surface plus namespaced future fields.
 * `parentId` is an API-only convenience; the RPE document still stores the
 * relation in the format's numeric `father` field.
 */
export type JudgeLinePatch = Readonly<
  Partial<Pick<JudgeLine, JudgeLineEditableField>> & {
    parentId?: ChartObjectId | null;
  }
> &
  ChartPatch;

export interface TransactionIssue {
  readonly code: string;
  readonly path?: string;
  readonly objectId?: ChartObjectId;
  readonly message?: string;
}

export interface TransactionLineTarget {
  readonly lineId?: ChartObjectId;
  readonly lineIndex?: number;
}

export interface TransactionNoteInsert extends TransactionLineTarget {
  readonly note: Partial<JudgeLineNote> &
    Pick<JudgeLineNote, "type" | "startTime" | "endTime" | "positionX">;
}

export interface TransactionEventInsert extends TransactionLineTarget {
  readonly eventType: string;
  readonly layer?: number | "extended";
  readonly event: Partial<JudgeLineEvent> & Pick<JudgeLineEvent, "startTime" | "endTime">;
}

export interface TransactionObjectUpdate<TPatch extends ChartPatch = ChartPatch> {
  readonly id: ChartObjectId;
  readonly patch: TPatch;
}

export interface TransactionJudgeLineUpdate {
  readonly id: ChartObjectId;
  readonly patch: JudgeLinePatch;
}

export interface TransactionNoteOperations {
  readonly insert?: readonly TransactionNoteInsert[];
  readonly update?: readonly TransactionObjectUpdate<Partial<JudgeLineNote> & ChartPatch>[];
  readonly delete?: readonly ChartObjectId[];
}

export interface TransactionEventOperations {
  readonly insert?: readonly TransactionEventInsert[];
  readonly update?: readonly TransactionObjectUpdate<Partial<JudgeLineEvent> & ChartPatch>[];
  readonly delete?: readonly ChartObjectId[];
}

/** Insert one judge line; the editor assigns an id when `line.id` is omitted. */
export interface TransactionLineInsert {
  readonly line: Partial<JudgeLine> & { id?: ChartObjectId };
}

export interface TransactionLineOperations {
  readonly insert?: readonly TransactionLineInsert[];
  readonly update?: readonly TransactionJudgeLineUpdate[];
}

/** Replace the complete tempo map; entries are sorted by beat on apply. */
export interface TransactionTimingOperations {
  readonly bpmList: readonly BpmEntry[];
}

export interface ChartTransactionRequest {
  /** Reject the write with `stale_read` when the chart generation has changed. */
  readonly expectedGeneration?: number;
  readonly label?: string;
  readonly metadata?: Partial<ChartMeta> & ChartPatch;
  readonly timing?: TransactionTimingOperations;
  readonly lines?: TransactionLineOperations;
  readonly notes?: TransactionNoteOperations;
  readonly events?: TransactionEventOperations;
}

export interface TransactionHistorySummary {
  readonly label: string;
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly issues: readonly TransactionIssue[];
  /** Audit origin stored on the committed history entry, or null when absent. */
  readonly origin: HistoryEntryOrigin | null;
}

export interface TransactionHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
}

export interface TransactionHistoryResult {
  readonly changed: boolean;
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
  readonly history: TransactionHistoryState;
}

export interface TransactionConflict {
  readonly code: "chartFingerprint";
  readonly expectedFingerprint: string;
  readonly currentFingerprint: string;
}

export interface ChartTransactionResult {
  readonly status: TransactionStatus;
  readonly beforeFingerprint: string | null;
  readonly afterFingerprint: string | null;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly issues: readonly TransactionIssue[];
  readonly history: TransactionHistorySummary | null;
  readonly conflict: TransactionConflict | null;
}

export interface TransactionCommitOptions {
  readonly expectedFingerprint?: string;
  /** Internal revision guard used by the public request's expectedGeneration. */
  readonly expectedGeneration?: number;
  /** Current host generation captured immediately before planning/commit. */
  readonly currentGeneration?: number;
  readonly origin?: HistoryEntryOrigin;
  /**
   * Internal: the transaction planner already validated noise-line
   * compatibility for this chart. Only the transaction kernel sets it.
   */
  readonly validatedNoise?: boolean;
}

export type TransactionPreviewStatus = "previewed" | "unchanged" | "rejected" | "unavailable";

export interface ChartTransactionPreviewResult {
  readonly status: TransactionPreviewStatus;
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly issues: readonly TransactionIssue[];
  readonly previewId: string | null;
}

/** True when `value` is a non-array object usable as a transaction request. */
export function isChartTransactionRequest(value: unknown): value is ChartTransactionRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
