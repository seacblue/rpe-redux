/**
 * The multi-line pane: a line-selection expression, the line list, and the
 * multi-line window width, with the class owning the render cycle and its revision.
 *
 * Parsing and applying the expression belong to core multi-line edits; the view
 * only keeps drafts and writes the resulting indices onto the session. The list
 * selects on pointer down so a pending expression blur cannot swallow the click;
 * Shift-drag uses the toolbar marquee contract for range selection.
 */
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";

import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import { t } from "../../../../../i18n/index.ts";
import {
  clampMultiLineWindowWidth,
  MULTI_LINE_WINDOW_WIDTH_MAX,
  MULTI_LINE_WINDOW_WIDTH_MIN,
} from "../../../../../core/edit/timeline/timelineCoordinates.ts";
import { displayValues } from "../../../settings/editorDisplaySettings.ts";
import { MultiLineEventTracks } from "./MultiLineEventTracks.tsx";
import {
  editorLine,
  editorLineGroups,
  editorLineOptions,
  editorLineSelection,
} from "../../../../../core/edit/state/publishedValues.ts";
import { parseLineSelectionInput } from "../../../../../core/edit/state/lineSelectionInput.ts";
import {
  addGroupSelection,
  addLineSelection,
  formatLineSelectionTokens,
  resolveLineSelection,
  subtractLineSelection,
  tokensForSelection,
  tokensFromLines,
} from "../../../../../core/edit/state/lineSelectionTokens.ts";
import {
  buildMultiLineLineBarItems,
  lineBarSelectionAfterClick,
} from "../../multiLine/multiLineLineBar.ts";
import {
  setLineSelectionCollapsedFolders,
  useLineSelectionPreferences,
} from "../../lineSelection/preferences.ts";
import { groupLineEntries } from "../../lineSelection/lineGroupEntries.ts";
import { toggleGroupSelection } from "../../toolbar/lineSelectionGroupSelection.ts";
import { LineSelectionGroupHeader } from "../../lineSelection/LineSelectionGroupHeader.tsx";
import {
  createMarqueeDrag,
  listContentX,
  listContentY,
  marqueeBox,
  type MarqueeBox,
  type MarqueeDrag,
  type MarqueePoint,
  type MarqueePreview,
} from "../../toolbar/lineSelectionMarquee.ts";

import type { MultiLinePanelState } from "./model.ts";

type MultiLineTimeline = Pick<Timeline, "changed" | "cancelPlacement">;

const MARQUEE_EDGE = 28;
const MARQUEE_SCROLL_STEP = 14;

interface MultiLinePanelOptions {
  state: MultiLinePanelState;
  render?: () => void;
  timeline?: MultiLineTimeline | null;
}

export interface MultiLinePanelProps {
  session: EditorSession;
  timeline: MultiLineTimeline | null;
  renderSession: () => void;
}

// This surface edits the existing mutable editor session and timeline models.

/**
 * The editor engine owns the session and timeline. This view only renders the
 * stable multi-line panel structure and sends user actions back to that engine.
 */
