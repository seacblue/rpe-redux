/** Owns the selection source shared by single-line and multi-line timelines. */

/** The session fields needed to resolve note selection for one line. */
export interface NoteSelectionSession {
  readonly lineIndex: number;
  readonly selection: ReadonlySet<number>;
  readonly multiLineActive: boolean;
  readonly multiLineMode: string;
  readonly multiLineSelection?: ReadonlyMap<number, ReadonlySet<number>>;
}

const EMPTY_SELECTION: ReadonlySet<number> = new Set();

/** Return the selected note indices that belong to `lineIndex`. */
export function selectedNoteIndices(
  session: NoteSelectionSession,
  lineIndex: number,
): ReadonlySet<number> {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    return session.multiLineSelection?.get(lineIndex) ?? EMPTY_SELECTION;
  }
  return lineIndex === session.lineIndex ? session.selection : EMPTY_SELECTION;
}

/** Commit an overlap-menu choice and immediately repaint the timeline. */
export function selectOverlappingNote(
  session: {
    focus: string;
    marqueeSelection: string | null;
    selectionMode: "none" | "single" | "multi";
    lineIndex: number;
    selection: Set<number>;
    multiLineSelection: Map<number, Set<number>>;
    multiLineIndices: number[];
    multiLineEnabled: boolean;
    selectionRevision: number;
    selectionState(): unknown;
    normalizeMultiLine(): void;
    recordSelection(scope: undefined, before: unknown, undoable: boolean): void;
  },
  entry: { lineIndex: number; index: number },
  changed: () => void,
): void {
  const before = session.selectionState();
  session.focus = "notes";
  session.selectionMode = "single";
  session.marqueeSelection = null;
  session.lineIndex = entry.lineIndex;
  session.selection = new Set([entry.index]);
  session.multiLineSelection.clear();
  session.multiLineIndices = [];
  session.multiLineEnabled = false;
  session.normalizeMultiLine();
  session.selectionRevision += 1;
  session.recordSelection(undefined, before, true);
  changed();
}
