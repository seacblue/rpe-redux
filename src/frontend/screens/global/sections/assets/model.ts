/**
 * View types and the state cell for the asset-library pane.
 *
 * `null` is an unbuilt pane, distinct from `loading`; failed builds publish
 * `error` instead of throwing. Root files travel separately from the folder
 * tree so the view can hide a deleted Default group without losing the files.
 */
import { createValue, type ValueCell } from "../../../../../core/state/values.ts";
import type {
  ShaderParameter,
  ShaderParameterOverrides,
} from "../../../../../core/global/chart/shader/shaderEvents.ts";

/** A media file in the asset tree. */
export type AssetViewKind = "image" | "audio" | "shader";

/** A media file in the asset tree and the object URL used for its preview. */
export interface AssetViewFile {
  name: string;
  file: string;
  url: string;
  selected: boolean;
  kind: AssetViewKind;
  text?: string;
}

/** A folder in the asset tree, recursively containing child folders. */
export interface AssetViewFolder {
  /** Full chart-relative folder path; folder names repeat across levels. */
  path: string;
  /** The last path segment, which is what the row shows. */
  name: string;
  count: number;
  files: AssetViewFile[];
  folders: AssetViewFolder[];
}

/** The currently selected asset, resolved to a preview URL. */
export interface AssetViewSelected {
  name: string;
  url: string;
  kind: AssetViewKind;
  text?: string;
  shaderParameters?: ShaderParameter[];
  shaderParameterOverrides?: ShaderParameterOverrides | null;
}

/** Panel callbacks, rebound by `AssetLibraryPanel` for each snapshot. */
export interface AssetLibraryViewActions {
  onAdd(): void;
  onFiles(files: FileList | null): void;
  onCreateFolder(): void;
  onSelectFolder(path: string): void;
  onDeleteFolder(path: string): void;
  /** Move one asset into a folder, optionally before/after another asset. */
  onMoveAsset(name: string, folder: string, targetName?: string, after?: boolean): void;
  /** Reorder a folder among its own siblings. */
  onMoveFolder(path: string, targetPath: string, after?: boolean): void;
  addInputRef(node: HTMLInputElement | null): void;
  onSelect(name: string): void;
  onRename(name?: string): void;
  onConfigureShader(name: string, overrides: ShaderParameterOverrides): void;
  onOpenExternal(): void;
  onDelete(): void;
}

/**
 * All data needed to render the panel.
 *
 * `files` are the images that sit directly in the chart's folder and `folders`
 * are the top-level ones. The view places the root files in the `Default` group
 * when that group is present; a user may delete the group once it is empty.
 */
export interface AssetLibraryPanelSnapshot {
  assetCount: number;
  files: AssetViewFile[];
  folders: AssetViewFolder[];
  empty: boolean;
  /** Whether the root Default group is present and should be drawn. */
  rootVisible: boolean;
  /** No assets and no groups: the workspace shows its empty screen. */
  blank: boolean;
  /** Insertion index of the root Default group among top-level folders. */
  rootIndex: number;
  selectedFolder: string;
  /** Whether the selected folder still exists. */
  selectedFolderExists: boolean;
  /** Assets in the selected folder's subtree; zero enables Delete group. */
  selectedFolderCount: number;
  selected?: AssetViewSelected;
}

/** Complete props received by the view: data plus callbacks. */
export interface AssetLibraryViewProps extends AssetLibraryPanelSnapshot, AssetLibraryViewActions {
  /** Global pages split the tree and the selected-image inspector. */
  variant?: "all" | "tree" | "details";
}

/**
 * Panel state.
 *
 * View construction is asynchronous, so the neutral initial `null` state must stay
 * distinct from `loading`: the former is an empty hidden mount, while the latter
 * provides a spinner fallback. Failed builds publish `error` instead of throwing;
 * the panel shows a translated message and the controller reports the detail via toast.
 */
export type AssetLibraryPanelState =
  | { status: "loading" }
  | { status: "ready"; snapshot: AssetLibraryPanelSnapshot; actions: AssetLibraryViewActions }
  | { status: "error"; retry(): void };

/** The pane's state cell; `null` means no build has run yet. */
export type AssetLibraryState = ValueCell<AssetLibraryPanelState | null>;

/** Creates the asset pane state for one mounted editor tree. */
export function createAssetLibraryState(): AssetLibraryState {
  return createValue<AssetLibraryPanelState | null>({ initial: null });
}
