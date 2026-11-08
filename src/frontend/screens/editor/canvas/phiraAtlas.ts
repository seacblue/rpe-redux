/**
 * Browser-side slicing for Phira's vertical Hold and hit-effect atlases.
 *
 * The canvas renderer keeps its existing semantic texture slots, so Phira
 * resource dimensions are converted once when a skin is adopted.
 */
import { t } from "../../../../i18n/index.ts";

/** Crop Phira's vertical Hold atlas into the three Redux Hold slots. */
export async function splitPhiraHoldAtlas(
  source: HTMLImageElement,
  atlas: readonly [number, number],
): Promise<[HTMLImageElement, HTMLImageElement, HTMLImageElement]> {
  const [tailHeight, headHeight] = atlas;
  const bodyHeight = source.naturalHeight - tailHeight - headHeight;
  if (tailHeight <= 0 || headHeight <= 0 || bodyHeight <= 0) {
    throw new Error(t("editor.skin.invalidHoldAtlas"));
  }
  const crop = async (y: number, height: number): Promise<HTMLImageElement> => {
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(t("editor.skin.invalidHoldAtlas"));
    }
    context.drawImage(source, 0, y, source.naturalWidth, height, 0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    return image;
  };
  const [end, body, head] = await Promise.all([
    crop(0, tailHeight),
    crop(tailHeight, bodyHeight),
    crop(tailHeight + bodyHeight, headHeight),
  ]);
  return [head, body, end];
}

/** Crop Phira's hit-effect sprite sheet into runtime particle frames. */
export async function splitPhiraHitFx(
  source: HTMLImageElement,
  grid: readonly [number, number],
): Promise<HTMLImageElement[]> {
  const [columns, rows] = grid;
  if (
    columns <= 0 ||
    rows <= 0 ||
    source.naturalWidth % columns !== 0 ||
    source.naturalHeight % rows !== 0
  ) {
    throw new Error(t("editor.skin.invalidHitFx"));
  }
  const width = source.naturalWidth / columns;
  const height = source.naturalHeight / rows;
  const crop = async (x: number, y: number): Promise<HTMLImageElement> => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(t("editor.skin.invalidHitFx"));
    }
    context.drawImage(source, x, y, width, height, 0, 0, width, height);
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    return image;
  };
  return Promise.all(
    Array.from({ length: columns * rows }, (_, index) =>
      crop((index % columns) * width, Math.floor(index / columns) * height),
    ),
  );
}
