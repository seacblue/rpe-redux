/**
 * Commits the toolbar's parent-line field through the editor session.
 *
 * The field is intentionally bound to the line inspector's commit seam, so a
 * toolbar edit gets the same history, collaboration, and repaint behavior as
 * an edit made in the inspector panel.
 */
import { setLineParent } from "../../../../core/global/chart/line/lineEdits.ts";
import {
  editorLine,
  editorLineOptions,
  editorLineSelection,
  editorMultiLineActive,
} from "../../../../core/edit/state/publishedValues.ts";
import type { EditorSession } from "../../../../core/edit/session/session.ts";
import { t } from "../../../../i18n/index.ts";

interface ParentLineControlActions {
  isValid(raw: string): boolean;
  commit(raw: string): void;
}

let actions: ParentLineControlActions | null = null;

/** Whether the toolbar is currently editing more than one judge line. */
function multipleLinesSelected(): boolean {
  return editorMultiLineActive.get() || editorLineSelection.get().length > 1;
}

/** Parse the one-line grammar, where an empty string means the root. */
function parentIndex(raw: string): number | null {
  const value = raw.trim();
  if (value === "") {
    return -1;
  }
  if (!/^\d+$/u.test(value)) {
    return null;
  }
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

/** Fallback validation used before the editor binding is installed. */
function publishedValueIsValid(raw: string): boolean {
  const index = parentIndex(raw);
  if (index === null) {
    return false;
  }
  if (index === -1) {
    return true;
  }
  if (multipleLinesSelected()) {
    return false;
  }
  const current = Number(editorLine.get());
  return editorLineOptions.get().some((option) => option.index === index && index !== current);
}

/** Whether the current field text names one existing, non-self parent line. */
export function isParentLineInput(raw: string): boolean {
  return actions?.isValid(raw) ?? publishedValueIsValid(raw);
}

/** Commit one valid parent index, or clear the relation for an empty value. */
export function commitParentLine(raw: string): void {
  actions?.commit(raw);
}

/** Install the session-backed parent-line operation for the mounted editor. */
export function bindParentLineControl(options: {
  getSession(): EditorSession;
  commit(label: string, chart: EditorSession["chart"], index?: number): void;
  render(): void;
}): () => void {
  const current: ParentLineControlActions = {
    isValid(raw) {
      const session = options.getSession();
      const parent = parentIndex(raw);
      if (parent === null || multipleLinesSelected()) {
        return false;
      }
      if (parent === -1) {
        return true;
      }
      if (parent === session.lineIndex) {
        return false;
      }
      try {
        setLineParent(session.chart, session.lineIndex, parent);
        return true;
      } catch {
        return false;
      }
    },
    commit(raw) {
      const session = options.getSession();
      if (!current.isValid(raw)) {
        return;
      }
      const parent = parentIndex(raw);
      if (parent === null) {
        return;
      }
      const currentParent = Number(session.line?.father ?? -1);
      if (currentParent === parent) {
        return;
      }
      const next = setLineParent(session.chart, session.lineIndex, parent);
      options.commit(t("editorPanels.linePanel.applyLabel"), next, session.lineIndex);
      options.render();
    },
  };
  actions = current;
  return () => {
    if (actions === current) {
      actions = null;
    }
  };
}
