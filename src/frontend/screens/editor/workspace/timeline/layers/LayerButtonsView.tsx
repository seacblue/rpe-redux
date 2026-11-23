/**
 * Presentational button strip for the timeline layer selector, marking the active
 * layer and forwarding clicks by index.
 *
 * It reads no session or gesture state; the prepared snapshot supplies everything.
 * Optional event layers and the extended layer follow their capability switches
 * live. The chart remains lossless, but disabled layers have no editor entry
 * point until their capability is enabled again.
 */
import { useEffect } from "react";
import { useEditingFeature } from "../../../../settings/editingCapabilities.ts";
import { t } from "../../../../../../i18n/index.ts";
import { Segmented } from "../../../../../../design/components/segmented/Segmented.tsx";
import { useProximityReveal } from "../interaction/useProximityReveal.ts";
import { visibleLayerButtonItems } from "./layerButtonVisibility.ts";
export { visibleLayerButtonItems } from "./layerButtonVisibility.ts";

export interface LayerButtonItem {
  index: number;
  label: string;
  active: boolean;
  /** Marks the synthetic extended layer rather than one of the base layers. */
  extended?: boolean;
  /** Base layers above 0 are optional; layer 0 is the minimal editor surface. */
  optional?: boolean;
}

export interface LayerButtonsViewProps {
  items: LayerButtonItem[];
  onSelect(index: number): void;
}

/** Render the visible layer buttons and forward the chosen index. */
export function LayerButtonsView({ items, onSelect }: LayerButtonsViewProps) {
  const { ref: stripRef, revealed } = useProximityReveal<HTMLDivElement>();
  const extendedEnabled = useEditingFeature("extendedEvents");
  const eventLayersEnabled = useEditingFeature("eventLayers");
  const visibleItems = visibleLayerButtonItems(items, {
    eventLayers: eventLayersEnabled,
    extendedEvents: extendedEnabled,
  });
  const activeItem = items.find((item) => item.active);
  const activeLayerHidden =
    activeItem !== undefined && !visibleItems.some((item) => item.index === activeItem.index);

  // A setting can change while an optional layer is active. Move the session
  // back to layer 0 so the hidden layer is not still being edited underneath
  // the filtered button strip.
  useEffect(() => {
    if (activeLayerHidden) {
      onSelect(0);
    }
  }, [activeLayerHidden, onSelect]);
  // With event layers off, a line that has no optional layer only shows the
  // base cell. That lone cell has no choice to make, so the whole strip is
  // noise; keep it only when there is a second layer to switch between.
  if (!eventLayersEnabled && !visibleItems.some((item) => item.extended || item.index > 0)) {
    return null;
  }
  return (
    <Segmented<string>
      className={`layer-buttons proximity-reveal${revealed ? " is-revealed" : ""}`}
      containerRef={stripRef}
      ariaLabel={t("editorPanels.timeline.layers")}
      value={String(visibleItems.find((item) => item.active)?.index ?? visibleItems[0]?.index ?? 0)}
      options={visibleItems.map((item) => ({
        value: String(item.index),
        label: item.label,
      }))}
      onChange={(value: string) => onSelect(Number(value))}
    />
  );
}
