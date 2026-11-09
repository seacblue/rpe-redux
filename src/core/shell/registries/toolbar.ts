/**
 * The action registry: the one place a feature - or a plugin - puts an action,
 * a toolbar control, a rule or a gap into the shell.
 *
 * This registry is the action seam; the sidebar registry beside it registers a
 * descriptor - an id, a label and an activation route - and leaves rendering to
 * the frontend. A toolbar entry carries no component: an action carries its own
 * predicates and `run`, and a field is a *descriptor* (`kind: "field"`, a value
 * id, bounds the document may move, `input`/`commit`) that
 * `frontend/screens/editor/toolbar/ToolbarControls.tsx` draws. That is why a new
 * field is a line there, and why `ToolbarEntry` is a five-variant union rather
 * than one shape.
 *
 * Registering and running is all that happens here. The two toolbar rows, the
 * context menus, and the shortcut editor read this registry and live under
 * `frontend/`; nothing in this file renders or queries the DOM. `icon` is a glyph
 * name, not a component: the design system resolves the name to a bitmap, so a
 * contribution from outside the app cannot reach into it.
 *
 * Plugins reach the same registry through `core/api/toolbar.ts`.
 */
import type {
  Shortcut,
  ShortcutCategory,
  ShortcutContext,
  ShortcutScope,
} from "../../shortcuts/types.ts";
import type { SelectedEventRef } from "../../edit/selection/api.ts";
import { displayText } from "../../shortcuts/keys.ts";
import { shortcutRegistry } from "../../shortcuts/registry.ts";
import { Contributions } from "../../state/contributions.ts";

/** The rows the toolbar lays out, top one first. */
export type ToolbarRowName = 1 | 2;

/** Width policy for a toolbar action button, measured in toolbar cells. */
export type ToolbarCells = number | "auto";

/** Surfaces that may offer an action as a right-click menu. */
export type ActionContext = "notes" | "events" | "marker";

/**
 * The object under a timeline context-menu invocation.
 *
 * `beat` and `chartSeconds` describe the pointer position in chart time; a
 * marker target carries the marker's own position instead. `markerId` is the
 * marker's persistent id, so it survives a rename.
 */
export type ContextMenuTarget =
  | {
      surface: "notes";
      /**
       * Chart object ids for the selected notes.
       *
       * A normalized session supplies one for every note. A chart that still
       * lacks an id cannot produce this target; the action receives
       * `undefined` rather than a second, synthetic identity scheme.
       */
      noteIds: string[];
      /** Line of the note under the pointer. */
      lineIndex: number;
      beat: number;
      chartSeconds: number;
    }
  | {
      surface: "events";
      refs: SelectedEventRef[];
      beat: number;
      chartSeconds: number;
    }
  | {
      surface: "marker";
      markerId?: string;
      beat: number;
    };

/** A toolbar action's direct operation, optionally receiving a menu target. */
export type ToolbarActionRunner = (target?: ContextMenuTarget) => unknown;

