/**
 * The document's own verbs, in one module.
 *
 * The file menu, the welcome screen, the metadata pane and the editor's own keys
 * all ask for the same handful of things: start a blank chart, open one, save it,
 * save it elsewhere, close it, pick its cover, pick its music, show its assets.
 * They live here as named functions so a command's `run` names a function
 * directly: `documents.openDocument` is this file's function.
 *
 * The editor connects its own pieces - the desktop store, the candidate loader,
 * the image loader, the session getter - while it mounts, through
 * `connectDocumentService`, and disconnects them when it is disposed. Nothing is
 * connected while the shell sits at the start page, and every verb here does
 * nothing then, which is what a command that fires before a chart is open should
 * do.
 */
import { t } from "../../../../../../i18n/index.ts";
import { type AssetMap } from "../../../../../../core/global/document/types.ts";
import { type LoadTask } from "../../../../../../core/global/document/loading.ts";
import type { TauriDocumentStore } from "../../../../../../core/platform/desktop/documentStore.ts";
import type { EditorCandidate } from "../../../../../../core/global/document/types.ts";
import type { LibraryProjectRef } from "../../../../../../core/global/library/types.ts";
import { openDrawerPane } from "../../../../../chrome/drawer/drawerPanes.ts";
import { OPEN_METADATA_EVENT } from "../../../../../../core/shell/shellEventNames.ts";
import { CHART_FILE_ACCEPT, openChartFiles } from "../open/chartFiles.ts";
import { requestChoice, requestConfirm } from "../../../../../overlays/modals/prompts.ts";
import type { MediaKind } from "../../../chartMetadata/MediaFields.tsx";
import { pickFiles } from "../../../../../platform/filePicker.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { createLateBound } from "../../../../../../core/utils/lateBound.ts";
import { requestNewChartDetectionChoice } from "./newChartDetectionPrompt.ts";
import {
  newChartDetectionTrigger,
  readTimingDetectionPreference,
  resolveNewChartDetection,
  type NewChartDetectionTrigger,
  writeTimingDetectionPreference,
} from "./newChartDetectionPreference.ts";
import { openTimingDetection } from "../../timingDetection/timingDetectionState.ts";

/** The images the asset pane picks up from the project folder. */
const PROJECT_IMAGE_PATTERN = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** Editor services the document menu verbs call. */
export interface DocumentServiceBindings {
  documents: TauriDocumentStore | null;
  openNativeDocument(): Promise<void>;
  guardReplace(action: () => unknown, title?: string): unknown;
  /** Create a blank chart; timing detection waits for its first audio file. */
  createBlankChart(trigger?: NewChartDetectionTrigger): Promise<void>;
  hasUnsavedChanges(): boolean;
  loadCandidate(
    candidate: EditorCandidate,
    assets: AssetMap,
    task?: LoadTask,
    reason?: DocumentLoadReason,
  ): Promise<void>;
  save(): unknown;
  saveAs(): unknown;
  closeDocument(): unknown;
  pickMedia(kind: MediaKind): Promise<void>;
  /** Getter: opening a chart installs a fresh asset map. */
  getAssets(): AssetMap;
  getSession(): EditorSession;
  getChartName(): string;
  setLibraryProject(project: LibraryProjectRef | null): void;
  renderSession(): void;
  notify(message: string, level: string): void;
  reportError(error: unknown): void;
  /** The asset pane's own model, refreshed after its folder has been read. */
  assetLibrary: { render(): Promise<void> };
}

/** Why a candidate is replacing the current document. */
export type DocumentLoadReason = "open" | "create" | "restore";

const service = createLateBound<DocumentServiceBindings>();

/** Hands the mounted editor's document pieces to the verbs below. */
export function connectDocumentService(bindings: DocumentServiceBindings): () => void {
  return service.bind(bindings);
}

/** Ask the new-chart timing question after the first audio file arrives. */
export async function resolveNewChartDetectionAfterAudio(session: EditorSession): Promise<void> {
  const bound = service.value();
  if (!bound || bound.getSession() !== session) {
    return;
  }
  const choice = await requestNewChartDetectionChoice();
  if (choice === null || service.value() !== bound || bound.getSession() !== session) {
    return;
  }
  const preference = readTimingDetectionPreference();
  const decision = resolveNewChartDetection(preference, choice);
  writeTimingDetectionPreference(decision.preference);
  if (decision.detect) {
    openTimingDetection("new-chart");
  }
}

