/**
 * Pure presentation decisions for chart-issue rows and their locate action.
 * Keeping these decisions outside React makes the global density exception and
 * the current timeline layout contract directly testable.
 */
import type { ChartIssue } from "../../../../../core/edit/validation/chartIssueTypes.ts";
import type {
  EditorRegionSnapshot,
  EditorTimelineMode,
} from "../../workspace/runtime/commands/viewControls.ts";

/** Resolve the timeline a locate action should reveal, if it should change layout. */
export function issueJumpTimelineMode(
  mode: EditorTimelineMode,
  regions: Pick<EditorRegionSnapshot, "showNotes" | "showEvents">,
): EditorTimelineMode | null {
  return regions.showNotes && regions.showEvents ? null : mode;
}

/** Return the line label for an issue title, or null for chart-global issues. */
export function issueTitleLine(issue: Pick<ChartIssue, "kind">, line: string): string | null {
  return issue.kind === "density" ? null : line;
}
