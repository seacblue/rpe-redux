/** Browser presentation and rendering adapters; edit calculations live in core. */
import type {
  TimelinePoint,
  TimelineEventRect,
  TimelineEventDrag,
} from "../../../../../../core/edit/timeline/types.ts";
import type { Beat } from "../../../../../../core/global/chart/timing/beat.ts";

import { SPECIAL_TRACKS, specialTrackLabel } from "./tracks.ts";

import { t } from "../../../../../../i18n/index.ts";
import type { CanvasPalette } from "../../../canvas/palette.ts";

export type { CanvasPalette } from "../../../canvas/palette.ts";

export type TimelinePalette = CanvasPalette;

export interface EventInteractionHandle {
  drag: TimelineEventDrag | null;
  pending: { type: string; beat: Beat; lineIndex?: number; inst?: boolean } | null;
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  up(event: PointerEvent): void;
  hit(point: TimelinePoint): TimelineEventRect | undefined;
  place(
    type?: string | null,
    beat?: number | Beat,
    easingType?: number | null,
    inst?: boolean,
  ): boolean;
  delta(): number;
  draw(context: CanvasRenderingContext2D, width: number): void;
}

/** Base event-track labels for an ordinary line. */
export const trackLabels = (): string[] => [
  "X",
  "Y",
  t("editorPanels.timeline.track.rotation"),
  t("editorPanels.timeline.track.opacity"),
  t("editorPanels.timeline.track.speed"),
];

/** Noise-line base layer presents sizes and activation ranges. */
export const noiseTrackLabels = (): string[] => [
  "X",
  "Y",
  t("editorPanels.timeline.track.rotation"),
  t("editor.display.editorDisplay.trackSizeX"),
  t("editor.display.editorDisplay.trackSizeY"),
  t("editorPanels.linePanel.noiseActive"),
];

/**
 * The special-track headers, translated at call time.
 *
 * The labels are message keys, so resolving them per call keeps the headers in
 * the active language after a locale change.
 */
export const extendedLabels = (): string[] => SPECIAL_TRACKS.map(specialTrackLabel);
