/**
 * The second-row simplified rendering switch for the editor preview.
 *
 * One toggle only: pressed paints the flat fill with a moving hatch; unpressed
 * paints the full animated NoiseField effect. It also disables preview shaders
 * while pressed. The shared
 * `detailedNoiseRendering` value remains the storage, so preview code and
 * extensions keep the same contract.
 */
import { useSyncExternalStore } from "react";
import { t } from "../../../../i18n/index.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { detailedNoiseRendering } from "../../../../core/edit/state/noiseRendering.ts";

/** Second-row toggle between simplified and full preview rendering. */
export function NoiseRenderingToggle() {
  const detailed = useSyncExternalStore(
    detailedNoiseRendering.subscribe,
    detailedNoiseRendering.get,
    detailedNoiseRendering.get,
  );
  const simple = !detailed;
  return (
    <Button
      id="noise-rendering"
      type="button"
      aria-pressed={simple}
      aria-label={t("chrome.toolbar.noiseRenderingSimple")}
      data-tip-title={t("chrome.toolbar.noiseRenderingSimple")}
      data-tip-desc={t("chrome.toolbar.noiseRenderingHint")}
      onClick={() => detailedNoiseRendering.set(!detailed)}
    >
      <Icon name="noiseOff" size={13} />
    </Button>
  );
}
