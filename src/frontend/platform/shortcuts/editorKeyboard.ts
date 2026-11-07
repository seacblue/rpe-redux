/**
 * The application's keyboard dispatcher.
 *
 * One capture-phase listener evaluates the live context, lets editor commands
 * take first refusal when the editor workspace is active, then falls back to
 * registered app, instrument, workspace, and extension commands. Individual
 * modules declare scopes instead of installing their own window listeners.
 */
import type { ResourceScope } from "../../../core/utils/resourceScope.ts";
import {
  matchEditorShortcut,
  matchRegisteredShortcut,
} from "../../../core/edit/shortcuts/shortcutCatalog.ts";
import type { EditorShortcutArea } from "../../../core/edit/shortcuts/declarations.ts";
import {
  advancePrefixDigitSequence,
  createPrefixDigitSequenceState,
  type PrefixDigitModifier,
  type PrefixDigitSequenceState,
  type PrefixDigitSequenceSubmission,
} from "../../../core/shortcuts/prefixDigitSequence.ts";
import { normalizeShortcutKey } from "../../../core/shortcuts/keys.ts";
import { releaseShortcutFocus } from "./focus.ts";
import {
  runEditorKeyboardAction,
  type EditorKeyboardActionDependencies,
  type KeyboardActionEvent,
} from "../../../core/edit/operations/keyboard.ts";
import { shortcutRegistry } from "../../../core/shortcuts/registry.ts";
import { SHORTCUT_DISPATCHED_EVENT } from "../../../core/shell/shellEventNames.ts";
import { registerCanvasShortcutBindings } from "./canvasShortcuts.ts";
import { registerTransportShortcuts } from "./playbackKeys.ts";
import { readShortcutContext } from "./shortcutContext.ts";
import type { CanvasShortcutTarget } from "./canvasShortcuts.ts";
import type { Timeline } from "../../screens/editor/workspace/timeline/surface/timeline.ts";

export interface EditorKeyboardBindingDependencies extends Omit<
  EditorKeyboardActionDependencies,
  "timeline"
> {
  timeline: Pick<Timeline, "viewport" | "gestures" | "eventTypes" | "addAtCursor">;
  scope: ResourceScope;
  batchControlsActive: () => boolean;
  /** The curve trajectory surface owns the editor stage. */
  curveModeActive: () => boolean;
  /** The sampling pane owns the workspace and its local apply/cancel keys. */
  samplingActive: () => boolean;
  canvasTarget: (event: Event) => CanvasShortcutTarget | null;
  activeCanvasTarget: () => CanvasShortcutTarget | null;
  clearCanvasTarget: () => void;
  invalidate: () => void;
  /** Hide the line-information overlay when the window loses focus. */
  hideLineInfo: () => void;
  /**
   * Give a live draft first refusal on undo/redo.
   *
   * The curve trajectory editor keeps its own stroke history; without this,
   * Ctrl+Z would also undo the chart underneath it.
   */
  claimDraftShortcut?: (event: KeyboardEvent) => boolean;
  /** Configure one passive prefix-digit shortcut handled by the dispatcher. */
  prefixDigitShortcut: PrefixDigitShortcutBinding;
}

/** A generic prefix-digit binding whose result is interpreted by its owner. */
export interface PrefixDigitShortcutBinding {
  readonly id: string;
  readonly submit: (submission: PrefixDigitSequenceSubmission) => void;
}

/** Resolve the configured bare modifier for one prefix-digit shortcut. */
function configuredPrefix(id: string): PrefixDigitModifier | null {
  const modifiers = new Set<PrefixDigitModifier>(["CTRL", "ALT", "SHIFT", "META"]);
  return (
    shortcutRegistry
      .bindingsOf(id)
      .map((binding) => normalizeShortcutKey(binding.key))
      .find((key): key is PrefixDigitModifier => modifiers.has(key as PrefixDigitModifier)) ?? null
  );
}

