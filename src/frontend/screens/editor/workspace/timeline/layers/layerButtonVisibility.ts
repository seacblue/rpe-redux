/**
 * Computes which timeline layer buttons remain available under the editor's
 * optional event-layer display switches.
 */

/** The structural fields needed to classify one timeline layer button. */
export interface LayerButtonVisibilityItem {
  index: number;
  optional?: boolean;
  extended?: boolean;
}

/** Return only the layer buttons allowed by the display capabilities. */
export function visibleLayerButtonItems<T extends LayerButtonVisibilityItem>(
  items: readonly T[],
  visibility: { eventLayers: boolean; extendedEvents: boolean },
): T[] {
  return items.filter((item) =>
    item.extended ? visibility.extendedEvents : !item.optional || visibility.eventLayers,
  );
}
