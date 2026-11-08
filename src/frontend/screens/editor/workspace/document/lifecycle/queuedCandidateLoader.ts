/**
 * The document service decides when to replace, and the coordinator admits each
 * load so opening a chart cannot race a save, autosave, or Code Cell write.
 */
import {
  beginLoading,
  loadingProgress,
  type LoadTask,
} from "../../../../../../core/global/document/loading.ts";
import type { OpenResult } from "../../../../../../core/global/document/desktopTypes.ts";
import type { OpenDocumentOptions } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { AssetMap, EditorCandidate } from "../../../../../../core/global/document/types.ts";
import type {
  DocumentChangeCoordinator,
  DocumentLoadHandle,
  DocumentRevisionExpectation,
} from "../../../../../../core/edit/document/changeCoordinator.ts";
import { extensionRegistry } from "../../../../../../core/extensions/runtime.ts";
import { t } from "../../../../../../i18n/index.ts";
import type { DocumentLeaseHandle } from "../open/documentLease.ts";
import { createExternalResourceOpenSession } from "../open/externalResourceOpen.ts";
import type { DocumentLoadReason } from "./service.ts";

/** A candidate plus the conversion state the replacement still has to persist. */
export interface PreparedEditorCandidate extends EditorCandidate {
  /** Conversion materialized current-format fields; the caller should save once. */
  readonly converted?: boolean;
}

/** Services and state the queued loader uses for every replacement. */
export interface QueuedCandidateLoaderOptions {
  readonly coordinator: Pick<DocumentChangeCoordinator, "submitReplacement">;
  readonly openDocument?: (path: string, options?: OpenDocumentOptions) => Promise<OpenResult>;
  readonly loadCandidateResources: (
    candidate: EditorCandidate,
    assets: AssetMap,
    task: LoadTask,
  ) => Promise<void>;
  /**
   * Validate or convert a candidate before it replaces the document. Returning
   * null means the user cancelled; no replacement is started in that case.
   */
  readonly prepareCandidate?: (
    candidate: EditorCandidate,
  ) => Promise<PreparedEditorCandidate | null>;
  /**
   * Persist a converted document once its replacement has left the change
   * queue. Saving inside the replacement callback would deadlock the queue.
   */
  readonly commitConverted?: () => Promise<unknown>;
  /** Acquire cross-instance occupancy before replacing the document. */
  readonly acquireDocumentLease?: (
    documentKey: string | null,
    chartName: string,
  ) => Promise<DocumentLeaseHandle | null>;
  readonly documentKeyForCandidate?: (candidate: EditorCandidate) => string | null;
  readonly documentKeyForPath?: (path: string) => string;
  /**
   * Restore the native document that was active before a rejected open. The
   * desktop store activates the new file before the chart is accepted, so a
   * cancel has to put the previous file back rather than leave the store on an
   * unopened chart.
   */
  readonly restoreDocument?: (path: string | null) => Promise<void>;
  readonly currentChartFingerprint: () => string;
  readonly currentDiskSnapshot: () => string | null;
  readonly currentChartName: () => string;
  readonly currentPath: () => string | null;
  readonly awaitFingerprint?: () => Promise<string>;
  readonly currentChart: () => Chart;
}

