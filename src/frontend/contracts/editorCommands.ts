/**
 * Command seam between persistent chrome and the editor screen.
 *
 * Menu items, title-bar buttons, and transport controls stay in chrome but act
 * on the editor's document, transport, view, navigation, and inspector
 * controllers. Chrome calls this contract; the editor composition root binds
 * the real controllers at startup. An unbound command is a no-op, matching the
 * late-bound controllers the underlying modules already use before mount.
 */
import { createLateBound } from "../../core/utils/lateBound.ts";

/** Document verbs shared by the File menu, title-bar save, and host API. */
export interface EditorDocumentCommands {
  newDocument(): void;
  openDocument(): void;
  saveDocument(): void;
  /** Whether the open document has unsaved changes or unsaved resource edits. */
  hasUnsavedChanges(): boolean;
  /**
   * Append the open chart to its library project's backup tree.
   *
   * A backup node is not a commit: the project's stored chart is untouched, so the
   * work is preserved without moving the point a later restore would return to.
   */
  backupOpenDocument(): Promise<void>;
  /** Reload a library project after its stored chart was replaced. */
  reloadProject(projectId: string): Promise<void>;
  /**
   * Open the backup list for one library project.
   *
   * The argument is the project the caller already identified; without one, the
   * command reads the project the editor is showing. A native file has no
   * project, so the command reports that instead of failing.
   */
  restoreBackup(projectId?: string): void;
}

/** Temporary transport options for one held audition. */
export interface AuditionOptions {
  /** Show only the preview until the hold ends. */
  previewOnly?: boolean;
  /** Return to the starting position on release; defaults to true. */
  restoreTime?: boolean;
}

/** Playback commands shared by the View menu and the transport controls. */
export interface EditorTransportCommands {
  togglePlayback(): void;
  beginAudition(options?: AuditionOptions): void;
  endAudition(): void;
  rewind(): void;
  seekToBeat(beat: string): void;
}

/** View commands and the region state their menu switches report. */
export interface EditorViewCommands {
  isPreviewLayout(): boolean;
  resetCamera(resetPreview?: boolean): void;
  togglePreviewOnly(): void;
  toggleRegion(region: "showNotes" | "showEvents"): void;
  toggleStagePreview(): void;
  toggleRegions(): void;
  /** Apply a vertical timeline scale while the transport stretch bar is dragged. */
  setTimelineScale(scale: number): void;
  /** Persist the scale the transport stretch bar settled on. */
  commitTimelineScale(): void;
}

/** Workspace navigation shared by the application menu and shortcuts. */
export interface EditorNavigationCommands {
  /** Show the library and leave the chart open behind it. */
  openLibrary(): void;
  /** Return to the library and release the open document after one confirmation. */
  closeLibrary(): void;
}

/** Inspector entry point used by the workspace host API. */
export interface EditorInspectorCommands {
  /** Opens a registered pane; false when the id is unknown. */
  openPane(id: string): boolean;
}

/** Everything chrome may ask the mounted editor to do. */
export interface EditorChromeCommands {
  readonly documents: EditorDocumentCommands;
  readonly transport: EditorTransportCommands;
  readonly view: EditorViewCommands;
  readonly navigation: EditorNavigationCommands;
  readonly inspector: EditorInspectorCommands;
}

const commands = createLateBound<EditorChromeCommands>();

/** Binds the mounted editor's controllers; returns the matching disposer. */
export function bindEditorChromeCommands(next: EditorChromeCommands): () => void {
  return commands.bind(next);
}

/** The bound commands, or null before the editor composition root runs. */
export function editorChromeCommands(): EditorChromeCommands | null {
  return commands.value();
}
