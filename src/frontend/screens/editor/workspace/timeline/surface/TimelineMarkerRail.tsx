/**
 * Bookmark tabs for time markers on the left edge of the editing field.
 *
 * The controller publishes absolute positions and a seek callback; this view
 * only lays out the tabs, reveals the marker name on hover or focus, and
 * forwards a click to the transport.
 */
import type { CSSProperties } from "react";
import { normalizeMarkerColor } from "../../../../../../core/global/chart/timelineMarkers.ts";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../../../i18n/react.ts";
import { useEditorRuntimeValue } from "../../runtime/composition/EditorRuntime.tsx";

/** Renders one bookmark tab per visible marker at the timeline's left edge. */
export function TimelineMarkerRail() {
  const { t } = useTranslation();
  const rail = useEditorRuntimeValue((runtime) => runtime.ui.timelineMarkers.rail, null);
  if (!rail || rail.markers.length === 0) {
    return null;
  }
  return (
    <div
      className="timeline-marker-rail"
      style={{ left: `${rail.left}px`, top: `${rail.top}px`, height: `${rail.height}px` }}
    >
      {rail.markers.map((marker) => {
        const color = normalizeMarkerColor(marker.color);
        const style: CSSProperties & { "--marker-color"?: string } = {
          top: `${marker.top}px`,
        };
        if (color) {
          style["--marker-color"] = color;
        }
        const label = t("chrome.transport.markerManager.markerLabel", {
          name: marker.name,
          beat: Number(marker.beat).toFixed(3),
        });
        return (
          <Button
            key={marker.id ?? `${marker.name}:${marker.beat}`}
            type="button"
            variant="plain"
            className="timeline-marker-bookmark"
            data-marker-beat={String(marker.beat)}
            data-marker-name={marker.name}
            data-tip-title={label}
            aria-label={label}
            style={style}
            onClick={() => rail.onSeek(marker.audioSeconds)}
          >
            <span className="timeline-marker-bookmark-label">{marker.name}</span>
          </Button>
        );
      })}
    </div>
  );
}
