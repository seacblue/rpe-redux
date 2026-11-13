/**
 * The judge-line panel: line tree and groups, the line property form, and
 * the texture browser that opens beside it for visual texture selection.
 *
 * The form is uncontrolled by design and reports through `onApplyField`; the
 * panel holds no chart of its own, so the displayed line always comes from the
 * session. A Ctrl/Shift selection switches the form into batch mode: only the
 * shared, safe properties are shown, mixed values stay blank, and editing one
 * field applies that field to every selected line. When the tree selects a
 * folder instead, the properties face describes that folder and its bulk
 * purpose edit.
 */
import { useId, useRef, useState, type RefObject } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import {
  inheritsParentRotation,
  lineParentIndex,
  type Chart,
  type JudgeLine,
} from "../../../../../core/global/chart/chart.ts";
import { lineGroupIndex } from "../../../../../core/global/chart/line/lineGroups.ts";
import { combineJudgeLineTraits } from "../../../../../core/global/chart/line/lineTraits.ts";
import { lineGroupLabels } from "../../../editor/workspace/lineLabels.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { t } from "../../../../../i18n/index.ts";
import {
  lineHasCustomAnchor,
  lineHasCustomBpmFactor,
  lineHasParent,
} from "../../../../../core/global/chart/optionalFeatures.ts";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import type { LinePanelTexture } from "./linePanelController.ts";
import type { LineField } from "./lineFieldEdits.ts";
import type { LinePurposeTarget } from "../../../../../core/global/chart/line/linePurposeEdits.ts";
import { InspectorEmpty } from "../../../editor/inspector/InspectorEmpty.tsx";
import { LineFolderPanel } from "./LineFolderPanel.tsx";
import { LineTree } from "./LineTree.tsx";
import { LineTypeSection } from "./LineTypeSection.tsx";
import { lineTreeKey } from "./lineTreeModel.ts";
import { TextureBrowser, TextureField } from "./TexturePicker.tsx";
import type { GlobalView } from "../../globalView.ts";
import { lineNoiseConflicts } from "../../../../../core/global/chart/noise/lineNoiseConflicts.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
import { createLineResets } from "./linePanelResets.tsx";
import {
  noiseAreaForLine,
  noiseLineSettings,
  setNoiseLineMode,
} from "../../../../../core/global/chart/noise/noiseLine.ts";
import { requestConfirm } from "../../../../overlays/modals/prompts.ts";
import { TempoMap } from "../../../../../core/global/chart/timing/tempo.ts";

/** The two full-height faces of the line inspector. */
export type LineInspectorView = "lines" | "properties";

/** Callbacks and data supplied by the line-panel controller. */
export interface LinePanelProps {
  session: EditorSession;
  textures: LinePanelTexture[];
  scrollTopRef: { current: number | null };
  onSelectLine(index: number, scrollTop: number): void;
  onCommit(label: string, chart: Chart, index?: number): void;
  onApplyField(field: LineField, form: HTMLFormElement, indices?: readonly number[]): void;
  /** Restore one line property to the value a new line starts with. */
  onResetField(field: LineField, indices?: readonly number[]): void;
  onSetTexture(name: string, indices?: readonly number[]): void;
  /** Renames one folder; false reports a rejected name so the field can roll back. */
  onRenameGroup(group: number, name: string): boolean;
  /** Applies one purpose to every line in a folder and reports whether it committed. */
  onApplyLinePurpose(group: number, target: LinePurposeTarget): Promise<boolean>;
  /** Applies one purpose to the selected lines and reports whether it committed. */
  onApplySelectionPurpose(target: LinePurposeTarget, indices: readonly number[]): Promise<boolean>;
  onAddTexture(): Promise<string[]>;
  notify(message: string, kind?: string): void;
}

/** Controller props plus the view-only chrome owned by the mounted panel. */
export interface LinePanelViewProps extends LinePanelProps {
  /** Snapshot revision used to remount uncontrolled property fields after edits. */
  snapshotRevision: number;
  selectedLineIds: ReadonlySet<string>;
  /** The folder selected in folder mode, or null while lines are selected. */
  selectedFolderGroup: number | null;
  collapsedLineGroups: ReadonlySet<string>;
  onToggleLineGroup(name: string): void;
  onLineSelectionChange(ids: ReadonlySet<string>): void;
  onSelectFolder(group: number | null): void;
  lineView: LineInspectorView;
  onLineViewChange(view: LineInspectorView): void;
  treeLayout: GlobalView;
  textureBrowserOpen: boolean;
  textureTriggerRef: RefObject<HTMLButtonElement | null>;
  onTextureBrowserOpen(open: boolean): void;
  /** The drawer renders the tree without its editor title. */
  showTitle?: boolean;
  /** Split the tree and properties into separate workspace/inspector surfaces. */
  variant?: "all" | "tree" | "properties" | "stacked" | "split";
}