/** An invokable command with its button, context-menu, and shortcut metadata. */
export interface ToolbarAction {
  kind: "action";
  id: string;
  order: number;
  /**
   * The row that carries this action's button.
   *
   * An action that only lives in a context menu leaves it out: no node is drawn
   * for it anywhere, and the context menu, the shortcut and the plugin API are
   * the surfaces
   * that reach it.
   */
  row?: ToolbarRowName;
  group: string;
  /**
   * A message key, or already rendered text when the contribution has none.
   *
   * The field is not typed as `MessageKey` because editor panels and plugins
   * register actions and may pass literal text. Every surface resolves it with
   * `tRaw`, which returns an unmigrated literal unchanged.
   */
  label: string;
  /** Message key, or the rendered text for a contribution that has none yet. */
  tooltip: string;
  /** Action-only contributions share context menus and keyboard shortcuts. */
  toolbar?: boolean;
  contexts?: readonly ActionContext[];
  /** A glyph name the design system knows; see `design/components/icon/Icon.tsx`. */
  icon: string;
  presentation?: "icon" | "text" | "iconText";
  /** Number of cells reserved by the button; omitted and `auto` measure once. */
  cells?: ToolbarCells;
  /**
   * Default bindings, each stored and rendered separately. The registry owns
   * them from here on; this is only the seed.
   */
  shortcuts?: readonly Shortcut[];
  /** The shortcut-editor category for `shortcuts`; omitted means workspace. */
  shortcutCategory?: ShortcutCategory;
  /** Where the shortcut may run; omitted defaults to the editor scope. */
  shortcutScope?: ShortcutScope;
  /** Extra availability rule inside that scope. */
  shortcutWhen?: (context: ShortcutContext) => boolean;
  /**
   * The shortcut this action shares with the editor, when the editor's own
   * declaration is the one the user rebinds.
   *
   * `file.save` carries no `shortcuts` of its own because the editor declares
   * the same key as `Save`; naming that id here makes the toolbar show the
   * user's actual binding, which stays rebindable through that declaration.
   */
  shortcutId?: string;
  /** The element id, for an action the toolbar draws in a row. */
  domId?: string;
  enabled?: () => boolean;
  visible?: () => boolean;
  separatorBefore?: boolean;
  checked?: () => boolean;
  /** Destructive commands keep the danger ink in menus and context lists. */
  destructive?: boolean;
  run?: ToolbarActionRunner;
}
/** A control of the shell's own: a frontend renderer selected by stable id. */
export interface ToolbarControl {
  kind: "control";
  id: string;
  order: number;
  row: ToolbarRowName;
  controlId: string;
}

/**
 * Control ids the host renders.
 *
 * A package may place one of these controls in a row, but it cannot invent a
 * renderer id: the gate rejects an unknown id before it reaches the registry.
 * Keep this list beside the toolbar contract; the frontend renderers are the
 * implementation behind each id.
 */
export const HOST_TOOLBAR_CONTROL_IDS = Object.freeze([
  "playback",
  "audition",
  "extensions",
  "noiseRendering",
] as const);

/** One toolbar control id with a host renderer. */
export type HostToolbarControlId = (typeof HOST_TOOLBAR_CONTROL_IDS)[number];

/** A rule drawn between two items. */
export interface ToolbarDivider {
  kind: "divider";
  id: string;
  order: number;
  row: ToolbarRowName;
}

/** Empty space, measured in button cells (see `toolbar.less`). */
export interface ToolbarSpacer {
  kind: "spacer";
  id: string;
  order: number;
  row: ToolbarRowName;
  /** Width in `--tool-cell` units. Left out, it is `toolbar.less`'s default. */
  cells?: number;
}

/**
 * What every toolbar field carries: where it sits, and which value it shows.
 *
 * A field is data, not a component: the row names a value id and the kind below
 * says how to draw and commit it, which is why a new field is a line in
 * `ToolbarControls.tsx`. Nothing here subscribes - the toolbar reads the value
 * registry once for the whole bar.
 */
export interface ToolbarFieldCommon {
  kind: "field";
  id: string;
  /** The element id: what the editor contract and the browser suites address. */
  domId: string;
  row: ToolbarRowName;
  order: number;
  /** The value this field shows and writes, named by its id in `core/state/values.ts`. */
  value: string;
  /** The class the field's own cluster carries; `toolbarGrid.less` sizes its cells. */
  className?: string;
  /** A glyph name the design system knows; see `design/components/icon/Icon.tsx`. */
  icon?: string;
  /** The shell's richer tooltip, drawn by the icon beside the field. */
  tipTitle?: string;
  tipDesc?: string;
}

