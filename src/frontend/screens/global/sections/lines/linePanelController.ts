/**
 * Owns chart mutations, texture URL lifetime, and browser visibility; the
 * inspector owns pane rendering.
 */
import { flushSync } from "react-dom";
import { type Chart } from "../../../../../core/global/chart/chart.ts";
import { groupNames } from "../../../../../core/global/chart/line/lineGroups.ts";
import {
  applyLinePurpose as editLinePurpose,
  type LinePurposeTarget,
} from "../../../../../core/global/chart/line/linePurposeEdits.ts";
import {
  renameLineGroup,
  sanitizeLineGroupName,
} from "../../../../../core/global/chart/line/lineTreeEdits.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { t } from "../../../../../i18n/index.ts";
import { requestConfirm } from "../../../../overlays/modals/prompts.ts";
import { DEFAULT_BUNDLED_LINE_TEXTURE_URL } from "../../../../platform/noteSkinBridge.ts";
import { editLineField, type LineField } from "./lineFieldEdits.ts";
import { lineFolderIndices } from "./lineTreeModel.ts";
import type { LinePanelState } from "./model.ts";

const DEFAULT_TEXTURE = "line.png";
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** Case-insensitive, trimmed comparison used to reject duplicate group names. */
function sameGroupName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** One real project texture source; the bundled default is represented by its URL. */
export type LinePanelAsset = { name: string; bytes: Uint8Array } | { name: string; url: string };

/** Callbacks injected into the panel. */
export interface LinePanelOptions {
  state: LinePanelState;
  notify?: (message: string, kind?: string) => void;
  getAssets?: () => LinePanelAsset[];
  afterTexture?: () => void;
  /** Opens the image picker and adds the chosen files to the project assets. */
  onAddTexture?: () => Promise<string[]>;
}

/**
 * One texture the panel offers the view.
 *
 * `url` is empty when the chart references a texture the project does not carry
 * (an imported chart can name a file that was never extracted); the picker still
 * lists it so the current value is never silently dropped from the choices.
 */
export interface LinePanelTexture {
  name: string;
  url: string;
}

function textValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function checkedValue(form: HTMLFormElement, name: string): boolean {
  return new FormData(form).get(name) === "on";
}

/**
 * Owns chart mutations, texture URL lifetime, and browser visibility; the
 * inspector owns pane rendering.
 */
export class LinePanel {
  private readonly state: LinePanelState;
  private readonly getSession: () => EditorSession;
  private readonly notify: (message: string, kind?: string) => void;
  private readonly getAssets: () => LinePanelAsset[];
  private readonly afterTexture: () => void;
  private readonly onAddTexture: () => Promise<string[]>;
  private readonly textureUrls: string[] = [];
  private textureCache: LinePanelTexture[] = [];
  private textureSignature = "";
  private readonly listScrollTop = { current: null as number | null };
  private renderVersion = 0;
  private disposed = false;

  /** Stores the dependency callbacks and starts with an empty texture cache. */
  constructor(
    getSession: () => EditorSession,
    {
      state,
      notify = () => {},
      getAssets = () => [],
      afterTexture = () => {},
      onAddTexture = async () => [],
    }: LinePanelOptions,
  ) {
    this.state = state;
    this.getSession = getSession;
    this.notify = notify;
    this.getAssets = getAssets;
    this.afterTexture = afterTexture;
    this.onAddTexture = onAddTexture;
  }

  /** Releases every object URL created for the current texture cache. */
  private clearTextureUrls(): void {
    for (const url of this.textureUrls) {
      URL.revokeObjectURL(url);
    }
    this.textureUrls.length = 0;
  }

