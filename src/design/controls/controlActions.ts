/**
 * Popup state and operations shared by the design controls: anchor measurement, the
 * single active select/colour popup, and open/close/reposition operations. Native
 * elements stay the value holders.
 */
import { createValue } from "../../core/state/values.ts";

export interface PopupAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface PopupBase {
  seq: number;
  anchor: PopupAnchor;
}
export interface SelectPopupState extends PopupBase {
  kind: "select";
  element: HTMLSelectElement;
}
export interface ColorPopupState extends PopupBase {
  kind: "color";
  element: HTMLInputElement;
}
export type ControlPopupState = SelectPopupState | ColorPopupState;
/** The one popup currently attached to a control, if any. */
const popup = createValue<ControlPopupState | null>({ initial: null });
/** Subscribe to popup changes. */
export const subscribePopup = popup.subscribe;
/** The active control popup, or `null`. */
export const getPopup = popup.get;
/** Client box of the open dialog that contains `element`, or `null` for the viewport. */
export function popupDialogBoxOf(element: Element): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const dialog = element.closest("dialog[open]");
  const rect = dialog?.getBoundingClientRect();
  return dialog && rect
    ? { left: rect.left, top: rect.top, width: dialog.clientWidth, height: dialog.clientHeight }
    : null;
}

/**
 * Whether a control popup's anchor is still rendered and visible.
 *
 * A panel can be hidden or unmounted without changing the popup store, so the
 * host and scroll handler both use this check before repositioning or closing.
 */
export function popupAnchorVisible(element: Element): boolean {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    element.checkVisibility?.({ checkVisibilityCSS: true }) !== false
  );
}

/** Measure an element as a viewport-relative popup anchor. */
export function popupAnchorOf(element: Element): PopupAnchor {
  const box = element.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
  };
}
/** Publish the active control popup. */
export const openPopup = popup.set;
/** Clear the active popup without moving focus. */
export function closePopup(): void {
  if (popup.get()) {
    popup.set(null);
  }
}

/** Whether a native select can use the custom single-choice popup. */
export function editableSelect(select: HTMLSelectElement): boolean {
  return !select.disabled && !select.multiple && select.size <= 1 && !select.closest("[inert]");
}

/** Opens the React popup while retaining the native select as its value owner. */
export function openControlSelect(select: HTMLSelectElement): void {
  const current = getPopup();
  if (current?.kind === "select" && current.element === select) {
    closeControlPopup();
    return;
  }
  closeControlPopup();
  openPopup({
    kind: "select",
    seq: openPopupSequence++,
    element: select,
    anchor: popupAnchorOf(select),
  });
}

/** Opens the colour control's React picker instead of the platform dialog. */
export function openControlColor(input: HTMLInputElement): void {
  closeControlPopup();
  openPopup({
    kind: "color",
    seq: openPopupSequence++,
    element: input,
    anchor: popupAnchorOf(input),
  });
}

/**
 * Toggles the colour picker for one native colour input.
 *
 * A second activation closes the open picker and returns focus to the input.
 * Reopening the same control would replace the popup snapshot and replay its
 * enter animation.
 */
export function toggleControlColor(input: HTMLInputElement): void {
  const current = getPopup();
  if (current?.kind === "color" && current.element === input) {
    closeControlPopup(true);
    return;
  }
  openControlColor(input);
}

/**
 * Handle the shared Escape contract for an open control popup.
 *
 * Returns `true` when the event was Escape and has been consumed, so callers
 * can keep their own key handling while sharing dismissal and focus restore.
 */
export function handleControlPopupEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") {
    return false;
  }
  event.preventDefault();
  closeControlPopup(true);
  return true;
}

/** Closes the active panel and optionally returns focus to its native control. */
export function closeControlPopup(restoreFocus = false): void {
  const popup = getPopup();
  if (!popup) {
    return;
  }
  closePopup();
  if (restoreFocus) {
    popup.element.focus({ preventScroll: true });
  }
}

/** Keeps an open panel aligned with its control during viewport movement. */
export function repositionControlPopup(): void {
  const popup = getPopup();
  if (!popup) {
    return;
  }
  if (!popupAnchorVisible(popup.element)) {
    closeControlPopup();
    return;
  }
  openPopup({ ...popup, anchor: popupAnchorOf(popup.element) });
}

let openPopupSequence = 0;
