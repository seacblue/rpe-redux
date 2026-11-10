/**
 * Mounts the single fixed-position host for design-system popups.
 *
 * Controls request a popup through `controlActions`; this component chooses the
 * reusable panel and portals it above clipped surfaces. It does not own control
 * values or decide which product field opened the popup.
 */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  closeControlPopup,
  getPopup,
  popupAnchorVisible,
  subscribePopup,
} from "./controlActions.ts";
import { useHoldFloatingSurface } from "../patterns/floatingSurface.ts";
import { SelectPopup } from "./SelectPopup.tsx";
import { ColorPopup } from "./ColorPopup.tsx";
import { installControls } from "./enhance.ts";

/**
 * Mounts whichever custom panel a control asked for.
 *
 * It is one host rather than a popup per control because a control's popup has
 * to escape its own subtree: panels live inside scrolling, clipped rails, and a
 * panel rendered in place would be cut off by the first `overflow: hidden`
 * ancestor. `position: fixed` from a single top-level host is what keeps them
 * whole, and it also means only one can ever be open — which is the behaviour a
 * dropdown and a colour picker both want anyway.
 */
export function ControlHost() {
  useEffect(() => installControls(), []);
  const popup = useSyncExternalStore(subscribePopup, getPopup);
  const attached = Boolean(popup && popupAnchorVisible(popup.element));
  useHoldFloatingSurface(attached);
  useEffect(() => {
    if (!popup) {
      return;
    }
    // The popup store does not change when its parent panel is closed, so a
    // short poll notices an unmounted or hidden anchor and dismisses the list.
    const check = () => {
      if (!popupAnchorVisible(popup.element)) {
        closeControlPopup();
      }
    };
    check();
    const timer = window.setInterval(check, 120);
    return () => window.clearInterval(timer);
  }, [popup]);
  if (!popup || !attached) {
    return null;
  }
  // Keyed by the open sequence so a second open of the same control starts with
  // fresh panel state.
  const panel =
    popup.kind === "select" ? (
      <SelectPopup key={popup.seq} state={popup} />
    ) : (
      <ColorPopup key={popup.seq} state={popup} />
    );
  // A modal dialog makes every node outside its top layer inert. Its controls'
  // popup must belong to the same dialog to remain visible and interactive.
  // Everything else stays inside the app root: the design sheets qualify their
  // native-control rules with `.redux-app-root`, and a body portal would drop the popup's
  // inputs and buttons back to unstyled platform chrome.
  const appRoot = popup.element.closest(".redux-app-root");
  const host = popup.element.closest("dialog[open]") ?? appRoot ?? popup.element.ownerDocument.body;
  return createPortal(panel, host);
}
