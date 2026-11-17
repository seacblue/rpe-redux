/**
 * Fixed PNG glyphs for mouse buttons and wheel directions.
 *
 * The files are imported with `?inline`, so Vite embeds them in the bundle as
 * data URLs. A theme cannot replace them: these are key-cap pictures, not the
 * monochrome alpha masks the icon catalog publishes. The geometry is adapted
 * from Kenney Input Prompts 1.1 (CC0); see `mouse/README.md`.
 */
import mouseBack from "./mouse/mouse-back.png?inline";
import mouseForward from "./mouse/mouse-forward.png?inline";
import mouseLeft from "./mouse/mouse-left.png?inline";
import mouseMiddle from "./mouse/mouse-middle.png?inline";
import mouseRight from "./mouse/mouse-right.png?inline";
import wheelDown from "./mouse/wheel-down.png?inline";
import wheelLeft from "./mouse/wheel-left.png?inline";
import wheelRight from "./mouse/wheel-right.png?inline";
import wheelUp from "./mouse/wheel-up.png?inline";

const MOUSE_KEY_ICONS: Readonly<Record<string, string>> = Object.freeze({
  MOUSE0: mouseLeft,
  MOUSE1: mouseMiddle,
  MOUSE2: mouseRight,
  MOUSE3: mouseBack,
  MOUSE4: mouseForward,
  WHEELUP: wheelUp,
  WHEELDOWN: wheelDown,
  WHEELLEFT: wheelLeft,
  WHEELRIGHT: wheelRight,
});

/** The inline PNG for one mouse or wheel token, or `undefined` for other keys. */
export function mouseKeyIcon(key: string): string | undefined {
  return MOUSE_KEY_ICONS[key.trim().toUpperCase()];
}
