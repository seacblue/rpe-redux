/**
 * The BPM pane's form-request slot.
 *
 * It shares the request mechanism from `formRequest.ts` but keeps its own cell,
 * so opening or closing another pane cannot replace the session this pane is
 * editing.
 */
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { createFormRequest, type FormRequest, type FormRequestCell } from "../formRequest.ts";

export type BpmForm = FormRequest;

type BpmFormCell = FormRequestCell<BpmForm>;

const bindingCounts = new WeakMap<BpmFormCell, number>();

/** Creates the BPM pane's independent request slot. */
export function createBpmForm(): BpmFormCell {
  return createFormRequest<BpmForm>();
}

/**
 * Retains a BPM form binding for one mounted inspector instance.
 *
 * The compact page and its expanded studio can overlap during the workspace
 * transition. The request cell is shared by both views, so only the last
 * binding to leave may clear it.
 */
export function retainBpmForm(form: BpmFormCell, session: EditorSession): () => void {
  const count = bindingCounts.get(form) ?? 0;
  bindingCounts.set(form, count + 1);
  if (session.chart && form.get()?.session !== session) {
    form.show(session);
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (bindingCounts.get(form) ?? 1) - 1;
    if (remaining <= 0) {
      bindingCounts.delete(form);
      form.clear();
      return;
    }
    bindingCounts.set(form, remaining);
  };
}
