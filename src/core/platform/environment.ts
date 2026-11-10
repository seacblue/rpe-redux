/**
 * What the machine says about itself.
 *
 * A platform boundary like the rest of `core/platform/`: callers ask a question
 * about the host, so one answer reaches key formatting, shortcut matching and
 * the interface.
 */

interface NavigatorPlatform {
  readonly userAgentData?: { readonly platform?: string };
  readonly platform?: string;
}

/** True on the platform whose primary modifier is Command rather than Control. */
export function isApplePlatform(): boolean {
  const nav = globalThis.navigator as NavigatorPlatform | undefined;
  const platform = nav?.userAgentData?.platform ?? nav?.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };
/** True when the page runs inside the Tauri desktop host. */
export const isDesktop = (): boolean => Boolean((globalThis as TauriGlobal).__TAURI_INTERNALS__);

/** The host that owns the page, for capability and chrome decisions. */
export type HostKind = "desktop" | "web";

/** True when the page runs outside the Tauri desktop host. */
export const isWebHost = (): boolean => !isDesktop();

/** The host that owns the page. */
export const hostKind = (): HostKind => (isDesktop() ? "desktop" : "web");
