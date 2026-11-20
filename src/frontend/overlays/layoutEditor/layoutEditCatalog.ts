/**
 * The commands a layout surface can offer, and how each one is named.
 *
 * The palette, the drag ghost, and the drop all need the same answer to "what
 * is this id called, which strip does it belong in, and who contributes it", so
 * that answer lives here instead of being re-derived per component.
 */
import type { IconName } from "../../../design/components/icon/Icon.tsx";
import { iconName } from "../../../design/components/icon/Icon.tsx";
import type { MessageKey } from "../../../i18n/index.ts";
import { toolbar, type ToolbarEntry } from "../../../core/shell/registries/toolbar.ts";
import {
  USER_DIVIDER_PREFIX,
  type LayoutSlotId,
  type LayoutSurfaceId,
} from "../../../core/shell/layoutArrangement.ts";
import type { SidebarNavigationEntry } from "../../chrome/sidebar/navigation.ts";

/** One command a surface can place. */
export interface LayoutEntry {
  id: string;
  label: string;
  icon: IconName;
  /** The strip it belongs in when nothing more specific is known. */
  slot: LayoutSlotId;
  /** The package that contributes it, or empty for the host's own commands. */
  owner: string;
}

/**
 * Commands a surface already offers through a richer control.
 *
 * `playback.play` is the same toggle the transport control draws, so listing both
 * would put two buttons that do one thing on the same bar. The control wins because
 * it is the affordance a user recognises, and the action stays available to menus
 * and to the shortcut it carries.
 */
const DUPLICATED_BY_CONTROL: ReadonlySet<string> = new Set(["playback.play"]);

/**
 * Whether a toolbar entry is something the user can place.
 *
 * A rule or a gap that declares a `row` is part of the authored layout, so it is
 * placeable and movable like any button: the bar it separates is what the user is
 * arranging. A rule with no row belongs to a menu, and a gap is a fixed piece of
 * spacing its author sized, which is not something a user positions.
 */
export function toolbarEntryPlaceable(entry: ToolbarEntry): boolean {
  if (entry.kind === "spacer") {
    return false;
  }
  if (DUPLICATED_BY_CONTROL.has(entry.id)) {
    return false;
  }
  if (entry.kind === "divider") {
    return entry.row !== undefined;
  }
  if (entry.kind === "action") {
    return entry.toolbar !== false && entry.visible?.() !== false;
  }
  return true;
}

/** The readable name of one toolbar entry. */
export function toolbarEntryLabel(entry: ToolbarEntry, t: (key: string) => string): string {
  if (entry.kind === "action") {
    return t(entry.label);
  }
  if (entry.kind === "field") {
    if (entry.field === "number") {
      return t(entry.label);
    }
    return entry.tipTitle ? t(entry.tipTitle) : t(controlKey("field"));
  }
  if (entry.kind === "control") {
    return t(controlKey(entry.controlId));
  }
  if (entry.kind === "spacer") {
    return t("layoutEditor.spacer");
  }
  return entry.id;
}

/** The message key naming a host control. */
function controlKey(controlId: string): MessageKey {
  switch (controlId) {
    case "playback":
      return "layoutEditor.control.playback";
    case "audition":
      return "layoutEditor.control.audition";
    case "extensions":
      return "layoutEditor.control.extensions";
    case "noiseRendering":
      return "layoutEditor.control.noiseRendering";
    case "field":
      return "layoutEditor.field.other";
    default:
      return "layoutEditor.control.other";
  }
}

/** The glyph of one toolbar entry. */
function toolbarEntryIcon(entry: ToolbarEntry): IconName {
  if (entry.kind === "action" || entry.kind === "field") {
    return iconName(entry.icon ?? "help");
  }
  if (entry.kind === "control") {
    return iconName(controlIcon(entry.controlId));
  }
  return iconName("layout");
}

/** The glyph of one host control, which has no registered icon of its own. */
function controlIcon(controlId: string): string {
  switch (controlId) {
    case "playback":
      return "playbackPlay";
    case "audition":
      return "headphones";
    case "extensions":
      return "extension";
    case "noiseRendering":
      return "waves";
    default:
      return "sliders";
  }
}

/** The glyph of one placement the layout editor shows, by its own id. */
const PLACEMENT_ICONS: Readonly<Record<string, string>> = Object.freeze({
  // The transport action and the transport control are the same command; both show
  // the play glyph rather than the generic one the registry lists for an action.
  "playback.play": "playbackPlay",
  "playback.rewind": "rewind",
  "playback.jump": "jump",
  "playback.rate": "rate",
  "view.resetCamera": "refresh",
  "view.togglePreviewOnly": "monitor",
  "view.toggleNotes": "layers",
  "view.toggleEvents": "bezier",
  "view.toggleNotesEvents": "layout",
  "view.customizeToolbar": "layout",
  "view.customizeSidebar": "panelRight",
  "stage.notes": "layers",
  "stage.events": "bezier",
  "stage.preview": "monitor",
  "editor.free-camera": "zoom",
});

