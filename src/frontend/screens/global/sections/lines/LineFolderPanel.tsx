/**
 * Properties for the judge-line folder selected in the tree.
 *
 * The properties face normally describes one line or a line selection. When the
 * tree is in folder mode this panel takes its place: it renames the folder and
 * applies one purpose to every eligible line. Chart mutation and confirmation
 * stay in the line-panel controller.
 */
import { useMemo, useState } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import type { Chart, JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { noiseLineSettings } from "../../../../../core/global/chart/noise/noiseLine.ts";
import type { LinePurposeTarget } from "../../../../../core/global/chart/line/linePurposeEdits.ts";
import { sanitizeLineGroupName } from "../../../../../core/global/chart/line/lineTreeEdits.ts";
import { t } from "../../../../../i18n/index.ts";
import { InspectorEmpty } from "../../../editor/inspector/InspectorEmpty.tsx";
import { lineFolderIndices } from "./lineTreeModel.ts";

export interface LineFolderPanelProps {
  chart: Chart;
  group: number;
  /** The localized folder name the tree shows. */
  label: string;
  /** Applies a new name; false means the name was rejected and the field must roll back. */
  onRename(name: string): boolean;
  /** Applies a purpose to the folder and reports whether it committed. */
  onApplyPurpose(target: LinePurposeTarget): Promise<boolean>;
}

/** The lines a folder contains, used for the empty and disabled states. */
function folderLines(chart: Chart, group: number): JudgeLine[] {
  return lineFolderIndices(chart, group)
    .map((index) => chart.judgeLineList?.[index])
    .filter((line): line is JudgeLine => line !== undefined);
}

/** The bulk target that matches one line's current purpose. */
function linePurposeTarget(line: JudgeLine): LinePurposeTarget {
  const settings = noiseLineSettings(line);
  return settings ? (settings.invert ? "inverted" : "noise") : "standard";
}

/** The shared purpose of a folder, or null while its lines disagree. */
function sharedPurpose(lines: readonly JudgeLine[]): LinePurposeTarget | null {
  const first = lines[0] ? linePurposeTarget(lines[0]) : null;
  return first !== null && lines.every((line) => linePurposeTarget(line) === first) ? first : null;
}

/** The selected folder's name and batch purpose form. */
export function LineFolderPanel({
  chart,
  group,
  label,
  onRename,
  onApplyPurpose,
}: LineFolderPanelProps) {
  const [target, setTarget] = useState<LinePurposeTarget>("standard");
  const lines = useMemo(() => folderLines(chart, group), [chart, group]);
  const count = lines.length;
  const targetValue = sharedPurpose(lines) ?? target;
  /** Apply one purpose immediately; a refused or cancelled edit keeps the old value. */
  const applyTarget = async (next: LinePurposeTarget) => {
    if (await onApplyPurpose(next)) {
      setTarget(next);
    }
  };

  return (
    <div className="line-panel-fields line-folder-panel" data-group-index={group}>
      <h3 className="line-panel-section-title">{t("editorPanels.linePanel.folder.title")}</h3>
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor="line-folder-name"
        label={t("editorPanels.linePanel.folder.name")}
        control={
          <Input
            id="line-folder-name"
            defaultValue={label}
            onChange={(event) => {
              const next = sanitizeLineGroupName(event.currentTarget.value);
              if (next !== event.currentTarget.value) {
                event.currentTarget.value = next;
              }
            }}
            onBlur={(event) => {
              const next = sanitizeLineGroupName(event.currentTarget.value);
              event.currentTarget.value = next;
              if (!onRename(next)) {
                event.currentTarget.value = label;
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        }
      />
      {count === 0 && <InspectorEmpty>{t("editorPanels.linePanel.emptyGroup")}</InspectorEmpty>}
      <section className="line-panel-type">
        <h3 className="line-panel-section-title">{t("editorPanels.linePanel.folder.bulkType")}</h3>
        <Segmented<LinePurposeTarget>
          className="is-block"
          ariaLabel={t("editorPanels.linePanel.folder.bulkType")}
          value={targetValue}
          disabled={count === 0}
          options={[
            { value: "standard", label: t("editorPanels.linePanel.type.standard") },
            { value: "noise", label: t("editorPanels.linePanel.noise") },
            { value: "inverted", label: t("editorPanels.linePanel.noiseInvert") },
          ]}
          onChange={(next) => void applyTarget(next)}
        />
      </section>
    </div>
  );
}
