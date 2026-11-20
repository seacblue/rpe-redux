/**
 * The application menu sections and their registered command ids.
 *
 * The sections are presentation definitions; every command still comes from the
 * toolbar registry. Keeping the list pure makes the File menu easy to test
 * without mounting the title bar.
 */
import type { MessageKey } from "../../../i18n/index.ts";

/** One top-level menu section. */
export interface MenuSpec {
  id: string;
  label: MessageKey;
  actionIds: readonly string[];
}

/**
 * The visible application menus.
 *
 * Commands that already have a dedicated chrome surface stay there; these
 * sections carry document, edit, view, and help destinations. The File section
 * carries document and workspace actions but never the native close-window
 * command, which belongs to the caption buttons.
 */
export const APPLICATION_MENUS: readonly MenuSpec[] = [
  {
    id: "file",
    label: "chrome.menu.file",
    actionIds: [
      "file.new",
      "file.open",
      "document.save",
      "file.export",
      "document.close",
      "workspace.settings",
    ],
  },
  {
    id: "edit",
    label: "chrome.menu.edit",
    actionIds: [
      "edit.undo",
      "edit.redo",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "edit.delete",
      "edit.selectAll",
    ],
  },
  {
    id: "view",
    label: "chrome.menu.view",
    actionIds: [
      "view.resetCamera",
      "view.togglePreviewOnly",
      "view.toggleNotes",
      "view.toggleEvents",
      "view.togglePreview",
      "view.customizeToolbar",
      "view.customizeSidebar",
    ],
  },
  {
    id: "help",
    label: "chrome.menu.help",
    actionIds: [
      "help.onboarding-guide",
      "help.survey",
      "help.developer-docs",
      "help.changelog",
      "help.about",
    ],
  },
];
