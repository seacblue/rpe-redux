/**
 * The judge-line type section: standard/noise/text/UI purpose and the options
 * that the chosen purpose enables.
 *
 * It is split from the panel so the panel keeps the tree, property rows, and
 * folder operations without crossing the file-size boundary. The parent owns
 * every write; this component only renders and reports.
 */
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { t } from "../../../../../i18n/index.ts";
import type { JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { judgeLineTraits } from "../../../../../core/global/chart/line/lineTraits.ts";
import { noiseLineSettings } from "../../../../../core/global/chart/noise/noiseLine.ts";
import type { LinePurposeTarget } from "../../../../../core/global/chart/line/linePurposeEdits.ts";
import type { LineField } from "./lineFieldEdits.ts";
import type { createLineResets } from "./linePanelResets.tsx";
import { GAME_UI_BINDING_LABELS } from "../../../editor/workspace/preview/drawing/gameUi.ts";

/** The three purposes the bulk type selector can write. */
const LINE_PURPOSE_TARGETS: readonly LinePurposeTarget[] = ["standard", "noise", "inverted"];

/** Props the panel supplies for one line or one multi-line selection. */
export interface LineTypeSectionProps {
  selectedLine: JudgeLine | undefined;
  multi: boolean;
  batchPurposeValue: LinePurposeTarget;
  onBatchPurpose(target: LinePurposeTarget): Promise<void>;
  changeNoiseMode(mode: "normal" | "inverted", checked: boolean): Promise<void>;
  attachUI: string;
  lineExtendedEnabled: boolean;
  resets: ReturnType<typeof createLineResets>;
  commitField(field: LineField): void;
  onSetTexture(name: string): void;
}

/** Renders one high-level purpose and the options that purpose enables. */
export function LineTypeSection({
  selectedLine,
  multi,
  batchPurposeValue,
  onBatchPurpose,
  changeNoiseMode,
  attachUI,
  lineExtendedEnabled,
  resets,
  commitField,
  onSetTexture,
}: LineTypeSectionProps) {
  if (!selectedLine) {
    return null;
  }
  const lineTraits = judgeLineTraits(selectedLine);
  const settings = noiseLineSettings(selectedLine);
  const noiseMode = settings ? (settings.invert ? "inverted" : "normal") : "off";
  if (multi) {
    return (
      <section className="line-panel-type">
        <h3 className="line-panel-section-title">{t("editorPanels.linePanel.folder.bulkType")}</h3>
        <Segmented<LinePurposeTarget>
          className="is-block"
          ariaLabel={t("editorPanels.linePanel.folder.bulkType")}
          value={batchPurposeValue}
          options={LINE_PURPOSE_TARGETS.map((purpose) => ({
            value: purpose,
            label:
              purpose === "standard"
                ? t("editorPanels.linePanel.type.standard")
                : purpose === "noise"
                  ? t("editorPanels.linePanel.noise")
                  : t("editorPanels.linePanel.noiseInvert"),
          }))}
          onChange={(target) => void onBatchPurpose(target)}
        />
      </section>
    );
  }
  const binding = (
    <Select
      id="line-field-attach-ui"
      name="attachUI"
      defaultValue={attachUI}
      onChange={() => commitField("attachUI")}
    >
      <option value="">{t("editorPanels.linePanel.noBinding")}</option>
      {GAME_UI_BINDING_LABELS.map(([key, label]) => (
        <option value={key} key={key}>
          {t(label)}
        </option>
      ))}
      {attachUI && !GAME_UI_BINDING_LABELS.some(([key]) => key === attachUI) ? (
        <option value={attachUI}>{t("editorPanels.linePanel.retained", { name: attachUI })}</option>
      ) : null}
    </Select>
  );
  return (
    <section className="line-panel-type">
      <h3 className="line-panel-section-title">{t("editorPanels.linePanel.type")}</h3>
      {lineTraits.isText ? (
        <p className="hint">{t("editorPanels.linePanel.typeTextHint")}</p>
      ) : lineTraits.isTexture ? (
        <>
          <p className="hint">{t("editorPanels.linePanel.typeTextureHint")}</p>
          <Button variant="outlined" onClick={() => onSetTexture("line.png")}>
            {t("editorPanels.linePanel.typeTextureRestore")}
          </Button>
        </>
      ) : (
        <>
          {lineTraits.allowsNoiseMode && (
            <Segmented<"off" | "normal" | "inverted">
              className="is-block line-panel-type-switch"
              ariaLabel={t("editorPanels.linePanel.type")}
              value={noiseMode}
              options={[
                { value: "off", label: t("editorPanels.linePanel.type.standard") },
                { value: "normal", label: t("editorPanels.linePanel.noise") },
                { value: "inverted", label: t("editorPanels.linePanel.noiseInvert") },
              ]}
              onChange={(next) =>
                void changeNoiseMode(next === "inverted" ? "inverted" : "normal", next !== "off")
              }
            />
          )}
          {lineTraits.allowsUiBinding && (lineExtendedEnabled || Boolean(attachUI)) && (
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="line-field-attach-ui"
              label={t("editorPanels.linePanel.attachUi")}
              reset={resets.field(
                "attachUI",
                t("editorPanels.linePanel.attachUi"),
                attachUI !== "",
              )}
              control={binding}
            />
          )}
          {lineTraits.isNoise && (
            <p className="hint">{t("editorPanels.linePanel.typeNoiseHint")}</p>
          )}
          {lineTraits.isUi && <p className="hint">{t("editorPanels.linePanel.typeUiHint")}</p>}
        </>
      )}
    </section>
  );
}
