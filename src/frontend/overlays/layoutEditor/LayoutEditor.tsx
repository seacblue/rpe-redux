/**
 * The layout editor overlay.
 *
 * It dims the window and leaves the real toolbar and rail bright, because the
 * user arranges those and not a copy of them. The only surface it draws itself is
 * the list of commands that are not placed yet, which reads like a menu: one
 * command a row, with its glyph.
 *
 * A gesture is tracked from the pointer rather than through the browser's drag
 * protocol: a native drag suppresses `pointermove` while it runs, which would
 * leave the drop unable to see where it ended. The chrome takes the press at its
 * own container and this overlay owns the window listeners that follow it.
 *
 * The draft is rewritten on every move, so the real chrome reflows under the
 * pointer instead of settling only when the button is released. A command that
 * has not been placed yet joins the surface the moment the pointer enters it and
 * is carried like any other item from there, which is what makes one gesture able
 * to place and position in a single move.
 *
 * Nothing is written until 保存. Escape saves, because reopening the editor is
 * cheap and a blocking question here would be the only one in this surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { Icon, iconName } from "../../../design/components/icon/Icon.tsx";
import { MenuItem } from "../../../design/components/menu/MenuSurface.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import {
  getSidebarEntries,
  getSidebarEntryOwner,
  subscribeSidebarEntries,
} from "../../../core/shell/registries/sidebar.ts";
import {
  dividerId,
  findPlacement,
  resolveSurfaceLayout,
  type LayoutSlotId,
  type LayoutSurfaceId,
  type LayoutSlot,
} from "../../../core/shell/layoutArrangement.ts";
import {
  addSurfaceItem,
  beginLayoutDrag,
  cancelLayoutDrag,
  cancelLayoutEditor,
  layoutDrag,
  layoutEditorOpen,
  layoutEditorSurface,
  moveSurfaceItem,
  paintedLayout,
  removeSurfaceItem,
  saveLayoutEditor,
  trackLayoutDrag,
  type LayoutDragPayload,
} from "../../../core/shell/layoutEditorState.ts";
import { extensionRuntime } from "../../../core/extensions/extensionRuntime.ts";
import { ContextMenuPopup, createContextMenuState } from "../contextMenu/ContextMenuPopup.tsx";
import { useDrawerPanes } from "../../chrome/drawer/drawerPanes.ts";
import { mergeSidebarNavigation } from "../../chrome/sidebar/navigation.ts";
import {
  authoredSlotOf,
  placementIcon,
  placementLabel,
  railCatalog,
  surfaceIds,
  toolbarCatalog,
  type LayoutEntry,
} from "./layoutEditCatalog.ts";
import {
  layoutDropTargetAt,
  layoutItemAt,
  registerLayoutPalette,
  type LayoutDropTarget,
} from "./layoutEditTargets.ts";

/** The list group that holds rules. */
const DIVIDER_GROUP = "__divider__";

/** How far a press must travel before it counts as a drag. */
const DRAG_THRESHOLD = 3;

/** One list section: a package's commands, or the rules. */
interface PaletteGroup {
  key: string;
  label: string;
  items: readonly LayoutEntry[];
  divider?: true;
}

/** Where a right-click landed, so its row can act on that item. */
interface ContextPoint {
  surface: LayoutSurfaceId;
  id: string;
  x: number;
  y: number;
}

/**
 * The overlay.
 *
 * It reads the one painted arrangement the chrome also reads, so every gesture
 * shows its result on the real surface immediately.
 */
