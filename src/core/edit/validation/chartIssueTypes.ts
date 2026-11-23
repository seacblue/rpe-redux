/**
 * The catalog of chart issue kinds and the shape of one published issue.
 *
 * Every issue carries a kind, so the inspector can filter and label it without
 * guessing from `track` or `target`. The kind list is the only place a new
 * category is added: the scanner, the settings page, the row title and the
 * filter popover all read this catalog.
 */
import type { MessageKey } from "../../../i18n/index.ts";
import type { Beat } from "../../global/chart/timing/beat.ts";

/** Every issue category the scanner can report. */
export const CHART_ISSUE_KINDS = [
  "missing-resource",
  "overlap",
  "invalid-range",
  "negative-beat",
  "density",
] as const;

/** One issue category. */
export type ChartIssueKind = (typeof CHART_ISSUE_KINDS)[number];

/** How strongly an issue should be presented. */
export type ChartIssueSeverity = "warning" | "error" | "fatal";

/** The shared presentation contract for one issue kind. */
export interface ChartIssueKindDefinition {
  kind: ChartIssueKind;
  /** The severity an issue of this kind starts at. */
  severity: ChartIssueSeverity;
  /** The row title and filter option. */
  label: MessageKey;
  /** The filter option's secondary line, when one is worth showing. */
  description: MessageKey;
  /** The setting that turns this kind on or off. */
  settingKey: string;
}

/** Every kind with its display contract, in filter order. */
export const CHART_ISSUE_KIND_DEFINITIONS: readonly ChartIssueKindDefinition[] = [
  {
    kind: "missing-resource",
    severity: "fatal",
    label: "editorPanels.issues.kind.missingResource",
    description: "editorPanels.issues.kind.missingResource.description",
    settingKey: "chart-issues-check-missing-resource",
  },
  {
    kind: "overlap",
    severity: "error",
    label: "editorPanels.issues.kind.overlap",
    description: "editorPanels.issues.kind.overlap.description",
    settingKey: "chart-issues-check-overlap",
  },
  {
    kind: "invalid-range",
    severity: "error",
    label: "editorPanels.issues.kind.invalidRange",
    description: "editorPanels.issues.kind.invalidRange.description",
    settingKey: "chart-issues-check-invalid-range",
  },
  {
    kind: "negative-beat",
    severity: "error",
    label: "editorPanels.issues.kind.negativeBeat",
    description: "editorPanels.issues.kind.negativeBeat.description",
    settingKey: "chart-issues-check-negative-beat",
  },
  {
    // A density estimate is advice about another renderer, not a broken chart,
    // so it stays a hint and never raises the error badge.
    kind: "density",
    severity: "warning",
    label: "editorPanels.issues.kind.density",
    description: "editorPanels.issues.kind.density.description",
    settingKey: "chart-issues-check-density",
  },
];

/** Resolve one kind's display contract. */
export function chartIssueKindDefinition(kind: ChartIssueKind): ChartIssueKindDefinition {
  return (
    CHART_ISSUE_KIND_DEFINITIONS.find((definition) => definition.kind === kind) ??
    CHART_ISSUE_KIND_DEFINITIONS[0]
  );
}

/** One issue with the chart context needed to locate it. */
export interface ChartIssue {
  /** The category, which drives the label and the filter. */
  kind: ChartIssueKind;
  severity: ChartIssueSeverity;
  /** The chart object represented by this issue. */
  target: "event" | "hold" | "note" | "line" | "resource";
  /** Stable key for React and list diffs. */
  id: string;
  lineIndex: number;
  lineId: string;
  /** Raw line name; the view supplies a localized fallback. */
  lineName: string;
  /** Timeline event layer, including the extended layer's synthetic index. */
  layer: number;
  /** True when the pair lives in the line's `extended` map. */
  extended: boolean;
  track: string;
  firstEventIndex: number;
  secondEventIndex: number;
  firstEventId: string;
  secondEventId: string;
  /** First beat covered by the issue. */
  startTime: Beat;
  /** First beat after the covered range. */
  endTime: Beat;
  /** Those two beats as chart seconds, so a view can show a clock time. */
  startSeconds: number;
  endSeconds: number;
  /** Numeric start used for sorting and seeking. */
  beat: number;
  /** Numeric end used for snapshot equality. */
  endBeat: number;
  /** The on-screen note peak, for a density issue. */
  peak?: number;
  /** Name and media class for a missing chart resource. */
  resourceName?: string;
  resourceKind?: "image" | "audio" | "other";
}

/** One immutable publication consumed by the inspector. */
export interface ChartIssueSnapshot {
  revision: number;
  issues: readonly ChartIssue[];
  /** Where the background scan currently stands. */
  status: "idle" | "scanning" | "ready" | "failed";
  /** Highest same-time note count the density estimate found, or zero. */
  peak: number;
}

/** Empty snapshot shared until the first chart arrives. */
export const EMPTY_CHART_ISSUE_SNAPSHOT: ChartIssueSnapshot = Object.freeze({
  revision: 0,
  issues: Object.freeze([]),
  status: "idle",
  peak: 0,
});