/** Registers the one keyboard dispatcher and its pointer/wheel canvas routing. */
export function registerEditorKeyboardBindings(deps: EditorKeyboardBindingDependencies): void {
  let prefixDigitState: PrefixDigitSequenceState = createPrefixDigitSequenceState();
  const keyboardDeps: EditorKeyboardActionDependencies = {
    ...deps,
    timeline: {
      get division() {
        return deps.timeline.viewport.division;
      },
      get gridCount() {
        return deps.timeline.viewport.gridCount;
      },
      get eventTypes() {
        return deps.timeline.eventTypes;
      },
      get eventInteraction() {
        return deps.timeline.gestures.eventInteraction;
      },
      addAtCursor: (type) => deps.timeline.addAtCursor(type),
    },
  };

  const runShortcut = (id: string, input: unknown): void => {
    const invocation = input as {
      event: KeyboardActionEvent;
      area?: Parameters<typeof runEditorKeyboardAction>[2];
    };
    const registered = shortcutRegistry.definition(id);
    if (registered?.run) {
      void registered.run(invocation);
      return;
    }
    void runEditorKeyboardAction(
      invocation.event,
      id,
      invocation.area ?? deps.getSession().focus,
      keyboardDeps,
    );
  };

  registerTransportShortcuts({
    scope: deps.scope,
    hideLineInfo: deps.hideLineInfo,
  });

  deps.scope.listen(
    window,
    "keydown",
    (event) => {
      const context = readShortcutContext(event.target);
      if (context.capturing || context.modal === "urgent") {
        prefixDigitState = createPrefixDigitSequenceState();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (context.modal === "none" && deps.claimDraftShortcut?.(event)) {
        prefixDigitState = createPrefixDigitSequenceState();
        event.preventDefault();
        return;
      }

      let area: EditorShortcutArea = "notes";
      let editorAction: string | undefined;
      let surface: Parameters<typeof matchEditorShortcut>[1]["surface"];
      if (context.documentOpen && context.modal === "none") {
        const { timeline } = deps;
        const session = deps.getSession();
        const canvas = deps.canvasTarget(event) ?? deps.activeCanvasTarget();
        area = canvas?.area ?? timeline.gestures.hoverArea ?? session.focus;
        surface = canvas?.surface;
        const hasMultiSelection =
          [...(session.multiLineSelection?.values() ?? [])].some((values) => values.size) ||
          [...(session.multiEventSelection?.values() ?? [])].some((values) => values.size);
        const hasSelection = Boolean(
          session.selection.size || session.eventSelection.size || hasMultiSelection,
        );
        const hasEventSelection = Boolean(
          session.eventSelection.size ||
          [...(session.multiEventSelection?.values() ?? [])].some((values) => values.size),
        );
        editorAction = matchEditorShortcut(
          event,
          {
            area,
            hasSelection,
            hasEventSelection,
            samplingActive: deps.samplingActive(),
            surface,
            curveMode: deps.curveModeActive(),
          },
          context,
        );
      }
      const registered = editorAction ? undefined : matchRegisteredShortcut(event, context);
      const scope = editorAction
        ? (shortcutRegistry.definition(editorAction)?.scope ?? "editor")
        : (registered?.scope ?? "editor");
      if (
        context.modal === "none" &&
        deps.batchControlsActive() &&
        scope !== "app" &&
        scope !== "instrument"
      ) {
        prefixDigitState = createPrefixDigitSequenceState();
        event.preventDefault();
        return;
      }
      const shortcutId = editorAction ?? registered?.id ?? "";
      if (shortcutId) {
        prefixDigitState = createPrefixDigitSequenceState();
      } else if (
        context.documentOpen &&
        context.modal === "none" &&
        !context.textEntry &&
        context.surface === null
      ) {
        const prefix = configuredPrefix(deps.prefixDigitShortcut.id);
        if (prefix) {
          const transition = advancePrefixDigitSequence(
            prefixDigitState,
            { type: "keydown", event },
            prefix,
          );
          prefixDigitState = transition.state;
          if (transition.handled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
      } else {
        prefixDigitState = createPrefixDigitSequenceState();
      }
      if (shortcutId) {
        window.dispatchEvent(new Event(SHORTCUT_DISPATCHED_EVENT));
      }
      if (
        shortcutId ||
        (!context.textEntry &&
          context.surface !== "menu" &&
          context.surface !== "dialog" &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
      ) {
        releaseShortcutFocus(target);
      }
      const input = {
        event: event as KeyboardActionEvent,
        area,
        surface,
      };
      if (registered?.run) {
        event.preventDefault();
        event.stopPropagation();
        void registered.run(input);
      } else if (editorAction) {
        void runEditorKeyboardAction(input.event, editorAction, area, keyboardDeps);
      }
    },
    true,
  );
  deps.scope.listen(
    window,
    "keyup",
    (event) => {
      if (deps.timeline.gestures.clipboardMode?.keepTime) {
        deps.timeline.gestures.clipboardMode = {};
        deps.invalidate();
      }
      const context = readShortcutContext(event.target);
      if (
        context.capturing ||
        context.modal === "urgent" ||
        context.modal !== "none" ||
        context.textEntry ||
        context.surface !== null
      ) {
        prefixDigitState = createPrefixDigitSequenceState();
        return;
      }
      const prefix = configuredPrefix(deps.prefixDigitShortcut.id);
      if (!prefix) {
        prefixDigitState = createPrefixDigitSequenceState();
        return;
      }
      const transition = advancePrefixDigitSequence(
        prefixDigitState,
        { type: "keyup", event },
        prefix,
      );
      prefixDigitState = transition.state;
      if (transition.submission && transition.submission.kind !== "empty") {
        deps.prefixDigitShortcut.submit(transition.submission);
      }
    },
    true,
  );
  deps.scope.listen(
    window,
    "blur",
    () => {
      prefixDigitState = createPrefixDigitSequenceState();
    },
    true,
  );
  registerCanvasShortcutBindings({
    scope: deps.scope,
    batchControlsActive: deps.batchControlsActive,
    getSession: deps.getSession,
    canvasTarget: deps.canvasTarget,
    clearCanvasTarget: deps.clearCanvasTarget,
    runShortcut,
  });
}
