/**
 * The drawer content mode inside the inspector.
 *
 * A drawer page is an inspector destination, not a second surface: this frame
 * owns the reveal state that widens the inspector and exposes the page's list
 * column. The inspector header outside this frame names the page and closes it.
 *
 * Reveal is pointer-driven: dwelling inside the visible inspector reveals the
 * list, and pointer absence clips it again. Clicks and keyboard focus do not pin
 * it open. A guided step that anchors to this page holds the list revealed for
 * as long as the step is active.
 *
 * The frame publishes its mode and reveal state as `data-drawer-open` and
 * `data-drawer-expanded` so host styles and theme surfaces can read the drawer
 * without depending on the class names alone.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useHoverReveal } from "../useHoverReveal.ts";
import { drawerPaneDomId, useDrawerPaneHeld, type DrawerPaneDefinition } from "./drawerPanes.ts";
import { mergeRefs } from "../../platform/mergeRefs.ts";
import { onboardingAnchorRef } from "../../onboarding/anchors.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";

/** Pointer dwell before a collapsed drawer reveals its list column. */
const EXPAND_DELAY_MS = 350;
/** Pointer absence before the revealed list column hides again. */
const COLLAPSE_DELAY_MS = 600;

/** Renders one drawer page and owns its on-demand list column reveal. */
export function DrawerPaneView({ pane }: { pane: DrawerPaneDefinition }) {
  const [expanded, setExpanded] = useState(true);
  const inspector = useRef<HTMLElement | null>(null);
  const heldOpen = useDrawerPaneHeld(pane.id);
  const readOnly = useSyncExternalStore(
    subscribeToEditorVisibility,
    () => getEditorVisibility().readOnly,
    () => getEditorVisibility().readOnly,
  );
  const locked = readOnly && pane.editsChart === true;

  // The pointer contract belongs to the whole inspector panel, not just the
  // body: the shared header is part of the same reveal area.
  const bindFrame = useCallback((node: HTMLDivElement | null) => {
    inspector.current = node?.closest<HTMLElement>(".inspector") ?? null;
  }, []);

  useHoverReveal({
    containerRef: inspector,
    open: expanded,
    expandDelayMs: EXPAND_DELAY_MS,
    collapseDelayMs: COLLAPSE_DELAY_MS,
    holdWhileFocusInside: false,
    focusReveal: false,
    holdOpen: heldOpen,
    onExpand: () => setExpanded(true),
    onCollapse: () => setExpanded(false),
  });

  return (
    <div
      ref={mergeRefs(bindFrame, onboardingAnchorRef(drawerPaneDomId(pane.id)))}
      className={`inspector-drawer${expanded ? " is-expanded" : ""}`}
      data-drawer-pane={pane.id}
      data-drawer-open="true"
      data-drawer-expanded={expanded ? "true" : "false"}
      data-readonly={locked ? "true" : undefined}
      aria-disabled={locked || undefined}
    >
      <pane.body />
    </div>
  );
}
