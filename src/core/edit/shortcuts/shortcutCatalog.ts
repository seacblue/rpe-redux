/**
 * The editor's shortcuts, gathered from the modules that implement them.
 *
 * Editing declarations live next to their domain actions. Display-only shortcut
 * declarations are collected here without importing a browser implementation.
 * Matching yields an id for the editor table or a registered definition for
 * shell actions; execution calls that action's own callback.
 *
 * The editor registers them before the first listener binds, so a rebound key is
 * live from the first keystroke.
 */
import { type EditorShortcutContext, type EditorShortcutDefinition } from "./declarations.ts";
import { shortcutRegistry as shortcuts } from "../../shortcuts/registry.ts";
import { SHORTCUT_CATEGORIES } from "../../shortcuts/categories.ts";
import {
  type Shortcut,
  type ShortcutCategory,
  type ShortcutContext,
  type ShortcutDefinition,
  type ShortcutDisposer,
  type ShortcutEventLike,
} from "../../shortcuts/types.ts";
import { matches } from "../../shortcuts/keyMatching.ts";
import { shortcutScopeAvailable, shortcutScopePriority } from "../../shortcuts/scope.ts";
import { historyShortcuts } from "../session/history.ts";
import { selectionShortcuts } from "../selection/control.ts";
import { clipboardShortcuts } from "../clipboard/operations.ts";
import { eventLayerShortcuts, eventShortcuts } from "../events/eventCommands.ts";
import { trajectoryShortcuts } from "../events/trajectoryCommands.ts";
import { playbackShortcuts } from "../playback/transport.ts";
import { multiLineShortcuts } from "../multiLine/multiLineEdit.ts";
import { TIMELINE_WHEEL_SHORTCUT_IDS } from "./timelineWheel.ts";

/** Stable id for the passive judge-line prefix gesture. */
export const LINE_JUMP_SHORTCUT_ID = "navigation.line.jump";

/** Ids for the sampling commands owned by the workspace sampler. */
export const SAMPLING_SHORTCUT_IDS = Object.freeze({
  start: "event.sample.start",
  end: "event.sample.end",
  hideGuides: "sampling.hideGuides",
  apply: "sampling.apply",
});

/** Editor shortcuts that change stage and timeline visibility. */
const viewShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "view.togglePreviewOnly",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.togglePreviewOnly",
    scope: "editor",
    defaults: [{ key: "SPACE", modifiers: ["CTRL"] }],
  },
  {
    id: "view.previewAudition",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.previewAudition",
    scope: "editor",
    defaults: [{ key: "T" }],
    hold: true,
  },
  {
    id: "view.previewAuditionStay",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.previewAuditionStay",
    scope: "editor",
    defaults: [{ key: "U" }],
    hold: true,
  },
  {
    id: "view.resetCamera",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.resetCamera",
    scope: "editor",
    // F reads as "fit the view"; Ctrl+Shift keeps it beside the left index.
    defaults: [{ key: "F", modifiers: ["CTRL", "SHIFT"] }],
  },
  {
    id: "view.toggleGameUi",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.toggleGameUi",
    scope: "editor",
    defaults: [{ key: "G", modifiers: ["CTRL", "SHIFT"] }],
  },
];
/**
 * Editor shortcuts that open or close the workspace sampler.
 *
 * The sampler's live surfaces own the key listeners while it is open, so these
 * are passive declarations: the shortcut editor lists and rebinds them, and the
 * overlay matches the registry instead of a literal key.
 */
const samplingShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: SAMPLING_SHORTCUT_IDS.start,
    category: SHORTCUT_CATEGORIES.sampling.id,
    title: "shortcuts.editor.sampleStart",
    scope: "editor",
    // V reads as "pick a value"; Shift selects the other anchor of the event.
    // The selected event is the target, so the pointer's current region does
    // not decide whether the sampler opens.
    defaults: [{ key: "V" }],
    enabledFor: (context) =>
      context.hasEventSelection === true && !context.curveMode && !context.samplingActive,
  },
  {
    id: SAMPLING_SHORTCUT_IDS.end,
    category: SHORTCUT_CATEGORIES.sampling.id,
    title: "shortcuts.editor.sampleEnd",
    scope: "editor",
    defaults: [{ key: "V", modifiers: ["SHIFT"] }],
    enabledFor: (context) =>
      context.hasEventSelection === true && !context.curveMode && !context.samplingActive,
  },
  {
    id: SAMPLING_SHORTCUT_IDS.hideGuides,
    category: SHORTCUT_CATEGORIES.sampling.id,
    title: "shortcuts.editor.samplingHideGuides",
    scope: "editor",
    defaults: [{ key: "SHIFT" }],
    passive: true,
  },
  {
    id: SAMPLING_SHORTCUT_IDS.apply,
    category: SHORTCUT_CATEGORIES.sampling.id,
    title: "shortcuts.editor.samplingApply",
    scope: "editor",
    defaults: [{ key: "F" }],
    passive: true,
  },
];

