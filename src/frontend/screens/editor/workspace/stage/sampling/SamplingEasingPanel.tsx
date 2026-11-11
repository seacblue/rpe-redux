/**
 * Floating easing editor for a completed sampler drag.
 *
 * The panel is anchored beside the midpoint of the drawn path and stays inside
 * the preview viewport until its title row is dragged, after which it stays
 * inside the stage. It edits only the sampled easing preset through the shared
 * session draft and offers only two exits: discard the draft or commit it.
 * Other curve fields remain unchanged. Layout measurement keeps the panel clear
 * of the path midpoint and lets its body scroll when the viewport is short
 * instead of compressing the controls.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { EasingField } from "../../../../../../design/components/easing/EasingField.tsx";
import { useTranslation } from "../../../../../../i18n/react.ts";
import {
  setSamplingCurve,
  type FinishSamplingResult,
  type SamplingCurveDraft,
  type SamplingSessionState,
} from "../../../sampling/samplingSession.ts";
import type { SamplingViewport } from "./samplingGuides.ts";

/** Space between the panel edge and the preview viewport edge, in stage pixels. */
const PANEL_MARGIN = 16;
/** Space between the path midpoint and the nearest panel edge. */
const PANEL_GAP = 18;
/** Preferred panel width in stage pixels. */
const PANEL_WIDTH = 360;
/** Cap on the body height before it starts scrolling. */
const PANEL_MAX_VIEWPORT_RATIO = 0.7;

interface SamplingEasingPanelProps {
  session: SamplingSessionState;
  viewport: SamplingViewport;
  /** Stage position of the sampled path midpoint. */
  anchor: { x: number; y: number };
  /** Commits the shared draft and reports the core result. */
  onCommit: () => FinishSamplingResult;
  /** Clears both anchors and returns the workspace to idle. */
  onDiscard: () => void;
}

/** The panel's horizontal and vertical placement inside the viewport. */
function panelPosition(
  anchor: { x: number; y: number },
  viewport: SamplingViewport,
  size: { width: number; height: number },
): { left: number; top: number } {
  const x = Math.min(
    viewport.right - PANEL_MARGIN,
    Math.max(viewport.left + PANEL_MARGIN, anchor.x),
  );
  const y = Math.min(
    viewport.bottom - PANEL_MARGIN,
    Math.max(viewport.top + PANEL_MARGIN, anchor.y),
  );
  const leftRoom = x - viewport.left;
  const rightRoom = viewport.right - x;
  let left = rightRoom >= leftRoom ? x + PANEL_GAP : x - PANEL_GAP - size.width;
  if (left + size.width > viewport.right - PANEL_MARGIN) {
    left = x - PANEL_GAP - size.width;
  }
  if (left < viewport.left + PANEL_MARGIN) {
    left = viewport.left + PANEL_MARGIN;
  }
  if (left + size.width > viewport.right - PANEL_MARGIN) {
    left = Math.max(viewport.left + PANEL_MARGIN, viewport.right - PANEL_MARGIN - size.width);
  }
  let top = y - size.height / 2;
  const minimumTop = viewport.top + PANEL_MARGIN;
  const maximumTop = viewport.bottom - PANEL_MARGIN - size.height;
  top = Math.min(Math.max(minimumTop, top), Math.max(minimumTop, maximumTop));
  return { left, top };
}

/** Floating curve editor shown after both anchors of a drag are locked. */
export function SamplingEasingPanel({
  session,
  viewport,
  anchor,
  onCommit,
  onDiscard,
}: SamplingEasingPanelProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: PANEL_WIDTH, height: 360 });
  const [manualPosition, setManualPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = session.draft;
  const easingType = draft.curve.easingType ?? session.easingType;
  const canCommit = Boolean(draft.start && draft.end) && !session.dragging;
  const maxWidth = Math.max(240, viewport.width - PANEL_MARGIN * 2);
  const width = Math.min(PANEL_WIDTH, maxWidth);
  const maxHeight = Math.max(
    160,
    Math.min(
      viewport.height - PANEL_MARGIN * 2,
      typeof window === "undefined" ? 480 : window.innerHeight * PANEL_MAX_VIEWPORT_RATIO,
    ),
  );
  const measured = { width: size.width || width, height: size.height || Math.min(360, maxHeight) };
  const position = manualPosition ?? panelPosition(anchor, viewport, measured);
  const style: CSSProperties = {
    left: position.left,
    top: position.top,
    width,
    maxHeight,
  };

  // Measure the rendered panel and every later content change (curve mode,
  // range rows) so the placement rule never guesses the final height.
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

  /** Drag the card by its title row, bounded by the stage overlay. */
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const element = panel.current;
    const parent = element?.parentElement;
    if (!element || !parent) {
      return;
    }
    const card = element.getBoundingClientRect();
    event.preventDefault();
    const pointerId = event.pointerId;
    drag.current = {
      pointerId,
      offsetX: event.clientX - card.left,
      offsetY: event.clientY - card.top,
    };
    const move = (moveEvent: PointerEvent) => {
      const current = drag.current;
      if (!current || moveEvent.pointerId !== current.pointerId) {
        return;
      }
      const currentCard = panel.current;
      const bounds = currentCard?.parentElement?.getBoundingClientRect();
      if (!currentCard || !bounds) {
        return;
      }
      const maxLeft = Math.max(0, bounds.width - currentCard.offsetWidth);
      const maxTop = Math.max(0, bounds.height - currentCard.offsetHeight);
      setManualPosition({
        left: Math.min(Math.max(0, moveEvent.clientX - bounds.left - current.offsetX), maxLeft),
        top: Math.min(Math.max(0, moveEvent.clientY - bounds.top - current.offsetY), maxTop),
      });
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  /** Apply one draft curve change and clear the stale commit error. */
  const changeCurve = (patch: SamplingCurveDraft) => {
    setError(null);
    setSamplingCurve(patch);
  };

  /** Commit the locked draft; a rejected edit stays open with its reason. */
  const commit = () => {
    const result = onCommit();
    if (!result.ok) {
      setError(
        result.error
          ? result.error instanceof Error
            ? result.error.message
            : String(result.error)
          : t("editorPanels.sampling.eventMissing"),
      );
    }
  };

  /** Discard the two anchors and return to the idle sampler. */
  const discard = () => {
    setError(null);
    onDiscard();
  };

  return (
    <div
      ref={panel}
      className="sampling-float"
      style={style}
      role="dialog"
      aria-label={t("editorPanels.sampling.title")}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="sampling-float-header" onPointerDown={beginDrag}>
        <span className="sampling-float-title">{t("editorPanels.sampling.title")}</span>
        <span className="sampling-float-grip" aria-hidden="true">
          ⠿
        </span>
      </div>
      <div className="sampling-float-body">
        <EasingField
          label={t("editorPanels.sampling.easing")}
          value={easingType}
          onChange={(value) => changeCurve({ easingType: value })}
        />
        {error && (
          <p className="sampling-float-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="sampling-float-footer">
        <Button type="button" variant="outlined" onClick={discard}>
          {t("editorPanels.sampling.cancel")}
        </Button>
        <Button type="button" variant="solid" disabled={!canCommit} onClick={commit}>
          {t("editorPanels.sampling.confirm")}
        </Button>
      </div>
    </div>
  );
}
