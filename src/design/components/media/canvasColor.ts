/**
 * Resolves one CSS colour into the opaque RGB triple a canvas ImageData writes.
 *
 * Canvas pixels need channels, not a CSS string. A one-pixel probe reuse keeps
 * the conversion independent of the colour syntax the active theme uses.
 */

/** An opaque RGB triple in the 0-255 form canvas tints consume. */
export type CanvasRgb = [number, number, number];

let probe: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS colour the browser understands; `fallback` covers a missing DOM. */
export function resolveCanvasColor(value: string, fallback: CanvasRgb): CanvasRgb {
  if (probe === undefined) {
    if (typeof document === "undefined") {
      probe = null;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext("2d", { willReadFrequently: true });
    }
  }
  if (!probe || !value) {
    return fallback;
  }
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  return [pixel[0] ?? fallback[0], pixel[1] ?? fallback[1], pixel[2] ?? fallback[2]];
}
