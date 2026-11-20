/**
 * Runs the cut and stick tools against the current event selection and reports
 * their counts as one notification.
 *
 * Command statistics stay here, so the view does not interpret what each tool
 * changed; a thrown tool error becomes an error notification.
 */
import {
  cutSelectedEvents,
  stickSelectedEvents,
} from "../../../../../core/edit/events/eventTools.ts";
import { t } from "../../../../../i18n/index.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { TempoGrid } from "../../../../../core/global/chart/editing/editGrid.ts";

export type EventToolAction = "cut" | "stickNext";

/** One-off overrides for a tool run; omitted values fall back to the session. */
export interface EventToolOptions {
  density?: number;
}

/** Shared command statistics; `generated` applies only to cutting and is zero for sticking. */
interface EventToolSummary {
  changed: number;
  generated: number;
  skipped: number;
}

/** Runs a cut or stick tool and reports its counts as one notification. */
export function runEventTool(
  session: EditorSession,
  tempo: TempoGrid,
  action: EventToolAction,
  notify: (message: string, kind: "success" | "warning" | "error") => void,
  beat: number,
  options: EventToolOptions = {},
): void {
  try {
    const summary: EventToolSummary =
      action === "cut"
        ? {
            ...cutSelectedEvents(session, {
              division: session.division,
              density: options.density ?? session.cutDensity,
              beat,
              tempo,
              factor: session.line?.bpmfactor ?? 1,
            }),
          }
        : { ...stickSelectedEvents(session, "next"), generated: 0 };
    const message = summary.changed
      ? action === "cut"
        ? t("editorPanels.inspector.eventTools.cut", {
            changed: summary.changed,
            generated: summary.generated,
          })
        : t("editorPanels.inspector.eventTools.stick", { changed: summary.changed })
      : t("editorPanels.inspector.eventTools.nothing");
    notify(
      `${message}${
        summary.skipped
          ? t("editorPanels.inspector.eventTools.skipped", { skipped: summary.skipped })
          : ""
      }`,
      summary.changed ? "success" : "warning",
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
  }
}
