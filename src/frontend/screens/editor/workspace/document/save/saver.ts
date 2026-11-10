/**
 * Persists a stable chart/resource snapshot into the SQLite library, then
 * reconciles the result with the live session.
 *
 * A path argument is an explicit export, not the normal save. The browser/desktop
 * distinction disappears for saving: both use the local service, while the native
 * document store remains the import and export transport.
 */
import { t } from "../../../../../../i18n/index.ts";
import { showProgressToast } from "../../../../../../design/patterns/ToastHost.tsx";
import { serializeChartOffThread, serializeChartStream } from "./chartSerializeOffThread.ts";
import { registeredChartDocument } from "../../../../../../core/global/chart/streaming/chartDocumentRegistry.ts";
import { projectChartForExport } from "../../../../../../core/global/chart/exportProjection.ts";
import {
  assetNames,
  assetPath,
  snapshotAssets,
} from "../../../../../../core/global/document/resources.ts";
import { localService } from "../../../../../../core/global/library/service.ts";
import { materializeAssets } from "../../../../../../core/global/library/document.ts";
import { LocalLibraryError } from "../../../../../../core/global/library/client.ts";
import {
  catalogIdFor,
  rememberCatalogPath,
} from "../../../../../../core/global/library/libraryCatalog.ts";
import { saveLibraryDocument } from "../../../../../../core/global/library/save.ts";
import type { AssetMap } from "../../../../../../core/global/document/types.ts";
import { collaborationRoomDocument } from "../../../../../../core/collaboration/ui.ts";
import type { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import type { LocalLibrary } from "../../../../../../core/global/library/client.ts";
import type { SaveResult } from "../../../../../../core/global/document/desktopTypes.ts";

/** Live document state and persistence side effects used by the saver. */
export interface DocumentSaverDependencies {
  documents: TauriDocumentStore | null;
  currentSession: () => EditorSession;
  currentGeneration?: () => number;
  currentAssets: () => AssetMap;
  currentChartName: () => string;
  currentLibraryProject?: () => LibraryProjectRef | null;
  currentSourcePath?: () => string | null;
  currentAssetFolders?: () => string[];
  /** Test seam; production resolves the shared sidecar connection. */
  openLibrary?: () => Promise<LocalLibrary | null>;
  setAssetDirty: (dirty: boolean) => void;
  setLibraryProject: (project: LibraryProjectRef) => void;
  setChartName?: (name: string) => void;
  renderSession: () => void;
  onSaved?: (
    snapshot: EditorSession["chart"],
    result: Extract<SaveResult, { status: "saved" }>,
    generation: number,
  ) => void;
}

/** Save a stable snapshot into the library, or export it when a path is given. */
export function createDocumentSaver(deps: DocumentSaverDependencies) {
  let saving: Promise<SaveResult | null> | null = null;
  /** Resolves the shared library connection. */
  const library = deps.openLibrary ?? (async () => (await localService())?.library ?? null);

  /** Saves one snapshot; concurrent callers share the in-flight promise. */
  const save = async (saveAs = false, path?: string): Promise<SaveResult | null> => {
    if (saving) {
      return saving;
    }
    // A room chart is a temporary working copy. Only an explicit export path
    // may write it; the normal save path must never create a library entry.
    if (!path && collaborationRoomDocument.get()) {
      return null;
    }

    const current = deps.currentSession();
    const generation = deps.currentGeneration?.() ?? 0;
    const snapshot = current.chart;
    const captured = snapshotAssets(deps.currentAssets());
    const project = deps.currentLibraryProject?.() ?? null;
    const metaName = typeof snapshot.META?.name === "string" ? snapshot.META.name.trim() : "";
    const backgroundPath = assetPath(captured, snapshot.META?.background, deps.currentChartName());
    const background = backgroundPath ? captured.uri?.(backgroundPath) : undefined;
    const progressToast = showProgressToast(
      t("workspace.document.saving"),
      "info",
      background ? { kind: "image", src: background } : undefined,
    );
    progressToast.setProgress(0.05);

    saving = (async () => {
      const chartDocument = registeredChartDocument(snapshot as object);
      // A file export projects and serializes the complete chart. A paged
      // document must materialize its placeholders first; library saves keep
      // the streamed path below.
      const exportSource = path && chartDocument ? await chartDocument.materializeAll() : snapshot;
      const chartJson =
        path || !chartDocument
          ? await serializeChartOffThread(
              path ? projectChartForExport(exportSource, path) : snapshot,
            )
          : "";
      const chartChunks = !path && chartDocument ? serializeChartStream(snapshot) : undefined;
      progressToast.setProgress(0.2);

      // An explicit path is an export. It never becomes the live document.
      if (path) {
        if (!deps.documents) {
          throw new Error(t("editor.app.notice.desktopOnlySaveFile"));
        }
        // A native document can read unchanged resources from its own store.
        // A library document has no native store, so materialize its lazy map.
        const exported = deps.documents.current ? captured : await materializeAssets(captured);
        return deps.documents.export(chartJson, exported, { path });
      }

      const client = await library();
      if (!client) {
        throw new Error(t("editor.app.error.libraryServiceDown"));
      }
      // A native document has no project ref, but its file may already have been
      // imported; reuse that project and avoid a second library copy.
      let target = project;
      const sourcePath = deps.currentSourcePath?.() ?? null;
      if (!target?.id && sourcePath) {
        const mappedId = catalogIdFor(sourcePath);
        if (mappedId) {
          try {
            const loaded = await client.get(mappedId, { timeoutMs: 30_000 });
            target = {
              id: loaded.project.id,
              revision: loaded.project.revision,
              name: loaded.project.name,
              ...(loaded.project.group ? { group: loaded.project.group } : {}),
              ...(loaded.project.background ? { background: loaded.project.background } : {}),
              ...(loaded.project.assetFolders ? { assetFolders: loaded.project.assetFolders } : {}),
              ...(loaded.project.viewState ? { viewState: loaded.project.viewState } : {}),
            };
          } catch (error) {
            // A stale mapping may create a new project; a service failure must
            // still fail the save so no silent duplicate appears.
            if (!(error instanceof LocalLibraryError && error.status === 404)) {
              throw error;
            }
          }
        }
      }
      const projectName = target?.name || metaName || deps.currentChartName();
      const saved = await saveLibraryDocument({
        library: client,
        ...(target?.id ? { projectId: target.id } : {}),
        ...(target && Number.isFinite(target.revision) ? { baseRevision: target.revision } : {}),
        chart: snapshot,
        chartJson,
        ...(chartChunks ? { chartChunks } : {}),
        name: projectName,
        assets: captured,
        ...(target?.viewState ? { viewState: target.viewState } : {}),
        ...(deps.currentAssetFolders
          ? { assetFolders: deps.currentAssetFolders() }
          : target?.assetFolders
            ? { assetFolders: target.assetFolders }
            : {}),
        duplicate: saveAs,
        ...(saveAs
          ? {
              duplicateName: t("editor.home.duplicateNameSuffix", {
                name: projectName,
              }),
            }
          : {}),
        onProgress: (value) => progressToast.setProgress(0.2 + value * 0.75),
      });
      // Cache the committed hashes on the live map. A document first imported
      // from a file (or a brand-new chart) otherwise re-uploads every unchanged
      // asset on the next save.
      const live = deps.currentAssets() as AssetMap & {
        hashes?: Map<string, string>;
        original?: Map<string, Uint8Array>;
      };
      if (!live.hashes) {
        live.hashes = new Map();
      }
      if (!live.original) {
        live.original = new Map();
      }
      for (const entry of saved.manifest) {
        live.hashes.set(entry.name, entry.hash);
        const bytes = live.get(entry.name);
        if (bytes) {
          live.original.set(entry.name, bytes);
        }
      }
      if (saveAs) {
        deps.setChartName?.(saved.name);
      }
      if (sourcePath && (!target?.id || saveAs)) {
        rememberCatalogPath(sourcePath, saved.projectId);
      }
      deps.setLibraryProject({
        ...(target ?? {}),
        id: saved.projectId,
        revision: saved.revision,
        ...(saveAs ? { name: saved.name } : {}),
        ...(saved.committed?.background ? { background: saved.committed.background } : {}),
        ...(target?.assetFolders || deps.currentAssetFolders
          ? { assetFolders: deps.currentAssetFolders?.() ?? target?.assetFolders }
          : {}),
      });
      return {
        status: "saved" as const,
        storage: "library" as const,
        path: "",
        packed: false,
        chart_name: saved.name,
        remap: {},
        disk_snapshot: null,
        projectId: saved.projectId,
        revision: saved.revision,
      };
    })()
      .then((result) => {
        if (!result) {
          progressToast.dismiss();
          return result;
        }
        if (result.status === "save_conflict") {
          progressToast.finish(
            `${t("workspace.document.error.saveConflict")} ${t("workspace.document.solutionLabel")}: ${t("workspace.document.solution.saveConflict")}`,
            "warning",
          );
          return result;
        }
        if (
          (deps.currentGeneration && generation !== deps.currentGeneration()) ||
          current !== deps.currentSession()
        ) {
          progressToast.dismiss();
          return result;
        }
        current.history.markSaved(snapshot);
        if (current === deps.currentSession()) {
          if (current.chart === snapshot && result.chart) {
            current.history.document = result.chart;
            current.history.markSaved(result.chart);
          }
          const assets = deps.currentAssets();
          const liveNames = new Set(assetNames(assets));
          const capturedNames = new Set(assetNames(captured));
          const assetDirty =
            liveNames.size !== capturedNames.size ||
            [...capturedNames].some((name) => !liveNames.has(name)) ||
            [...captured].some(([name, bytes]) => Boolean(bytes) && assets.get(name) !== bytes);
          deps.setAssetDirty(assetDirty);
          deps.renderSession();
          if (result.storage === "library") {
            progressToast.finish(
              current.history.dirty || assetDirty
                ? t("editor.app.status.savedWithPendingChanges")
                : t("editor.app.status.savedToLibrary", { name: result.chart_name }),
              "success",
            );
          } else {
            progressToast.finish(
              current.history.dirty || assetDirty
                ? t("editor.app.status.savedWithPendingChanges")
                : t("editor.app.status.savedTo", { path: result.path }),
              "success",
            );
          }
        } else {
          progressToast.dismiss();
        }
        deps.onSaved?.(snapshot, result, generation);
        return result;
      })
      .catch((error: unknown) => {
        const baseMessage =
          error instanceof LocalLibraryError && error.code === "revision_conflict"
            ? t("workspace.document.error.libraryRevisionConflict")
            : error instanceof Error && error.message
              ? error.message
              : t("workspace.document.error.saveFailed");
        const solution =
          error instanceof LocalLibraryError && error.code === "revision_conflict"
            ? t("workspace.document.solution.libraryRevisionConflict")
            : error &&
                typeof error === "object" &&
                "solution" in error &&
                typeof error.solution === "string"
              ? error.solution
              : t("workspace.document.solution.saveGeneric");
        const message = `${baseMessage} ${t("workspace.document.solutionLabel")}: ${solution}`;
        progressToast.fail(message);
        throw error;
      })
      .finally(() => {
        saving = null;
      });
    return saving;
  };

  return {
    save,
    get pending() {
      return saving;
    },
  };
}
