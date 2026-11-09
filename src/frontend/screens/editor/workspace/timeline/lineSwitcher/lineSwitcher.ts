/**
 * Owns the line-switcher overlay controller: indexes chart lines, lays out the card
 * grid, tracks the visible window, and animates the selected card.
 *
 * It publishes snapshots for React and delegates line selection through its
 * injected callback.
 */
import {
  lineOverviewWindow,
  lineOverviewLayout,
  stepOverviewLine,
  LineOverviewIndex,
  type OverviewLayout,
} from "../../../../../../core/global/chart/line/lineOverview.ts";
import { shaderEvents } from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import { isDefaultLineGroup, isDefaultLineName, lineGroupName } from "../../lineLabels.ts";
import { t } from "../../../../../../i18n/index.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";
import { clamp } from "../../../../../../core/utils/numbers.ts";
import type {
  LineSwitcherCardSnapshot,
  LineSwitcherSnapshot,
  LineSwitcherContext,
} from "./lineSwitcherTypes.ts";
import { lineSwitcherFrameDue } from "./lineSwitcherTiming.ts";

/** Indexes chart lines, lays out the card grid, and animates the selected card. */
export class LineSwitcher {
  stage: HTMLElement;
  getContext: () => LineSwitcherContext;
  enabled: boolean;
  overlayEnabled: boolean;
  active: boolean;
  select: (index: number) => unknown;
  browseRow: number | null;
  animation: number | null;
  cache: Map<string, LineOverviewIndex>;
  cards: Map<number, LineSwitcherCardSnapshot>;
  lastFrame: number;
  viewport: HTMLElement | null;
  snapshot: LineSwitcherSnapshot;
  renderView?: (snapshot: LineSwitcherSnapshot) => void;
  disposeView?: () => void;
  animateFollow?: boolean;
  chart?: Chart | null;
  tempo?: TempoSource;
  filterKey?: string | null;
  indices?: number[];
  layout?: OverviewLayout;
  context?: Omit<LineSwitcherContext, "visible">;
  stride?: number;
  visibleRows?: number;
  signature?: string;
  targetTop?: number;

  /** Create the switcher over its stage and optional view hooks. */
  constructor(
    stage: HTMLElement,
    getContext: () => LineSwitcherContext,
    {
      select = () => {},
      renderView,
      disposeView,
    }: {
      select?: (index: number) => unknown;
      renderView?: (snapshot: LineSwitcherSnapshot) => void;
      disposeView?: () => void;
    } = {},
  ) {
    this.stage = stage;
    this.getContext = getContext;
    this.enabled = true;
    this.overlayEnabled = true;
    this.active = false;
    this.select = select;
    this.renderView = renderView;
    this.disposeView = disposeView;
    this.browseRow = null;
    this.animation = null;
    this.cache = new Map();
    this.cards = new Map();
    this.lastFrame = -Infinity;
    this.viewport = null;
    this.snapshot = {
      visible: false,
      host: { top: 0, width: 0, thumbnailHeight: 0 },
      viewport: { columns: 1, height: 1, contentHeight: 0, gridTop: 0, empty: true, cards: [] },
    };
    this.renderPanel();
  }

  /** Open the switcher and draw the current selection. */
  show(): void {
    if (!this.enabled) {
      return;
    }
    this.animateFollow = this.active;
    this.browseRow = null;
    this.active = true;
    this.snapshot = { ...this.snapshot, visible: true };
    this.renderPanel();
    this.lastFrame = -Infinity;
    this.draw(performance.now());
  }

  /** Close the switcher and drop cached line indexes. */
  reset(): void {
    this.hide();
    this.browseRow = null;
    this.cache.clear();
    this.chart = null;
    this.filterKey = null;
    this.renderPanel();
  }

  /** Memoized overview sample for one line, layer, and mode. */
  lineIndex(
    index: number,
    chart: Chart,
    tempo: TempoSource,
    layer = 0,
    extended = false,
  ): LineOverviewIndex | undefined {
    const key = `${index}:${layer}:${extended ? 1 : 0}`;
    const line = chart.judgeLineList?.[index];
    if (!line) {
      return undefined;
    }
    if (!this.cache.has(key)) {
      this.cache.set(
        key,
        new LineOverviewIndex(
          line,
          tempo,
          extended ? shaderEvents(chart, index) : [],
          layer,
          extended,
        ),
      );
    }
    return this.cache.get(key);
  }

