/**
 * Installs a replacement session and transfers the editor listeners, clipboard,
 * recovery clock, and media bindings onto it. Later replacements follow the same
 * path; callers keep reading the session through the provider.
 */
import {
  EditorSession,
  type SessionMutationGate,
} from "../../../../../../core/edit/session/session.ts";
import type { ClipboardHistory } from "../../../../../../core/edit/clipboard/clipboardHistory.ts";
import type { AutoSaveClock } from "../../../../../../core/edit/session/autosave.ts";
import type { HitSounds } from "../../../../../../core/media/hitsounds.ts";
import type { ProjectImages } from "../../../../../../core/media/images.ts";
import type { DocumentReplacement } from "./replacer.ts";

/** Session transfer and setup operations for one installed document. */
export interface DocumentInstallOptions {
  session: { current(): EditorSession; replace(session: EditorSession): void };
  mutationGate: SessionMutationGate;
  history: { clipboard: Pick<ClipboardHistory, "attach">; limit(): number; onChange(): void };
  resetSelectionView(): void;
  recovery: { clearDraft(): void; autoSave: Pick<AutoSaveClock, "reset"> };
  resetCurveDraft(): void;
  installRecord(
    document: Pick<DocumentReplacement, "assets" | "folders" | "name" | "diagnostics" | "readOnly">,
  ): void;
  resetEditClock(): void;
  hitSounds: Pick<HitSounds, "setProject">;
  images: Pick<ProjectImages, "load">;
}

/** Own the listener transfer and new document setup; getters follow later replacements. */
export function createSessionInstaller(options: DocumentInstallOptions) {
  return (replacement: DocumentReplacement): void => {
    options.session.current().removeEventListener("change", options.history.onChange);
    const session = replacement.chartDocument
      ? EditorSession.fromDocument(replacement.chartDocument, replacement.readOnly)
      : new EditorSession(replacement.chart, replacement.readOnly);
    session.setMutationGate(options.mutationGate);
    options.session.replace(session);
    options.history.clipboard.attach(session);
    options.resetSelectionView();
    session.history.limit = options.history.limit();
    session.addEventListener("change", options.history.onChange);
    options.recovery.clearDraft();
    options.recovery.autoSave.reset(performance.now());
    options.resetCurveDraft();
    options.installRecord(replacement);
    options.resetEditClock();
    options.hitSounds.setProject(replacement.chart, replacement.assets, replacement.name);
    if (replacement.loadImages) {
      options.images.load(replacement.chart, replacement.assets, replacement.name);
    }
  };
}
