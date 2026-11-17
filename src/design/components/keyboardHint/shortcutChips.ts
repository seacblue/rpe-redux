/**
 * Bindings as the key caps that draw them.
 *
 * This is the one place the shortcut model meets the design system: a value
 * becomes `KbdStroke` props here, `MOD` is resolved into whichever modifier
 * this platform calls primary, and mouse keys receive their fixed inline PNG.
 * `core` never learns what a chip looks like.
 */
import type { Shortcut } from "../../../core/shortcuts/types.ts";
import { formatKeyToken, shortcutKeys } from "../../../core/shortcuts/keys.ts";
import { isApplePlatform } from "../../../core/platform/environment.ts";
import type { KbdKeyCap, KbdStroke } from "./Kbd.tsx";
import { mouseKeyIcon } from "./mouseKeyIcons.ts";

/** One binding as key-cap props, including its held-key chord. */
export function shortcutStroke(shortcut: Shortcut): KbdStroke {
  const apple = isApplePlatform();
  const modifiers = shortcut.modifiers ?? [];
  const mod = modifiers.includes("MOD");
  return {
    ctrl: modifiers.includes("CTRL") || (mod && !apple),
    alt: modifiers.includes("ALT"),
    shift: modifiers.includes("SHIFT"),
    meta: modifiers.includes("META") || (mod && apple),
    keys: shortcutKeys(shortcut).map((key): KbdKeyCap => {
      const icon = mouseKeyIcon(key);
      return icon ? { label: formatKeyToken(key), icon } : { label: formatKeyToken(key) };
    }),
  };
}

/** Resolve shortcut bindings into per-platform key-cap props. */
export function shortcutChips(shortcuts: readonly Shortcut[]): KbdStroke[] {
  return shortcuts.map(shortcutStroke);
}
