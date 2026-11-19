/**
 * Resolves the judge-line header text shared by multi-line panel surfaces.
 *
 * Multi-line note and event fields paint one label per panel so the field names
 * its judge line instead of relying on the panel order. The text is composed at
 * draw time so chart renames and language switches reach every surface.
 */
import { t } from "../../../../../../i18n/index.ts";
import type { JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import { lineNameLabel } from "../../lineLabels.ts";

/** The number-and-name header for one multi-line panel. */
export function multiLineLineLabel(lineIndex: number, line: JudgeLine | undefined): string {
  return t("editorPanels.timeline.lineHeader", {
    index: lineIndex,
    name: lineNameLabel(line, lineIndex),
  });
}
