/**
 * Presentational button strip for the timeline layer selector, marking the active
 * layer and forwarding clicks by index.
 *
 * It reads no session or gesture state; the prepared snapshot supplies everything.
 * Optional event layers and the extended layer follow their capability switches
 * live, while a layer that is active or already contains data stays reachable.
 */
import { useEditingFeature } from "../../../../settings/editingCapabilities.ts";
import { t } from "../../../../../../i18n/index.ts";
import { Segmented } from "../../../../../../design/components/segmented/Segmented.tsx";
import { useProximityReveal } from "../interaction/useProximityReveal.ts";

export interface LayerButtonItem {
  index: number;
  label: string;
  active: boolean;
  /** Marks the synthetic extended layer rather than one of the base layers. */
  extended?: boolean;
  /** Base layers above 0 are optional; layer 0 is the minimal editor surface. */
  optional?: boolean;
  /** That layer already carries events and must remain reachable. */
  present?: boolean;
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
  const visibleItems = items.filter((item) =>
    item.extended
      ? extendedEnabled || item.present || item.active
      : !item.optional || eventLayersEnabled || item.present || item.active,
  );
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