/** Editor shortcuts owned by the curve trajectory stage. */
const curveShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "editor.curve.delete",
    category: SHORTCUT_CATEGORIES.editorCurve.id,
    title: "shortcuts.editor.curveDelete",
    scope: "editor",
    defaults: [{ key: "D" }],
    // D is the curve segment delete while the curve stage is open and the
    // regular object delete otherwise.
    shared: true,
    enabledFor: (context) => context.curveMode === true,
  },
];
/** Wheel-driven line stepping and time seeking, both rebindable. */
const navigationShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: LINE_JUMP_SHORTCUT_ID,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.lineJump",
    scope: "editor",
    defaults: [{ key: "CTRL" }],
    // The editor keyboard host observes this binding as a prefix and commits on
    // key-up; the ordinary dispatcher must never consume the bare modifier.
    passive: true,
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.lineNext,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.nextJudgeLine",
    scope: "editor",
    defaults: [{ key: "WHEELUP", modifiers: ["CTRL"] }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.linePrevious,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.previousJudgeLine",
    scope: "editor",
    defaults: [{ key: "WHEELDOWN", modifiers: ["CTRL"] }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.fastNext,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineFastForward",
    scope: "editor",
    defaults: [{ key: "WHEELUP", modifiers: ["SHIFT"] }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.fastPrevious,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineFastBackward",
    scope: "editor",
    defaults: [{ key: "WHEELDOWN", modifiers: ["SHIFT"] }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.timeNext,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineForward",
    scope: "editor",
    defaults: [{ key: "WHEELUP" }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.timePrevious,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineBackward",
    scope: "editor",
    defaults: [{ key: "WHEELDOWN" }],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.zoomIn,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineZoomIn",
    scope: "editor",
    defaults: [
      { key: "WHEELUP", modifiers: ["ALT"] },
      { key: "WHEELUP", modifiers: ["ALT", "SHIFT"] },
    ],
  },
  {
    id: TIMELINE_WHEEL_SHORTCUT_IDS.zoomOut,
    category: SHORTCUT_CATEGORIES.editorNavigation.id,
    title: "shortcuts.editor.timelineZoomOut",
    scope: "editor",
    defaults: [
      { key: "WHEELDOWN", modifiers: ["ALT"] },
      { key: "WHEELDOWN", modifiers: ["ALT", "SHIFT"] },
    ],
  },
];
/** Editor shortcuts without default keys but available for custom binding. */
const lineInfoShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "view.showLineInfo",
    category: SHORTCUT_CATEGORIES.editorPlayback.id,
    title: "shortcuts.editor.showLineInfo",
    scope: "editor",
    // Line information remains available through a custom binding; Tab stays
    // free for focus traversal.
    defaults: [],
  },
];

/** The editor's categories, in the order the settings page lists them. */
const EDITOR_CATEGORIES: readonly ShortcutCategory[] = [
  SHORTCUT_CATEGORIES.editorEditing,
  SHORTCUT_CATEGORIES.editorNotes,
  SHORTCUT_CATEGORIES.editorSelection,
  SHORTCUT_CATEGORIES.editorClipboard,
  SHORTCUT_CATEGORIES.editorNavigation,
  SHORTCUT_CATEGORIES.editorPlayback,
  SHORTCUT_CATEGORIES.editorCurve,
  SHORTCUT_CATEGORIES.sampling,
];

// ------------------------------------------------------------------ shortcuts

/** `Save` writes the document this module saves. */
export const documentShortcuts: readonly EditorShortcutDefinition[] = [
  {
    id: "document.save",
    category: SHORTCUT_CATEGORIES.file.id,
    title: "shortcuts.editor.save",
    defaults: [{ key: "S", modifiers: ["CTRL"] }],
    scope: "app",
    when: (context) => context.documentOpen,
  },
];

/** Every editor shortcut, in the order the settings page lists them. */
export const EDITOR_SHORTCUTS: readonly EditorShortcutDefinition[] = [
  ...documentShortcuts,
  ...historyShortcuts,
  ...selectionShortcuts,
  ...eventLayerShortcuts,
  ...eventShortcuts,
  ...samplingShortcuts,
  ...trajectoryShortcuts,
  ...curveShortcuts,
  ...clipboardShortcuts,
  ...navigationShortcuts,
  ...playbackShortcuts,
  ...viewShortcuts,
  ...lineInfoShortcuts,
  ...multiLineShortcuts,
];
const EDITOR_SHORTCUT_IDS = new Set(EDITOR_SHORTCUTS.map((shortcut) => shortcut.id));

/** Registers the editor's categories and shortcuts; the editor calls this before it mounts. */
export function registerEditorShortcuts(): ShortcutDisposer {
  // The categories are created here, through the shortcut API, and the ids it
  // returns are what the declarations are registered with — a declaration only
  // names the category it belongs to. A toolbar action may have registered the
  // same category first (both surfaces share the playback/view label), so an
  // existing category is reused instead of being registered twice.
  const categoryIds = new Map<string, string>();
  const registrations: { dispose: ShortcutDisposer }[] = [];
  for (const category of EDITOR_CATEGORIES) {
    if (shortcuts.hasCategory(category.id)) {
      categoryIds.set(category.id, category.id);
      continue;
    }
    const registration = shortcuts.registerCategory({ ...category });
    categoryIds.set(category.id, registration.id);
    registrations.push(registration);
  }
  const disposers = EDITOR_SHORTCUTS.map((shortcut) =>
    shortcuts.registerShortcut(registryDefinition(shortcut, categoryIds)),
  );
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
    for (const registration of registrations) {
      registration.dispose();
    }
  };
}

