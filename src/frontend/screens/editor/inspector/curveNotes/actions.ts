/**
 * Late-bound actions for the curve-note pane.
 *
 * Menus and shortcuts can call them before the editor mounts; every action is a
 * no-op while no editor is bound, and the binding clears on unmount.
 */
import type { createCurveEditor } from "./curveEditor.ts";
let editor: ReturnType<typeof createCurveEditor> | null = null;

/** Binds the mounted curve editor; the returned callback unbinds it. */
export function bindCurveActions(current: ReturnType<typeof createCurveEditor>): () => void {
  editor = current;
  return () => {
    if (editor === current) {
      editor = null;
    }
  };
}
/** Ends an in-progress anchor pick while the curve editor is bound. */
export function deactivateCurve(): void {
  editor?.deactivate();
}

/** Late-bound curve editor commands; each is a no-op without a bound editor. */
export const curveActions = Object.freeze({
  openCurveNotes: () => editor?.openPanel(),
  captureCurveStart: () => editor?.capture(false),
  captureCurveEnd: () => editor?.capture(true),
  generateCurve: () => editor?.generate(),
  setCurveEasing: (easingType: number) => editor?.setEasing(easingType),
  setCurveQuickType: (type: number) => editor?.setQuickType(type),
  dismissCurveQuick: () => editor?.dismissQuick(),
});
