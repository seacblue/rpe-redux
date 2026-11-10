/**
 * Plans the confirmed trip from the editor back to the chart library.
 *
 * The plan composes the document's save state with the collaboration session,
 * because returning hides the workspace and may end a room. Copy is expressed
 * as message keys so the prompt and its tests share one decision.
 */
import type { MessageKey } from "../../../../../../i18n/index.ts";
import { roomNeedsExitConfirmation } from "../../../../../../core/collaboration/ui.ts";
import type { CollaborationState } from "../../../../../../core/collaboration/types.ts";

/** How an exit prompt answers the library request. */
export type LeaveEditorAction = "save" | "discard" | "exit" | "cancel";

/** One footer button in the exit prompt. */
export interface LeaveEditorChoice {
  readonly action: LeaveEditorAction;
  readonly labelKey: MessageKey;
  readonly variant: "solid" | "danger" | "outlined";
}

/** What returning to the library must account for. */
export type LeaveEditorRoom = "none" | "host" | "guest" | "pending";

/** The complete confirmation the library trip renders. */
export interface LeaveEditorPlan {
  readonly titleKey: MessageKey;
  readonly descriptionKey: MessageKey;
  /** Additional reasons rendered under the title when one key is not enough. */
  readonly descriptionKeys?: readonly MessageKey[];
  /** Collaboration work the chosen action must end. */
  readonly room: LeaveEditorRoom;
  /** Whether the open document is a guest's temporary room chart. */
  readonly temporaryDocument: boolean;
  readonly hasDocument: boolean;
  readonly dirty: boolean;
  /** Footer buttons in display order. */
  readonly choices: readonly LeaveEditorChoice[];
}

/** The editor state the library confirmation reads. */
export interface LeaveEditorSnapshot {
  readonly hasDocument: boolean;
  readonly dirty: boolean;
  /** Whether the open document belongs to a guest's room session. */
  readonly roomDocument: boolean;
  readonly collaboration: CollaborationState;
  readonly collaborationPreparing: boolean;
}

const CANCEL: LeaveEditorChoice = Object.freeze({
  action: "cancel",
  labelKey: "editor.app.dialog.returnStay",
  variant: "outlined",
});

/** Builds the two- or three-way footer for one document state. */
function documentChoices(
  dirty: boolean,
  saveLabelKey: MessageKey,
  discardLabelKey: MessageKey,
): LeaveEditorChoice[] {
  if (!dirty) {
    return [
      CANCEL,
      {
        action: "exit",
        labelKey: "editor.app.dialog.returnHome",
        variant: "solid",
      },
    ];
  }
  return [
    CANCEL,
    { action: "discard", labelKey: discardLabelKey, variant: "danger" },
    { action: "save", labelKey: saveLabelKey, variant: "solid" },
  ];
}

/** Builds the footer for a room exit that has its own leave/close verb. */
function roomChoices(
  dirty: boolean,
  saveLabelKey: MessageKey,
  discardLabelKey: MessageKey,
  exitLabelKey: MessageKey,
): LeaveEditorChoice[] {
  if (!dirty) {
    return [CANCEL, { action: "exit", labelKey: exitLabelKey, variant: "danger" }];
  }
  return [
    CANCEL,
    { action: "discard", labelKey: discardLabelKey, variant: "danger" },
    { action: "save", labelKey: saveLabelKey, variant: "solid" },
  ];
}

/**
 * Resolves the room state that the library trip must warn about.
 *
 * A connection that has not produced a room yet is `pending`, a host closes the
 * room, and any other member leaves it. An idle or failed room is `none`.
 */
function roomMode(snapshot: LeaveEditorSnapshot): LeaveEditorRoom {
  if (!roomNeedsExitConfirmation(snapshot.collaboration, snapshot.collaborationPreparing)) {
    return "none";
  }
  if (snapshot.collaborationPreparing || !snapshot.collaboration.roomId) {
    return "pending";
  }
  return snapshot.collaboration.role === "host" ? "host" : "guest";
}

/**
 * Chooses the confirmation copy and actions for the current editor state.
 *
 * The result always includes Cancel, so no path leaves the editor without an
 * explicit answer. Dirty documents gain Save and Discard; a temporary room
 * chart never gains Save because the collaboration contract refuses it.
 */