/** A number box, with bounds the document may move and one place that commits it. */
export interface ToolbarNumberField extends ToolbarFieldCommon {
  field: "number";
  /** The field's accessible name. */
  label: string;
  /** A fixed bound, or one that follows the document (the line picker's last line). */
  min?: number | (() => number);
  max?: number | (() => number);
  step?: number | "any";
  /** A ring rather than a line: past `max` comes `min`, and the reverse. */
  wrap?: boolean;
  /** Adds the field's own step buttons (`Input`'s `redux-stepper`). */
  stepper?: boolean;
  /**
   * Draws a text box for grammars a native number input would drop.
   *
   * The line picker needs one because its grammar carries ranges and unions
   * (`2:5`, `1,3`), which a native number input discards before the owner sees it.
   */
  text?: boolean;
  /**
   * Where the field's text sits inside its box.
   *
   * A toolbar cell is compact and reads as part of a rail, so its entries say
   * which edge they use. Omitted, the design field's trailing-edge default
   * applies.
   */
  textAlign?: "left" | "center" | "right";
  /** A trailing dropdown owned by a frontend feature, keyed by a stable marker. */
  dropdown?: "linePicker";
  /** Disabled while the editor has nothing to walk. */
  disabled?: () => boolean;
  /** The box's tooltip, which may follow the value. */
  title?(value: string): string | undefined;
  /**
   * Whether the box may take the text as it is being typed.
   *
   * Left out, every keystroke reaches `input` and the field's owner decides what
   * the text means. A field that declares this never gets the value rewritten: a
   * refused text stays in the box, the box reports `aria-invalid`, and the
   * owner's value is untouched until an acceptable value arrives. An empty box
   * is an edit in progress, not a refusal.
   */
  accept?(value: string): boolean;
  /** Keep typed text in the box and parse it only when the field loses focus. */
  commitOnBlur?: boolean;
  /** Every keystroke and every step; nothing is finished yet. */
  input(value: string): void;
  /**
   * The value is finished: the wheel, a step button, or the blur after an edit.
   */
  commit?(value: string): void;
}

/** A select with the field's own name in front of the box. */
export interface ToolbarSelectField extends ToolbarFieldCommon {
  field: "select";
  /** The choices, given what the field shows: a ratio outside the presets keeps its entry. */
  options(value: string): readonly string[];
  /** Text drawn before the box, for the field whose name is not a glyph. */
  leading?: string;
  commit(value: string): void;
}

/** A number or select field descriptor drawn by the toolbar. */
export type ToolbarField = ToolbarNumberField | ToolbarSelectField;

/** Any contribution the toolbar can lay out. */
export type ToolbarEntry =
  ToolbarAction | ToolbarControl | ToolbarField | ToolbarDivider | ToolbarSpacer;

/** Ordered contribution registry for toolbar actions, controls, fields, dividers, and spacers. */
export const toolbar = new Contributions<ToolbarEntry>();

/** Formats the primary registered binding for plain-text search and tooltips. */
export function actionShortcut(action: ToolbarAction): string {
  const primary = actionShortcuts(action)[0];
  return primary ? displayText(primary) : "";
}

/** Returns bindings so the view can render each key as its own chip. */
export function actionShortcuts(action: ToolbarAction): Shortcut[] {
  const bindings = shortcutRegistry.bindingsOf(action.shortcutId ?? action.id);
  if (bindings.length) {
    return bindings;
  }
  return action.shortcutId ? [] : [...(action.shortcuts ?? [])];
}

/**
 * Whether there is anything to run right now.
 *
 * An action carries its own `run`, so availability is only its own predicates
 * plus that one field: an action with nothing to run is not offered, and a
 * surface that offers it would be offering a button that does nothing.
 */
export function actionAvailable(action: ToolbarAction): boolean {
  if (action.visible?.() === false || action.enabled?.() === false) {
    return false;
  }
  return action.run !== undefined;
}

/** Context menus, toolbar rows and plugins execute the action's own callback. */
export function runAction(action: ToolbarAction): boolean {
  if (!actionAvailable(action)) {
    return false;
  }
  action.run?.();
  return true;
}
