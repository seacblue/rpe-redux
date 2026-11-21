/**
 * Snapshot and action contracts shared by the line-switcher controller and its
 * React views: context, cards, viewport, presentation, and callbacks.
 *
 * These types carry data only and keep both sides on one description.
 */
import type { Chart } from "../../../../../../core/global/chart/chart.ts";
import type { LineOverviewIndex } from "../../../../../../core/global/chart/line/lineOverview.ts";
import type { TempoSource } from "../../../../../../core/global/chart/timing/events.ts";

export interface LineSwitcherContext {
  chart: Chart;
  tempo: TempoSource;
  seconds: number;
  selected: number;
  start: number;
  end: number;
  visible: boolean;
  layer?: number;
  extended?: boolean;
  /**
   * The multi-line line set while multi-line editing is active, empty otherwise.
   *
   * Stepping stays inside this set so Ctrl+wheel moves the active line across
   * the selected windows instead of leaving the set, and the step order follows
   * ascending line number rather than the order the lines were written in.
   */
  lineSet?: readonly number[];
}

export interface LineThumbnailSnapshot {
  sample: ReturnType<LineOverviewIndex["sample"]> | undefined;
  seconds: number;
  start: number;
  end: number;
}

export interface LineSwitcherCardSnapshot {
  index: number;
  selected: boolean;
  titleNumber: string;
  lineGroup: string;
  name: string;
  info: string;
  thumbnail: LineThumbnailSnapshot;
}

export interface LineSwitcherViewportSnapshot {
  columns: number;
  height: number;
  contentHeight: number;
  gridTop: number;
  empty: boolean;
  cards: readonly LineSwitcherCardSnapshot[];
}

export interface LineSwitcherSnapshot {
  visible: boolean;
  host: { top: number; width: number; thumbnailHeight: number };
  viewport: LineSwitcherViewportSnapshot;
}

export interface LineSwitcherContentActions {
  setViewport(element: HTMLDivElement | null): void;
  scroll(): void;
  browse(row: number): void;
  select(index: number): void;
}

export interface LineSwitcherActions extends LineSwitcherContentActions {
  step(direction: number): void;
  dismiss(): void;
}

export interface LineSwitcherPresentation {
  snapshot: LineSwitcherSnapshot;
  actions: LineSwitcherActions;
}