/**
 * The registry's shape: the declared category key resolved to the id the API
 * returned, and `enabledFor` left with the editor's own matcher.
 */
function registryDefinition(
  shortcut: EditorShortcutDefinition,
  categoryIds: ReadonlyMap<string, string>,
): ShortcutDefinition {
  const definition: ShortcutDefinition = {
    id: shortcut.id,
    category: categoryIds.get(shortcut.category) ?? shortcut.category,
    title: shortcut.title,
    defaults: shortcut.defaults,
    scope: shortcut.scope,
  };
  if (shortcut.shared) {
    definition.shared = shortcut.shared;
  }
  if (shortcut.passive) {
    definition.passive = shortcut.passive;
  }
  if (shortcut.when) {
    definition.when = shortcut.when;
  }
  return definition;
}

/**
 * The editor action `event` triggers, or `undefined`.
 *
 * The declaration's scope and `when` rule are evaluated first, then the editor's
 * own surface/selection predicate. The first match in declaration order wins, and
 * every binding the user gave the command counts — not just the default one.
 */
export function matchEditorShortcut(
  event: ShortcutEventLike,
  context: EditorShortcutContext,
  shortcutContext: ShortcutContext,
): string | undefined {
  for (const shortcut of EDITOR_SHORTCUTS) {
    if (shortcut.passive) {
      continue;
    }
    if (!shortcutScopeAvailable(shortcut.scope, shortcutContext)) {
      continue;
    }
    if (!(shortcut.when?.(shortcutContext) ?? true)) {
      continue;
    }
    if (shortcut.surface && shortcut.surface !== context.surface) {
      continue;
    }
    if (!(shortcut.enabledFor?.(context) ?? true)) {
      continue;
    }
    if (shortcuts.bindingsOf(shortcut.id).some((binding) => matches(event, binding))) {
      return shortcut.id;
    }
  }
  return undefined;
}

/** Whether an editor action stays active until its key is released. */
export function holdsEditorShortcut(id: string): boolean {
  return EDITOR_SHORTCUTS.some((shortcut) => shortcut.id === id && shortcut.hold === true);
}

/** Match one passive editor gesture without dispatching it as a command. */
export function matchesEditorShortcut(
  id: string,
  event: ShortcutEventLike,
  context: EditorShortcutContext,
  shortcutContext: ShortcutContext,
): boolean {
  const shortcut = EDITOR_SHORTCUTS.find((candidate) => candidate.id === id);
  if (!shortcut || !shortcutScopeAvailable(shortcut.scope, shortcutContext)) {
    return false;
  }
  if (!(shortcut.when?.(shortcutContext) ?? true)) {
    return false;
  }
  if (shortcut.surface && shortcut.surface !== context.surface) {
    return false;
  }
  if (!(shortcut.enabledFor?.(context) ?? true)) {
    return false;
  }
  return shortcuts.bindingsOf(id).some((binding) => matches(event, binding));
}

/**
 * Matches a registered shell/extension shortcut after the editor-specific table
 * has had first refusal. The returned definition carries its own direct runner.
 *
 * Candidate scopes are filtered by the live context and the most specific scope
 * wins; registration order only breaks ties inside one scope.
 */
export function matchRegisteredShortcut(
  event: ShortcutEventLike,
  context: ShortcutContext,
): ShortcutDefinition | undefined {
  let winner: { definition: ShortcutDefinition; priority: number } | undefined;
  for (const view of shortcuts.shortcuts()) {
    if (EDITOR_SHORTCUT_IDS.has(view.id)) {
      continue;
    }
    const definition = shortcuts.definition(view.id);
    if (!definition || definition.passive || definition.enabled?.() === false) {
      continue;
    }
    const scope = definition.scope;
    if (!shortcutScopeAvailable(scope, context)) {
      continue;
    }
    if (!(definition.when?.(context) ?? true)) {
      continue;
    }
    if (!view.bindings.some((binding) => matches(event, binding))) {
      continue;
    }
    const priority = shortcutScopePriority(scope);
    if (!winner || priority > winner.priority) {
      winner = { definition, priority };
    }
  }
  return winner?.definition;
}

/**
 * The main binding of one editor action, for the handlers that check a single
 * key. `undefined` means the action is not registered — handlers skip the event
 * rather than treating it as unmatched text.
 */
export function editorShortcut(action: string): Shortcut | undefined {
  return shortcuts.primaryOf(action);
}
