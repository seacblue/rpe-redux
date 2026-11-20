/**
 * The saved arrangement of the workspace chrome.
 *
 * Each surface keeps its own preference key, so customizing the toolbar never
 * rewrites the rail and the other way around. The chrome paints whatever this
 * module currently says; saving is one write per surface.
 */
import { PREFERENCE_SECTIONS, readPreference, writePreference } from "../state/preferences.ts";
import {
  readArrangement,
  type LayoutArrangement,
  type LayoutSurfaceId,
} from "./layoutArrangement.ts";

/** One preference key per surface, inside the shared layout section. */
export const LAYOUT_ARRANGEMENT_KEYS: Readonly<Record<LayoutSurfaceId, string>> = Object.freeze({
  toolbar: "toolbarArrangement",
  sidebar: "sidebarArrangement",
});

/** Both saved arrangements, which is what the chrome paints on a restart. */
export function currentArrangement(): LayoutArrangement {
  const section = readPreference<Record<string, unknown>>(PREFERENCE_SECTIONS.layout, {});
  return readArrangement({
    toolbar: readStored(section, "toolbar"),
    sidebar: readStored(section, "sidebar"),
  });
}

/** One stored surface payload, shaped as the reader expects. */
function readStored(
  section: Record<string, unknown>,
  surface: LayoutSurfaceId,
): Record<string, unknown> | undefined {
  const stored = section[LAYOUT_ARRANGEMENT_KEYS[surface]];
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : undefined;
}

/**
 * Write one surface's arrangement.
 *
 * Only that surface's own key is replaced, so a toolbar save leaves the rail
 * document — including a rail the user never touched — exactly as it was.
 */
export function commitSurfaceArrangement(
  surface: LayoutSurfaceId,
  arrangement: LayoutArrangement,
): void {
  const section = readPreference<Record<string, unknown>>(PREFERENCE_SECTIONS.layout, {});
  writePreference(PREFERENCE_SECTIONS.layout, {
    ...section,
    [LAYOUT_ARRANGEMENT_KEYS[surface]]: arrangement[surface] ?? {},
  });
}

/** Write both surfaces, for the caller that owns the whole document. */
export function commitArrangement(arrangement: LayoutArrangement): void {
  const section = readPreference<Record<string, unknown>>(PREFERENCE_SECTIONS.layout, {});
  writePreference(PREFERENCE_SECTIONS.layout, {
    ...section,
    ...Object.fromEntries(
      (["toolbar", "sidebar"] as const).map((surface) => [
        LAYOUT_ARRANGEMENT_KEYS[surface],
        arrangement[surface] ?? {},
      ]),
    ),
  });
}

/** Forget both arrangements so the chrome returns to its authored layout. */
export function resetArrangement(): void {
  commitArrangement({});
}
