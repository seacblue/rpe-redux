/**
 * The shapes the shortcut feature publishes, and nothing else.
 *
 * No imports and no code: the key model turns written text into these
 * (`keys.ts`), the registry stores them (`registry.ts`), and every contributor
 * writes them — a feature, the editor, a plugin. Nothing here says how a key
 * looks on screen; the view layer owns that.
 */

// ------------------------------------------------------------------ key model

/**
 * The modifier tokens a binding may name.
 *
 * `MOD` is the platform's own primary modifier, resolved whenever a binding is
 * matched or drawn, so one default table serves macOS and the rest.
 */
export type Modifier = "CTRL" | "ALT" | "SHIFT" | "META" | "MOD";

/** Where a command is allowed to run, independent of the focused DOM node. */
export type ShortcutScope =
  "app" | "instrument" | "workspace" | "editor" | "surface" | "modal" | "emergency";

/** The live state the dispatcher evaluates for every key press. */
export interface ShortcutContext {
  /** Whether the home screen owns the window; there is no other shell mode. */
  readonly atHome: boolean;
  readonly documentOpen: boolean;
  readonly modal: "none" | "normal" | "urgent";
  readonly capturing: boolean;
  readonly developerMode: boolean;
  readonly textEntry: boolean;
  readonly surface: "menu" | "dialog" | "text" | null;
}

/**
 * One key plus the modifiers it is pressed with — what a shortcut answers to.
 *
 * The order of `modifiers` carries no meaning: two bindings naming the same
 * modifiers are the same binding, and `canonicalText` is what fixes the order
 * they are written in.
 */
export interface Shortcut {
  /** The key itself: `"S"`, `"SPACE"`, `"MOUSE0"`, `"WHEELUP"`. */
  key: string;
  /** Omitted when the key is pressed on its own. */
  modifiers?: readonly Modifier[];
}

/** A keyboard event, a mouse button event or a wheel event. */
export interface ShortcutEventLike {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  /** `KeyboardEvent.repeat`; present only on keyboard events. */
  repeat?: boolean;
  /** `MouseEvent.button`; present only on pointer events. */
  button?: number;
  /** `WheelEvent.deltaY`; present only on wheel events. */
  deltaY?: number;
  /** `WheelEvent.deltaX`; present only on horizontal wheel/trackpad events. */
  deltaX?: number;
}

/** Text that parsed, or the message key saying why it did not. */
export type ParsedShortcut = { ok: true; shortcut: Shortcut } | { ok: false; error: string };

// ------------------------------------------------------------------ registry

/**
 * A shortcut group: how a contributor declares one, and how the settings page
 * reads it back.
 *
 * One shape, not a definition/view pair: the registry adds nothing to a category.
 * Only a shortcut definition becomes a view once the profile has answered for its
 * keys.
 */
export interface ShortcutCategory {
  /** Stable id, independent of the displayed label. */
  id: string;
  /** Message key of the group's name, or a literal label a plugin supplies. */
  title: string;
  order: number;
}

/** A shortcut definition: stable id, owner category, defaults, scope, and runner. */
export interface ShortcutDefinition {
  id: string;
  /**
   * Id of the group this shortcut is filed under, as `registerCategory` returned
   * it. Deliberately a plain string rather than a union: a contributor — a
   * feature or a plugin — may bring a category of its own.
   */
  category: string;
  /** Message key of the shortcut's name. */
  title: string;
  /** Canonical bindings. The first is the primary one shown in the UI. */
  defaults: readonly Shortcut[];
  /** The dispatch scope every registered command declares. */
  scope: ShortcutScope;
  /** Additional availability rule inside the scope, evaluated per key press. */
  when?: (context: ShortcutContext) => boolean;
  /**
   * Whether this shortcut may deliberately share a key with another.
   *
   * Two editor actions bound to `R` are not a mistake when one places a Hold and
   * the other an event, and `←` is one key in two contexts. Such a shortcut opts
   * out of the conflict list rather than making the settings page cry wolf.
   */
  shared?: boolean;
  /** Whether the binding is observed by a feature without dispatching a command. */
  passive?: boolean;
  /** The direct operation this key runs when matched. */
  run?: (input?: unknown) => unknown;
  enabled?: () => boolean;
  /** Former storage key adopted once when the current id has no stored bindings. */
  legacyStorageKey?: string;
}

/**
 * A registered shortcut plus the profile's answer for it — the shape the
 * interface reads.
 *
 * `bindings` is what the profile says, or the registered defaults when it is
 * silent; `overridden` says which of the two it was; `conflicts` names the ids
 * this shortcut collides with. The run callbacks stay in the registry, so what
 * reaches React can never run an action by accident.
 */
export interface ShortcutView extends Omit<
  ShortcutDefinition,
  "run" | "enabled" | "legacyStorageKey"
> {
  bindings: Shortcut[];
  overridden: boolean;
  /** Ids this shortcut collides with, when the collision is not allowed. */
  conflicts: string[];
}

/** Outcome of rebinding one shortcut, with a message key on failure. */
export interface BindingChange {
  ok: boolean;
  /** Message key of the failure, when `ok` is false. */
  error?: string;
}

/** This feature's shortcuts are gone; used by `registerShortcut`. */
export type ShortcutDisposer = () => void;