/** Admit document replacement work so loading cannot race a save or Code Cell write. */
export function createQueuedCandidateLoader(options: QueuedCandidateLoaderOptions) {
  const openWithExternalResources = options.openDocument
    ? createExternalResourceOpenSession(options.openDocument)
    : null;

  /** Runs the optional candidate validation and dismisses loading on cancel. */
  const prepare = async (candidate: EditorCandidate): Promise<PreparedEditorCandidate | null> => {
    if (!options.prepareCandidate) {
      return candidate;
    }
    const prepared = await options.prepareCandidate(candidate);
    if (!prepared) {
      // A prompt can be shown while a desktop open still owns the progress
      // surface; cancel closes it rather than leaving a stuck loading modal.
      loadingProgress.dismiss();
    }
    return prepared;
  };

  /** Persists a converted document without failing an already successful open. */
  const commitConverted = async (candidate: PreparedEditorCandidate): Promise<void> => {
    if (!candidate.converted) {
      return;
    }
    try {
      await options.commitConverted?.();
    } catch {
      // The document is already open. The saver reports its own failure toast;
      // a failed conversion save must not reject the successful open.
    }
  };

  /** Runs the hooks, resource load, and completion for one admitted replacement. */
  const loadInsideReplacement = async (
    load: DocumentLoadHandle,
    candidate: EditorCandidate,
    assets: AssetMap,
    task: LoadTask,
    reason: DocumentLoadReason,
    finalizeReplacement?: () => Promise<void>,
  ): Promise<void> => {
    try {
      if (reason === "create") {
        const payload = { cancel: false };
        extensionRegistry.emitHook("document:before-create", payload);
        if (payload.cancel) {
          throw new Error(t("workspace.document.error.createCancelled"));
        }
      } else {
        const payload = { source: reason, cancel: false };
        extensionRegistry.emitHook("document:before-open", payload);
        if (payload.cancel) {
          throw new Error(t("workspace.document.error.openCancelled"));
        }
      }
      await options.loadCandidateResources(candidate, assets, task);
      const fingerprint = options.awaitFingerprint
        ? await options.awaitFingerprint()
        : options.currentChartFingerprint();
      task.complete();
      if (
        !load.complete({
          chartFingerprint: fingerprint,
          diskSnapshot: options.currentDiskSnapshot(),
        })
      ) {
        throw new Error(t("system.document.loadCancelled"));
      }
      await finalizeReplacement?.();
      const eventName =
        reason === "create"
          ? "document:created"
          : reason === "restore"
            ? "document:restored"
            : "document:opened";
      if (extensionRegistry.hasEvent(eventName)) {
        extensionRegistry.emitEvent(eventName, {
          name: options.currentChartName(),
          path: options.currentPath(),
          chart: structuredClone(options.currentChart()),
        });
      }
    } catch (error) {
      task.fail(error);
      throw error;
    }
  };

  /** Converts a non-accepted coordinator result into the error the caller sees. */
  const assertAdmitted = (
    result: Awaited<ReturnType<DocumentChangeCoordinator["submitReplacement"]>>,
  ): void => {
    if (result.status === "rejected") {
      // Keep the original failure so callers can act on its code and cause.
      if (result.error instanceof Error) {
        throw result.error;
      }
      throw new Error(result.message ?? result.reason);
    }
    if (result.status === "stale") {
      throw new Error(t("system.document.loadCancelled"));
    }
    if (result.status === "conflict") {
      throw new Error(t("system.document.loadCancelled"));
    }
  };

  /** Loads a prepared candidate through the change coordinator and settles its lease. */
  const loadCandidate = async (
    candidate: EditorCandidate,
    assets: AssetMap,
    task?: LoadTask,
    reason: DocumentLoadReason = "open",
    expected?: DocumentRevisionExpectation,
    finalizeReplacement?: () => Promise<void>,
  ): Promise<void> => {
    const lease = options.acquireDocumentLease
      ? await options.acquireDocumentLease(
          options.documentKeyForCandidate?.(candidate) ?? null,
          candidate.name,
        )
      : undefined;
    if (lease === null) {
      return;
    }
    try {
      const prepared = await prepare(candidate);
      if (!prepared) {
        await lease?.cancel();
        return;
      }
      task ??= beginLoading(prepared.name);
      const admitted = await options.coordinator.submitReplacement(async (load) => {
        await loadInsideReplacement(load, prepared, assets, task!, reason, finalizeReplacement);
      }, expected);
      assertAdmitted(admitted);
      await lease?.commit();
      await commitConverted(prepared);
    } catch (error) {
      await lease?.cancel();
      throw error;
    }
  };

  /** Opens a native path, restoring the previous document when the open is cancelled. */
  const openPath = async (
    path: string,
    reason: DocumentLoadReason = "open",
    expected?: DocumentRevisionExpectation,
  ): Promise<void> => {
    if (!openWithExternalResources) {
      throw new Error(t("workspace.document.error.pathUnavailable"));
    }
    const lease = options.acquireDocumentLease
      ? await options.acquireDocumentLease(options.documentKeyForPath?.(path) ?? null, path)
      : undefined;
    if (lease === null) {
      return;
    }
    const previousPath = options.currentPath();
    let cancelled = false;
    let restoreError: unknown;
    let prepared: PreparedEditorCandidate | null = null;
    try {
      const admitted = await options.coordinator.submitReplacement(async (load) => {
        const opened = await openWithExternalResources(path);
        prepared = await prepare(opened.candidate);
        if (!prepared) {
          cancelled = true;
          if (!load.restore()) {
            load.cancel();
          }
          try {
            await options.restoreDocument?.(previousPath);
          } catch (error) {
            restoreError = error;
          } finally {
            loadingProgress.dismiss();
          }
          return;
        }
        await loadInsideReplacement(load, prepared, opened.assets, opened.task, reason);
      }, expected);
      if (cancelled) {
        await lease?.cancel();
        if (restoreError) {
          throw restoreError;
        }
        return;
      }
      assertAdmitted(admitted);
      await lease?.commit();
      if (prepared) {
        await commitConverted(prepared);
      }
    } catch (error) {
      await lease?.cancel();
      throw error;
    }
  };

  return { loadCandidate, openPath };
}
