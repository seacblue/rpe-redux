/**
 * The blurred image behind the welcome window or the editor.
 *
 * Both surfaces read their own enable, blur, and brightness settings and paint
 * one layer behind their content. The layer is mounted on the app frame so it
 * can continue behind the title bar and content surfaces. It is absent when
 * the setting is off or no image URL is available, so the window keeps its
 * normal surface.
 */
import { useEffect, useState, type CSSProperties } from "react";
import {
  COVER_BACKGROUND_DEFAULTS,
  COVER_BACKGROUND_KEYS,
} from "../../core/settings/features/coverBackground.ts";
import { useSetting } from "../screens/settings/useSetting.ts";

/** Which surface owns the settings and the image. */
export type CoverBackdropScope = "welcome" | "editor";

/** Paint one blurred cover layer for the requested surface. */
export function CoverBackdrop({ scope, url }: { scope: CoverBackdropScope; url: string }) {
  const welcome = scope === "welcome";
  const enabled = useSetting(
    welcome ? COVER_BACKGROUND_KEYS.welcomeEnabled : COVER_BACKGROUND_KEYS.editorWindowEnabled,
    welcome
      ? COVER_BACKGROUND_DEFAULTS.welcomeEnabled
      : COVER_BACKGROUND_DEFAULTS.editorWindowEnabled,
  );
  const blur = Number(
    useSetting(
      welcome ? COVER_BACKGROUND_KEYS.welcomeBlur : COVER_BACKGROUND_KEYS.editorWindowBlur,
      welcome ? COVER_BACKGROUND_DEFAULTS.welcomeBlur : COVER_BACKGROUND_DEFAULTS.editorWindowBlur,
    ),
  );
  const brightness = Number(
    useSetting(
      welcome
        ? COVER_BACKGROUND_KEYS.welcomeBrightness
        : COVER_BACKGROUND_KEYS.editorWindowBrightness,
      welcome
        ? COVER_BACKGROUND_DEFAULTS.welcomeBrightness
        : COVER_BACKGROUND_DEFAULTS.editorWindowBrightness,
    ),
  );
  const target = enabled ? url : "";
  const [images, setImages] = useState({ current: target, previous: "" });
  if (images.current !== target) {
    // Turning the setting off clears the image at once; the previous frame only
    // exists to cross-fade between two live images.
    setImages({ current: target, previous: target ? images.current : "" });
  }
  const fallbackBlur = welcome
    ? COVER_BACKGROUND_DEFAULTS.welcomeBlur
    : COVER_BACKGROUND_DEFAULTS.editorWindowBlur;
  const fallbackBrightness = welcome
    ? COVER_BACKGROUND_DEFAULTS.welcomeBrightness
    : COVER_BACKGROUND_DEFAULTS.editorWindowBrightness;
  const blurValue = Number.isFinite(blur) ? blur : fallbackBlur;
  const brightnessValue = Number.isFinite(brightness) ? brightness : fallbackBrightness;
  const currentImage = images.current;
  // Surfaces outside this layer (the expanded Inspector) reuse the same image
  // and filter through root variables, so their glass matches the compact
  // panels exactly instead of sampling whatever happens to be behind them.
  useEffect(() => {
    const root = document.documentElement;
    if (currentImage) {
      root.style.setProperty(
        "--cover-backdrop-image",
        `url("${currentImage.replaceAll('"', '\\"')}")`,
      );
    } else {
      root.style.removeProperty("--cover-backdrop-image");
    }
    root.style.setProperty("--cover-backdrop-blur", `${blurValue}px`);
    root.style.setProperty("--cover-backdrop-brightness", String(brightnessValue));
    return () => {
      root.style.removeProperty("--cover-backdrop-image");
      root.style.removeProperty("--cover-backdrop-blur");
      root.style.removeProperty("--cover-backdrop-brightness");
    };
  }, [brightnessValue, blurValue, currentImage]);
  if (!images.current && !images.previous) {
    return null;
  }
  const style = {
    "--cover-backdrop-blur": `${blurValue}px`,
    "--cover-backdrop-brightness": String(brightnessValue),
  } as CSSProperties;
  return (
    <div className={`cover-backdrop cover-backdrop-${scope}`} style={style} aria-hidden="true">
      {images.previous && (
        <div
          key={`previous:${images.previous}`}
          className="cover-backdrop-image is-leaving"
          style={{ backgroundImage: `url("${images.previous.replaceAll('"', '\\"')}")` }}
          onAnimationEnd={() => setImages((current) => ({ ...current, previous: "" }))}
        />
      )}
      {images.current && (
        <div
          key={`current:${images.current}`}
          className="cover-backdrop-image is-entering"
          style={{ backgroundImage: `url("${images.current.replaceAll('"', '\\"')}")` }}
        />
      )}
    </div>
  );
}
