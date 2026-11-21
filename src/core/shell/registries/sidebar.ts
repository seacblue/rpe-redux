/**
 * The sidebar's registry.
 *
 * The registry owns icon data, activation, and standalone separators, not React
 * components. The frontend shell renders the entries, so a contribution cannot
 * replace the rail's markup or smuggle an arbitrary surface into it.
 *
 * Extensions reach the same registry through their host-owned UI capability;
 * `core/api/sidebar.ts` remains the callback-free public facade.
 */
import type { ValueCell } from "../../state/values.ts";
import { Contributions } from "../../state/contributions.ts";

/** The icon-only visual descriptor rendered by the shell. */
export interface SidebarIconDescriptor {
  /** A design-system icon name; the frontend resolves unknown names to `help`. */
  name: string;
  /** A message key or already resolved label for the icon button. */
  label: string;
  /** Set false when the visible label is enough and no collapsed hover tip is wanted. */
  tooltip?: boolean;
  /** Optional DOM id for browser automation and accessibility tooling. */
  domId?: string;
  /** A reactive visibility gate owned by the contributing feature. */
  visibility?: Pick<ValueCell<boolean>, "get" | "subscribe">;
  /** A reactive active-state cell for modes that are not inspector panes. */
  active?: Pick<ValueCell<boolean>, "get" | "subscribe">;
  /** A small accent dot for live but non-selected state, such as a room. */
  indicator?: Pick<ValueCell<boolean>, "get" | "subscribe">;
  /** A count badge for actionable problems on this route. */
  badge?: Pick<ValueCell<number>, "get" | "subscribe">;
  /**
   * Whether the badge describes a broken state or a caution.
   *
   * A rail that only ever paints red forces every contribution to look like an
   * error; a hint such as an on-screen density warning belongs in the caution
   * colour instead. Missing means `"error"`.
   */
  badgeTone?: Pick<ValueCell<"error" | "warning">, "get" | "subscribe">;
}

/** One independently owned icon route inserted into the shell's sidebar. */
export interface SidebarItem {
  id: string;
  order: number;
  /** When present, the shell marks this icon active for the matching inspector. */
  panelId?: string;
  icon: SidebarIconDescriptor;
  /** The host decides what activation means; the rail only invokes it. */
  onActivate: () => void;
}

/** A standalone separator positioned among sidebar items. */
export interface SidebarDivider {
  readonly kind: "divider";
  readonly id: string;
  readonly order: number;
  /** Optional visibility shared with the entry or group this separates. */
  readonly visibility?: Pick<ValueCell<boolean>, "get" | "subscribe">;
}

/** A sidebar button or a standalone separator. */
export type SidebarEntry = SidebarItem | SidebarDivider;

const entries = new Contributions<SidebarEntry>();
let lastEntries: readonly SidebarEntry[] | undefined;
let itemSnapshot: readonly SidebarItem[] = Object.freeze([]);

/**
 * Register an item and receive a disposer for its owner or HMR lifecycle.
 *
 * `owner` tags the registration for owner-scoped cleanup; callers without an
 * owner keep the existing unowned behaviour.
 */
export function registerSidebarItem(item: SidebarItem, owner?: string): () => void {
  return entries.register(item, owner);
}

/** Register a related set of items with one cleanup function, tagged by `owner`. */
export function registerSidebarItems(items: readonly SidebarItem[], owner?: string): () => void {
  return entries.registerAll(items, owner);
}

/** Register an independent visual separator in the sidebar, tagged by `owner`. */
export function registerSidebarDivider(divider: SidebarDivider, owner?: string): () => void {
  return entries.register(divider, owner);
}

/** Remove every sidebar entry registered under one owner: the plugin-unload path. */
export function unregisterSidebarOwner(owner: string): void {
  entries.unregisterOwner(owner);
}

/** Remove one sidebar entry by id. */
export function unregisterSidebarEntry(id: string): boolean {
  return entries.unregister(id);
}

/** Read one sidebar entry, including separators. */
export function getSidebarEntry(id: string): SidebarEntry | undefined {
  return entries.node(id);
}

/** Read the package that registered one sidebar entry; undefined for host entries. */
export function getSidebarEntryOwner(id: string): string | undefined {
  return entries.ownerOf(id);
}

/** Read sidebar buttons without exposing separators through the item-only API. */
export function getSidebarItems(): readonly SidebarItem[] {
  const snapshot = entries.getSnapshot();
  if (snapshot !== lastEntries) {
    lastEntries = snapshot;
    itemSnapshot = Object.freeze(
      snapshot.filter((entry): entry is SidebarItem => !("kind" in entry)),
    );
  }
  return itemSnapshot;
}

/** Snapshot of every sidebar entry, including separators. */
export const getSidebarEntries = entries.getSnapshot;
/** Subscribe to sidebar entry or separator changes. */
export const subscribeSidebarEntries = entries.subscribe;
/** Subscribe to sidebar item changes; separators remain hidden. */
export const subscribeSidebarItems = entries.subscribe;