/** The glyph a placement's own id names, when it has a better one than the entry. */
export function placementIcon(id: string, isDivider: boolean): IconName {
  if (isDivider || id.startsWith(USER_DIVIDER_PREFIX) || toolbar.node(id)?.kind === "divider") {
    return iconName("linesVertical");
  }
  const named = PLACEMENT_ICONS[id];
  if (named) {
    return iconName(named);
  }
  const entry = toolbar.node(id);
  return entry ? toolbarEntryIcon(entry) : iconName("help");
}

/**
 * Every command a surface can offer, in registry order.
 *
 * A registered rule is left out: the list offers one rule of its own, because the
 * rules the product registered belong to the groups it drew, and a user adding a
 * separator wants a plain one rather than a second copy of an authored seam.
 */
export function toolbarCatalog(t: (key: string) => string): LayoutEntry[] {
  return toolbar
    .getSnapshot()
    .filter((entry) => entry.kind !== "divider" && toolbarEntryPlaceable(entry))
    .map((entry) => ({
      id: entry.id,
      label: toolbarEntryLabel(entry, t),
      icon: toolbarEntryIcon(entry),
      slot: (entry.row ?? 1) as LayoutSlotId,
      owner: toolbar.ownerOf(entry.id) ?? "",
    }));
}

/** Every rail route the editor can place, in registry order. */
export function railCatalog(
  entries: readonly SidebarNavigationEntry[],
  t: (key: string) => string,
  ownerOf: (id: string) => string | undefined,
): LayoutEntry[] {
  return entries
    .filter((entry) => entry.kind === "item")
    .map((entry) => ({
      id: entry.id,
      label: entry.kind === "item" ? t(entry.label) : "",
      icon: iconName(entry.kind === "item" ? entry.icon : "help"),
      slot: 1 as LayoutSlotId,
      owner: ownerOf(entry.id) ?? "",
    }));
}

/** The row an authored toolbar entry declares; an entry with none is never drawn. */
export function toolbarAuthoredSlot(id: string): LayoutSlotId {
  return (toolbar.node(id)?.row ?? 1) as LayoutSlotId;
}

/**
 * The name of a placement the chrome is drawing.
 *
 * A rule carries either a generated id or the id of a registered divider, so it is
 * named here rather than falling through to the id; nothing a user sees should be a
 * generated string. Every other placement is named the way its own surface names it.
 */
export function placementLabel(
  id: string,
  isDivider: boolean,
  catalog: readonly LayoutEntry[],
  t: (key: string) => string,
): string {
  if (isDivider || id.startsWith(USER_DIVIDER_PREFIX) || toolbar.node(id)?.kind === "divider") {
    return t("layoutEditor.divider");
  }
  const known = catalog.find((entry) => entry.id === id);
  if (known) {
    return known.label;
  }
  const entry = toolbar.node(id);
  return entry ? toolbarEntryLabel(entry, t) : id;
}

/**
 * The strip a command belongs in when a drop names no position.
 *
 * The rail is one column, so every route belongs there; the toolbar keeps the
 * row its author chose.
 */
export function authoredSlotOf(surface: LayoutSurfaceId, id: string): LayoutSlotId {
  return surface === "toolbar" ? toolbarAuthoredSlot(id) : 1;
}

/** An entry that declares a row is one the authored toolbar draws. */
function drawsAuthoredRow(entry: ToolbarEntry): boolean {
  return entry.row !== undefined;
}

/**
 * Every id the surface draws before the user changes anything.
 *
 * This is deliberately narrower than {@link toolbarCatalog}: the registry holds far
 * more commands than the toolbar shows, and an entry that declares no `row` has
 * never been on it. Those commands stay in the list, one drag away from the bar, but
 * a fresh profile must look exactly like the chrome did before this editor existed
 * rather than carrying every registered action.
 */
export function surfaceIds(
  surface: LayoutSurfaceId,
  railEntries: readonly SidebarNavigationEntry[],
): string[] {
  if (surface === "toolbar") {
    return toolbar
      .getSnapshot()
      .filter((entry) => toolbarEntryPlaceable(entry) && drawsAuthoredRow(entry))
      .map((entry) => entry.id);
  }
  return railEntries.filter((entry) => entry.kind === "item").map((entry) => entry.id);
}
