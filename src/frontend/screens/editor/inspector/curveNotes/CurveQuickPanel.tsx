/**
 * Floating curve-note quick pick over the timeline.
 *
 * Ctrl+click supplies both anchor notes; once the pair is complete this panel
 * portals into the app root, floats above the inspector, and edits only its own
 * type and easing before the one generation action. The pane owns the draft and
 * the commit, so the panel never touches the chart.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { EasingField } from "../../../../../design/components/easing/EasingField.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FloatingPanel } from "../../../../../design/components/floatingPanel/FloatingPanel.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { beatValue } from "../../../../../core/global/chart/timing/beat.ts";
import { readFloatingHost } from "../../../../overlays/floatingHost.ts";
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import {
  useEditorRuntime,
  useEditorRuntimeValue,
} from "../../workspace/runtime/composition/EditorRuntime.tsx";
import { curveActions } from "./actions.ts";
import {
  quickPanelPosition,
  QUICK_PANEL_MARGIN,
  type QuickPanelSize,
  type QuickViewportRect,
} from "./curveQuickPlacement.ts";
import { EMPTY_CURVE_QUICK, type CurveQuickAnchor, type CurveQuickSnapshot } from "./model.ts";

/** Preferred panel width before the timeline narrows it. */
const PANEL_WIDTH = 400;
/** The panel keeps this share of a short viewport before its body scrolls. */
const PANEL_MAX_VIEWPORT_RATIO = 0.7;

/** The client-space point of one captured note in the live timeline. */
function notePoint(timeline: Timeline, anchor: CurveQuickAnchor): { x: number; y: number } | null {
  const canvas = timeline.notesCanvas;
  if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) {
    return null;
  }
  const bounds = canvas.getBoundingClientRect();
  const lineIndex = anchor.lineIndex ?? timeline.getSession().lineIndex;
  try {
    return {
      x: bounds.left + timeline.viewport.noteHorizontal(anchor.positionX, lineIndex),
      y:
        bounds.top +
        timeline.viewport.noteVerticalForLine(
          beatValue(anchor.startTime),
          lineIndex,
          canvas.clientHeight,
        ),
    };
  } catch {
    return null;
  }
}

/** The midpoint of both anchors, or the only selected anchor. */
function quickAnchorPoint(
  timeline: Timeline,
  quick: CurveQuickSnapshot,
): { x: number; y: number } | null {
  const start = quick.start ? notePoint(timeline, quick.start) : null;
  const end = quick.end ? notePoint(timeline, quick.end) : null;
  if (start && end) {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  return start ?? end;
}

/** The current timeline rectangle, or the window when the notes field is hidden. */
function timelineViewport(timeline: Timeline): QuickViewportRect {
  const bounds = timeline.notesCanvas.getBoundingClientRect();
  if (bounds.width > 0 && bounds.height > 0) {
    return bounds;
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/** Renders one quick pick and keeps it beside the captured notes. */
function CurveQuickPanelView({
  quick,
  timeline,
}: {
  quick: CurveQuickSnapshot;
  timeline: Timeline;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(() => quickAnchorPoint(timeline, quick));
  const [size, setSize] = useState<QuickPanelSize>({ width: PANEL_WIDTH, height: 320 });
  const [manualPosition, setManualPosition] = useState<{ left: number; top: number } | null>(null);

  // Follow timeline scrolling, zoom, and camera changes while the panel is up.
  useEffect(() => {
    let frame = 0;
    let stopped = false;
    const update = () => {
      if (stopped) {
        return;
      }
      frame = requestAnimationFrame(update);
      const next = quickAnchorPoint(timeline, quick);
      setAnchor((previous) => {
        if (!next && !previous) {
          return previous;
        }
        if (
          previous &&
          next &&
          Math.abs(previous.x - next.x) < 0.5 &&
          Math.abs(previous.y - next.y) < 0.5
        ) {
          return previous;
        }
        return next;
      });
    };
    update();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [quick, timeline]);

  // Measure every content change so placement never guesses the final height.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) {
      return;
    }
    const measure = () =>
      setSize((previous) => {
        const next = { width: element.offsetWidth, height: element.offsetHeight };
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const viewport = timelineViewport(timeline);
  const maxWidth = Math.max(200, viewport.width - QUICK_PANEL_MARGIN * 2);
  const width = Math.min(PANEL_WIDTH, maxWidth);
  const maxHeight = Math.max(
    160,
    Math.min(
      viewport.height - QUICK_PANEL_MARGIN * 2,
      window.innerHeight * PANEL_MAX_VIEWPORT_RATIO,
    ),
  );
  const measured = {
    width: size.width || width,
    height: size.height || Math.min(320, maxHeight),
  };
  const anchorPoint = anchor ?? {
    x: viewport.left + viewport.width / 2,
    y: viewport.top + viewport.height / 2,
  };
  const position = manualPosition ?? quickPanelPosition(anchorPoint, viewport, measured);
  const style: CSSProperties = { left: position.left, top: position.top, width, maxHeight };

  return (
    <FloatingPanel
      ref={panel}
      className="curve-quick-float"
      style={style}
      aria-label={t("editorPanels.curve.quickTitle")}
      title={t("editorPanels.curve.quickTitle")}
      position={manualPosition ?? undefined}
      onPositionChange={setManualPosition}
      footer={
        <>
          <Button
            type="button"
            variant="outlined"
            size="sm"
            onClick={() => curveActions.dismissCurveQuick()}
          >
            {t("editorPanels.curve.quickCancel")}
          </Button>
          <Button
            type="button"
            variant="solid"
            size="sm"
            onClick={() => curveActions.generateCurve()}
          >
            {t("editorPanels.curve.quickGenerate")}
          </Button>
        </>
      }
      onPointerDown={(event) => event.stopPropagation()}
    >
      <FieldRow
        layout="inline"
        density="compact"
        label={t("editor.app.curve.type")}
        control={(id) => (
          <Select
            id={id}
            className="curve-quick-type"
            value={String(quick.type)}
            onChange={(event) => curveActions.setCurveQuickType(Number(event.currentTarget.value))}
          >
            <option value="1">{t("editorPanels.inspector.noteType.tap")}</option>
            <option value="2">{t("editorPanels.inspector.noteType.hold")}</option>
            <option value="3">{t("editorPanels.inspector.noteType.flick")}</option>
            <option value="4">{t("editorPanels.inspector.noteType.drag")}</option>
          </Select>
        )}
      />
      <EasingField
        label={t("editor.app.curve.easing")}
        value={quick.easingType}
        onChange={(easingType) => curveActions.setCurveEasing(easingType)}
      />
    </FloatingPanel>
  );
}

/** Mounts the floating quick panel once both Ctrl+click anchors are complete. */
export function CurveQuickPanel() {
  const quick = useEditorRuntimeValue((runtime) => runtime.ui.curve.quick, EMPTY_CURVE_QUICK);
  const runtime = useEditorRuntime();
  if (!quick.visible || !runtime) {
    return null;
  }
  const host = readFloatingHost() ?? document.body;
  return createPortal(<CurveQuickPanelView quick={quick} timeline={runtime.timeline} />, host);
}
