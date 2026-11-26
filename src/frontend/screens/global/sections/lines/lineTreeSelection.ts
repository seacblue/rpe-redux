/** Pure focus rules for the judge-line tree's pointer selection. */
import {
  listSelectionAfterMarquee,
  type ListSelectionModifiers,
} from "../../../../../design/patterns/list/listSelection.ts";

/** Return the first item in list order that belongs to a selection. */
export function topmostLineInSelection(
  order: readonly string[],
  selection: readonly string[],
): string | undefined {
  const selected = new Set(selection);
  return order.find((key) => selected.has(key));
}

/**
 * Resolve the line that receives focus when a tree marquee commits.
 *
 * A Shift marquee adds to the captured selection, so the first selected id in
 * the result may belong to the old selection. The topmost row touched by the
 * current gesture is the new range origin; plain and Ctrl/Cmd marquees use the
 * shared list rule's resulting focus instead.
 */
export function resolveLineTreeMarqueeFocus(
  order: readonly string[],
  selected: ReadonlySet<string>,
  touched: readonly string[],
  modifiers: ListSelectionModifiers,
): string | undefined {
  const result = listSelectionAfterMarquee(order, selected, touched, modifiers, true);
  if (modifiers.shiftKey) {
    return topmostLineInSelection(order, touched) ?? result.focus;
  }
  return result.focus;
}
