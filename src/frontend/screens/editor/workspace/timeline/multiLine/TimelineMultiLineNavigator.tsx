/**
 * Renders the compact horizontal navigator below the active multi-line field.
 * It only owns chrome and delegates viewport changes to the timeline binding.
 */
import { useSyncExternalStore } from "react";
import { IconButton } from "../../../../../../design/components/button/IconButton.tsx";
import { t } from "../../../../../../i18n/index.ts";
import { useEditorRuntime } from "../../runtime/composition/EditorRuntime.tsx";
import {
  moveMultiLineScrollByPanel,
  endMultiLineScroll,
  resetMultiLineScroll,
  type MultiLineScrollSnapshot,
  type MultiLineScrollState,
} from "./multiLineScrollBinding.ts";

const EMPTY_SNAPSHOT: MultiLineScrollSnapshot = {
  area: "notes",
  visible: false,
  max: "0",
  value: "0",
  step: "0",
  firstPanel: "0",
  lastPanel: "0",
  panelCount: "0",
};

const neverSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;

/** Show a three-button horizontal navigator when the active field overflows. */
export function TimelineMultiLineNavigator() {
  const runtime = useEditorRuntime();
  const state: MultiLineScrollState | null = runtime?.ui.multiLineScroll ?? null;
  const snapshot = useSyncExternalStore(
    state?.snapshot.subscribe ?? neverSubscribe,
    state?.snapshot.get ?? emptySnapshot,
    state?.snapshot.get ?? emptySnapshot,
  );
  const maximum = Number(snapshot.max) || 0;
  const value = Number(snapshot.value) || 0;
  const hasLeftOverflow = value > 0.5;
  const hasRightOverflow = value < maximum - 0.5;
  const hidden = !snapshot.visible || maximum <= 0;
  const rangeLabel = t("editorPanels.timeline.navigator.range", {
    first: Number(snapshot.firstPanel) || 0,
    last: Number(snapshot.lastPanel) || 0,
    count: Number(snapshot.panelCount) || 0,
  });
  const areaLabel =
    snapshot.area === "events"
      ? t("editorPanels.timeline.eventsCanvas")
      : t("editorPanels.timeline.notesCanvas");
  return (
    <div
      className={`timeline-multi-line-navigator timeline-multi-line-navigator-${snapshot.area}`}
      data-area={snapshot.area}
      hidden={hidden}
      role="group"
      aria-label={t("editorPanels.timeline.navigator.group", { area: areaLabel })}
      onKeyDown={(event) => {
        if (!state) {
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveMultiLineScrollByPanel(state, -1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          moveMultiLineScrollByPanel(state, 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          resetMultiLineScroll(state);
        } else if (event.key === "End") {
          event.preventDefault();
          endMultiLineScroll(state);
        }
      }}
    >
      <IconButton
        icon="chevronLeft"
        size="small"
        label={t("editorPanels.timeline.navigator.left")}
        disabled={!hasLeftOverflow}
        onClick={() => state && moveMultiLineScrollByPanel(state, -1)}
      />
      <IconButton
        icon="home"
        size="small"
        label={t("editorPanels.timeline.navigator.reset")}
        disabled={!hasLeftOverflow}
        onClick={() => state && resetMultiLineScroll(state)}
      />
      <span className="timeline-multi-line-navigator-range" aria-live="polite">
        {rangeLabel}
      </span>
      <IconButton
        icon="chevronRight"
        size="small"
        label={t("editorPanels.timeline.navigator.right")}
        disabled={!hasRightOverflow}
        onClick={() => state && moveMultiLineScrollByPanel(state, 1)}
      />
    </div>
  );
}
