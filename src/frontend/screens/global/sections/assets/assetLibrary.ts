/**
 * The asset-library panel model: builds the folder tree and thumbnail URLs from
 * the chart's asset map and applies add, rename, delete, and folder
 * actions.
 *
 * Asset object URLs are owned here and released with the panel; folder changes
 * leave through `onChange`, where the runtime writes them into the chart so they
 * stay undoable and survive PEZ, project, and export serialization.
 */
import type { AssetMap } from "../../../../../core/global/document/types.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import {
  ASSET_EXTENSIONS,
  IMAGE_EXTENSIONS,
  assetEntries,
  assetKind,
  assetPathFor,
  collectAssetFolders,
  createUrl,
  imageName,
  isChartRelativePath,
  scannedRoot,
  type CachedUrl,
} from "./assetLibraryModel.ts";
import { buildAssetSnapshot } from "./assetTree.ts";
import {
  assetFoldersOfChart,
  hasAssetFoldersField,
} from "../../../../../core/global/document/folders.ts";
import { t } from "../../../../../i18n/index.ts";
import type {
  AssetLibraryPanelSnapshot,
  AssetLibraryState,
  AssetLibraryViewActions,
} from "./model.ts";
import { flushSync } from "react-dom";
import { openAssetPrompt } from "./assetPrompts.ts";
import { requestConfirm } from "../../../../overlays/modals/prompts.ts";
import type { ShaderParameterOverrides } from "../../../../../core/global/chart/shader/shaderEvents.ts";

/** The editor-context slice read and written by the panel. */
export interface AssetContext {
  assets: AssetMap;
  /** Asset folders; consume the caller's `Set` through its iterable contract. */
  folders: Iterable<string>;
  /**
   * Name of the directory that holds the chart. Scanning is accepted only for
   * this folder, because asset references are relative to it.
   */
  chartDirectoryName?: string;
  /** The open chart; it stores the persisted folder organization. */
  chart?: Chart | null;
}

/** A file returned by the desktop drop reader. */
export interface DroppedAssetFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Callbacks injected into the panel. */
export interface AssetLibraryOptions {
  state: AssetLibraryState;
  notify?: (message: string, kind?: string) => void;
  onChange?: (assets: AssetMap, folders: Set<string>) => void;
  onTexture?: (from: string, to?: string) => void;
  /** Reads file bytes for OS drops; injected so the model owns no platform API. */
  readDroppedFiles?: (paths: readonly string[]) => Promise<readonly DroppedAssetFile[]>;
  onOpenExternal?: (name: string) => Promise<void> | void;
  onConfigureShader?: (name: string, overrides: ShaderParameterOverrides) => void;
}

/** Owns the asset tree model, asset bytes, and thumbnail URL lifetime for one panel. */
export class AssetLibraryPanel {
  state: AssetLibraryState;
  getContext: () => AssetContext;
  notify: (message: string, kind?: string) => void;
  onChange: (assets: AssetMap, folders: Set<string>) => void;
  onTexture: (from: string, to?: string) => void;
  readDroppedFiles?: (paths: readonly string[]) => Promise<readonly DroppedAssetFile[]>;
  onOpenExternal: (name: string) => Promise<void> | void;
  onConfigureShader: (name: string, overrides: ShaderParameterOverrides) => void;
  selected: string | null;
  /** Empty string is the chart's root folder, shown as Default. */
  selectedFolder: string;
  /** Committed URL cache keyed by asset name; replacing the bytes invalidates the entry. */
  urls: Map<string, CachedUrl>;
  fileInput: HTMLInputElement | null = null;
  /** Incremented by each `render()` so in-flight builds detect replacement. */
  generation = 0;

  /** Stores the panel callbacks and starts with an empty selection and URL cache. */
  constructor(
    getContext: () => AssetContext,
    {
      state,
      notify = () => {},
      onChange = () => {},
      onTexture = () => {},
      readDroppedFiles,
      onOpenExternal = () => {},
      onConfigureShader = () => {},
    }: AssetLibraryOptions,
  ) {
    this.state = state;
    this.getContext = getContext;
    this.notify = notify;
    this.onChange = onChange;
    this.onTexture = onTexture;
    this.readDroppedFiles = readDroppedFiles;
    this.onOpenExternal = onOpenExternal;
    this.onConfigureShader = onConfigureShader;
    this.selected = null;
    this.selectedFolder = "";
    this.urls = new Map();
  }

