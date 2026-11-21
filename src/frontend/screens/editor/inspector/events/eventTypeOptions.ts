/**
 * The event types the inspector offers for one selected event.
 *
 * The list is the union of the tracks the line's visible layers expose: the
 * five ordinary tracks from every visible base layer, plus scale X/Y from the
 * extended layer. A noise line carries scale X/Y as size tracks on its base
 * layers, so those targets stay available even with the extended layer off.
 */
import { t } from "../../../../../i18n/index.ts";
import type { JudgeLine } from "../../../../../core/global/chart/chart.ts";
import { MAX_BASE_EVENT_LAYERS } from "../../../../../core/global/chart/chartVocabulary.ts";
import { judgeLineTraits } from "../../../../../core/global/chart/line/lineTraits.ts";
import {
  lineHasEventLayer,
  lineHasExtendedEvents,
} from "../../../../../core/global/chart/optionalFeatures.ts";
import {
  CONVERTIBLE_EVENT_TYPES,
  isConvertibleEventType,
  type ConvertibleEventType,
} from "../../../../../core/edit/events/eventTypeConversion.ts";
import { eventTypesForLine } from "../../workspace/timeline/drawing/tracks.ts";

/** Whether the optional layer cells are visible; mirrors the layer strip. */
export interface EventTypeLayerVisibility {
  readonly eventLayers: boolean;
  readonly extendedEvents: boolean;
}

/** One selectable event type and the label the timeline gives it. */
export interface EventTypeOption {
  readonly type: ConvertibleEventType;
  readonly label: string;
}

/**
 * Layer indexes the strip shows for this line.
 *
 * Layer 0 is the minimal editor surface and always exists. A higher base layer
 * or the extended layer stays reachable when its capability is on, when it is
 * active, or when it already carries data.
 */
function visibleLayerIndexes(
  line: JudgeLine | undefined,
  eventLayer: number,
  visibility: EventTypeLayerVisibility,
): number[] {
  const indexes: number[] = [];
  for (let index = 0; index <= MAX_BASE_EVENT_LAYERS; index++) {
    const extended = index === MAX_BASE_EVENT_LAYERS;
    const visible = extended
      ? visibility.extendedEvents || lineHasExtendedEvents(line) || eventLayer === index
      : index === 0 ||
        visibility.eventLayers ||
        lineHasEventLayer(line, index) ||
        eventLayer === index;
    if (visible) {
      indexes.push(index);
    }
  }
  return indexes;
}

/** Numeric tracks the line can author through its visible layers. */
export function convertibleEventTypes(
  line: JudgeLine | undefined,
  eventLayer: number,
  visibility: EventTypeLayerVisibility,
): ConvertibleEventType[] {
  const found = new Set<string>();
  for (const index of visibleLayerIndexes(line, eventLayer, visibility)) {
    for (const type of eventTypesForLine(line, index === MAX_BASE_EVENT_LAYERS)) {
      if (isConvertibleEventType(type)) {
        found.add(type);
      }
    }
  }
  const traits = judgeLineTraits(line);
  if (!traits.allowsAlphaEvents) {
    found.delete("alphaEvents");
  }
  if (!traits.allowsSpeedEvents) {
    found.delete("speedEvents");
  }
  return CONVERTIBLE_EVENT_TYPES.filter((type) => found.has(type));
}

/** Label one track the way the timeline names it on this line. */
function eventTypeLabel(type: ConvertibleEventType, noise: boolean): string {
  switch (type) {
    case "moveXEvents":
      return "X";
    case "moveYEvents":
      return "Y";
    case "rotateEvents":
      return t("editorPanels.timeline.track.rotation");
    case "alphaEvents":
      return t("editorPanels.timeline.track.opacity");
    case "speedEvents":
      return t("editorPanels.timeline.track.speed");
    case "scaleXEvents":
      return t(
        noise
          ? "editor.display.editorDisplay.trackSizeX"
          : "editor.display.editorDisplay.trackScaleX",
      );
    case "scaleYEvents":
      return t(
        noise
          ? "editor.display.editorDisplay.trackSizeY"
          : "editor.display.editorDisplay.trackScaleY",
      );
  }
}

/**
 * Select options for the event type row.
 *
 * The current type stays present when its layer is hidden, so the select always
 * reports the authored track; a type that is not numeric is dropped by the
 * caller before rendering the row.
 */
export function eventTypeOptions(
  line: JudgeLine | undefined,
  eventLayer: number,
  visibility: EventTypeLayerVisibility,
  currentType: string,
): EventTypeOption[] {
  const types = convertibleEventTypes(line, eventLayer, visibility);
  if (isConvertibleEventType(currentType) && !types.includes(currentType)) {
    types.push(currentType);
    types.sort(
      (left, right) =>
        CONVERTIBLE_EVENT_TYPES.indexOf(left) - CONVERTIBLE_EVENT_TYPES.indexOf(right),
    );
  }
  const noise = judgeLineTraits(line).isNoise;
  return types.map((type) => ({ type, label: eventTypeLabel(type, noise) }));
}