export function planLeaveEditor(snapshot: LeaveEditorSnapshot): LeaveEditorPlan {
  const room = roomMode(snapshot);
  const dirty = snapshot.dirty;
  const temporaryDocument = snapshot.roomDocument && room === "guest";

  if (temporaryDocument) {
    return {
      titleKey: "editor.app.dialog.returnRoomDocumentTitle",
      descriptionKey: "editor.app.dialog.returnRoomDocumentBody",
      room,
      temporaryDocument,
      hasDocument: snapshot.hasDocument,
      dirty,
      choices: roomChoices(
        false,
        "editor.app.dialog.saveAndReturn",
        "editor.app.dialog.discardAndReturn",
        "editor.app.dialog.returnRoomDocumentConfirm",
      ),
    };
  }

  if (room === "host") {
    return {
      titleKey: dirty
        ? "editor.app.dialog.returnCloseRoomDirtyTitle"
        : "editor.app.dialog.returnCloseRoomTitle",
      descriptionKey: dirty
        ? "editor.app.dialog.returnCloseRoomDirtyBody"
        : "editor.app.dialog.returnCloseRoomBody",
      room,
      temporaryDocument,
      hasDocument: snapshot.hasDocument,
      dirty,
      choices: roomChoices(
        dirty,
        "editor.app.dialog.saveCloseRoomAndReturn",
        "editor.app.dialog.discardCloseRoomAndReturn",
        "editor.app.dialog.returnCloseRoom",
      ),
    };
  }

  if (room === "guest") {
    return {
      titleKey: dirty
        ? "editor.app.dialog.returnLeaveRoomDirtyTitle"
        : "editor.app.dialog.returnLeaveRoomTitle",
      descriptionKey: dirty
        ? "editor.app.dialog.returnLeaveRoomDirtyBody"
        : "editor.app.dialog.returnLeaveRoomBody",
      room,
      temporaryDocument,
      hasDocument: snapshot.hasDocument,
      dirty,
      choices: roomChoices(
        dirty,
        "editor.app.dialog.saveLeaveRoomAndReturn",
        "editor.app.dialog.discardLeaveRoomAndReturn",
        "editor.app.dialog.returnLeaveRoom",
      ),
    };
  }

  if (room === "pending") {
    return {
      titleKey: dirty
        ? "editor.app.dialog.returnCancelConnectDirtyTitle"
        : "editor.app.dialog.returnCancelConnectTitle",
      descriptionKey: dirty
        ? "editor.app.dialog.returnCancelConnectDirtyBody"
        : "editor.app.dialog.returnCancelConnectBody",
      room,
      temporaryDocument,
      hasDocument: snapshot.hasDocument,
      dirty,
      choices: roomChoices(
        dirty,
        "editor.app.dialog.saveAndReturn",
        "editor.app.dialog.discardAndReturn",
        "editor.app.dialog.returnCancelConnect",
      ),
    };
  }

  return {
    titleKey: dirty ? "editor.app.dialog.unsavedChangesTitle" : "editor.app.dialog.returnHomeTitle",
    descriptionKey: dirty
      ? "editor.app.dialog.unsavedChangesBody"
      : "editor.app.dialog.returnHomeBody",
    room,
    temporaryDocument,
    hasDocument: snapshot.hasDocument,
    dirty,
    choices: documentChoices(
      dirty,
      "editor.app.dialog.saveAndReturn",
      "editor.app.dialog.discardAndReturn",
    ),
  };
}

/**
 * Plans one application-close confirmation from the same document and room
 * snapshot the library trip uses.
 *
 * A quit has one prompt instead of a room prompt followed by an unsaved prompt.
 * The description lists every reason that blocks the close, and the footer offers
 * Keep editing, Discard and quit, and Save and quit when saving is possible.
 */
export function planAppClose(snapshot: LeaveEditorSnapshot): LeaveEditorPlan {
  const room = roomMode(snapshot);
  const dirty = snapshot.dirty;
  const temporaryDocument = snapshot.roomDocument && room === "guest";
  const reasons: MessageKey[] = [];
  if (dirty) {
    reasons.push("editor.app.dialog.exitDirtyBody");
  }
  if (room === "host") {
    reasons.push("editor.app.dialog.exitHostBody");
  } else if (room === "guest") {
    reasons.push("editor.app.dialog.exitGuestBody");
  } else if (room === "pending") {
    reasons.push("editor.app.dialog.exitPendingBody");
  }
  if (!reasons.length) {
    reasons.push("editor.app.dialog.exitBody");
  }
  const choices: LeaveEditorChoice[] = [
    {
      action: "cancel",
      labelKey: "editor.app.dialog.exitKeep",
      variant: "outlined",
    },
  ];
  if (dirty) {
    choices.push({
      action: "discard",
      labelKey: "editor.app.dialog.exitDiscard",
      variant: "danger",
    });
    if (!temporaryDocument) {
      choices.push({
        action: "save",
        labelKey: "editor.app.dialog.exitSave",
        variant: "solid",
      });
    }
  } else {
    choices.push({
      action: "exit",
      labelKey: "editor.app.dialog.exitConfirm",
      variant: "danger",
    });
  }
  return {
    titleKey: "editor.app.dialog.exitTitle",
    descriptionKey: reasons[0] ?? "editor.app.dialog.exitBody",
    descriptionKeys: reasons,
    room,
    temporaryDocument,
    hasDocument: snapshot.hasDocument,
    dirty,
    choices,
  };
}
