/**
 * Owns leaving and re-entering the workspace: the home view, the unsaved-document
 * decision, and the reset work that must precede it. Document persistence stays
 * in the document service.
 */
import { requestActionChoice } from "../../../../../overlays/modals/prompts.ts";
import { MODAL_PRIORITY } from "../../../../../overlays/modals/modalQueue.ts";
import { t } from "../../../../../../i18n/index.ts";
import {
  getEditorVisibility,
  setEditorVisibility,
} from "../../../../../../core/edit/state/visibility.ts";
import {
  collaborationPreparing,
  collaborationRoom,
  collaborationRoomDocument,
} from "../../../../../../core/collaboration/ui.ts";
import { TOOLBAR_REFRESH_EVENT } from "../../../../../../core/shell/shellEventNames.ts";
import { createLateBound } from "../../../../../../core/utils/lateBound.ts";
import { collaborationRoomExit } from "../../collaboration/roomExit.ts";
import { planLeaveEditor } from "./leaveEditor.ts";

/** Editor services the home transition drives while leaving a document. */
export interface WorkspaceNavigationOptions {
  atHome(): boolean;
  hasDocument(): boolean;
  clearNoteSourceToast(): void;
  resetLineSwitcher(): void;
  setMuteCurrentLine(muted: boolean): void;
  setLineInfoVisible(visible: boolean): void;
  pausePlayback(): void;
  cancelTimelinePlacement(): void;
  refreshHome(): Promise<void>;
  invalidate(): void;
  hasUnsavedChanges(): boolean;
  save(): Promise<unknown>;
  closeDocument(): void;
  reportError(error: unknown): void;
}

/** Owns the editor-to-library transition and its unsaved-document decision. */
export function createWorkspaceNavigation(options: WorkspaceNavigationOptions) {
  /** Shows or hides the home view and resets the editor chrome for it. */
  const setHome = (visible: boolean) => {
    setEditorVisibility({
      ...getEditorVisibility(),
      atHome: visible,
      hasDocument: options.hasDocument(),
      // The home screen has no open document to be unsaved.
      dirty: visible ? false : getEditorVisibility().dirty,
    });
    if (visible) {
      options.clearNoteSourceToast();
      options.resetLineSwitcher();
      options.setMuteCurrentLine(false);
      options.setLineInfoVisible(false);
    }
    window.dispatchEvent(new Event(TOOLBAR_REFRESH_EVENT));
    if (visible) {
      options.pausePlayback();
      options.cancelTimelinePlacement();
      options.refreshHome().catch(options.reportError);
    }
    options.invalidate();
  };

  /** Guards against a second library request while the confirmation is open. */
  let leaving = false;

  /**
   * Pauses the editor and returns to the library after one confirmation.
   *
   * Every path asks first, even a saved document. The prompt gains Save and
   * Discard only when the document is dirty, and it names the room outcome when
   * returning would also close or leave a collaboration session.
   */
  const openLibrary = async () => {
    if (options.atHome() || leaving) {
      return;
    }
    leaving = true;
    try {
      options.pausePlayback();
      const plan = planLeaveEditor({
        hasDocument: options.hasDocument(),
        dirty: options.hasUnsavedChanges(),
        roomDocument: collaborationRoomDocument.get(),
        collaboration: collaborationRoom.get(),
        collaborationPreparing: collaborationPreparing.get(),
      });
      // A dismissed prompt answers "cancel": the editor stays where it is.
      const answer = await requestActionChoice({
        title: t(plan.titleKey),
        description: t(plan.descriptionKey),
        entries: plan.choices.map((choice) => ({
          value: choice.action,
          label: t(choice.labelKey),
          variant: choice.variant,
        })),
        cancelValue: "cancel",
        priority: MODAL_PRIORITY.closePrompt,
      });
      if (answer === "cancel") {
        return;
      }
      try {
        if (answer === "save") {
          await options.save();
          if (options.hasUnsavedChanges()) {
            throw new Error(t("editor.app.error.stillUnsaved"));
          }
        } else if (answer === "discard") {
          options.closeDocument();
        }
        if (plan.room !== "none") {
          collaborationRoomExit.exit();
        }
        setHome(true);
      } catch (failure) {
        options.reportError(failure);
      }
    } finally {
      leaving = false;
    }
  };

  return { setHome, openLibrary };
}

// ------------------------------------------------------------ the library trip

const navigationBinding = createLateBound<ReturnType<typeof createWorkspaceNavigation>>();

/**
 * Hands the mounted editor's home transition to the commands below and returns
 * that navigation handle alongside its disposer.
 */
export function bindWorkspaceNavigation(options: WorkspaceNavigationOptions): {
  navigation: ReturnType<typeof createWorkspaceNavigation>;
  dispose: () => void;
} {
  const navigation = createWorkspaceNavigation(options);
  return { navigation, dispose: navigationBinding.bind(navigation) };
}

/** The library trip, as the Page menu, the rail and the editor's own lifecycle see it. */
export const navigation = Object.freeze({
  setHome: (visible: boolean): void => navigationBinding.value()?.setHome(visible),
  openLibrary: (): void => {
    void navigationBinding.value()?.openLibrary();
  },
});
