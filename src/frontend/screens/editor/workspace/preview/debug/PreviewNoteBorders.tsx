/**
 * Developer note-border overlay for the editor preview.
 *
 * It subscribes to painted preview snapshots, paints note and Hold borders on
 * its own canvas above the preview, and turns one border green while its short
 * parameter panel is open. The canvas never captures pointers; border hits are
 * taken in a capture listener so a click inspects instead of editing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewObject, PreviewSnapshot } from "../../../../../../core/edit/preview/api.ts";
import { getPreviewApi, onPreviewApiChange } from "../../../../../../core/edit/preview/api.ts";
import { t } from "../../../../../../i18n/index.ts";
import { useLanguage } from "../../../../../../i18n/react.ts";
import { useTimelineDomSurface } from "../../timeline/surface/TimelineDomSurface.tsx";
import { previewOwnsPointer } from "../interaction/previewSelection.ts";
import { noteBorderHit, noteBorderPolygons } from "./noteBorderGeometry.ts";

/** One selected note or Hold and the panel position anchored to its click. */
interface SelectedBorder {
  readonly object: PreviewObject;
  readonly x: number;
  readonly y: number;
}

// Debug-only overlay colours are deliberately fixed so the border stays legible
// against every theme and preview background.
const BORDER_COLOR = "#ff4d4f";
const SELECTED_COLOR = "#33ff66";
const BORDER_HALO = "rgba(0, 0, 0, 0.55)";

/** Paint one closed polygon twice: a dark halo, then the debug colour. */
function paintPolygon(
  context: CanvasRenderingContext2D,
  points: readonly { readonly x: number; readonly y: number }[],
  color: string,
  alpha: number,
): void {
  if (points.length < 2) {
    return;
  }
  context.globalAlpha = alpha;
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.strokeStyle = BORDER_HALO;
  context.lineWidth = 3;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
}

/** Paint every border of one note or Hold. */
function paintObject(
  context: CanvasRenderingContext2D,
  object: PreviewObject,
  selected: boolean,
): void {
  const color = selected ? SELECTED_COLOR : BORDER_COLOR;
  for (const polygon of noteBorderPolygons(object)) {
    paintPolygon(context, polygon.points, color, polygon.part === "hold-body" ? 0.8 : 1);
  }
  context.globalAlpha = 1;
}

/** The short parameter rows shown beside the selected border. */
function debugRows(object: PreviewObject): readonly { label: string; value: string }[] {
  const debug = object.debug;
  if (!debug) {
    return [{ label: "ID", value: object.id }];
  }
  const rows: { label: string; value: string }[] = [];
  if (debug.startTime) {
    const time =
      object.kind === "hold" && debug.endTime
        ? `${debug.startTime.join("/")} → ${debug.endTime.join("/")}`
        : debug.startTime.join("/");
    rows.push({ label: t("editorPanels.preview.debug.time"), value: time });
  }
  if (debug.positionX !== undefined) {
    rows.push({ label: "X", value: debug.positionX.toFixed(2) });
  }
  if (debug.type !== undefined) {
    rows.push({ label: t("editorPanels.preview.debug.type"), value: String(debug.type) });
  }
  if (debug.speed !== undefined) {
    rows.push({ label: t("editorPanels.preview.debug.speed"), value: String(debug.speed) });
  }
  if (debug.size !== undefined) {
    rows.push({ label: t("editorPanels.preview.debug.size"), value: String(debug.size) });
  }
  if (debug.yOffset !== undefined) {
    rows.push({ label: t("editorPanels.preview.debug.yOffset"), value: String(debug.yOffset) });
  }
  if (debug.above !== undefined && debug.above !== null) {
    rows.push({ label: t("editorPanels.preview.debug.above"), value: String(debug.above) });
  }
  if (debug.isFake !== undefined) {
    rows.push({
      label: t("editorPanels.preview.debug.fake"),
      value: debug.isFake
        ? t("editorPanels.preview.debug.yes")
        : t("editorPanels.preview.debug.no"),
    });
  }
  rows.push({ label: "ID", value: object.id });
  return rows;
}

/** Draws the developer note borders and their floating parameter panel. */
export function PreviewNoteBorders() {
  // The panel uses the live catalog, so a language switch repaints its labels.
  useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<PreviewSnapshot | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<SelectedBorder | null>(null);
  const {
    refs: { stage },
  } = useTimelineDomSurface();

  const draw = useCallback((snapshot: PreviewSnapshot | null) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    snapshotRef.current = snapshot;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    if (!snapshot) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const ratio = Math.max(1, snapshot.devicePixelRatio || globalThis.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(snapshot.width * ratio));
    const height = Math.max(1, Math.round(snapshot.height * ratio));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, snapshot.width, snapshot.height);
    context.save();
    context.beginPath();
    context.rect(
      snapshot.viewport.left,
      snapshot.viewport.top,
      snapshot.viewport.width,
      snapshot.viewport.height,
    );
    context.clip();
    const objects = snapshot.objects.filter(
      (object) => object.kind === "note" || object.kind === "hold",
    );
    const selectedId = selectedIdRef.current;
    for (const object of objects) {
      if (object.id !== selectedId) {
        paintObject(context, object, false);
      }
    }
    const active = objects.find((object) => object.id === selectedId);
    if (active) {
      paintObject(context, active, true);
    }
    context.restore();
  }, []);

  useEffect(() => {
    let disposeSnapshot: (() => void) | null = null;
    const bind = () => {
      disposeSnapshot?.();
      disposeSnapshot = null;
      const api = getPreviewApi();
      if (!api) {
        draw(null);
        return;
      }
      disposeSnapshot = api.subscribe((snapshot) => draw(snapshot));
      draw(api.snapshot());
    };
    bind();
    const stopApi = onPreviewApiChange(bind);
    return () => {
      stopApi();
      disposeSnapshot?.();
    };
  }, [draw]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const stageElement = stage.current;
      if (!stageElement || !previewOwnsPointer(event.target, stageElement)) {
        return;
      }
      const snapshot = snapshotRef.current;
      const canvas = canvasRef.current;
      if (!snapshot || !canvas) {
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const viewport = snapshot.viewport;
      if (
        point.x < viewport.left ||
        point.x > viewport.left + viewport.width ||
        point.y < viewport.top ||
        point.y > viewport.top + viewport.height
      ) {
        return;
      }
      const hit = noteBorderHit(snapshot.objects, point, 4);
      if (!hit) {
        selectedIdRef.current = null;
        setSelected(null);
        draw(snapshot);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      selectedIdRef.current = hit.id;
      setSelected({
        object: hit,
        x: Math.max(
          viewport.left + 8,
          Math.min(point.x + 14, viewport.left + viewport.width - 288),
        ),
        y: Math.max(viewport.top + 8, Math.min(point.y + 14, viewport.top + viewport.height - 210)),
      });
      draw(snapshot);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [draw, stage]);

  return (
    <>
      <canvas ref={canvasRef} className="preview-note-borders" aria-hidden="true" />
      {selected && (
        <div
          className="preview-note-border-panel"
          role="status"
          style={{ left: selected.x, top: selected.y }}
        >
          <header className="preview-note-border-panel-header">
            <strong>
              {selected.object.kind === "hold"
                ? t("editorPanels.preview.debug.hold")
                : t("editorPanels.preview.debug.note")}
            </strong>
            <span>{`${selected.object.lineIndex}:${selected.object.noteIndex ?? "-"}`}</span>
          </header>
          <dl className="preview-note-border-panel-rows">
            {debugRows(selected.object).map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}