/** Create a blank library document and send the user to the metadata editor. */
export function newDocument(): void {
  const bound = service.value();
  if (!bound) {
    return;
  }
  const install = (trigger: NewChartDetectionTrigger) => {
    void bound
      .createBlankChart(trigger)
      .then(() => {
        if (service.value() === bound) {
          // A new chart has no metadata yet; unfolding the toolbar row puts its
          // name and composer fields in front of the author without covering the
          // timeline with a page.
          window.dispatchEvent(new Event(OPEN_METADATA_EVENT));
        }
      })
      .catch(bound.reportError);
  };
  const installWithPreference = (): void => {
    install(newChartDetectionTrigger(readTimingDetectionPreference()));
  };
  if (!bound.hasUnsavedChanges()) {
    installWithPreference();
    return;
  }
  void requestConfirm({
    title: t("chrome.menu.file.new"),
    description: t("editor.dialogs.dialog.unsavedChanges"),
    destructive: true,
  })
    .then((confirmed) => {
      if (confirmed && service.value() === bound) {
        installWithPreference();
      }
    })
    .catch(bound.reportError);
}

/** Offers the parsed candidates from picked files and loads the chosen one. */
function loadPickedCharts(bound: DocumentServiceBindings, files: readonly File[]): Promise<void> {
  return openChartFiles(files, {
    guardReplace: bound.guardReplace,
    loadCandidate: bound.loadCandidate,
    chooseCandidates: async (candidates, assets) => {
      const chosen = await requestChoice({
        title: t("editor.app.dialog.chooseChart"),
        description: t("editor.app.dialog.multipleCharts"),
        entries: candidates,
        label: (candidate) => `${candidate.name} · ${candidate.chart.META.name ?? ""}`,
      });
      if (chosen) {
        await bound.loadCandidate(chosen, assets).catch(bound.reportError);
      }
    },
    reportError: bound.reportError,
  });
}

/** Opens a chart: the desktop store's picker, or the browser's own file input. */
export function openDocument(): void {
  const bound = service.value();
  if (!bound) {
    return;
  }
  const documents = bound.documents;
  if (documents) {
    bound.guardReplace(() => bound.openNativeDocument());
    return;
  }
  void pickFiles({ accept: CHART_FILE_ACCEPT, multiple: true })
    .then((files) => (files ? loadPickedCharts(bound, files) : undefined))
    .catch(bound.reportError);
}

/** Saves the open document into the library. */
export function saveDocument(): void {
  service.value()?.save();
}

/** Save-as needs a store to write a second file into; in the browser it is a no-op. */
export function saveAsDocument(): void {
  const bound = service.value();
  if (bound?.documents) {
    bound.saveAs();
  }
}

/** Closes the open document after the unsaved-changes decision. */
export function closeDocument(): void {
  const bound = service.value();
  if (!bound) {
    return;
  }
  bound.guardReplace(bound.closeDocument, t("editor.app.dialog.closeChart"));
}

/** Picks the cover image: the file input behind it is the editor's. */
export function pickBackground(): void {
  const bound = service.value();
  if (!bound) {
    return;
  }
  void bound.pickMedia("background").catch(bound.reportError);
}

/** Picks the document's music track. */
export function pickMusic(): void {
  const bound = service.value();
  if (!bound) {
    return;
  }
  void bound.pickMedia("song").catch(bound.reportError);
}

/**
 * Opens the assets drawer with the project's images read from disk first.
 *
 * Assets are document-wide, so this opens the drawer pane and leaves the
 * inspector to editing panels.
 */
export async function openAssets(): Promise<void> {
  const bound = service.value();
  if (!bound) {
    return;
  }
  try {
    const store = bound.documents;
    const live = bound.getAssets() as AssetMap & {
      materialize?(pattern?: RegExp): Promise<void>;
    };
    if (live.materialize) {
      await live.materialize(PROJECT_IMAGE_PATTERN);
    } else if (store?.assets) {
      await store.assets.materialize(PROJECT_IMAGE_PATTERN);
      for (const [name, bytes] of store.assets.assets) {
        if (bytes && !bound.getAssets().get(name)) {
          bound.getAssets().set(name, bytes);
        }
      }
    }
    openDrawerPane("assets");
    await bound.assetLibrary.render();
  } catch (error) {
    bound.reportError(error);
  }
}

/** The document verbs, as the commands' entry point sees them. */
export const documents = Object.freeze({
  newDocument,
  openDocument,
  saveDocument,
  saveAsDocument,
  closeDocument,
  pickBackground,
  pickMusic,
  openAssets,
});
