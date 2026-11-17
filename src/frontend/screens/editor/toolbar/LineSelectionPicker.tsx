/**
 * Toolbar judge-line selector with folder groups.
 *
 * A plain click replaces the selection, shift-click toggles one line, and
 * shift-drag previews a marquee that commits on release. A folder row batch
 * toggles its lines; its disclosure only folds. Folder disclosure persists;
 * selection is document state and never becomes empty.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { ListRow } from "../../../../design/components/list/ListRow.tsx";
import { useAnchoredPopover } from "../../../../design/patterns/useAnchoredPopover.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { values } from "../../../../core/state/values.ts";
import type { EditorLineOption } from "../../../../core/edit/state/publishedValues.ts";
import { setSelectedLineIndices } from "../../global/sections/lines/lineSelectionMode.ts";
import { LineSelectionGroupHeader } from "../lineSelection/LineSelectionGroupHeader.tsx";
import { groupLineEntries, type LineGroupEntries } from "../lineSelection/lineGroupEntries.ts";
import {
  setLineSelectionCollapsedFolders,
  useLineSelectionPreferences,
} from "../lineSelection/preferences.ts";
import { toggleGroupSelection } from "./lineSelectionGroupSelection.ts";
import { lineBarSelectionAfterClick } from "../multiLine/multiLineLineBar.ts";
import {
  createMarqueeDrag,
  listContentX,
  listContentY,
  marqueeBox,
  type MarqueeBox,
  type MarqueeDrag,
  type MarqueePoint,
} from "./lineSelectionMarquee.ts";

type RowKeys = Pick<MouseEvent<HTMLButtonElement>, "shiftKey">;

type LineGroup = LineGroupEntries<EditorLineOption>;

const EMPTY_OPTIONS: readonly EditorLineOption[] = Object.freeze([]);
const EMPTY_GROUP_NAMES: readonly string[] = Object.freeze([]);
const EMPTY_SELECTION: readonly number[] = Object.freeze([]);
const MARQUEE_EDGE = 28;
const MARQUEE_SCROLL_STEP = 14;

/** Toolbar judge-line selector with folders, shift-toggle, and marquee selection. */
export function LineSelectionPicker({
  inputRef,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation();
  const lineSelection = useLineSelectionPreferences();
  const collapsed = useMemo(
    () => new Set(lineSelection.collapsedFolders),
    [lineSelection.collapsedFolders],
  );
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const initialScrollIndex = useRef<number | null>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const marqueeActive = useRef(false);
  const marqueePointer = useRef({ x: 0, y: 0 });
  const marqueeStartContent = useRef<MarqueePoint>({ x: 0, y: 0 });
  const marqueeDrag = useRef<MarqueeDrag | null>(null);
  const marqueeFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  const anchorElement = useRef<HTMLElement | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeBox | null>(null);
  const [marqueePreview, setMarqueePreview] = useState<ReadonlySet<number> | null>(null);
  const [marqueeTouched, setMarqueeTouched] = useState<ReadonlySet<number> | null>(null);
  const options = useSyncExternalStore(
    (listener) => values.byId.subscribe("editor.lineOptions", listener),
    () => values.byId.get<readonly EditorLineOption[]>("editor.lineOptions") ?? EMPTY_OPTIONS,
    () => values.byId.get<readonly EditorLineOption[]>("editor.lineOptions") ?? EMPTY_OPTIONS,
  );
  const groupNames = useSyncExternalStore(
    (listener) => values.byId.subscribe("editor.lineGroups", listener),
    () => values.byId.get<readonly string[]>("editor.lineGroups") ?? EMPTY_GROUP_NAMES,
    () => values.byId.get<readonly string[]>("editor.lineGroups") ?? EMPTY_GROUP_NAMES,
  );
  const selected = useSyncExternalStore(
    (listener) => values.byId.subscribe("editor.lineSelection", listener),
    () => values.byId.get<readonly number[]>("editor.lineSelection") ?? EMPTY_SELECTION,
    () => values.byId.get<readonly number[]>("editor.lineSelection") ?? EMPTY_SELECTION,
  );
  const current = Number(
    useSyncExternalStore(
      (listener) => values.byId.subscribe("editor.line", listener),
      () => values.byId.get<string>("editor.line") ?? "0",
      () => values.byId.get<string>("editor.line") ?? "0",
    ),
  );
  const selectedSet = useMemo(() => {
    const next = new Set(selected);
    if (!next.size && Number.isInteger(current)) {
      next.add(current);
    }
    return next;
  }, [current, selected]);
  const selectionRef = useRef(selectedSet);
  useEffect(() => {
    selectionRef.current = selectedSet;
  }, [selectedSet]);

  /** Cancel the marquee frame loop and clear its preview state. */
  const stopMarquee = useCallback(() => {
    if (marqueeFrame.current !== null) {
      cancelAnimationFrame(marqueeFrame.current);
      marqueeFrame.current = null;
    }
    marqueeCleanup.current?.();
    marqueeCleanup.current = null;
    marqueeDrag.current?.cancel();
    marqueeDrag.current = null;
    marqueeActive.current = false;
    setMarqueeRect(null);
    setMarqueePreview(null);
    setMarqueeTouched(null);
  }, []);

  useEffect(() => stopMarquee, [stopMarquee]);

  const groups = useMemo(() => groupLineEntries(options, groupNames), [groupNames, options]);
  // One column width for every line number, sized by the widest index, so names
  // start on the same tab stop regardless of each row's label.
  const indexColumn = useMemo(() => {
    let highest = 0;
    for (const option of options) {
      highest = Math.max(highest, option.index);
    }
    return `${Math.max(1, String(highest).length)}ch`;
  }, [options]);

  /** Open the popover anchored to the line input and remember the current row. */
  const show = () => {
    // Align the popover with the input it belongs to, not with the chevron that
    // opens it: the list then reads as the field's own dropdown.
    const target = inputRef?.current ?? button.current;
    if (!target) {
      return;
    }
    const currentNow = Number(values.byId.get<string>("editor.line") ?? 0);
    initialScrollIndex.current = Number.isFinite(currentNow) ? currentNow : null;
    anchorElement.current = target;
    setOpen(true);
  };
  const popover = useAnchoredPopover({
    open,
    anchor: anchorElement,
    panel: popup,
    onClose: () => {
      stopMarquee();
      setOpen(false);
    },
    focusTarget: button,
    toggle: button,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    // Focus and scroll after the portal has laid out. The current line lands at
    // 30% of the visible list.
    const frame = requestAnimationFrame(() => {
      const container = list.current;
      if (!container) {
        return;
      }
      const targetIndex = initialScrollIndex.current;
      const row = targetIndex === null ? null : rowRefs.current.get(targetIndex);
      const focusTarget = row ?? rowRefs.current.values().next().value;
      focusTarget?.focus({ preventScroll: true });
      if (!row) {
        return;
      }
      const listRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const offset = rowRect.top - listRect.top + container.scrollTop;
      const maximum = container.scrollHeight - container.clientHeight;
      container.scrollTop = Math.max(0, Math.min(maximum, offset - container.clientHeight * 0.3));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /** Commit a selection and make sure the current line is one of its members. */
  const applySelection = (next: ReadonlySet<number>, focus: number) => {
    const indices = [...next].filter((value) => Number.isInteger(value)).sort((a, b) => a - b);
    const currentNow = Number(values.byId.get<string>("editor.line") ?? focus);
    const requested = Number.isInteger(focus) ? focus : currentNow;
    const safe = indices.length ? indices : [requested];
    const focused = safe.includes(requested) ? requested : (safe[0] ?? currentNow);
    selectionRef.current = new Set(safe);
    setSelectedLineIndices(safe);
    values.byId.set<string>("editor.line", String(focused));
  };

  /**
   * Toggle one row. The only selected line is protected: asking to remove it
   * behaves as an add instead, so the selector can never become empty.
   */
  const toggleLine = (index: number) => {
    const next = lineBarSelectionAfterClick(current, [...selectionRef.current], index, true);
    applySelection(new Set(next.selection), next.current);
  };

  /** Plain click: this line is the whole selection. Shift: toggle it. */
  const pick = (index: number, keys: RowKeys) => {
    if (keys.shiftKey) {
      toggleLine(index);
      return;
    }
    applySelection(new Set([index]), index);
  };

  /** Toggle one folder's disclosure and persist the collapsed set. */
  const toggleGroup = (name: string) => {
    const next = new Set(collapsed);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setLineSelectionCollapsedFolders(next);
  };

  /**
   * Toggle every line in one group on the currently painted selection. A
   * marquee preview is the source when a drag is active, so the click commits
   * exactly what the user sees.
   */
  const selectGroup = (group: LineGroup) => {
    const activeSet = marqueePreview ?? selectedSet;
    const result = toggleGroupSelection(
      activeSet,
      group.entries.map((entry) => entry.index),
      current,
    );
    applySelection(new Set(result.selection), result.focus);
  };

  /** Rows intersecting the content-space rectangle, in document order. */
  const rowsInMarquee = (from: MarqueePoint, to: MarqueePoint): number[] => {
    const container = list.current;
    if (!container) {
      return [];
    }
    const listRect = container.getBoundingClientRect();
    // The rectangle is absolutely positioned in the list's padding box, so row
    // hit testing starts from the same origin rather than the border box. Both
    // axes matter: the drag follows the pointer horizontally as well as down.
    const originX = listRect.left + container.clientLeft;
    const originY = listRect.top + container.clientTop;
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x, to.x);
    const top = Math.min(from.y, to.y);
    const bottom = Math.max(from.y, to.y);
    const rows: { index: number; top: number }[] = [];
    for (const row of rowRefs.current.values()) {
      const index = Number(row.dataset.lineIndex);
      const rect = row.getBoundingClientRect();
      const rowLeft = rect.left - originX;
      const rowTop = rect.top - originY + container.scrollTop;
      const rowRight = rowLeft + rect.width;
      const rowBottom = rowTop + rect.height;
      if (
        Number.isInteger(index) &&
        rowRight >= left &&
        rowLeft <= right &&
        rowBottom >= top &&
        rowTop <= bottom
      ) {
        rows.push({ index, top: rowTop });
      }
    }
    return rows.sort((leftRow, rightRow) => leftRow.top - rightRow.top).map((row) => row.index);
  };

  /**
   * Paint the marquee at the pointer's current content position.
   *
   * `allowScroll` advances edge auto-scroll before measuring. Returns whether
   * the list moved, so the frame loop keeps ticking only while it can still do
   * useful work.
   */
  const updateMarquee = (allowScroll: boolean): boolean => {
    const container = list.current;
    const drag = marqueeDrag.current;
    if (!container || !drag || !marqueeActive.current) {
      return false;
    }
    const rect = container.getBoundingClientRect();
    const pointer = marqueePointer.current;
    let delta = 0;
    if (allowScroll) {
      if (pointer.y < rect.top + MARQUEE_EDGE) {
        delta = -MARQUEE_SCROLL_STEP;
      } else if (pointer.y > rect.bottom - MARQUEE_EDGE) {
        delta = MARQUEE_SCROLL_STEP;
      }
    }
    let scrolling = false;
    if (delta) {
      const before = container.scrollTop;
      container.scrollTop = Math.max(
        0,
        Math.min(container.scrollHeight - container.clientHeight, before + delta),
      );
      scrolling = container.scrollTop !== before;
    }
    const contentY = listContentY(pointer.y, rect.top, container.clientTop, container.scrollTop);
    const contentX = listContentX(pointer.x, rect.left, container.clientLeft);
    const start = marqueeStartContent.current;
    const rows = rowsInMarquee(start, { x: contentX, y: contentY });
    const preview = drag.update(rows, contentY >= start.y);
    setMarqueeRect(marqueeBox(start, { x: contentX, y: contentY }));
    setMarqueePreview(new Set(preview.selection));
    setMarqueeTouched(new Set(rows));
    return scrolling;
  };

  /** One drag frame: repaint, then keep scrolling while the pointer is at an edge. */
  const runMarqueeFrame = () => {
    marqueeFrame.current = null;
    if (!marqueeActive.current) {
      return;
    }
    if (updateMarquee(true)) {
      marqueeFrame.current = requestAnimationFrame(runMarqueeFrame);
    }
  };

  /** Coalesce pointer moves and auto-scroll into one repaint per frame. */
  const scheduleMarquee = () => {
    if (marqueeFrame.current === null) {
      marqueeFrame.current = requestAnimationFrame(runMarqueeFrame);
    }
  };

  /**
   * Shift+press starts a preview drag. The pressed row decides whether the drag
   * paints rows in or out, but no selection is written until release. Pointer
   * moves coalesce into one repaint per frame, and release captures the final
   * pointer position even when no pointermove preceded it.
   */
  const beginMarquee = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0 || !event.shiftKey) {
      return;
    }
    stopMarquee();
    event.preventDefault();
    const container = list.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const drag = createMarqueeDrag(selectionRef.current, index, (preview) => {
      applySelection(preview.selection, preview.focus);
    });
    marqueeActive.current = true;
    marqueeDrag.current = drag;
    const start = {
      x: listContentX(event.clientX, rect.left, container.clientLeft),
      y: listContentY(event.clientY, rect.top, container.clientTop, container.scrollTop),
    };
    marqueeStartContent.current = start;
    marqueePointer.current = { x: event.clientX, y: event.clientY };
    suppressClick.current = true;
    setMarqueePreview(new Set(drag.preview().selection));
    setMarqueeTouched(new Set([index]));
    setMarqueeRect(marqueeBox(start, start));

    const pointerId = event.pointerId;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      marqueePointer.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      scheduleMarquee();
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      const active = marqueeDrag.current;
      if (active) {
        marqueePointer.current = { x: finishEvent.clientX, y: finishEvent.clientY };
        updateMarquee(false);
        active.finish();
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 80);
      }
      stopMarquee();
    };
    const cancel = () => {
      stopMarquee();
    };
    marqueeCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    if (updateMarquee(true)) {
      scheduleMarquee();
    }
  };

  return (
    <>
      <IconButton
        ref={button}
        icon="chevronDown"
        size={14}
        variant="plain"
        className="line-picker-toggle"
        label={t("chrome.toolbar.lineSelection")}
        data-tip-desc={t("chrome.toolbar.lineSelectionHint")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            stopMarquee();
            setOpen(false);
          } else {
            show();
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={popup}
            className="line-selection-popover"
            role="dialog"
            aria-label={t("chrome.toolbar.lineSelection")}
            style={
              {
                ...popover.style,
                "--line-selection-index-width": indexColumn,
              } as CSSProperties
            }
            data-placement={popover.side}
            data-line-selection-popover
          >
            <div
              ref={list}
              className="line-selection-list"
              role="group"
              aria-label={t("chrome.toolbar.lineSelection")}
              onPointerDownCapture={(event) => {
                // Shift is a range-selection modifier: pressing it inside the
                // list must not move focus onto a folder or row. The row and
                // group handlers still own the actual selection behavior.
                if (event.shiftKey) {
                  event.preventDefault();
                }
              }}
            >
              {marqueeRect && (
                <span
                  className="line-selection-marquee"
                  style={{
                    top: marqueeRect.top,
                    left: marqueeRect.left,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                  }}
                  aria-hidden="true"
                />
              )}
              {groups.map((group) => {
                const activeSet = marqueePreview ?? selectedSet;
                const picked = group.entries.filter((entry) => activeSet.has(entry.index)).length;
                const all = group.entries.length > 0 && picked === group.entries.length;
                const name = group.name || t("chrome.toolbar.lineSelectionDefaultGroup");
                const folded = collapsed.has(group.name);
                const groupAction = t(
                  all
                    ? "chrome.toolbar.lineSelectionGroupClearAll"
                    : "chrome.toolbar.lineSelectionGroupSelectAll",
                  { name },
                );
                return (
                  <section className="line-selection-group" key={group.name || "default"}>
                    <LineSelectionGroupHeader
                      name={name}
                      folded={folded}
                      all={all}
                      picked={picked}
                      groupAction={groupAction}
                      onToggle={() => toggleGroup(group.name)}
                      onSelect={() => selectGroup(group)}
                    />
                    {!folded && group.entries.length > 0 && (
                      <div className="line-selection-children">
                        {group.entries.map((entry) => {
                          const previewing = marqueePreview !== null;
                          const previewed = marqueePreview?.has(entry.index) ?? false;
                          const committed = selectedSet.has(entry.index);
                          const touched = marqueeTouched?.has(entry.index) ?? false;
                          // Only rows whose committed state would change get the
                          // dashed preview edge. Already-selected rows stay solid
                          // and untouched rows keep their normal surface.
                          const changing = previewing && touched && previewed !== committed;
                          const removing = changing && committed;
                          return (
                            <ListRow
                              as="button"
                              type="button"
                              ref={(row) => {
                                if (row) {
                                  rowRefs.current.set(entry.index, row);
                                } else {
                                  rowRefs.current.delete(entry.index);
                                }
                              }}
                              selected={previewing ? committed && !changing : committed}
                              current={entry.index === current}
                              className={`line-selection-row${changing && !removing ? " is-marquee-preview" : ""}${removing ? " is-marquee-remove" : ""}`}
                              key={entry.index}
                              data-line-index={entry.index}
                              aria-pressed={previewing ? previewed : committed}
                              aria-current={entry.index === current ? "true" : undefined}
                              onPointerDown={(event) => beginMarquee(event, entry.index)}
                              onClick={(event) => {
                                if (suppressClick.current) {
                                  suppressClick.current = false;
                                  return;
                                }
                                pick(entry.index, event);
                              }}
                            >
                              <span className="line-selection-index">{entry.index}</span>
                              <span className="line-selection-name">{entry.name}</span>
                            </ListRow>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