  /** Releases every cached URL; the workspace calls this when replacing a document. */
  disposeUrls(): void {
    for (const { url } of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }

  /** Releases every cached URL and drops the published snapshot. */
  dispose(): void {
    // Invalidate in-flight builds; they will observe the stale generation and clean up.
    this.generation += 1;
    this.disposeUrls();
    flushSync(() => this.state.set(null));
  }

  /**
   * Folders as the panel should see them.
   *
   * Two sources are merged: the runtime set the document installed when it
   * opened, and the chart field where the organization is persisted. A freshly
   * opened document only has the chart field until the runtime installs it, and
   * a document created in this session only has the runtime set until the next
   * commit writes the chart field, so either side can be the only one present.
   */
  private currentFolders(): Set<string> {
    const context = this.getContext();
    const folders = new Set(context.folders ?? []);
    for (const folder of assetFoldersOfChart(context.chart)) {
      folders.add(folder);
    }
    // A chart without a folder field has an implicit Default root group; an
    // explicit empty field means the user deleted every group.
    if (!hasAssetFoldersField(context.chart)) {
      folders.add("");
    }
    return folders;
  }

  /**
   * Applies a mutation to a copy of the asset map and folders, then publishes it.
   *
   * The promise settles once the caller's mutation has run and the change has
   * been handed to `onChange`; the view rebuild continues in the background.
   */
  async mutate(
    mutator: (next: AssetMap, folders: Set<string>) => unknown,
    message = t("editorPanels.assetLibrary.updated"),
  ): Promise<void> {
    const context = this.getContext();
    const next = new Map(context.assets ?? []);
    const folders = this.currentFolders();
    await mutator(next, folders);
    this.onChange(next, folders);
    this.notify(message, "success");
    // Do not wait for the rebuild: dialogs use this promise to decide when to close,
    // while waiting for a large tree would make them feel stuck. `render()` consumes errors.
    void this.render();
  }

  /**
   * The folder an import can actually use.
   *
   * A deleted selection falls back to the root when it exists, otherwise to the
   * first remaining group. With no groups at all the root path is returned so
   * the import can recreate the default group instead of writing an unreachable
   * asset.
   */
  private targetFolder(folder: string): string {
    const folders = this.currentFolders();
    if (folder === "" ? folders.has("") : folders.has(folder)) {
      return folder;
    }
    return [...folders].find((path) => path !== "") ?? "";
  }

  /** Write imported bytes into the selected folder, appending in arrival order. */
  private async storeAssets(
    accepted: readonly { path: string; bytes: Uint8Array }[],
    folder: string,
  ): Promise<void> {
    await this.mutate(
      (next, folders) => {
        // Importing into an empty library recreates the Default group so every
        // asset stays reachable from the tree.
        if (!folders.has(folder)) {
          folders.add(folder);
        }
        let firstStored: string | null = null;
        for (const file of accepted) {
          let path = file.path;
          if (next.has(path)) {
            const dot = path.lastIndexOf(".");
            const stem = dot < 0 ? path : path.slice(0, dot);
            const extension = dot < 0 ? "" : path.slice(dot);
            let index = 2;
            while (next.has(`${stem}-${index}${extension}`)) {
              index++;
            }
            path = `${stem}-${index}${extension}`;
          }
          next.set(path, file.bytes);
          collectAssetFolders(path, folders);
          firstStored ??= path;
        }
        if (firstStored) {
          this.selected = firstStored;
        }
        this.selectedFolder = folder;
      },
      t("editorPanels.assetLibrary.addedImages", { count: accepted.length }),
    );
  }

  /**
   * Imports picked files into a folder, filtering unsupported extensions and
   * refusing directory scans taken outside the chart's own folder.
   */
  addFiles(
    files: FileList | readonly File[] | null,
    folder = this.selectedFolder,
  ): Promise<void> | void {
    const assets = [...(files ?? [])].filter((file) => ASSET_EXTENSIONS.test(file.name));
    if (!assets.length) {
      return this.notify(t("editorPanels.assetLibrary.noSupportedImages"), "warning");
    }
    const chartDirectory = this.getContext().chartDirectoryName;
    const scanned = assets.find((file) => file.webkitRelativePath);
    const root = scanned ? scannedRoot(scanned) : null;
    if (root && chartDirectory && root.toLowerCase() !== chartDirectory.toLowerCase()) {
      // The scan is keyed relative to the picked folder, so a different folder
      // would silently place every asset below a folder that does not exist in
      // the project.
      return this.notify(
        t("editorPanels.assetLibrary.scanOutsideChart", { name: chartDirectory }),
        "warning",
      );
    }
    const target = this.targetFolder(folder);
    const accepted: { path: string; bytes: Promise<Uint8Array> }[] = [];
    const rejected: string[] = [];
    for (const file of assets) {
      const path = assetPathFor(file, target);
      if (isChartRelativePath(path)) {
        accepted.push({ path, bytes: file.arrayBuffer().then((buffer) => new Uint8Array(buffer)) });
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length) {
      this.notify(t("editorPanels.assetLibrary.outsideChart", { name: rejected[0] }), "warning");
    }
    if (!accepted.length) {
      return;
    }
    return Promise.all(
      accepted.map(async (file) => ({ path: file.path, bytes: await file.bytes })),
    ).then((loaded) => this.storeAssets(loaded, target));
  }

  /** Import file bytes returned by the desktop drop reader into the selected folder. */
  async addDroppedAssets(
    files: readonly DroppedAssetFile[],
    folder = this.selectedFolder,
  ): Promise<void> {
    const target = this.targetFolder(folder);
    const accepted = files.flatMap((file) => {
      const name = imageName(file.name).replace(/^\/+/, "");
      if (!ASSET_EXTENSIONS.test(name) || !isChartRelativePath(name)) {
        return [];
      }
      return [{ path: [target, name].filter(Boolean).join("/"), bytes: file.bytes }];
    });
    if (!accepted.length) {
      this.notify(t("editorPanels.assetLibrary.noSupportedImages"), "warning");
      return;
    }
    await this.storeAssets(accepted, target);
  }

  /** Read and import OS-dropped paths; the platform reader is injected by the runtime. */
  async importPaths(paths: readonly string[]): Promise<void> {
    if (!this.readDroppedFiles || !paths.length) {
      return;
    }
    try {
      await this.addDroppedAssets(await this.readDroppedFiles(paths));
    } catch (error) {
      this.notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  /** Opens the new-folder name prompt. */
  createFolder(): void {
    openAssetPrompt({
      kind: "name",
      title: t("editorPanels.assetLibrary.newFolder.title"),
      label: t("editorPanels.assetLibrary.newFolder.label"),
      placeholder: t("editorPanels.assetLibrary.newFolder.placeholder"),
      submit: (name) => this.submitFolder(name),
    });
  }

  /** Validates and creates a folder; dialogs display validation or write failures locally. */
  private async submitFolder(raw: string): Promise<void> {
    const entered = imageName(raw).replace(/^\/+|\/+$/g, "");
    if (!isChartRelativePath(entered)) {
      throw new Error(t("editorPanels.assetLibrary.newFolder.invalid"));
    }
    const name =
      this.selectedFolder && !entered.includes("/") ? `${this.selectedFolder}/${entered}` : entered;
    if (this.currentFolders().has(name)) {
      throw new Error(t("editorPanels.assetLibrary.newFolder.exists"));
    }
    await this.mutate((next, folders) => {
      collectAssetFolders(`${name}/placeholder.png`, folders);
      folders.add(name);
      this.selectedFolder = name;
      this.selected = null;
    }, t("editorPanels.assetLibrary.newFolder.done"));
  }

  /**
   * Delete one asset after an explicit confirmation.
   *
   * The library has no per-asset undo, so the question is the recovery boundary;
   * a cancelled confirmation leaves the selection untouched.
   */
  async deleteAsset(name: string): Promise<void> {
    const confirmed = await requestConfirm({
      title: t("editorPanels.assetLibrary.deleteSelected"),
      description: t("editorPanels.assetLibrary.deleteAssetDescription", { name }),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    await this.mutate((next) => {
      next.delete(name);
      if (this.selected === name) {
        this.selected = null;
      }
    }, t("editorPanels.assetLibrary.deleted"));
  }

  /**
   * Deletes an organizing folder.
   *
   * Folders are derived from asset paths rather than stored as directories, so a
   * folder that still holds assets would reappear immediately and is refused.
   */
  async deleteFolder(path: string): Promise<void> {
    const isRoot = path === "";
    const count = assetEntries(this.getContext().assets).filter(([name]) => {
      const normalized = imageName(name);
      return isRoot ? !normalized.includes("/") : normalized.startsWith(`${path}/`);
    }).length;
    if (count) {
      return this.notify(
        t("editorPanels.assetLibrary.deleteFolder.notEmpty", { count }),
        "warning",
      );
    }
    const confirmed = await requestConfirm({
      title: t("editorPanels.assetLibrary.deleteFolder.title"),
      description: t("editorPanels.assetLibrary.deleteFolder.description", {
        name: isRoot ? t("editorPanels.assetLibrary.defaultFolder") : path,
      }),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    await this.mutate((next, folders) => {
      for (const folder of [...folders]) {
        const inBlock = isRoot ? folder === "" : folder === path || folder.startsWith(`${path}/`);
        if (inBlock) {
          folders.delete(folder);
        }
      }
      if (this.selectedFolder === path || this.selectedFolder.startsWith(`${path}/`)) {
        this.selectedFolder = this.firstFolder(folders);
      }
      if (this.selected && imageName(this.selected).startsWith(`${path}/`)) {
        this.selected = null;
      }
    }, t("editorPanels.assetLibrary.deleteFolder.done"));
  }

  /** The default root when present, otherwise the first authored group. */
  private firstFolder(folders: ReadonlySet<string>): string {
    if (folders.has("")) {
      return "";
    }
    return [...folders].find((folder) => folder !== "") ?? "";
  }

  /** Opens the rename prompt for an asset. */
  renameImage(name: string): void {
    openAssetPrompt({
      kind: "name",
      title: t("editorPanels.assetLibrary.rename.title"),
      description: t("editorPanels.assetLibrary.rename.description"),
      label: t("editorPanels.assetLibrary.rename.label"),
      value: name,
      submit: (next) => this.submitRename(name, next),
    });
  }

  /** Validates a rename and commits it to the asset map, rejecting invalid or duplicate names. */
  private async submitRename(name: string, raw: string): Promise<void> {
    const nextName = imageName(raw).replace(/^\/+|\/+$/g, "");
    const kind = assetKind(name);
    if (!isChartRelativePath(nextName) || assetKind(nextName) !== kind) {
      throw new Error(t("editorPanels.assetLibrary.rename.invalid"));
    }
    await this.mutate((next, folders) => {
      if (nextName !== name && next.has(nextName)) {
        throw new Error(t("editorPanels.assetLibrary.rename.exists"));
      }
      const bytes = next.get(name);
      next.delete(name);
      // The map should contain this entry; never write an undefined byte array.
      if (bytes !== undefined) {
        next.set(nextName, bytes);
      }
      collectAssetFolders(nextName, folders);
      if (kind === "image") {
        this.onTexture(name, nextName);
      }
      this.selected = nextName;
    }, t("editorPanels.assetLibrary.rename.done"));
  }

  /**
   * Rebuilds the panel view.
   *
   * The build is asynchronous because each asset needs an object URL. Yielding
   * between batches keeps the spinner paintable and prevents a large library
   * from locking the main thread.
   *
   * Calls are not queued: a newer `render()` replaces an in-flight one through
   * `generation`, and the replaced build reclaims the URLs it created.
   */
  async render(): Promise<void> {
    const generation = (this.generation += 1);
    // Enter loading only when no usable content is visible; edits and selection changes
    // keep the old view so every thumbnail click does not flash a spinner.
    if (this.state.get()?.status !== "ready") {
      this.state.set({ status: "loading" });
    }
    // Build into `pending` and commit only on success so replacement or failure cannot
    // contaminate the committed cache.
    const pending = new Map<string, CachedUrl>();
    const created = new Set<string>();
    let committed = false;
    try {
      const snapshot = await this.buildSnapshot(
        pending,
        created,
        () => generation === this.generation,
      );
      if (!snapshot) {
        return;
      }
      this.commitUrls(pending);
      committed = true;
      this.state.set({ status: "ready", snapshot, actions: this.createActions() });
    } catch {
      if (generation !== this.generation) {
        return;
      }
      this.state.set({ status: "error", retry: () => void this.render() });
      this.notify(t("editorPanels.assetLibrary.loadFailed"), "error");
    } finally {
      // An uncommitted build reclaims only URLs it created; reused URLs remain committed.
      if (!committed) {
        for (const url of created) {
          URL.revokeObjectURL(url);
        }
      }
    }
  }

  /**
   * Returns an image URL, reusing the committed cache when the bytes are unchanged.
   *
   * `mutate()` copies the map shell while retaining the same `Uint8Array`
   * values, so untouched assets hit the cache and an edited image is rebuilt.
   * New URLs go into `created` for reclamation if the build is discarded;
   * `this.urls` stays untouched during the build so a replaced build cannot
   * leave released URLs in the committed cache.
   */
  private urlFor(
    pending: Map<string, CachedUrl>,
    created: Set<string>,
    name: string,
    bytes: Uint8Array,
  ): string {
    const cached = pending.get(name) ?? this.urls.get(name);
    if (cached && cached.bytes === bytes) {
      pending.set(name, cached);
      return cached.url;
    }
    const entry: CachedUrl = { bytes, url: createUrl(bytes, name) };
    pending.set(name, entry);
    created.add(entry.url);
    return entry.url;
  }

  /** Commits this build's cache and releases URLs no longer present in the view. */
  private commitUrls(pending: Map<string, CachedUrl>): void {
    const live = new Set<string>();
    for (const { url } of pending.values()) {
      live.add(url);
    }
    for (const { url } of this.urls.values()) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
      }
    }
    this.urls = pending;
  }

  /**
   * Builds view data; returns null when `isCurrent()` becomes false and this build is replaced.
   *
   * `pending` contains cache entries used by this build and `created` contains new URLs;
   * the caller owns both and decides whether to commit or reclaim them.
   */
  /**
   * Builds view data through the pure tree builder.
   *
   * Returns null when a newer render replaced this one. The builder may correct
   * a folder selection whose folder was deleted; that correction is applied here
   * so the next render starts from the reachable folder.
   */
  private async buildSnapshot(
    pending: Map<string, CachedUrl>,
    created: Set<string>,
    isCurrent: () => boolean,
  ): Promise<AssetLibraryPanelSnapshot | null> {
    const result = await buildAssetSnapshot({
      assets: this.getContext().assets,
      entries: assetEntries(this.getContext().assets),
      folders: this.currentFolders(),
      selected: this.selected,
      selectedFolder: this.selectedFolder,
      chart: this.getContext().chart,
      defaultFolder: (folders) => this.firstFolder(folders),
      urlFor: (name, bytes) => this.urlFor(pending, created, name, bytes),
      isCurrent,
    });
    if (!result) {
      return null;
    }
    this.selectedFolder = result.selectedFolder;
    return result.snapshot;
  }

  /** A sibling name that does not collide; used when a move changes folders. */
  private uniqueAssetName(assets: AssetMap, desired: string): string {
    if (!assets.has(desired)) {
      return desired;
    }
    const dot = desired.lastIndexOf(".");
    const stem = dot < 0 ? desired : desired.slice(0, dot);
    const extension = dot < 0 ? "" : desired.slice(dot);
    let index = 2;
    while (assets.has(`${stem}-${index}${extension}`)) {
      index += 1;
    }
    return `${stem}-${index}${extension}`;
  }

  /** Folder path that contains an asset name. */
  private assetFolder(name: string): string {
    const parts = imageName(name).split("/");
    parts.pop();
    return parts.join("/");
  }

  /** Move or reorder one asset entry, preserving the display order of the map. */
  private async moveAsset(
    name: string,
    folder: string,
    targetName: string | undefined,
    after: boolean,
  ): Promise<void> {
    const sourceFolder = this.assetFolder(name);
    if (sourceFolder === folder && (!targetName || targetName === name)) {
      return;
    }
    await this.mutate((next, folders) => {
      const bytes = next.get(name);
      if (!bytes) {
        return;
      }
      const nextName =
        sourceFolder === folder
          ? name
          : this.uniqueAssetName(
              next,
              [folder, name.split("/").at(-1) ?? name].filter(Boolean).join("/"),
            );
      const entries = [...next.entries()].filter(([entryName]) => entryName !== name);
      let insert = entries.length;
      if (targetName) {
        const targetIndex = entries.findIndex(([entryName]) => entryName === targetName);
        if (targetIndex >= 0) {
          insert = after ? targetIndex + 1 : targetIndex;
        }
      }
      entries.splice(insert, 0, [nextName, bytes]);
      next.clear();
      for (const [entryName, entryBytes] of entries) {
        next.set(entryName, entryBytes);
      }
      collectAssetFolders(nextName, folders);
      if (nextName !== name && IMAGE_EXTENSIONS.test(name)) {
        this.onTexture(name, nextName);
      }
      this.selected = nextName;
      this.selectedFolder = folder;
    }, t("editorPanels.assetLibrary.moved"));
  }

  /** Reorder one folder block among siblings; descendants move with it. */
  private async moveFolder(path: string, targetPath: string, after: boolean): Promise<void> {
    const parent = this.assetFolder(path);
    const targetParent = this.assetFolder(targetPath);
    if (path === targetPath || parent !== targetParent) {
      return;
    }
    await this.mutate((next, folders) => {
      const all = [...folders];
      // The Default group is a marker, not a parent of every folder. Moving it
      // moves only that marker so top-level folders keep their own order.
      const block =
        path === ""
          ? all.filter((folder) => folder === "")
          : all.filter((folder) => folder === path || folder.startsWith(`${path}/`));
      const rest = all.filter((folder) => !block.includes(folder));
      const targetIndex = rest.indexOf(targetPath);
      if (!block.length || targetIndex < 0) {
        return;
      }
      rest.splice(after ? targetIndex + 1 : targetIndex, 0, ...block);
      folders.clear();
      for (const folder of rest) {
        folders.add(folder);
      }
    }, t("editorPanels.assetLibrary.movedFolder"));
  }

  /** Builds the callback set the view receives with each snapshot. */
  private createActions(): AssetLibraryViewActions {
    return {
      onAdd: () => this.fileInput?.click(),
      onFiles: (files) => {
        void this.addFiles(files);
        if (this.fileInput) {
          this.fileInput.value = "";
        }
      },
      onCreateFolder: () => {
        this.createFolder();
      },
      onSelectFolder: (path) => {
        this.selected = null;
        this.selectedFolder = path;
        void this.render();
      },
      onDeleteFolder: (path) => {
        void this.deleteFolder(path);
      },
      onMoveAsset: (name, folder, targetName, after) => {
        void this.moveAsset(name, folder, targetName, after === true);
      },
      onMoveFolder: (path, targetPath, after) => {
        void this.moveFolder(path, targetPath, after === true);
      },
      addInputRef: (node) => {
        this.fileInput = node;
      },
      onSelect: (name) => {
        this.selected = name;
        void this.render();
      },
      onRename: (name) => {
        const target = name ?? this.selected;
        if (target) {
          this.renameImage(target);
        }
      },
      onConfigureShader: (name, overrides) => {
        this.onConfigureShader(name, overrides);
        void this.render();
      },
      onOpenExternal: () => {
        if (this.selected) {
          void this.onOpenExternal(this.selected);
        }
      },
      onDelete: () => {
        const name = this.selected;
        if (name) {
          void this.deleteAsset(name);
        }
      },
    };
  }
}