  /**
   * The textures the picker offers: project images, the bundled default, and
   * any texture the chart references by name (even when the file is missing).
   *
   * The picker renders these thumbnails during a render, so the object URLs are
   * created here and revoked by the next render or by `dispose()`.
   */
  private textures(assets = this.getAssets()): LinePanelTexture[] {
    const found = new Map<string, LinePanelTexture>();
    for (const asset of assets) {
      const { name } = asset;
      if (!IMAGE_NAME.test(name)) {
        continue;
      }
      const url =
        "bytes" in asset
          ? URL.createObjectURL(
              new Blob([asset.bytes.slice()], {
                type: `image/${(name.split(".").at(-1) ?? "").replace("jpg", "jpeg")}`,
              }),
            )
          : asset.url;
      if ("bytes" in asset) {
        this.textureUrls.push(url);
      }
      found.set(name, { name, url });
    }
    for (const line of this.getSession().chart.judgeLineList ?? []) {
      const name = String(line.Texture ?? "").trim();
      if (name && !found.has(name)) {
        found.set(name, { name, url: "" });
      }
    }
    if (!found.has(DEFAULT_TEXTURE)) {
      found.set(DEFAULT_TEXTURE, { name: DEFAULT_TEXTURE, url: DEFAULT_BUNDLED_LINE_TEXTURE_URL });
    }
    return [...found.values()].sort((a, b) => {
      if (a.name === DEFAULT_TEXTURE) {
        return -1;
      }
      if (b.name === DEFAULT_TEXTURE) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /** Writes a texture name to the target lines and commits the change. */
  setTexture(name: string, indices?: readonly number[]): void {
    const session = this.getSession();
    const sourceLines = session.chart.judgeLineList ?? [];
    const targets = [...new Set(indices?.length ? indices : [session.lineIndex])].filter(
      (index) => Number.isInteger(index) && index >= 0 && index < sourceLines.length,
    );
    if (!targets.length) {
      return;
    }
    const lines = [...sourceLines];
    for (const index of targets) {
      lines[index] = { ...lines[index], Texture: name || DEFAULT_TEXTURE };
    }
    session.commitChart(
      targets.length > 1
        ? t("editorPanels.linePanel.textureChangeBatch", { count: targets.length })
        : t("editorPanels.linePanel.textureChange"),
      { ...session.chart, judgeLineList: lines },
      session.selectionState(),
      undefined,
      { normalized: true },
    );
    this.afterTexture();
  }

  /**
   * Commits a chart but keeps the current line, notes, and events selected when
   * the active line index does not change.
   */
  commit(
    label: string,
    chart: Chart,
    index = this.getSession().lineIndex,
    normalized = false,
  ): void {
    const session = this.getSession();
    session.commitLineChart(label, chart, index, { normalized });
  }

  /**
   * Apply one changed property to the current line or to a multi-line selection.
   *
   * Reading only the field that blurred is what makes batch editing safe: mixed
   * numeric controls are blank, and the untouched fields must not be written back
   * from the primary line's values.
   */
  applyLineField(
    form: HTMLFormElement,
    field: LineField,
    indices: readonly number[] = [this.getSession().lineIndex],
  ): void {
    const session = this.getSession();
    const targets = [...new Set(indices)].filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < (session.chart.judgeLineList?.length ?? 0),
    );
    if (!targets.length) {
      return;
    }
    const next = editLineField(session.chart, targets, {
      field,
      value: textValue(form, field),
      checked: field === "rotateWithFather" ? checkedValue(form, "rotateWithFather") : undefined,
    });
    if (next === session.chart) {
      return;
    }
    this.commit(
      targets.length > 1
        ? t("editorPanels.linePanel.batchApplyLabel", { count: targets.length })
        : t("editorPanels.linePanel.applyLabel"),
      next,
      session.lineIndex,
      true,
    );
  }

  /**
   * Restore one property to the value a new judge line starts with.
   *
   * Per-line identity fields are reset one line at a time so a batch reset
   * never rejects the whole request; shared properties land in one commit.
   */
  resetLineField(
    field: LineField,
    indices: readonly number[] = [this.getSession().lineIndex],
  ): void {
    const session = this.getSession();
    const targets = [...new Set(indices)].filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < (session.chart.judgeLineList?.length ?? 0),
    );
    if (!targets.length) {
      return;
    }
    const values: Record<LineField, { value: string; checked?: boolean }> = {
      name: { value: t("model.line.untitled") },
      group: { value: "0" },
      isCover: { value: "1" },
      zOrder: { value: "0" },
      bpmfactor: { value: "1" },
      anchorX: { value: "0.5" },
      anchorY: { value: "0.5" },
      attachUI: { value: "" },
      parent: { value: "" },
      rotateWithFather: { value: "", checked: false },
    };
    const edit = { field, ...values[field] };
    let next = session.chart;
    for (const index of targets) {
      next = editLineField(next, [index], edit);
    }
    if (next === session.chart) {
      return;
    }
    this.commit(t("editorPanels.linePanel.applyLabel"), next, session.lineIndex, true);
  }

  /**
   * Rename one folder after stripping characters a folder expression cannot
   * carry, rejecting only empty and duplicate names.
   *
   * The folder panel keeps an uncontrolled name field, so a rejected name needs
   * a synchronous answer to roll the visible value back.
   */
  renameGroup(group: number, name: string): boolean {
    const session = this.getSession();
    const names = groupNames(session.chart);
    if (!Number.isInteger(group) || group < 0 || group >= names.length) {
      return false;
    }
    const next = sanitizeLineGroupName(name);
    if (!next) {
      this.notify(t("editorPanels.linePanel.groupNameRequired"), "warning");
      return false;
    }
    if (names.some((existing, index) => index !== group && sameGroupName(existing, next))) {
      this.notify(t("editorPanels.linePanel.duplicateGroupName"), "warning");
      return false;
    }
    if (next === names[group]) {
      return true;
    }
    try {
      this.commit(
        t("editorPanels.linePanel.renameGroupLabel"),
        renameLineGroup(session.chart, group, next),
        session.lineIndex,
      );
      return true;
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
  }

  /**
   * Give every line in one folder the same purpose.
   *
   * The pure edit clears what the target cannot keep. A folder with incompatible
   * content asks once before the commit; cancelling leaves the chart untouched.
   * Text lines and lines whose noise area cannot be exported are skipped and
   * reported without aborting the rest of the batch.
   */
  async applyFolderPurpose(group: number, target: LinePurposeTarget): Promise<boolean> {
    const targets = lineFolderIndices(this.getSession().chart, group);
    return this.applyPurpose(targets, target, "folder");
  }

  /** Give every selected line the same purpose, using the batch confirmation copy. */
  async applySelectionPurpose(
    target: LinePurposeTarget,
    indices: readonly number[],
  ): Promise<boolean> {
    return this.applyPurpose(indices, target, "selection");
  }

  /** Apply one purpose to a set of lines, confirming any destructive clears first. */
  private async applyPurpose(
    indices: readonly number[],
    target: LinePurposeTarget,
    scope: "folder" | "selection",
  ): Promise<boolean> {
    const session = this.getSession();
    const source = session.chart;
    const targets = [...new Set(indices)].filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < (source.judgeLineList?.length ?? 0),
    );
    if (!targets.length) {
      return false;
    }
    let result: ReturnType<typeof editLinePurpose>;
    try {
      result = editLinePurpose(source, targets, target);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), "error");
      return false;
    }
    const textSkipped = result.skipped.filter((entry) => entry.reason === "text").length;
    const unsupportedSkipped = result.skipped.filter(
      (entry) => entry.reason === "unsupported",
    ).length;
    if (result.changed.length && result.conflicts.lines) {
      const conflicts = result.conflicts;
      const byFolder = scope === "folder";
      const confirmed = await requestConfirm(
        target === "standard"
          ? {
              title: t(
                byFolder
                  ? "editorPanels.linePanel.folder.standardConfirmTitle"
                  : "editorPanels.linePanel.batchTypeStandardConfirmTitle",
              ),
              description: t(
                byFolder
                  ? "editorPanels.linePanel.folder.standardConfirmDescription"
                  : "editorPanels.linePanel.batchTypeStandardConfirmDescription",
                {
                  lines: conflicts.lines,
                  textures: conflicts.textures,
                  uiBindings: conflicts.uiBindings,
                  noiseSettings: conflicts.noiseSettings,
                },
              ),
              label: t("editorPanels.linePanel.noiseClear"),
              cancelLabel: t("editorPanels.linePanel.noiseCancel"),
              destructive: true,
            }
          : {
              title: t(
                byFolder
                  ? "editorPanels.linePanel.folder.noiseConfirmTitle"
                  : "editorPanels.linePanel.batchTypeNoiseConfirmTitle",
              ),
              description: t(
                byFolder
                  ? "editorPanels.linePanel.folder.noiseConfirmDescription"
                  : "editorPanels.linePanel.batchTypeNoiseConfirmDescription",
                {
                  lines: conflicts.lines,
                  notes: conflicts.notes,
                  alphaEvents: conflicts.alphaEvents,
                  speedEvents: conflicts.speedEvents,
                  textures: conflicts.textures,
                },
              ),
              label: t("editorPanels.linePanel.noiseClear"),
              cancelLabel: t("editorPanels.linePanel.noiseCancel"),
              destructive: true,
            },
      );
      if (!confirmed) {
        return false;
      }
    }
    if (session.chart !== source) {
      this.notify(t("editorPanels.linePanel.noiseChanged"), "warning");
      return false;
    }
    if (result.changed.length) {
      try {
        this.commit(
          t("editorPanels.linePanel.folder.applyTypeLabel", { count: result.changed.length }),
          result.chart,
          session.lineIndex,
        );
        this.afterTexture();
      } catch (error) {
        this.notify(error instanceof Error ? error.message : String(error), "error");
        return false;
      }
    }
    if (textSkipped) {
      this.notify(
        t("editorPanels.linePanel.folder.skippedText", { count: textSkipped }),
        "warning",
      );
    }
    if (unsupportedSkipped) {
      this.notify(
        t("editorPanels.linePanel.folder.skippedUnsupported", { count: unsupportedSkipped }),
        "warning",
      );
    }
    return result.changed.length > 0;
  }

  /** Rebuilds the panel snapshot, reusing texture URLs while the asset signature holds. */
  render(): void {
    if (this.disposed) {
      return;
    }
    const session = this.getSession();
    if (!session?.chart) {
      return;
    }
    const assets = this.getAssets();
    const chartTextures = (session.chart.judgeLineList ?? [])
      .map((line) => String(line.Texture ?? "").trim())
      .join("\u0000");
    // Rebuilding object URLs for every image on every selection made the tree
    // look like it reloaded: thumbnails restarted and the picker blinked. The
    // cache is keyed by the asset manifest and the names the chart references.
    const signature = `${assets.map((asset) => `${asset.name}:${"bytes" in asset ? `b${asset.bytes.length}` : "u"}`).join("\u0000")}\u0001${chartTextures}`;
    if (signature !== this.textureSignature) {
      this.clearTextureUrls();
      this.textureCache = this.textures(assets);
      this.textureSignature = signature;
    }
    this.renderVersion += 1;
    this.state.set({
      revision: this.renderVersion,
      props: {
        session,
        textures: this.textureCache,
        scrollTopRef: this.listScrollTop,
        onSelectLine: (index, scrollTop) => {
          this.listScrollTop.current = scrollTop;
          session.selectLine(index);
        },
        onCommit: (label, chart, index) => this.commit(label, chart, index),
        onApplyField: (field, form, indices) => {
          try {
            this.applyLineField(form, field, indices);
          } catch (error) {
            this.notify(error instanceof Error ? error.message : String(error), "error");
          }
        },
        onResetField: (field, indices) => {
          try {
            this.resetLineField(field, indices);
          } catch (error) {
            this.notify(error instanceof Error ? error.message : String(error), "error");
          }
        },
        onSetTexture: (name, indices) => this.setTexture(name, indices),
        onRenameGroup: (group, name) => this.renameGroup(group, name),
        onApplyLinePurpose: (group, target) => this.applyFolderPurpose(group, target),
        onApplySelectionPurpose: (target, indices) => this.applySelectionPurpose(target, indices),
        onAddTexture: this.onAddTexture,
        notify: this.notify,
      },
    });
  }

  /** Clears the published snapshot and releases texture URLs; later renders are ignored. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    flushSync(() => this.state.set(null));
    this.clearTextureUrls();
    this.textureCache = [];
    this.textureSignature = "";
  }
}
