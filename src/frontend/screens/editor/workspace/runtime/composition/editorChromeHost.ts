/**
 * Binds the editor screen's controllers to the chrome host contract.
 *
 * The shell calls this once before registering built-in actions. Chrome then
 * reaches documents, transport, view controls, navigation, and inspector entry
 * points through `frontend/contracts/` instead of importing this screen. The
 * spectrum worker factory is bound here too, so the worker URL stays with the
 * editor that owns the analysis code.
 */
import { bindAudioAnalysisWorker } from "../../../../../contracts/audioAnalysisWorker.ts";
import { bindEditorChromeCommands } from "../../../../../contracts/editorCommands.ts";
import { openPane } from "../../../inspector/controller.ts";
import * as documentService from "../../document/lifecycle/service.ts";
import { transport } from "../commands/transport.ts";
import { getEditorRegionSnapshot, viewControls } from "../commands/viewControls.ts";
import { navigation } from "../commands/workspaceNavigation.ts";

/** Binds the editor's chrome commands and spectrum worker; returns their disposer. */
export function connectEditorChromeHost(): () => void {
  const unbindCommands = bindEditorChromeCommands({
    documents: {
      newDocument: () => documentService.newDocument(),
      openDocument: () => documentService.openDocument(),
      saveDocument: () => documentService.saveDocument(),
      closeDocument: () => documentService.closeDocument(),
    },
    transport: {
      togglePlayback: () => transport.togglePlayback(),
      beginAudition: (options) => transport.beginAudition(options),
      endAudition: () => transport.endAudition(),
      rewind: () => transport.rewind(),
      seekToBeat: (beat) => transport.seekToBeat(beat),
    },
    view: {
      isPreviewLayout: () => {
        const regions = getEditorRegionSnapshot();
        return regions.showPreview && !regions.showNotes && !regions.showEvents;
      },
      resetCamera: (resetPreview) => viewControls.resetCamera(resetPreview),
      togglePreviewOnly: () => viewControls.togglePreviewOnly(),
      toggleRegion: (region) => viewControls.toggleRegion(region),
      toggleStagePreview: () => viewControls.toggleStagePreview(),
      toggleRegions: () => viewControls.toggleRegions(),
    },
    navigation: {
      openLibrary: () => navigation.openLibrary(),
    },
    inspector: {
      openPane: (id) => openPane(id),
    },
  });
  const unbindWorker = bindAudioAnalysisWorker(
    () =>
      new Worker(
        new URL("../../timeline/audioAnalysis/workers/audioAnalysis.ts", import.meta.url),
        {
          type: "module",
        },
      ),
  );
  return () => {
    unbindWorker();
    unbindCommands();
  };
}
