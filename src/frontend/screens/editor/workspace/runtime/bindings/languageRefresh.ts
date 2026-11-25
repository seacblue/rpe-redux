/**
 * Owns the non-React editor surfaces that need to repaint when the language
 * catalog changes. The mounted session and tempo map stay replaceable at the
 * seam, so this binding reads them through getters on every repaint.
 */
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { TempoGrid } from "../../../../../../core/global/chart/editing/editGrid.ts";
import type { Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import type { ResourceScope } from "../../../../../../core/utils/resourceScope.ts";
import { getLanguage, onLanguageChange } from "../../../../../../i18n/index.ts";
import { renderProperties } from "../../../inspector/notes/noteInspector.ts";
import type { NoteHitSoundOptions, NotesInspectorState } from "../../../inspector/notes/model.ts";

/** Editor state the language-change repaint reads. */
export interface EditorLanguageRefreshDependencies {
  scope: ResourceScope;
  hasDocument(): boolean;
  getSession(): EditorSession;
  notes: NotesInspectorState;
  getTempo(): TempoGrid;
  reportError(error: unknown): void;
  onNudge(value: Beat, direction: number): Beat | null;
  hitSoundOptions: NoteHitSoundOptions;
}

/** Repaint open inspector properties when the catalog changes. */
export function bindEditorLanguageRefresh(deps: EditorLanguageRefreshDependencies): void {
  let spokenLanguage = getLanguage();
  deps.scope.add(
    onLanguageChange((language) => {
      if (language === spokenLanguage) {
        return;
      }
      spokenLanguage = language;
      if (deps.hasDocument()) {
        renderProperties(
          deps.getSession(),
          deps.notes,
          deps.getTempo(),
          deps.reportError,
          deps.onNudge,
          false,
          deps.hitSoundOptions,
        );
      }
    }),
  );
}