export function LayoutEditor() {
  const { t, tRaw } = useTranslation();
  const open = useSyncExternalStore(
    layoutEditorOpen.subscribe,
    layoutEditorOpen.get,
    layoutEditorOpen.get,
  );
  const surface = useSyncExternalStore(
    layoutEditorSurface.subscribe,
    layoutEditorSurface.get,
    layoutEditorSurface.get,
  );
  const painted = useSyncExternalStore(
    paintedLayout.subscribe,
    paintedLayout.get,
    paintedLayout.get,
  );
  const drag = useSyncExternalStore(layoutDrag.subscribe, layoutDrag.get, layoutDrag.get);

  const paletteRef = useRef<HTMLDivElement | null>(null);
  const menu = useMemo(
    () => createContextMenuState<{ owner: HTMLElement | null; x: number; y: number }>(),
    [],
  );
  const [context, setContext] = useState<ContextPoint | null>(null);
  const [dropTarget, setDropTarget] = useState<LayoutDropTarget | null>(null);

  const railEntries = useSyncExternalStore(
    subscribeSidebarEntries,
    getSidebarEntries,
    getSidebarEntries,
  );
  const panes = useDrawerPanes();
  const railNavigation = useMemo(
    () => mergeSidebarNavigation(railEntries, panes),
    [railEntries, panes],
  );

  /** Every command the open surface can hold, named the way its own UI names it. */
  const catalog = useMemo<LayoutEntry[]>(
    () =>
      surface === "toolbar"
        ? toolbarCatalog(tRaw)
        : railCatalog(railNavigation, tRaw, getSidebarEntryOwner),
    [surface, railNavigation, tRaw],
  );

  const registeredIds = useMemo(
    () => surfaceIds(surface, railNavigation),
    [surface, railNavigation],
  );
  const authoredSlot = useCallback(
    (id: string): LayoutSlotId => authoredSlotOf(surface, id),
    [surface],
  );
  const slots = useMemo(
    () => (open ? resolveSurfaceLayout(painted, surface, registeredIds, authoredSlot) : []),
    [open, surface, registeredIds, authoredSlot, painted],
  );
  const placed = useMemo(
    () => new Set(slots.flatMap((slot) => slot.items.map((item) => item.id))),
    [slots],
  );

  const carried = drag?.moving ? drag.payload.id : null;
  const carriedKind = drag?.moving ? drag.payload.kind : null;

  /**
   * The list holds what is not on the surface.
   *
   * A command the gesture is carrying stays listed, because its place on the
   * surface is only a preview: dropping it back here is what removes it, so it
   * must never look like it became unavailable.
   */
  const groups = useMemo<PaletteGroup[]>(() => {
    const available = catalog.filter((item) => !placed.has(item.id) || item.id === carried);
    const byOwner = new Map<string, LayoutEntry[]>();
    for (const item of available) {
      const list = byOwner.get(item.owner);
      if (list) {
        list.push(item);
      } else {
        byOwner.set(item.owner, [item]);
      }
    }
    const names = new Map(
      extensionRuntime.list().map((entry) => [entry.manifest.id, entry.manifest.name]),
    );
    const grouped: PaletteGroup[] = [...byOwner.entries()]
      .map(([owner, items]) => ({
        key: owner || "host",
        label: owner ? (names.get(owner) ?? owner) : t("layoutEditor.groupHost"),
        items,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    grouped.push({
      key: DIVIDER_GROUP,
      label: t("layoutEditor.groupDividers"),
      items: [],
      divider: true,
    });
    return grouped;
  }, [catalog, placed, carried, t]);

  const save = useCallback(() => saveLayoutEditor(), []);
  const cancel = useCallback(() => cancelLayoutEditor(), []);

  /** The painted run of one surface, which every gesture step re-reads. */
  const currentSlots = useCallback(
    (surfaceId: LayoutSurfaceId): LayoutSlot[] =>
      resolveSurfaceLayout(paintedLayout.get(), surfaceId, registeredIds, authoredSlot),
    [registeredIds, authoredSlot],
  );

  /**
   * Put one payload at one place on the surface.
   *
   * This runs on every pointer move, so it is written to be the same call whether
   * the command is already on the surface or not: a command that is missing is
   * added, and one that is there is moved. The run therefore reflows under the
   * pointer rather than at the end of the gesture.
   */
  const place = useCallback(
    (payload: LayoutDragPayload, at: LayoutDropTarget): void => {
      if (at.kind !== "slot") {
        return;
      }
      const here = findPlacement(currentSlots(payload.surface), payload.id);
      if (!here) {
        addSurfaceItem(
          payload.surface,
          at.slot,
          payload.kind === "divider" ? { id: payload.id, divider: true } : { id: payload.id },
          at.index,
          registeredIds,
          authoredSlot,
        );
        return;
      }
      // The index is measured against the run without the carried item, which is
      // the same run `movePlacement` inserts into, so an unchanged index means the
      // item is already where the pointer says and nothing needs to repaint.
      if (here.slot === at.slot && here.index === at.index) {
        return;
      }
      moveSurfaceItem(payload.surface, registeredIds, authoredSlot, payload.id, at.slot, at.index);
    },
    [currentSlots, registeredIds, authoredSlot],
  );

  /**
   * Settle one gesture.
   *
   * A drop on the list or past the chrome takes the command off the surface, which
   * is how a removal is written: the preview already put it where the pointer is,
   * so the drop only has to undo that.
   */
  const settle = useCallback(
    (payload: LayoutDragPayload, at: LayoutDropTarget): void => {
      if (at.kind === "slot") {
        place(payload, at);
        return;
      }
      const here = findPlacement(currentSlots(payload.surface), payload.id);
      if (here) {
        removeSurfaceItem(payload.surface, registeredIds, authoredSlot, payload.id);
      }
    },
    [place, currentSlots, registeredIds, authoredSlot],
  );

  // The gesture is followed at the window, which is the only level that still
  // sees a pointer once it has left the chrome.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onMove = (event: PointerEvent) => {
      const current = layoutDrag.get();
      if (!current) {
        return;
      }
      trackLayoutDrag(event.clientX, event.clientY, DRAG_THRESHOLD);
      const next = layoutDrag.get();
      if (!next?.moving) {
        return;
      }
      const at = layoutDropTargetAt(
        next.payload.surface,
        event.clientX,
        event.clientY,
        next.payload.id,
      );
      setDropTarget(at);
      place(next.payload, at);
    };
    const onUp = (event: PointerEvent) => {
      const current = layoutDrag.get();
      if (!current) {
        return;
      }
      const at = layoutDropTargetAt(
        current.payload.surface,
        event.clientX,
        event.clientY,
        current.payload.id,
      );
      cancelLayoutDrag();
      setDropTarget(null);
      if (current.moving) {
        settle(current.payload, at);
      }
    };
    const onCancel = () => {
      cancelLayoutDrag();
      setDropTarget(null);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [open, place, settle]);

  // Escape saves when no gesture is using the key, and abandons a gesture first.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }
      if (layoutDrag.get()) {
        cancelLayoutDrag();
        setDropTarget(null);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (menu.get()) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      save();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, save, menu]);

  // The list takes a command back, so it has to be a known drop target.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    return registerLayoutPalette(paletteRef.current);
  }, [open]);

  // A right-click on real chrome resolves the item from the boxes the surfaces
  // published: while editing, the items take no pointer events, so the element
  // under the pointer is the surface container rather than the button.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onContextMenu = (event: MouseEvent) => {
      for (const candidate of ["toolbar", "sidebar"] as const) {
        const hit = layoutItemAt(candidate, event.clientX, event.clientY);
        if (!hit) {
          continue;
        }
        event.preventDefault();
        event.stopPropagation();
        setContext({ surface: candidate, id: hit.id, x: event.clientX, y: event.clientY });
        menu.set({ owner: null, x: event.clientX, y: event.clientY });
        return;
      }
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => window.removeEventListener("contextmenu", onContextMenu, true);
  }, [open, menu]);

  if (!open) {
    return null;
  }

  /** What the ghost shows: the glyph and the name of what the pointer carries. */
  const ghost =
    carried === null
      ? null
      : (() => {
          const isDivider =
            carriedKind === "divider" || findPlacement(slots, carried)?.placement.divider === true;
          return {
            label: placementLabel(carried, isDivider, catalog, tRaw),
            icon: placementIcon(carried, isDivider),
          };
        })();
  const overPalette = dropTarget?.kind === "palette";

  return (
    <div
      className="redux-layout-editor"
      role="dialog"
      aria-modal="true"
      aria-label={t(
        surface === "toolbar" ? "layoutEditor.titleToolbar" : "layoutEditor.titleSidebar",
      )}
      data-editor-surface={surface}
    >
      {/* The dim leaves the toolbar and the rail bright: those are the surfaces
          being arranged, so they stay visible while the editor is open. */}
      <div className="redux-layout-editor-dim is-workspace" aria-hidden="true" />
      <div className="redux-layout-editor-dim is-gutter" aria-hidden="true" />
      <aside
        ref={paletteRef}
        className={`redux-layout-editor-palette${overPalette ? " is-over" : ""}`}
        aria-label={t("layoutEditor.palette")}
      >
        <header className="redux-layout-editor-header">
          <h2>
            {t(surface === "toolbar" ? "layoutEditor.titleToolbar" : "layoutEditor.titleSidebar")}
          </h2>
        </header>
        <div className="redux-layout-editor-list">
          {groups.map((group) => (
            <section key={group.key} className="redux-layout-editor-group">
              <h3>{group.label}</h3>
              <ul>
                {group.divider ? (
                  <li>
                    <Button
                      variant="plain"
                      className="redux-layout-editor-row"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        beginLayoutDrag(
                          { kind: "divider", id: dividerId(), surface },
                          event.clientX,
                          event.clientY,
                        );
                      }}
                    >
                      <Icon name={iconName("linesVertical")} size={16} />
                      <span className="redux-layout-editor-row-label">
                        {t("layoutEditor.divider")}
                      </span>
                    </Button>
                  </li>
                ) : (
                  group.items.map((item) => (
                    <li key={item.id}>
                      <Button
                        variant="plain"
                        className="redux-layout-editor-row"
                        data-carried={carried === item.id ? "true" : undefined}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          beginLayoutDrag(
                            { kind: "available", id: item.id, surface },
                            event.clientX,
                            event.clientY,
                          );
                        }}
                      >
                        <Icon name={item.icon} size={16} />
                        <span className="redux-layout-editor-row-label">{item.label}</span>
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}
          {groups.every((group) => group.items.length === 0) && (
            <p className="redux-layout-editor-empty">{t("layoutEditor.allPlaced")}</p>
          )}
        </div>
        <footer className="redux-layout-editor-footer">
          <Button variant="outlined" onClick={cancel}>
            {t("layoutEditor.discard")}
          </Button>
          <Button variant="solid" onClick={save}>
            {t("layoutEditor.save")}
          </Button>
        </footer>
      </aside>
      {ghost && (
        <div
          className="redux-layout-editor-ghost"
          aria-hidden="true"
          style={{ left: `${drag?.x ?? 0}px`, top: `${drag?.y ?? 0}px` }}
        >
          <Icon name={ghost.icon} size={14} />
          <span>{ghost.label}</span>
        </div>
      )}
      <ContextMenuPopup store={menu} label={t("layoutEditor.rowMenu")} initialFocus="container">
        {(_point, close) => (
          <MenuItem
            label={t("layoutEditor.remove")}
            danger
            onClick={() => {
              close();
              if (context) {
                removeSurfaceItem(context.surface, registeredIds, authoredSlot, context.id);
                setContext(null);
              }
            }}
          />
        )}
      </ContextMenuPopup>
    </div>
  );
}