export function MultiLinePanelView({ session, timeline, renderSession }: MultiLinePanelProps) {
  const multiLineWindowWidth = useSyncExternalStore(
    displayValues.multiLineWindowWidth.subscribe,
    displayValues.multiLineWindowWidth.get,
    displayValues.multiLineWindowWidth.get,
  );
  const multiLineMergeNotes = useSyncExternalStore(
    displayValues.multiLineMergeNotes.subscribe,
    displayValues.multiLineMergeNotes.get,
    displayValues.multiLineMergeNotes.get,
  );
  const multiLineNoteLineNumbers = useSyncExternalStore(
    displayValues.multiLineNoteLineNumbers.subscribe,
    displayValues.multiLineNoteLineNumbers.get,
    displayValues.multiLineNoteLineNumbers.get,
  );
  const windowWidthValue = clampMultiLineWindowWidth(Number(multiLineWindowWidth));
  const lineOptions = useSyncExternalStore(
    editorLineOptions.subscribe,
    editorLineOptions.get,
    editorLineOptions.get,
  );
  const lineGroupNames = useSyncExternalStore(
    editorLineGroups.subscribe,
    editorLineGroups.get,
    editorLineGroups.get,
  );
  const lineSelection = useSyncExternalStore(
    editorLineSelection.subscribe,
    editorLineSelection.get,
    editorLineSelection.get,
  );
  const lineValue = useSyncExternalStore(editorLine.subscribe, editorLine.get, editorLine.get);
  const currentLine = Number.isInteger(Number(lineValue)) ? Number(lineValue) : 0;
  const lineItems = buildMultiLineLineBarItems(lineOptions, lineSelection, currentLine, (index) =>
    t("editorPanels.multiLine.lineFallback", { number: index }),
  );
  const selectedSet = useMemo(() => {
    const next = new Set(lineSelection);
    if (!next.size && Number.isInteger(currentLine)) {
      next.add(currentLine);
    }
    return next;
  }, [currentLine, lineSelection]);
  const selectionRef = useRef(selectedSet);
  const lineListRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const marqueeActive = useRef(false);
  const marqueePointer = useRef({ x: 0, y: 0 });
  const marqueeStartContent = useRef<MarqueePoint>({ x: 0, y: 0 });
  const marqueeDrag = useRef<MarqueeDrag | null>(null);
  const marqueeFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeBox | null>(null);
  const [marqueePreview, setMarqueePreview] = useState<ReadonlySet<number> | null>(null);
  const [marqueeTouched, setMarqueeTouched] = useState<ReadonlySet<number> | null>(null);
  useEffect(() => {
    selectionRef.current = selectedSet;
  }, [selectedSet]);
  const selectionPreferences = useLineSelectionPreferences();
  const collapsedGroups = useMemo(
    () => new Set(selectionPreferences.collapsedFolders),
    [selectionPreferences.collapsedFolders],
  );
  const lineGroups = useMemo(
    () => groupLineEntries(lineItems, lineGroupNames),
    [lineGroupNames, lineItems],
  );
  // The parser and the folder rows share one membership view: the lines shown
  // under a folder are exactly the lines its name adds.
  const selectionGroups = useMemo(
    () =>
      lineGroups.map((group) => ({
        index: group.index,
        name: group.name,
        label: group.name || t("chrome.toolbar.lineSelectionDefaultGroup"),
        indices: group.entries.map((entry) => entry.index),
      })),
    [lineGroups],
  );
  // One tab stop for every number, sized by the widest line index.
  const indexColumn = useMemo(() => {
    const highest = lineOptions.reduce((maximum, option) => Math.max(maximum, option.index), 0);
    return `${Math.max(1, String(highest).length)}ch`;
  }, [lineOptions]);
  const lines = session.chart.judgeLineList;
  const available = useMemo(
    () => Array.from({ length: lines?.length ?? 0 }, (unused, index) => index),
    [lines],
  );
  const authoredTokens = tokensForSelection(
    session.multiLineTokens,
    session.multiLineIndices,
    available,
    selectionGroups,
  );
  const lineText =
    formatLineSelectionTokens(authoredTokens, selectionGroups) || String(session.lineIndex);

  /** Applies a parsed line-selection expression to the session. */
  const commitLines = (raw: string, input: HTMLInputElement) => {
    const parsed = parseLineSelectionInput(raw, available, selectionGroups);
    if (!parsed) {
      input.value = lineText;
      return;
    }
    // Keep the active line when it remains selected; otherwise focus the last
    // line in the expression, matching the field's compact display.
    const focus =
      parsed.current ??
      (parsed.lines.includes(session.lineIndex)
        ? session.lineIndex
        : (parsed.lines.at(-1) ?? session.lineIndex));
    session.setMultiLineSelection(parsed.lines, { tokens: parsed.tokens });
    editorLine.set(String(focus));
    renderSession();
  };

  /** Applies one line-list click to the session and repaints. */
  const commitLineClick = (index: number, shiftToggle: boolean) => {
    const current = Number(editorLine.get());
    const baseTokens = tokensForSelection(
      session.multiLineTokens,
      session.multiLineIndices,
      available,
      selectionGroups,
    );
    const next = lineBarSelectionAfterClick(
      Number.isInteger(current) ? current : 0,
      session.multiLineIndices,
      index,
      shiftToggle,
      baseTokens,
      available,
      selectionGroups,
    );
    session.setMultiLineSelection(next.selection, { tokens: next.tokens });
    editorLine.set(String(next.current));
    renderSession();
  };

  /** Applies one folder-row click: add the folder, or remove its members in place. */
  const commitGroupClick = (groupIndex: number, groupName: string, indices: readonly number[]) => {
    const current = Number(editorLine.get());
    const currentSelection = new Set(session.multiLineIndices);
    const active = Number.isInteger(current) ? current : 0;
    const all = indices.length > 0 && indices.every((index) => currentSelection.has(index));
    const result = toggleGroupSelection(currentSelection, indices, active);
    const baseTokens = tokensForSelection(
      session.multiLineTokens,
      session.multiLineIndices,
      available,
      selectionGroups,
    );
    const tokens = all
      ? subtractLineSelection(baseTokens, indices, available, selectionGroups)
      : addGroupSelection(
          baseTokens,
          selectionGroups.find((group) => group.index === groupIndex) ?? {
            index: groupIndex,
            name: groupName,
            label: groupName || t("chrome.toolbar.lineSelectionDefaultGroup"),
            indices,
          },
          available,
          selectionGroups,
        );
    const next = resolveLineSelection(tokens, available, selectionGroups);
    const safe = next.length ? next : [result.focus];
    const safeTokens = next.length ? tokens : tokensFromLines(safe);
    session.setMultiLineSelection(safe, { tokens: safeTokens });
    editorLine.set(String(result.focus));
    renderSession();
  };

  /** Cancel a line marquee and remove its global pointer listeners. */
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

  /** Commit one marquee block: append additions, splice removals in place. */
  const applyMarqueeSelection = (preview: MarqueePreview) => {
    const baseTokens = tokensForSelection(
      session.multiLineTokens,
      session.multiLineIndices,
      available,
      selectionGroups,
    );
    const tokens =
      preview.mode === "add"
        ? addLineSelection(baseTokens, preview.lines, available, selectionGroups)
        : subtractLineSelection(baseTokens, preview.lines, available, selectionGroups);
    const next = resolveLineSelection(tokens, available, selectionGroups);
    const currentNow = Number(editorLine.get());
    const requested = Number.isInteger(preview.focus) ? preview.focus : currentNow;
    const safe = next.length ? next : [requested];
    const safeTokens = next.length ? tokens : tokensFromLines(safe);
    const focused = safe.includes(requested) ? requested : (safe[0] ?? currentNow);
    selectionRef.current = new Set(safe);
    session.setMultiLineSelection(safe, { tokens: safeTokens });
    editorLine.set(String(focused));
    renderSession();
  };

  /** Return visible line rows intersecting a content-space marquee. */
  const rowsInMarquee = (from: MarqueePoint, to: MarqueePoint): number[] => {
    const container = lineListRef.current;
    if (!container) {
      return [];
    }
    const listRect = container.getBoundingClientRect();
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

  /** Repaint the preview and optionally scroll when the pointer reaches an edge. */
  const updateMarquee = (allowScroll: boolean): boolean => {
    const container = lineListRef.current;
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

  /** Keep repainting while edge auto-scroll can still advance the list. */
  const runMarqueeFrame = () => {
    marqueeFrame.current = null;
    if (!marqueeActive.current) {
      return;
    }
    if (updateMarquee(true)) {
      marqueeFrame.current = requestAnimationFrame(runMarqueeFrame);
    }
  };

  /** Coalesce pointer movement and scrolling into one animation frame. */
  const scheduleMarquee = () => {
    if (marqueeFrame.current === null) {
      marqueeFrame.current = requestAnimationFrame(runMarqueeFrame);
    }
  };

  /** Start the same Shift-drag line marquee used by the toolbar dropdown. */
  const beginMarquee = (event: ReactPointerEvent<HTMLElement>, index: number): boolean => {
    if (event.button !== 0 || !event.shiftKey) {
      return false;
    }
    stopMarquee();
    event.preventDefault();
    const container = lineListRef.current;
    if (!container) {
      return true;
    }
    const rect = container.getBoundingClientRect();
    const drag = createMarqueeDrag(selectionRef.current, index, (preview) => {
      applyMarqueeSelection(preview);
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
    const cancel = () => stopMarquee();
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
    return true;
  };

  /** Folds or unfolds one folder, sharing the toolbar picker's persisted state. */
  const toggleGroupFold = (name: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setLineSelectionCollapsedFolders(next);
  };

  /** Index of the row that already committed from the current pointer sequence. */
  const pointerHandledIndexRef = useRef<number | null>(null);

  /**
   * Selects a row on pointer down, before the focused expression field blurs.
   *
   * Focusing the row first makes the field's blur commit run inside this handler;
   * the row selection then applies after it, so both commits happen once and the
   * row stays selected. The following click is ignored by `handleLineClick`.
   */
  const handleLinePointerDown = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0) {
      return;
    }
    if (beginMarquee(event, index)) {
      return;
    }
    pointerHandledIndexRef.current = index;
    event.currentTarget.focus();
    commitLineClick(index, event.shiftKey);
  };

  /**
   * Handles keyboard and assistive clicks; pointer clicks already committed on
   * pointer down. A stale pointer marker never blocks a keyboard click because
   * those arrive with `detail` 0.
   */
  const handleLineClick = (event: ReactMouseEvent<HTMLElement>, index: number) => {
    const handledIndex = pointerHandledIndexRef.current;
    pointerHandledIndexRef.current = null;
    if (handledIndex === index && event.detail > 0) {
      return;
    }
    commitLineClick(index, event.shiftKey);
  };

  /**
   * Writes one multi-line window width as the slider moves.
   *
   * The settings binding applies the new width to the timeline viewport and
   * invalidates the frame, so the panels resize during the drag instead of
   * waiting for the pointer to be released.
   */
  const applyWindowWidth = (raw: number) => {
    const next = clampMultiLineWindowWidth(raw);
    if (String(next) !== multiLineWindowWidth) {
      displayValues.multiLineWindowWidth.set(String(next));
    }
  };

  return (
    <>
      <FieldRow
        layout="inline"
        density="compact"
        className="multi-line-lines-field"
        label={t("editorPanels.multiLine.lines")}
        control={(id) => (
          <Input
            id={id}
            key={lineText}
            data-multi-line-lines="true"
            defaultValue={lineText}
            placeholder={t("editorPanels.multiLine.linesPlaceholder")}
            onBlur={(event) => commitLines(event.currentTarget.value, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        )}
      />
      {lineItems.length > 0 ? (
        <div
          className="multi-line-line-list"
          ref={lineListRef}
          role="group"
          aria-label={t("editorPanels.multiLine.lineBar")}
          data-multi-line-line-list="true"
          style={{ "--line-selection-index-width": indexColumn } as CSSProperties}
          onPointerDownCapture={(event) => {
            if (!event.shiftKey) {
              return;
            }
            event.preventDefault();
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
          {lineGroups.map((group) => {
            const name = group.name || t("chrome.toolbar.lineSelectionDefaultGroup");
            const folded = collapsedGroups.has(group.name);
            const activeSelection = marqueePreview ?? selectedSet;
            const picked = group.entries.filter((item) => activeSelection.has(item.index)).length;
            const all = group.entries.length > 0 && picked === group.entries.length;
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
                  onToggle={() => toggleGroupFold(group.name)}
                  onSelect={() =>
                    commitGroupClick(
                      group.index,
                      group.name,
                      group.entries.map((item) => item.index),
                    )
                  }
                />
                {!folded && group.entries.length > 0 && (
                  <div className="line-selection-children">
                    {group.entries.map((item) => {
                      const previewing = marqueePreview !== null;
                      const previewed = marqueePreview?.has(item.index) ?? false;
                      const committed = selectedSet.has(item.index);
                      const touched = marqueeTouched?.has(item.index) ?? false;
                      const changing = previewing && touched && previewed !== committed;
                      const removing = changing && committed;
                      return (
                        <ListRow
                          as="button"
                          type="button"
                          ref={(row) => {
                            if (row) {
                              rowRefs.current.set(item.index, row);
                            } else {
                              rowRefs.current.delete(item.index);
                            }
                          }}
                          key={item.index}
                          className={`line-selection-row multi-line-line-row${changing && !removing ? " is-marquee-preview" : ""}${removing ? " is-marquee-remove" : ""}`}
                          selected={previewing ? committed && !changing : item.selected}
                          current={item.current}
                          aria-pressed={previewing ? previewed : item.selected}
                          aria-current={item.current ? "true" : undefined}
                          data-line-index={item.index}
                          onPointerDown={(event) => handleLinePointerDown(event, item.index)}
                          onClick={(event) => handleLineClick(event, item.index)}
                        >
                          <span className="line-selection-index">{item.index}</span>
                          <span className="line-selection-name">{item.name}</span>
                        </ListRow>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      <Segmented
        className="multi-line-mode-field"
        label={t("editorPanels.multiLine.mode")}
        value={session.multiLineMode}
        options={[
          { value: "notes", label: t("editorPanels.multiLine.notes") },
          { value: "events", label: t("editorPanels.multiLine.events") },
        ]}
        onChange={(mode) => {
          session.setMultiLineMode(mode);
          renderSession();
        }}
      />
      <MultiLineEventTracks session={session} timeline={timeline} renderSession={renderSession} />
      <FieldRows>
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiLine.mergeNotes")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={multiLineMergeNotes}
              disabled={session.multiLineMode !== "notes"}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                displayValues.multiLineMergeNotes.set(enabled);
                session.setMultiLineMerge(enabled);
                renderSession();
              }}
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("settings.field.multi-line-note-line-numbers.label")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={multiLineNoteLineNumbers}
              disabled={session.multiLineMode !== "notes" || !multiLineMergeNotes}
              onChange={(event) => {
                displayValues.multiLineNoteLineNumbers.set(event.currentTarget.checked);
                renderSession();
              }}
            />
          )}
        />
        {timeline && session.multiLineActive ? (
          <FieldRow
            layout="inline"
            density="compact"
            label={t("settings.field.multi-line-window-width.label")}
            control={(id) => (
              <SliderField
                id={id}
                min={MULTI_LINE_WINDOW_WIDTH_MIN}
                max={MULTI_LINE_WINDOW_WIDTH_MAX}
                step={0.01}
                value={windowWidthValue}
                disabled={session.multiLineMode === "notes" && multiLineMergeNotes}
                aria-label={t("settings.field.multi-line-window-width.label")}
                onChange={(event) => applyWindowWidth(Number(event.currentTarget.value))}
              />
            )}
          />
        ) : null}
      </FieldRows>
    </>
  );
}

/** Publishes the multi-line form snapshot for the host to mount. */
export class MultiLinePanel {
  private readonly state: MultiLinePanelState;
  private readonly getSession: () => EditorSession;
  private readonly renderSession: () => void;
  private readonly timeline: MultiLineTimeline | null;
  private renderVersion = 0;
  private disposed = false;

  /** Binds the panel to the live session and its render callback. */
  constructor(getSession: () => EditorSession, options: MultiLinePanelOptions) {
    this.state = options.state;
    this.getSession = getSession;
    this.renderSession = options.render ?? (() => {});
    this.timeline = options.timeline ?? null;
  }

  /** Publishes a new snapshot revision for the current session. */
  render(): void {
    if (this.disposed) {
      return;
    }
    const session = this.getSession();
    if (!session) {
      return;
    }
    this.renderVersion += 1;
    this.state.set({
      revision: this.renderVersion,
      props: {
        session,
        timeline: this.timeline,
        renderSession: this.renderSession,
      },
    });
  }

  /** Clears the snapshot and rejects later renders. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    flushSync(() => this.state.set(null));
  }
}
