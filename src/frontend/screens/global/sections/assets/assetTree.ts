/**
 * Builds the asset-library view tree from the chart's asset map and folders.
 *
 * The builder is pure apart from the injected URL resolver: it yields between
 * batches so a large library stays paintable, and reports replacement by
 * returning `null` when `isCurrent()` turns false.
 */
import type { AssetMap } from "../../../../../core/global/document/types.ts";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import {
  shaderParameterOverrides,
  shaderParameters,
} from "../../../../../core/global/chart/shader/shaderEvents.ts";
import type {
  AssetLibraryPanelSnapshot,
  AssetViewFile,
  AssetViewFolder,
  AssetViewSelected,
} from "./model.ts";
import {
  ASSETS_PER_YIELD,
  assetKind,
  imageName,
  yieldToBrowser,
  type AssetNode,
} from "./assetLibraryModel.ts";

/** Everything the tree needs from the panel, so the builder owns no state. */
export interface AssetSnapshotOptions {
  assets: AssetMap;
  entries: readonly [string, Uint8Array][];
  folders: ReadonlySet<string>;
  selected: string | null;
  selectedFolder: string;
  chart: Chart | null | undefined;
  /** Root folder when present, otherwise the first authored group. */
  defaultFolder(folders: ReadonlySet<string>): string;
  /** Cached object URL for one asset, creating and tracking it as needed. */
  urlFor(name: string, bytes: Uint8Array): string;
  /** False once a newer build replaced this one. */
  isCurrent(): boolean;
}

/** A built snapshot plus the folder selection it normalized. */
export interface AssetSnapshotResult {
  snapshot: AssetLibraryPanelSnapshot;
  selectedFolder: string;
}

/**
 * Builds the folder tree, file rows, and selection summary.
 *
 * Returns `null` when the build was replaced mid-flight.
 */
export async function buildAssetSnapshot(
  options: AssetSnapshotOptions,
): Promise<AssetSnapshotResult | null> {
  const { assets, entries, folders, selected, defaultFolder, urlFor, isCurrent } = options;
  const folderPaths = [...folders].filter(Boolean);
  const root: AssetNode = { folders: new Map(), files: [] };
  /** Returns the chart node for a folder path, creating missing ancestors. */
  const ensureFolder = (node: AssetNode, parts: string[]): AssetNode => {
    let current = node;
    for (const part of parts) {
      let child = current.folders.get(part);
      if (!child) {
        child = { folders: new Map(), files: [] };
        current.folders.set(part, child);
      }
      current = child;
    }
    return current;
  };
  for (const folderPath of folderPaths) {
    ensureFolder(root, imageName(folderPath).split("/").filter(Boolean));
  }
  // Images directly inside the chart's folder are listed on their own; there is
  // no synthetic root node, because the chart folder is the panel's whole scope.
  const rootFiles: [string, string, Uint8Array][] = [];
  for (const [name, bytes] of entries) {
    const parts = imageName(name).split("/").filter(Boolean);
    const file = parts.pop() ?? name;
    if (!parts.length) {
      rootFiles.push([name, file, bytes]);
      continue;
    }
    ensureFolder(root, parts).files.push([name, file, bytes]);
  }
  // Root files imply a Default group when the chart has no folder field.
  const rootVisible = folders.has("") || rootFiles.length > 0;
  const topLevelOrder = [...folders].filter((folder) => folder === "" || !folder.includes("/"));
  const rootIndex = Math.max(0, topLevelOrder.indexOf(""));
  /** Total assets in a node and all of its descendants. */
  const countFiles = (node: AssetNode): number =>
    node.files.length +
    [...node.folders.values()].reduce((sum, child) => sum + countFiles(child), 0);

  let sinceYield = 0;
  /** Yields after ASSETS_PER_YIELD assets; false means this build was replaced. */
  const step = async (): Promise<boolean> => {
    if (++sinceYield < ASSETS_PER_YIELD) {
      return true;
    }
    sinceYield = 0;
    await yieldToBrowser();
    return isCurrent();
  };
  /** Maps one asset entry to its view row, retaining its cached URL. */
  const toViewFile = (name: string, file: string, bytes: Uint8Array): AssetViewFile => {
    const kind = assetKind(name);
    return {
      name,
      file,
      url: urlFor(name, bytes),
      kind,
      selected: selected === name,
      ...(kind === "shader" ? { text: new TextDecoder().decode(bytes) } : {}),
    };
  };
  /** Recursively maps a folder node and its children, yielding between batches. */
  const toViewFolder = async (node: AssetNode, path: string): Promise<AssetViewFolder | null> => {
    const files: AssetViewFile[] = [];
    for (const [name, file, bytes] of node.files) {
      files.push(toViewFile(name, file ?? "", bytes));
      if (!(await step())) {
        return null;
      }
    }
    const childFolders: AssetViewFolder[] = [];
    const children = [...node.folders.entries()];
    for (const [childName, child] of children) {
      const childFolder = await toViewFolder(child, `${path}/${childName}`);
      if (!childFolder) {
        return null;
      }
      childFolders.push(childFolder);
    }
    return {
      path,
      name: path.split("/").at(-1) ?? path,
      count: countFiles(node),
      files,
      folders: childFolders,
    };
  };

  const files: AssetViewFile[] = [];
  for (const [name, file, bytes] of rootFiles) {
    files.push(toViewFile(name, file, bytes));
    if (!(await step())) {
      return null;
    }
  }
  const viewFolders: AssetViewFolder[] = [];
  const topFolders = [...root.folders.entries()];
  for (const [name, child] of topFolders) {
    const folder = await toViewFolder(child, name);
    if (!folder) {
      return null;
    }
    viewFolders.push(folder);
  }

  const selectedBytes = selected ? assets.get(selected) : undefined;
  let selectedView: AssetViewSelected | undefined;
  if (selected && selectedBytes) {
    const selectedText =
      assetKind(selected) === "shader" ? new TextDecoder().decode(selectedBytes) : undefined;
    selectedView = {
      name: selected,
      url: urlFor(selected, selectedBytes),
      kind: assetKind(selected),
      ...(selectedText === undefined ? {} : { text: selectedText }),
      ...(selectedText === undefined
        ? {}
        : {
            shaderParameters: shaderParameters(selectedText),
            shaderParameterOverrides: shaderParameterOverrides(options.chart, selected),
          }),
    };
  }
  const folderExists = (folder: string): boolean =>
    folder === "" ? rootVisible : folders.has(folder);
  const selectedFolder = folderExists(options.selectedFolder)
    ? options.selectedFolder
    : defaultFolder(folders);
  const selectedFolderExists = folderExists(selectedFolder);
  const selectedFolderCount = selectedFolderExists
    ? entries.reduce((count, [name]) => {
        const normalized = imageName(name);
        const matches =
          selectedFolder === ""
            ? !normalized.includes("/")
            : normalized.startsWith(`${selectedFolder}/`);
        return count + (matches ? 1 : 0);
      }, 0)
    : 0;
  // An empty root group is still an empty library: the workspace shows its
  // full empty screen until an asset or a user-created folder exists.
  const blank = !entries.length && !viewFolders.length;
  return {
    selectedFolder,
    snapshot: {
      assetCount: entries.length,
      files,
      folders: viewFolders,
      empty: !entries.length,
      rootVisible,
      blank,
      rootIndex,
      selectedFolder,
      selectedFolderExists,
      selectedFolderCount,
      selected: selectedView,
    },
  };
}