/** A select value that cannot collide with a real group, mask, or binding. */
const MIXED_VALUE = "__mixed__";

/** The bulk target that matches one line's current purpose. */
function linePurposeTarget(line: JudgeLine): LinePurposeTarget {
  const settings = noiseLineSettings(line);
  return settings ? (settings.invert ? "inverted" : "noise") : "standard";
}

/** Groups may arrive from an imported chart with every line pointing outside them. */
function clampGroup(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

/** The shared value when every selected line agrees, otherwise `null` (mixed). */
function sharedValue<T>(values: readonly T[]): T | null {
  if (!values.length) {
    return null;
  }
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : null;
}

/** The effective anchor component, matching the runtime fallback. */
function anchorValue(line: JudgeLine, axis: 0 | 1): number {
  const anchor = Array.isArray(line.anchor) ? line.anchor : [];
  const value = Number(anchor[axis] ?? 0.5);
  return Number.isFinite(value) ? value : 0.5;
}

/** Renders the line tree and property faces, including multi-selection batch editing. */
export function LinePanelView({
  session,
  textures,
  scrollTopRef,
  selectedLineIds,
  selectedFolderGroup,
  collapsedLineGroups,
  onToggleLineGroup,
  onLineSelectionChange,
  onSelectFolder,
  lineView,
  onLineViewChange,
  treeLayout,
  textureBrowserOpen,
  textureTriggerRef,
  onSelectLine,
  onCommit,
  onApplyField,
  onResetField,
  onSetTexture,
  onRenameGroup,
  onApplyLinePurpose,
  onApplySelectionPurpose,
  onAddTexture,
  onTextureBrowserOpen,
  snapshotRevision,
  showTitle = true,
  variant = "all",
  notify,
}: LinePanelViewProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textureId = useId();
  const textureBrowserId = `${textureId}-browser`;
  const [batchPurpose, setBatchPurpose] = useState<LinePurposeTarget>("standard");
  const chart = session.chart;
  const lines = chart.judgeLineList ?? [];
  const labels = lineGroupLabels(chart);
  const groupCount = labels.length;
  // Folder mode describes a folder, not the active line. An index outside the
  // declared groups falls back to the ordinary line form.
  const folderGroup =
    selectedFolderGroup !== null &&
    Number.isInteger(selectedFolderGroup) &&
    selectedFolderGroup >= 0 &&
    selectedFolderGroup < groupCount
      ? selectedFolderGroup
      : null;
  const folderLabel = folderGroup === null ? "" : (labels[folderGroup] ?? "");
  const parentLinesEnabled = useEditingFeature("parentLines");
  const lineExtendedEnabled = useEditingFeature("lineExtended");
  const lineBpmFactorEnabled = useEditingFeature("lineBpmFactor");
  const lineAnchorEnabled = useEditingFeature("lineAnchor");
  // Line groups are part of the standard line model and stay visible.
  const showGroups = true;
  const selectedLine = session.line;

  const selectedIndices = lines.flatMap((unused, index) =>
    selectedLineIds.has(lineTreeKey(lines, index)) ? [index] : [],
  );
  const fallbackSelection = selectedIndices.length
    ? selectedIndices
    : lines.length
      ? [Math.max(0, Math.min(session.lineIndex, lines.length - 1))]
      : [];
  const selectedLines = fallbackSelection
    .map((index) => lines[index])
    .filter((line): line is JudgeLine => line !== undefined);
  const multi = selectedLines.length > 1;
  const selectionKey = fallbackSelection.join("|");
  const sharedPurpose = sharedValue(selectedLines.map(linePurposeTarget));
  const batchPurposeValue = sharedPurpose ?? batchPurpose;

  // A mixed control is null; the form renders it as an empty numeric field or a
  // disabled "Mixed" option. Only the field that actually changed is committed.
  const sharedGroup = sharedValue(selectedLines.map((line) => lineGroupIndex(line)));
  const sharedName = sharedValue(selectedLines.map((line) => String(line.Name ?? "")));
  const sharedParent = sharedValue(selectedLines.map((line) => lineParentIndex(line.father)));
  const sharedRotateWithFather = sharedValue(
    selectedLines.map((line) => inheritsParentRotation(line)),
  );
  const sharedMask = sharedValue(
    selectedLines.map((line) => (Number(line.isCover ?? 0) === 1 ? "1" : "0")),
  );
  const sharedZOrder = sharedValue(selectedLines.map((line) => Number(line.zOrder ?? 0)));
  const sharedBpmFactor = sharedValue(selectedLines.map((line) => Number(line.bpmfactor ?? 1)));
  const sharedAnchorX = sharedValue(selectedLines.map((line) => anchorValue(line, 0)));
  const sharedAnchorY = sharedValue(selectedLines.map((line) => anchorValue(line, 1)));
  const sharedAttachUI = sharedValue(selectedLines.map((line) => line.attachUI ?? ""));
  const sharedTexture = sharedValue(
    selectedLines.map((line) => String(line.Texture ?? "").trim() || "line.png"),
  );
  const attachUI = sharedAttachUI ?? "";
  const traits = combineJudgeLineTraits(selectedLines);
  const hasNotes = selectedLines.some((line) => (line.notes?.length ?? 0) > 0);
  const hasCustomTexture = selectedLines.some((line) => {
    const texture = String(line.Texture ?? "").trim();
    return Boolean(texture && texture !== "line.png");
  });
  // Extended line data stays visible after the capability is switched off, so an
  // imported chart never hides a field that already carries a non-default value.
  const showExtendedLineFields =
    lineExtendedEnabled ||
    selectedLines.some(
      (line) =>
        Number(line.zOrder ?? 0) !== 0 || Number(line.isCover ?? 0) === 1 || Boolean(line.attachUI),
    );
  const showBpmFactor = lineBpmFactorEnabled || selectedLines.some(lineHasCustomBpmFactor);
  // The default line always draws around its centre, so a custom pivot only
  // matters for an image line. Masking notes only matters when notes exist.
  const showAnchor =
    traits.allowsAnchor &&
    hasCustomTexture &&
    (traits.isTexture || lineAnchorEnabled || selectedLines.some(lineHasCustomAnchor));
  const showMask = showExtendedLineFields && traits.allowsMask && hasNotes;
  const showTexture = traits.allowsTexture;
  const showZOrder = showExtendedLineFields && traits.allowsZOrder;
  const selection = multi ? fallbackSelection : undefined;
  /** Apply just the field that blurred; mixed numeric blanks are ignored. */
  const commitField = (field: LineField) => {
    if (formRef.current) {
      onApplyField(field, formRef.current, selection);
    }
  };
  /** Writes the texture chosen in the picker to the selected lines. */
  const commitTexture = (name: string) => {
    onSetTexture(name, selection);
  };
  const resets = createLineResets(onResetField, onSetTexture, selection);
  /** Switches a line between standard and noise rendering, confirming destructive clears. */
  const changeNoiseMode = async (mode: "normal" | "inverted", checked: boolean) => {
    const source = session.chart;
    const index = session.lineIndex;
    const line = source.judgeLineList?.[index];
    if (!line) {
      return;
    }
    let clear = false;
    if (checked) {
      const conflicts = lineNoiseConflicts(line);
      const existing = noiseLineSettings(line);
      const textureConflict = !existing && conflicts.textures > 0;
      if (conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents || textureConflict) {
        const details = [
          conflicts.notes || conflicts.alphaEvents || conflicts.speedEvents
            ? t("editorPanels.linePanel.noiseConflictDescription", { ...conflicts })
            : "",
          textureConflict
            ? t("editorPanels.linePanel.noiseConflictTexture", { textures: conflicts.textures })
            : "",
        ].filter(Boolean);
        clear = await requestConfirm({
          title: t("editorPanels.linePanel.noiseConflictTitle"),
          description: details.join(" "),
          label: t("editorPanels.linePanel.noiseClear"),
          cancelLabel: t("editorPanels.linePanel.noiseCancel"),
          destructive: true,
        });
        if (!clear) {
          return;
        }
      }
    }
    if (session.chart !== source || session.lineIndex !== index) {
      notify(t("editorPanels.linePanel.noiseChanged"), "warning");
      return;
    }
    try {
      const next = setNoiseLineMode(line, checked ? mode : "off", clear);
      let exportSupported = true;
      if (checked) {
        try {
          noiseAreaForLine(next, new TempoMap(source.BPMList), source);
        } catch {
          exportSupported = false;
        }
      }
      const lines = [...(source.judgeLineList ?? [])];
      lines[index] = next;
      onCommit(t("editorPanels.linePanel.noiseChange"), { ...source, judgeLineList: lines }, index);
      if (!exportSupported) {
        notify(t("editorPanels.linePanel.noiseUnsupported"), "warning");
      }
    } catch {
      notify(t("editorPanels.linePanel.noiseUnsupported"), "warning");
    }
  };

  /** Commit one bulk purpose immediately; a refused or cancelled edit keeps the old value. */
  const applyBatchPurpose = async (target: LinePurposeTarget) => {
    if (await onApplySelectionPurpose(target, fallbackSelection)) {
      setBatchPurpose(target);
    }
  };

  /**
   * Renders one high-level purpose for the line, followed by the options that
   * purpose enables. A multi-line selection writes the chosen purpose to every
   * selected line immediately; destructive targets confirm inside the controller.
   */

  /** Renders the editable property fields for the current selection. */
  const renderLineProperties = () => {
    if (!selectedLine) {
      return <InspectorEmpty>{t("editorPanels.linePanel.selectLineHint")}</InspectorEmpty>;
    }
    return (
      <div className="line-panel-fields" key={selectionKey}>
        {multi && (
          <div className="line-panel-batch">
            <strong>{t("editorPanels.linePanel.batchEdit")}</strong>
            <small>{t("editorPanels.linePanel.batchHint")}</small>
          </div>
        )}
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="line-field-name"
          label={t("editorPanels.linePanel.name")}
          reset={resets.field(
            "name",
            t("editorPanels.linePanel.name"),
            String(selectedLine.Name ?? "") !== t("model.line.untitled"),
          )}
          control={
            <Input
              id="line-field-name"
              name="name"
              defaultValue={sharedName ?? ""}
              placeholder={sharedName === null ? t("editorPanels.linePanel.mixed") : undefined}
              onBlur={() => commitField("name")}
            />
          }
        />
        <LineTypeSection
          selectedLine={selectedLine}
          multi={multi}
          batchPurposeValue={batchPurposeValue}
          onBatchPurpose={applyBatchPurpose}
          changeNoiseMode={changeNoiseMode}
          attachUI={attachUI}
          attachUIMixed={sharedAttachUI === null}
          lineExtendedEnabled={lineExtendedEnabled}
          resets={resets}
          commitField={commitField}
          onSetTexture={onSetTexture}
        />
        {showAnchor && (
          <div className="line-panel-pair">
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="line-field-anchor-x"
              label={t("editorPanels.linePanel.anchorX")}
              reset={resets.field(
                "anchorX",
                t("editorPanels.linePanel.anchorX"),
                sharedAnchorX !== 0.5,
              )}
              control={
                <Input
                  id="line-field-anchor-x"
                  name="anchorX"
                  type="number"
                  step="0.01"
                  defaultValue={sharedAnchorX === null ? "" : String(sharedAnchorX)}
                  placeholder={
                    sharedAnchorX === null ? t("editorPanels.linePanel.mixed") : undefined
                  }
                  onBlur={() => commitField("anchorX")}
                />
              }
            />
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="line-field-anchor-y"
              label={t("editorPanels.linePanel.anchorY")}
              reset={resets.field(
                "anchorY",
                t("editorPanels.linePanel.anchorY"),
                sharedAnchorY !== 0.5,
              )}
              control={
                <Input
                  id="line-field-anchor-y"
                  name="anchorY"
                  type="number"
                  step="0.01"
                  defaultValue={sharedAnchorY === null ? "" : String(sharedAnchorY)}
                  placeholder={
                    sharedAnchorY === null ? t("editorPanels.linePanel.mixed") : undefined
                  }
                  onBlur={() => commitField("anchorY")}
                />
              }
            />
          </div>
        )}
        {showZOrder && (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor="line-field-z-order"
            label={t("editorPanels.linePanel.zOrder")}
            reset={resets.field("zOrder", t("editorPanels.linePanel.zOrder"), sharedZOrder !== 0)}
            control={
              <Input
                id="line-field-z-order"
                name="zOrder"
                type="number"
                step="1"
                defaultValue={sharedZOrder === null ? "" : String(sharedZOrder)}
                placeholder={sharedZOrder === null ? t("editorPanels.linePanel.mixed") : undefined}
                onBlur={() => commitField("zOrder")}
              />
            }
          />
        )}
        {showMask && (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor="line-field-mask"
            label={t("editorPanels.linePanel.mask")}
            reset={resets.field("isCover", t("editorPanels.linePanel.mask"), sharedMask !== "1")}
            control={
              <Select
                id="line-field-mask"
                name="isCover"
                defaultValue={sharedMask ?? MIXED_VALUE}
                onChange={() => commitField("isCover")}
              >
                {sharedMask === null && (
                  <option value={MIXED_VALUE} disabled>
                    {t("editorPanels.linePanel.mixed")}
                  </option>
                )}
                <option value="1">{t("editorPanels.linePanel.maskOn")}</option>
                <option value="0">{t("editorPanels.linePanel.maskOff")}</option>
              </Select>
            }
          />
        )}
        {showTexture && (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor={textureId}
            label={t("editorPanels.linePanel.texture")}
            reset={resets.texture(sharedTexture !== "line.png")}
            control={
              <TextureField
                id={textureId}
                textures={textures}
                value={sharedTexture ?? ""}
                mixed={sharedTexture === null}
                open={textureBrowserOpen}
                triggerRef={textureTriggerRef}
                onToggle={() => onTextureBrowserOpen(!textureBrowserOpen)}
              />
            }
          />
        )}
        {showBpmFactor && (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor="line-field-bpm-factor"
            label={t("editorPanels.linePanel.bpmFactor")}
            reset={resets.field(
              "bpmfactor",
              t("editorPanels.linePanel.bpmFactor"),
              sharedBpmFactor !== 1,
            )}
            control={
              <Input
                id="line-field-bpm-factor"
                name="bpmfactor"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={sharedBpmFactor === null ? "" : String(sharedBpmFactor)}
                placeholder={
                  sharedBpmFactor === null ? t("editorPanels.linePanel.mixed") : undefined
                }
                onBlur={() => commitField("bpmfactor")}
              />
            }
          />
        )}
      </div>
    );
  };

  /** Renders group assignment and parent-line controls. */
  const renderCombination = () => {
    if (!selectedLine) {
      return null;
    }
    const groupIndex = sharedGroup === null ? null : clampGroup(sharedGroup, groupCount);
    const parent = sharedParent === null ? -1 : sharedParent;
    const showParent = parentLinesEnabled || selectedLines.some((line) => lineHasParent(line));
    const rotateWithFather = sharedRotateWithFather ?? false;
    if (!showGroups && !showParent) {
      return null;
    }
    return (
      <section
        className="line-panel-combination"
        key={`combination:${snapshotRevision}:${selectionKey}:${session.lineIndex}`}
      >
        <h3 className="line-panel-section-title">{t("editorPanels.linePanel.combination")}</h3>
        {showGroups && (
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor="line-field-group"
            label={t("editorPanels.linePanel.group")}
            reset={resets.field("group", t("editorPanels.linePanel.group"), groupIndex !== 0)}
            control={
              <Select
                id="line-field-group"
                name="group"
                defaultValue={groupIndex === null ? MIXED_VALUE : String(groupIndex)}
                onChange={() => commitField("group")}
              >
                {groupIndex === null && (
                  <option value={MIXED_VALUE} disabled>
                    {t("editorPanels.linePanel.mixed")}
                  </option>
                )}
                {labels.map((name, index) => (
                  <option value={index} key={index}>
                    {name}
                  </option>
                ))}
              </Select>
            }
          />
        )}
        {showParent && (
          <>
            <FieldRow
              layout="inline"
              density="compact"
              htmlFor="line-field-parent"
              label={t("editorPanels.linePanel.parent")}
              reset={resets.field("parent", t("editorPanels.linePanel.parent"), parent !== -1)}
              control={
                <Input
                  id="line-field-parent"
                  name="parent"
                  type="number"
                  min="-1"
                  step="1"
                  defaultValue={sharedParent !== null && parent >= 0 ? String(parent) : ""}
                  placeholder={
                    sharedParent === null
                      ? t("editorPanels.linePanel.mixed")
                      : t("editorPanels.linePanel.noParent")
                  }
                  onBlur={() => commitField("parent")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              }
            />
            <FieldRow
              layout="inline"
              density="compact"
              className="checkbox-field"
              htmlFor="line-field-inherit-rotation"
              label={t("editorPanels.linePanel.inheritRotation")}
              reset={resets.field(
                "rotateWithFather",
                t("editorPanels.linePanel.inheritRotation"),
                rotateWithFather,
              )}
              control={
                <Input
                  id="line-field-inherit-rotation"
                  name="rotateWithFather"
                  type="checkbox"
                  defaultChecked={rotateWithFather}
                  ref={(element) => {
                    if (element) {
                      element.indeterminate = sharedRotateWithFather === null;
                    }
                  }}
                  onChange={() => commitField("rotateWithFather")}
                />
              }
            />
          </>
        )}
      </section>
    );
  };
  const stacked = variant === "stacked";
  const split = variant === "split";
  const showTree = variant !== "properties" && (split || stacked || lineView === "lines");
  const showProperties =
    variant !== "tree" &&
    (variant === "properties" || split || stacked || lineView === "properties");
  const treeFace = showTree ? (
    <LineTree
      session={session}
      chart={chart}
      showGroups={showGroups}
      selectedLineIds={selectedLineIds}
      folderGroup={folderGroup}
      collapsedGroups={collapsedLineGroups}
      onToggleGroup={onToggleLineGroup}
      scrollTopRef={scrollTopRef}
      treeLayout={treeLayout}
      onSelectionChange={onLineSelectionChange}
      onSelectLine={onSelectLine}
      onSelectFolder={onSelectFolder}
      onCommit={onCommit}
      onNotify={notify}
    />
  ) : null;
  const propertyFace = showProperties ? (
    folderGroup !== null ? (
      <section
        className="line-panel-properties"
        aria-label={t("editorPanels.linePanel.properties")}
        key={`folder-properties:${folderGroup}:${folderLabel}`}
      >
        <LineFolderPanel
          chart={chart}
          group={folderGroup}
          label={folderLabel}
          onRename={(name) => onRenameGroup(folderGroup, name)}
          onApplyPurpose={(target) => onApplyLinePurpose(folderGroup, target)}
        />
      </section>
    ) : (
      <>
        <section
          className="line-panel-properties"
          aria-label={t("editorPanels.linePanel.properties")}
          key={`properties:${snapshotRevision}:${selectionKey}:${session.lineIndex}`}
        >
          {renderLineProperties()}
        </section>
        {renderCombination()}
        {textureBrowserOpen && showTexture && (
          <TextureBrowser
            id={textureBrowserId}
            textures={textures}
            value={sharedTexture ?? ""}
            onChange={commitTexture}
            onAddTexture={onAddTexture}
            onClose={() => onTextureBrowserOpen(false)}
            triggerRef={textureTriggerRef}
          />
        )}
      </>
    )
  ) : null;
  return (
    <form
      ref={formRef}
      className="line-panel"
      data-view={lineView}
      data-variant={variant}
      aria-label={t("editorPanels.linePanel.title")}
      autoComplete="off"
      onSubmit={(event) => event.preventDefault()}
    >
      {showTitle && <div className="panel-title">{t("editorPanels.linePanel.title")}</div>}
      {variant === "all" && (
        <Segmented
          className="is-block line-panel-view-switch"
          ariaLabel={t("editorPanels.linePanel.view.label")}
          value={lineView}
          options={[
            { value: "lines", label: t("editorPanels.linePanel.view.lines") },
            { value: "properties", label: t("editorPanels.linePanel.properties") },
          ]}
          onChange={onLineViewChange}
        />
      )}
      {split ? (
        <div className="line-panel-split">
          <div className="line-panel-split-tree">{treeFace}</div>
          <div className="line-panel-split-properties mode-handoff-detail">{propertyFace}</div>
        </div>
      ) : stacked ? (
        <InspectorPageSplit
          topLabel={t("editorPanels.linePanel.title")}
          bottomLabel={t("editorPanels.linePanel.properties")}
          top={treeFace}
          bottom={propertyFace}
        />
      ) : (
        <>
          {treeFace}
          {propertyFace}
        </>
      )}
    </form>
  );
}
