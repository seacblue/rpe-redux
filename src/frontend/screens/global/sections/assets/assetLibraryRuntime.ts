/**
 * Runtime wiring for the asset-library feature: resolves the chart's directory,
 * loads images, and writes asset maps and folders back into the session.
 *
 * A directory scan is accepted only for the chart's own folder, because asset
 * references are relative to it; keeping this here leaves the pane model free of
 * platform access.
 */
import type { AssetMap } from "../../../../../core/global/document/types.ts";
import { withChartFolders } from "../../../../../core/global/document/folders.ts";
import {
  setShaderParameterOverrides,
  type ShaderParameterOverrides,
} from "../../../../../core/global/chart/shader/shaderEvents.ts";
import { t } from "../../../../../i18n/index.ts";
import type { ProjectImages } from "../../../../../core/media/images.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { currentDocumentStore } from "../../../../platform/documentStoreHandle.ts";
import { readDroppedAssetFiles } from "../../../../platform/desktop/droppedAssetFiles.ts";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../../../../core/platform/environment.ts";
import { AssetLibraryPanel } from "./assetLibrary.ts";
import type { AssetLibraryState } from "./model.ts";

/**
 * The directory that holds the open chart.
 *
 * A folder scan reports paths relative to the folder the user picked; comparing
 * that folder with this one is how the panel refuses to import a directory that
 * is not the chart's own.
 */
function chartDirectoryName(): string | undefined {
  const path = currentDocumentStore()?.current?.path;
  if (!path) {
    return undefined;
  }
  const parts = path.replaceAll("\\", "/").split("/");
  parts.pop();
  return parts.at(-1) || undefined;
}

/** Open a loose-document asset in the user's associated external editor. */
async function openExternalAsset(
  name: string,
  notify: (message: string, severity?: string) => void,
) {
  const store = currentDocumentStore();
  if (!isDesktop() || !store?.current) {
    notify(t("editorPanels.assetLibrary.openExternalDesktopOnly"), "warning");
    return;
  }
  try {
    await invoke("open_asset_external", { id: store.current.id, name });
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error), "error");
  }
}

/**
 * Creates the asset-library panel for one editor runtime.
 *
 * `deps` supplies the session, the live asset map and folders, the image loader,
 * and the commit/notify hooks; asset and folder changes are written back into
 * the session so they stay undoable and serialize with the chart.
 */
export function createAssetLibraryRuntime(deps: {
  state: AssetLibraryState;
  getSession(): EditorSession;
  getAssets(): AssetMap;
  getAssetFolders(): Set<string>;
  getChartName(): string;
  attachAssets(assets: AssetMap): void;
  setAssets(assets: AssetMap): void;
  setAssetFolders(folders: Set<string>): void;
  markDirty(): void;
  /** Announces a committed local asset-map mutation to the room runtime. */
  onAssetsChanged?(): void;
  images: Pick<ProjectImages, "load">;
  notify(message: string, severity?: string): void;
  renderSession(): void;
}): AssetLibraryPanel {
  const loadImages = () =>
    deps.images.load(deps.getSession().chart, deps.getAssets(), deps.getChartName());

  return new AssetLibraryPanel(
    () => ({
      assets: deps.getAssets(),
      folders: deps.getAssetFolders(),
      chartDirectoryName: chartDirectoryName(),
      chart: deps.getSession().chart,
    }),
    {
      state: deps.state,
      notify: deps.notify,
      readDroppedFiles: readDroppedAssetFiles,
      onOpenExternal: (name) => openExternalAsset(name, deps.notify),
      onConfigureShader: (name: string, overrides: ShaderParameterOverrides) => {
        const session = deps.getSession();
        session.commitChart(
          t("editorPanels.assetLibrary.shaderParametersCommit"),
          setShaderParameterOverrides(session.chart, name, overrides),
          session.selectionState(),
          undefined,
          { normalized: true },
        );
        deps.markDirty();
        deps.renderSession();
      },
      onChange: (nextAssets, nextFolders) => {
        const folders = new Set(nextFolders ?? []);
        const previousAssets = deps.getAssets();
        const bytesChanged =
          nextAssets.size !== previousAssets.size ||
          [...nextAssets].some(([name, bytes]) => previousAssets.get(name) !== bytes);
        deps.attachAssets(nextAssets);
        deps.setAssets(nextAssets);
        deps.setAssetFolders(folders);
        // Folder organization alone is not a room asset replacement; only a
        // changed name or byte reference should reach the collaboration push.
        if (bytesChanged) {
          deps.onAssetsChanged?.();
        }
        // The organization is chart data: writing it into the chart object is
        // what makes a PEZ, a JSON project and an export all keep it. The commit
        // is the document's own change, so it is undoable like any other.
        const session = deps.getSession();
        const chart = withChartFolders(session.chart, [...folders]);
        if (chart !== session.chart) {
          session.commitChart(
            t("editorPanels.assetLibrary.foldersCommit"),
            chart,
            session.selectionState(),
            undefined,
            { normalized: true },
          );
        }
        loadImages();
        deps.markDirty();
        deps.notify(t("editor.app.notice.assetLibraryDirty"), "warning");
        deps.renderSession();
      },
      onTexture: (oldName, newName = oldName) => {
        const session = deps.getSession();
        const lines = [...(session.chart.judgeLineList ?? [])];
        if (newName !== oldName) {
          let changed = false;
          for (let index = 0; index < lines.length; index++) {
            if (lines[index]?.Texture === oldName) {
              lines[index] = { ...lines[index], Texture: newName };
              changed = true;
            }
          }
          if (changed) {
            session.commitChart(
              t("editor.app.commit.renameLineTexture"),
              {
                ...session.chart,
                judgeLineList: lines,
              },
              session.selectionState(),
              undefined,
              { normalized: true },
            );
          }
          loadImages();
          return;
        }
        const index = session.lineIndex;
        if (!lines[index]) {
          return;
        }
        lines[index] = { ...lines[index], Texture: newName };
        session.commitChart(
          t("editor.app.commit.changeLineTexture"),
          {
            ...session.chart,
            judgeLineList: lines,
          },
          session.selectionState(),
          undefined,
          { normalized: true },
        );
        loadImages();
      },
    },
  );
}