  /** Indices of the lines the switcher may show, memoized by range and layer. */
  filteredLines({
    chart,
    tempo,
    start,
    end,
    layer = 0,
    extended = false,
  }: {
    chart: Chart;
    tempo: TempoSource;
    start: number;
    end: number;
    layer?: number;
    extended?: boolean;
  }): number[] {
    if (chart !== this.chart || tempo !== this.tempo) {
      this.cache.clear();
      this.chart = chart;
      this.tempo = tempo;
      this.filterKey = null;
    }
    const key = `${start}:${end}:${layer}:${extended ? 1 : 0}`;
    if (this.filterKey === key) {
      return this.indices as number[];
    }
    this.filterKey = key;
    this.indices = (chart.judgeLineList ?? []).map((_line, index) => index);
    return this.indices as number[];
  }

  /** Move the selection by `direction` and show the switcher; false when no line exists. */
  step(direction: number): unknown {
    const context = this.getContext();
    const index = stepOverviewLine(context.selected, direction, this.filteredLines(context));
    return index === null ? false : this.select(index);
  }

  /** Close the switcher and cancel any scroll animation. */
  hide(): void {
    this.cancelScroll();
    this.active = false;
    if (this.snapshot?.visible) {
      this.snapshot = { ...this.snapshot, visible: false };
      this.renderPanel();
    }
  }

  /** Stop the running scroll animation. */
  cancelScroll(): void {
    if (this.animation != null) {
      cancelAnimationFrame(this.animation);
    }
    this.animation = null;
  }

  /** Stop animation and release the React view. */
  dispose(): void {
    this.cancelScroll();
    this.disposeView?.();
  }

