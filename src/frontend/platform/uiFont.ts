/**
 * The lazy CJK interface face and its on-demand slices.
 *
 * The startup splash and the first application frame paint with the system CJK
 * stack. The editor shell requests the UI subset after it mounts; when that face
 * is ready the root switches `--font-sans` to it. The same face family declares
 * unicode-range slices for the rest of the font, so a user-entered character
 * requests only the slice that contains it. The system stack remains the
 * fallback while a slice loads or for characters outside the font.
 */
const UI_FONT_FAMILY = "Source Han Sans CN";
const UI_FONT_SAMPLE = "界";
let loading: Promise<void> | null = null;

/** Request the interface face once and reveal its token when it arrives. */
export function loadUiFont(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      if (typeof document === "undefined" || !document.fonts) {
        return;
      }
      try {
        // The UI face's unicode-range contains this sample. The browser loads
        // only that face here; user-authored characters request their own
        // unicode-range slice later, without loading the rest of the font.
        await document.fonts.load(`400 16px "${UI_FONT_FAMILY}"`, UI_FONT_SAMPLE);
        document.documentElement.dataset.uiFont = "ready";
      } catch {
        // The system stack stays active; the face is optional.
      }
    })();
  }
  return loading;
}
