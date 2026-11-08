/**
 * The Hold atlas cutter.
 *
 * Phira stores a Hold as one vertical sheet: tail at the top, body in the
 * middle, head at the bottom, with `holdAtlas` naming the two boundary heights.
 * The cutter lets the author drag those boundaries over the source image and
 * confirms the pixel values the package records.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import type { PhiraWorkbenchAsset } from "../../../../core/media/phiraSkinDraft.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { useObjectUrl } from "./workbenchMedia.tsx";

/** One horizontal cut line. */
type CutEdge = "tail" | "head";

/** Clamp an atlas boundary so the body keeps at least one pixel. */
function clampBoundary(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

/** Draw one crop of the source sheet into a preview canvas. */
function drawSlice(
  canvas: HTMLCanvasElement | null,
  image: HTMLImageElement | null,
  y: number,
  height: number,
): void {
  if (!canvas || !image || height <= 0) {
    return;
  }
  const scale = Math.min(1, 240 / image.naturalWidth, 120 / Math.max(1, height));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, y, image.naturalWidth, height, 0, 0, canvas.width, canvas.height);
}

/** The inline cutter shown while a Hold slot is being adjusted. */
export function HoldCutter({
  asset,
  onApply,
  onCancel,
}: {
  asset: PhiraWorkbenchAsset;
  onApply(atlas: [number, number]): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const url = useObjectUrl(asset.bytes, "image/png");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState<readonly [number, number] | null>(null);
  const [tail, setTail] = useState<number | null>(asset.atlas?.[0] ?? null);
  const [head, setHead] = useState<number | null>(asset.atlas?.[1] ?? null);
  const [dragging, setDragging] = useState<CutEdge | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tailPreview = useRef<HTMLCanvasElement>(null);
  const bodyPreview = useRef<HTMLCanvasElement>(null);
  const headPreview = useRef<HTMLCanvasElement>(null);

  const height = size?.[1] ?? 0;
  // A new sheet starts with an even split, but the stored atlas wins when the
  // author has cut this file before.
  const tailValue = tail ?? (height ? Math.max(1, Math.floor(height / 3)) : null);
  const headValue =
    head ??
    (height && tailValue !== null ? Math.max(1, Math.floor((height - tailValue) / 2)) : null);
  const body =
    height && tailValue !== null && headValue !== null ? height - tailValue - headValue : 0;

  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const valid =
    height > 0 &&
    tailValue !== null &&
    headValue !== null &&
    Number.isInteger(tailValue) &&
    Number.isInteger(headValue) &&
    tailValue > 0 &&
    headValue > 0 &&
    body > 0;

  useEffect(() => {
    if (!valid || !size || tailValue === null || headValue === null) {
      return;
    }
    drawSlice(tailPreview.current, image, 0, tailValue);
    drawSlice(bodyPreview.current, image, tailValue, body);
    drawSlice(headPreview.current, image, height - headValue, headValue);
  }, [body, headValue, height, image, size, tailValue, valid]);

  useEffect(() => {
    if (!dragging || !height) {
      return undefined;
    }
    const move = (event: PointerEvent) => {
      const box = stage.current?.getBoundingClientRect();
      if (!box || box.height <= 0) {
        return;
      }
      const ratio = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      const pixel = ratio * height;
      if (dragging === "tail") {
        setTail(clampBoundary(pixel, 1, Math.max(1, height - (headValue ?? 1) - 1)));
      } else {
        setHead(clampBoundary(height - pixel, 1, Math.max(1, height - (tailValue ?? 1) - 1)));
      }
    };
    const stop = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, headValue, height, tailValue]);

  /** Start dragging one boundary; the window listeners own the rest of the gesture. */
  const startDrag = (edge: CutEdge) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    setDragging(edge);
  };

  return (
    <div ref={panel} className="redux-skin-workbench-cutter">
      <div className="redux-skin-workbench-cutter-heading">
        <strong>{t("settings.skin.workbench.cut.title")}</strong>
        <span>{t("settings.skin.workbench.cut.description")}</span>
      </div>
      <div className="redux-skin-workbench-cutter-body">
        <div className="redux-skin-workbench-cutter-stage-wrap">
          {url ? (
            <div className="redux-skin-workbench-cutter-stage" ref={stage}>
              <img
                className="redux-skin-workbench-cutter-image"
                src={url}
                alt={asset.fileName}
                onLoad={(event) => {
                  setImage(event.currentTarget);
                  setSize([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight]);
                }}
              />
              {size && tailValue !== null && headValue !== null && (
                <>
                  <span
                    className="redux-skin-workbench-cutter-line is-tail"
                    style={{ top: `${(tailValue / height) * 100}%` }}
                  >
                    <span
                      className="redux-skin-workbench-cutter-handle"
                      role="presentation"
                      onPointerDown={startDrag("tail")}
                    />
                  </span>
                  <span
                    className="redux-skin-workbench-cutter-line is-head"
                    style={{ top: `${((height - headValue) / height) * 100}%` }}
                  >
                    <span
                      className="redux-skin-workbench-cutter-handle"
                      role="presentation"
                      onPointerDown={startDrag("head")}
                    />
                  </span>
                </>
              )}
            </div>
          ) : null}
          <p className="redux-skin-workbench-cutter-size">
            {size
              ? t("settings.skin.workbench.size", { width: size[0], height: size[1] })
              : t("settings.skin.workbench.loading")}
          </p>
        </div>
        <div className="redux-skin-workbench-cutter-fields">
          <label>
            <span>{t("settings.skin.workbench.cut.tail")}</span>
            <Input
              type="number"
              min={1}
              max={Math.max(1, height - (headValue ?? 1) - 1)}
              value={tailValue ?? ""}
              onChange={(event) =>
                setTail(event.target.value === "" ? 0 : Number(event.target.value))
              }
            />
          </label>
          <label>
            <span>{t("settings.skin.workbench.cut.body")}</span>
            <output>{Math.max(0, body)}</output>
          </label>
          <label>
            <span>{t("settings.skin.workbench.cut.head")}</span>
            <Input
              type="number"
              min={1}
              max={Math.max(1, height - (tailValue ?? 1) - 1)}
              value={headValue ?? ""}
              onChange={(event) =>
                setHead(event.target.value === "" ? 0 : Number(event.target.value))
              }
            />
          </label>
          <div className="redux-skin-workbench-cutter-slices">
            <figure>
              <canvas ref={tailPreview} />
              <figcaption>{t("settings.skin.workbench.cut.tail")}</figcaption>
            </figure>
            <figure>
              <canvas ref={bodyPreview} />
              <figcaption>{t("settings.skin.workbench.cut.body")}</figcaption>
            </figure>
            <figure>
              <canvas ref={headPreview} />
              <figcaption>{t("settings.skin.workbench.cut.head")}</figcaption>
            </figure>
          </div>
          {!valid && (
            <p className="redux-skin-workbench-error">{t("settings.skin.workbench.cut.invalid")}</p>
          )}
        </div>
      </div>
      <div className="redux-skin-workbench-cutter-actions">
        <Button variant="outlined" onClick={onCancel}>
          {t("common.action.cancel")}
        </Button>
        <Button
          variant="solid"
          disabled={!valid || tailValue === null || headValue === null}
          onClick={() => {
            if (tailValue !== null && headValue !== null) {
              onApply([tailValue, headValue]);
            }
          }}
        >
          {t("settings.skin.workbench.cut.apply")}
        </Button>
      </div>
    </div>
  );
}