  /** Scroll the card viewport to `top`, easing when the jump is short. */
  scrollTo(top: number, animate: boolean): void {
    if (animate && this.targetTop === top && this.animation !== null) {
      return;
    }
    this.cancelScroll();
    this.targetTop = top;
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    const start = viewport.scrollTop;
    const distance = top - start;
    if (
      !animate ||
      Math.abs(distance) < 1 ||
      Math.abs(distance) > (this.stride as number) * (this.layout?.rows ?? 0) * 2
    ) {
      viewport.scrollTop = top;
      this.renderWindow();
      return;
    }
    const started = performance.now();
    const frame = (timestamp: number) => {
      const elapsed = timestamp - started;
      const progress =
        elapsed >= 140 - Number.EPSILON * Math.max(1, Math.abs(started))
          ? 1
          : clamp(elapsed / 140, 0, 1);
      viewport.scrollTop = start + distance * (1 - (1 - progress) ** 3);
      this.renderWindow();
      this.animation = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    this.animation = requestAnimationFrame(frame);
  }

  /** Refresh the layout and visible cards for the current context. */
  draw(timestamp: number): void {
    if (!this.active || !lineSwitcherFrameDue(this.lastFrame, timestamp)) {
      return;
    }
    const {
      chart,
      tempo,
      seconds,
      selected,
      start,
      end,
      visible,
      layer = 0,
      extended = false,
    } = this.getContext();
    if (!visible || !this.enabled || !chart.judgeLineList?.length) {
      this.hide();
      return;
    }
    this.lastFrame = timestamp;
    const changedChart = chart !== this.chart || tempo !== this.tempo;
    const indices = this.filteredLines({ chart, tempo, start, end, layer, extended });
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const layout = lineOverviewLayout(width, height);
    const resized =
      !this.layout ||
      layout.columns !== this.layout.columns ||
      layout.rows !== this.layout.rows ||
      layout.thumbnailHeight !== this.layout.thumbnailHeight ||
      layout.panelWidth !== this.layout.panelWidth;
    this.layout = layout;
    const { columns, rows, thumbnailHeight, panelWidth } = layout;
    this.context = {
      chart,
      tempo,
      seconds,
      selected,
      start,
      end,
      layer,
      extended: Boolean(extended),
    };
    this.stride = thumbnailHeight + 26;
    const visibleRows = Math.min(rows, Math.max(1, Math.floor((height - 38) / this.stride)));
    const overview = lineOverviewWindow(
      indices.indexOf(selected),
      indices.length,
      columns,
      visibleRows,
      this.browseRow,
    );
    this.visibleRows = visibleRows;
    this.snapshot = {
      ...this.snapshot,
      visible: true,
      host: {
        top: Math.max(0, (height - (visibleRows * this.stride - 4 + 38)) / 2),
        width: panelWidth,
        thumbnailHeight,
      },
      viewport: {
        ...this.snapshot.viewport,
        columns,
        height: Math.max(1, Math.min(visibleRows, overview.totalRows)) * this.stride - 4,
        contentHeight: Math.max(0, overview.totalRows * this.stride - 4),
        empty: indices.length === 0,
      },
    };
    this.scrollTo(
      overview.firstRow * this.stride,
      this.browseRow === null && this.animateFollow === true && !resized && !changedChart,
    );
    const selectedChanged =
      this.snapshot.viewport.cards.length === 0 ||
      this.snapshot.viewport.cards.some((card) => card.selected !== (card.index === selected));
    this.renderWindow(changedChart || resized || selectedChanged);
  }

  /** Rebuild the cards in the current scroll window, or only the grid offset. */
  renderWindow(refresh = false): void {
    const viewport = this.viewport;
    if (!this.active || !this.context || !this.layout || !viewport) {
      return;
    }
    const { chart, tempo, seconds, selected, start, end, layer, extended } = this.context;
    const { columns } = this.layout;
    const rows = this.visibleRows as number;
    const firstRow = Math.floor(viewport.scrollTop / (this.stride as number));
    const first = Math.max(0, firstRow - 1) * columns;
    const last = Math.min((this.indices as number[]).length, (firstRow + rows + 2) * columns);
    const indices = (this.indices as number[]).slice(first, last);
    const signature = `${columns}:${indices.join(",")}`;
    const previousGridTop = this.snapshot.viewport.gridTop;
    const gridTop = Math.max(0, firstRow - 1) * (this.stride as number);
    this.snapshot = {
      ...this.snapshot,
      viewport: {
        ...this.snapshot.viewport,
        gridTop,
      },
    };
    if (signature !== this.signature) {
      this.signature = signature;
      this.cards = new Map();
      refresh = true;
    }
    if (!refresh) {
      if (gridTop !== previousGridTop) {
        this.renderPanel();
      }
      return;
    }
    const cards = new Map<number, LineSwitcherCardSnapshot>();
    for (const index of indices) {
      const line = chart.judgeLineList?.[index];
      if (!line) {
        continue;
      }
      const sample = this.lineIndex(index, chart, tempo, layer, extended)?.sample(
        seconds,
        start,
        end,
      );
      const defaultName =
        String(line?.Name ?? "").trim() === "Untitled" || isDefaultLineName(line, index);
      const lineGroup = isDefaultLineGroup(chart, line) ? "" : `, ${lineGroupName(chart, line)}`;
      cards.set(index, {
        index,
        selected: index === selected,
        titleNumber: `${index === selected ? "▶ " : ""}${index}`,
        lineGroup,
        name: defaultName ? "" : `, ${String(line.Name).trim()}`,
        info: t("editorPanels.lineSwitcher.remaining", {
          notes: sample?.notesLeft ?? 0,
          events: sample?.eventsLeft ?? 0,
        }),
        thumbnail: { sample, seconds, start, end },
      });
    }
    this.cards = cards;
    this.snapshot = {
      ...this.snapshot,
      viewport: { ...this.snapshot.viewport, cards: [...cards.values()] },
    };
    this.renderPanel();
  }

  /** Publish the current snapshot to the mounted view. */
  renderPanel(): void {
    this.renderView?.(this.snapshot);
  }

  /** Select a card, keep the browse row, and redraw immediately. */
  selectCard(index: number): void {
    this.browseRow = Math.round((this.viewport?.scrollTop ?? 0) / (this.stride as number));
    this.select(index);
    this.lastFrame = -Infinity;
    this.draw(performance.now());
  }
}
