/**
 * Document-level compatibility listeners for native controls: replacing the OS
 * colour dialog, dismissing design-system popups, and repositioning them on
 * viewport changes. React control wrappers own their local behavior.
 */
import { getPopup } from "./controlActions.ts";
import {
  closeControlPopup,
  editableSelect,
  repositionControlPopup,
  toggleControlColor,
} from "./controlActions.ts";

/** The select a target belongs to, resolving through an associated label. */
function selectFromTarget(target: Element | null): HTMLSelectElement | null {
  const direct = target?.closest("select");
  if (direct instanceof HTMLSelectElement) {
    return direct;
  }
  const label = target?.closest("label");
  return label instanceof HTMLLabelElement && label.control instanceof HTMLSelectElement
    ? label.control
    : null;
}

/** The flag guarding one-time installation of the document listeners. */
let installed = false;

/**
 * Installs only document-level fallbacks: native color-dialog replacement,
 * popup dismissal, and viewport repositioning. Select components own label
 * activation through their associated-label refs.
 * Inputs own their presentation and wheel behavior through the React `Input`
 * component; selects own keyboard behavior through the React `Select` wrapper.
 */
export function installControls(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;

  const onMouseDown = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    // The React Select wrapper handles the actual activation. Skip generic
    // dismissal here so a click on an already-open select can still toggle it.
    const select = selectFromTarget(target);
    if (select && editableSelect(select)) {
      return;
    }
    const color = target?.closest('input[type="color"]');
    if (color instanceof HTMLInputElement && !color.disabled) {
      // Suppress the platform dialog on press; the click handler owns the
      // open/close decision so a second activation can toggle the React picker.
      event.preventDefault();
      return;
    }
    if (!target?.closest(".redux-control-popup")) {
      closeControlPopup();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const color = target?.closest('input[type="color"]');
    if (
      color instanceof HTMLInputElement &&
      !color.disabled &&
      ["Enter", " "].includes(event.key)
    ) {
      const current = getPopup();
      if (current && (current.kind !== "color" || current.element !== color)) {
        return;
      }
      event.preventDefault();
      toggleControlColor(color);
    }
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const color = target?.closest('input[type="color"]');
    if (color instanceof HTMLInputElement && !color.disabled) {
      // Cancelling mousedown is not sufficient in WebView2: the native color
      // dialog can still be dispatched by the subsequent click default action.
      event.preventDefault();
      event.stopPropagation();
      toggleControlColor(color);
    }
  };

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("resize", repositionControlPopup);
  window.addEventListener("scroll", repositionControlPopup, true);

  return () => {
    installed = false;
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("resize", repositionControlPopup);
    window.removeEventListener("scroll", repositionControlPopup, true);
    closeControlPopup();
  };
}
