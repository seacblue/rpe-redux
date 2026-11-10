/**
 * The progress card's right-click menu.
 *
 * The scrubber region owns two commands: jump to a chart position and open the
 * time marker manager. The store and pointer handler live here so the progress
 * card only has to attach the handler and render the popup. Rows come from the
 * shared renderer, so contributed `progress` rows and their shortcut hints
 * appear beside the two site commands; a press on a marker also draws the
 * `marker` surface with that marker as the target.
 */
import { useState, type MouseEvent } from "react";
import { markerTargetFromMarker } from "../../../core/edit/timeline/contextMenuTarget.ts";
import { getEditorVisibility } from "../../../core/edit/state/visibility.ts";
import type { ContextMenuTarget } from "../../../core/shell/registries/toolbar.ts";
import { hasOpenModal } from "../../../design/components/modal/Modal.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { useEditorHostRuntime } from "../../contracts/editorHostReact.tsx";
import type { EditorHostRuntime } from "../../contracts/editorHost.ts";
import {
  ContextMenuPopup,
  createContextMenuState,
  type ContextMenuSnapshot,
  type ContextMenuStore,
} from "../../overlays/contextMenu/ContextMenuPopup.tsx";
import { ContextMenuRows } from "../../overlays/contextMenu/ContextMenuRows.tsx";
import { progressMenuSurfaces } from "./chartProgressState.ts";
import { openMarkerDialog } from "./markerDialogs.ts";

/** A progress-card menu snapshot plus the marker target under the press, if any. */
export interface ProgressMenuSnapshot extends ContextMenuSnapshot {
  target?: ContextMenuTarget;
}

/** Resolve a marker under the press from the button's published data attributes. */
function markerTargetAt(
  event: MouseEvent<HTMLElement>,
  runtime: EditorHostRuntime | null,
): ContextMenuTarget | undefined {
  const origin = event.target;
  const node = origin instanceof Element ? origin.closest<HTMLElement>("[data-marker-time]") : null;
  if (!node) {
    return undefined;
  }
  const time = Number(node.dataset.markerTime);
  const name = node.dataset.markerName ?? "";
  if (!Number.isFinite(time) || !name) {
    return undefined;
  }
  const beat = runtime
    ? runtime.timeline.viewport.tempo.beat(time, runtime.session.line?.bpmfactor ?? 1)
    : 0;
  return markerTargetFromMarker({ id: node.dataset.markerId, time, name }, beat);
}

/** The menu store and pointer handler the progress card attaches to its region. */
export interface ProgressContextMenuHandle {
  readonly store: ContextMenuStore<ProgressMenuSnapshot>;
  open(event: MouseEvent<HTMLElement>): void;
}

/**
 * Creates the progress menu's local store and its right-click handler.
 *
 * The handler suppresses the native menu and stops the event so no surrounding
 * surface can open a second context menu for the same press. A modal owns the
 * pointer gesture, so the menu stays closed while one is up. A press that lands
 * on a marker carries that marker as the target.
 */
export function useProgressContextMenu(): ProgressContextMenuHandle {
  const { t } = useTranslation();
  const runtime = useEditorHostRuntime();
  const [store] = useState(() => createContextMenuState<ProgressMenuSnapshot>());
  const open = (event: MouseEvent<HTMLElement>) => {
    if (hasOpenModal()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    store.set({
      owner: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      target: markerTargetAt(event, runtime),
      actions: [
        {
          id: "transport.jump",
          label: t("chrome.transport.menu.jump"),
          icon: "jump",
          enabled: () => !getEditorVisibility().readOnly,
          run: () => openMarkerDialog("jump"),
        },
        {
          id: "transport.markers",
          label: t("chrome.transport.menu.manageMarkers"),
          icon: "clock",
          enabled: () => !getEditorVisibility().readOnly,
          run: () => openMarkerDialog("manager"),
        },
      ],
    });
  };
  return { store, open };
}

/** Renders the progress card's right-click menu: contributed and site rows. */
export function ProgressContextMenu({ store }: { store: ContextMenuStore<ProgressMenuSnapshot> }) {
  const { t } = useTranslation();
  return (
    <ContextMenuPopup store={store} label={t("chrome.transport.menu.label")}>
      {(snapshot, close) => (
        <>
          {progressMenuSurfaces(snapshot.target).map((surface) => (
            <ContextMenuRows
              key={surface}
              surface={surface}
              target={snapshot.target}
              actions={surface === "progress" ? snapshot.actions : undefined}
              close={close}
            />
          ))}
        </>
      )}
    </ContextMenuPopup>
  );
}
