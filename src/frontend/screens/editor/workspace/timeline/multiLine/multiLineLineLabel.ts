/**
 * Resolves the judge-line header text shared by multi-line panel surfaces.
 *
 * Multi-line note and event fields paint one label per panel so the field names
 * its judge line instead of relying on the panel order. The text is composed at
 * draw time so chart renames and language switches reach every surface.
 */
import { t } from "../../../../../../i18n/index.ts";
import type { JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import { isDefaultLineName } from "../../lineLabels.ts";

/** Suffix appended when an overlong name does not fit its panel. */
const LINE_HEADER_ELLIPSIS = "...";

/**
 * The header for one multi-line panel.
 *
 * A default line name carries no information, so it collapses to the bare
 * number. When a width budget and measurer are supplied, the header never
 * condenses the text: an overlong name is truncated and ends with `...`, and a
 * header that cannot fit even one name character falls back to the bare number.
 */
export function multiLineLineLabel(
  lineIndex: number,
  line: JudgeLine | undefined,
  maxWidth?: number,
  measureText?: (text: string) => number,
): string {
  const indexLabel = t("editorPanels.timeline.lineHeaderIndex", { index: lineIndex });
  const fits = (text: string) =>
    maxWidth === undefined || measureText === undefined || measureText(text) <= maxWidth;
  const labelFor = (name: string) =>
    t("editorPanels.timeline.lineHeader", { index: lineIndex, name });

  if (isDefaultLineName(line, lineIndex)) {
    return fits(indexLabel) ? indexLabel : "";
  }
  const name = String(line?.Name ?? "").trim();
  const label = labelFor(name);
  if (fits(label)) {
    return label;
  }
  if (maxWidth === undefined || measureText === undefined) {
    return label;
  }

  const characters = Array.from(name);
  const truncated = (count: number) =>
    labelFor(`${characters.slice(0, count).join("").trimEnd()}${LINE_HEADER_ELLIPSIS}`);
  if (!fits(truncated(1))) {
    return fits(indexLabel) ? indexLabel : "";
  }
  let low = 1;
  let high = characters.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(truncated(middle))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return truncated(low);
}
