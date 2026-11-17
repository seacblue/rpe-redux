/**
 * Renders the floating timeline hover preview with its own `Preview` instance and
 * positions it against the hovered overview strip.
 *
 * Hover timing and scene data come from `timelineThumbnail`; this component owns the
 * preview canvases and placement.
 */
import { useEffect, useRef } from "react";
import { clamp } from "../../../../../../core/utils/numbers.ts";
import { Preview } from "../../preview/scene/preview.ts";
import { createPreviewDisplay } from "../../preview/surface/previewDisplay.ts";
import { useEditorRuntimeValue } from "../../runtime/composition/EditorRuntime.tsx";
import { readEditorDisplaySettings } from "../../../../settings/editorDisplaySettings.ts";
import type { TimelineThumbnailAnchor } from "./timelineThumbnail.ts";

/** The preview's own size; it is set inline so the placement math matches the box. */
const PREVIEW_WIDTH = 192;
const PREVIEW_HEIGHT = 112;

/** Gap between the hovered strip's inner edge and the preview. */
const EDGE_GAP = 10;

/** Never let the preview touch the window edge. */
const VIEWPORT_MARGIN = 8;

/**
 * Where the preview sits: centred on the pointer's height, against the inner
 * edge of the strip being hovered, so it opens towards the middle of the
 * workspace instead of under the cursor.
 */
function previewPosition(anchor: TimelineThumbnailAnchor | null): {
  left: number;
  top: number;
} {
  if (!anchor) {
    return { left: 0, top: 0 };
  }
  const { y, edge, side } = anchor;
  const left = side === "left" ? edge + EDGE_GAP : edge - EDGE_GAP - PREVIEW_WIDTH;
  return {
    left: clamp(left, VIEWPORT_MARGIN, window.innerWidth - PREVIEW_WIDTH - VIEWPORT_MARGIN),
    top: clamp(
      y - PREVIEW_HEIGHT / 2,
      VIEWPORT_MARGIN,
      window.innerHeight - PREVIEW_HEIGHT - VIEWPORT_MARGIN,
    ),
  };
}

/** Render the floating hover preview and place it against the hovered strip. */
export function TimelineThumbnailView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const noteBatchCanvas = useRef<HTMLCanvasElement>(null);
  const shaderCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Preview | null>(null);
  const snapshot = useEditorRuntimeValue((runtime) => runtime.ui.timelineThumbnail.snapshot, null);
  const anchor = useEditorRuntimeValue((runtime) => runtime.ui.timelineThumbnail.anchor, null);

  useEffect(() => {
    const element = canvas.current;
    const noteBatch = noteBatchCanvas.current;
    const shader = shaderCanvas.current;
    const overlay = overlayCanvas.current;
    if (!element || !noteBatch || !shader || !overlay) {
      return;
    }
    const preview = new Preview(element, {
      noteBatch,
      shader,
      overlay,
      display: createPreviewDisplay(
        {
          primary: () => element,
          noteBatch: () => noteBatch,
          shader: () => shader,
          overlay: () => overlay,
        },
        "dedicated",
      ),
    });
    preview.visible = true;
    preview.applyShaders = false;
    preview.showHitEffects = false;
    preview.noteSize = 110;
    preview.lineScale = 1.1;
    preview.backgroundAlpha = 0.45;
    preview.backgroundBrightness = 1;
    preview.lineNumbers = false;
    preview.lineArrows = false;
    renderer.current = preview;
    return () => {
      renderer.current = null;
      preview.dispose();
    };
  }, []);

  useEffect(() => {
    if (!snapshot || !canvas.current || !renderer.current) {
      return;
    }
    const preview = renderer.current;
    preview.images = snapshot.resources.images;
    preview.skin = snapshot.resources.skin;
    preview.backgroundEnabled = readEditorDisplaySettings().preview.backgroundEnabled;
    const colors = snapshot.resources.colors();
    preview.setDefaultColors(colors);
    const { chart, tempo, seconds, lineIndex, documentRevision } = snapshot.scene;
    preview.draw(chart, tempo, seconds, lineIndex, undefined, { documentRevision });
  }, [snapshot]);

  const position = previewPosition(anchor);
  return (
    <div
      className="timeline-thumbnail"
      hidden={!snapshot}
      style={{
        left: position.left,
        top: position.top,
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
      }}
      data-time={snapshot?.scene.seconds}
      data-side={anchor?.side}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <canvas ref={noteBatchCanvas} className="preview-note-batch" aria-hidden="true" />
      <canvas ref={shaderCanvas} className="preview-shader-layer" aria-hidden="true" />
      <canvas ref={overlayCanvas} className="preview-overlay-layer" aria-hidden="true" />
      <span>{snapshot ? `${snapshot.scene.seconds.toFixed(2)} s` : ""}</span>
    </div>
  );
}
