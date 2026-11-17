/**
 * The shortcut registry.
 *
 * Features register shortcuts into this one catalog and receive a disposer, so
 * unloading a feature removes its shortcuts. The catalog answers what a shortcut
 * currently answers to, which shortcut a keystroke matches, and which shortcuts
 * collide. Bindings are ordinary values in the shortcuts preference section, so an
 * override is a value away from its default and SQLite stays authoritative for
 * persisted state.
 */
import { PREFERENCE_SECTIONS } from "../state/preferences.ts";
import { defineValue, values } from "../state/values.ts";
import { Contributions } from "../state/contributions.ts";
import {
  assertShortcut,
  canonicalText,
  parseShortcut,
  shortcutConflictKey,
  shortcutIssue,
  shortcutKeys,
} from "./keys.ts";
import { matches, shortcutKey } from "./keyMatching.ts";
import { heldShortcutKeys } from "./inputKeys.ts";
import { shortcutScopesOverlap } from "./scope.ts";
import type {
  BindingChange,
  Shortcut,
  ShortcutCategory,
  ShortcutDefinition,
  ShortcutDisposer,
  ShortcutEventLike,
  ShortcutView,
} from "./types.ts";

/** The preference section that holds the user's bindings. */
export const SHORTCUTS_SECTION = PREFERENCE_SECTIONS.shortcuts;

/** Two written binding lists are the same answer, whatever their wording was. */
const sameBindings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((text, index) => text === b[index]);

interface RegisteredShortcut extends ShortcutDefinition {
  order: number;
}

/**
 * Catalog of contributed shortcuts and the values that hold their bindings.
 *
 * Each id registers once; the registry answers binding, match, conflict, and
 * override questions and never persists directly.
 */
export class ShortcutRegistry {
  private readonly categoriesById = new Contributions<ShortcutCategory>();
  private readonly definitions = new Contributions<RegisteredShortcut>();
  private readonly definitionDisposers = new Map<string, ShortcutDisposer>();
  /** Subscriptions are per registration; the value itself intentionally outlives it. */
  private readonly bindingDisposers = new Map<string, () => void>();
  /** Lets a reloaded shortcut adopt a new default without overwriting a user override. */
  private readonly registeredDefaults = new Map<string, readonly string[]>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private cached: readonly ShortcutView[] | null = null;
  private cachedEnabled: readonly boolean[] | null = null;
  private nextDefinitionOrder = 0;
  /** Written bindings, parsed once per change: a keystroke asks this table. */
  private readonly parsed = new Map<string, Shortcut[]>();
  /** Views whose bindings can answer one trigger key; rebuilt with the view cache. */
  private candidateIndex: ReadonlyMap<string, readonly ShortcutView[]> | null = null;

  // ------------------------------------------------------------ registration

  /**
   * Register a category and return its id plus a disposer.
   *
   * Disposing the category also disposes every shortcut filed under it.
   */
  registerCategory(category: ShortcutCategory): {
    id: string;
    dispose: ShortcutDisposer;
  } {
    const disposeCategory = this.categoriesById.register({ ...category });
    this.invalidate();
    let active = true;
    return {
      id: category.id,
      dispose: () => {
        if (!active) {
          return;
        }
        active = false;
        disposeCategory();
        for (const definition of this.definitions.getSnapshot()) {
          if (definition.category === category.id) {
            this.definitionDisposers.get(definition.id)?.();
          }
        }
        this.invalidate();
      },
    };
  }

  /**
   * Register one shortcut, declare its binding value, and return an idempotent
   * disposer. Throws when the id or scope is missing or a default is unusable.
   */
  registerShortcut(definition: ShortcutDefinition): ShortcutDisposer {
    const id = definition.id.trim();
    if (!id) {
      throw new Error("Shortcut id must be nonempty");
    }
    if (!definition.scope) {
      throw new Error(`Shortcut ${id} must declare a scope`);
    }
    for (const binding of definition.defaults) {
      assertShortcut(binding, id);
    }
    const registered: RegisteredShortcut = {
      ...definition,
      id,
      defaults: [...definition.defaults],
      order: this.nextDefinitionOrder++,
    };
    const disposeDefinition = this.definitions.register(registered);
    try {
      this.defineBindings(registered);
    } catch (error) {
      disposeDefinition();
      throw error;
    }
    this.invalidate();
    const dispose = () => {
      if (this.definitionDisposers.get(id) !== dispose) {
        return;
      }
      this.definitionDisposers.delete(id);
      this.bindingDisposers.get(this.valueId(id))?.();
      this.bindingDisposers.delete(this.valueId(id));
      disposeDefinition();
      this.invalidate();
    };
    this.definitionDisposers.set(id, dispose);
    return dispose;
  }

  /** Whether a shortcut with this id is registered. */
  has(id: string): boolean {
    return this.definitions.node(id) !== undefined;
  }

  /** Whether a category with this id is registered. */
  hasCategory(id: string): boolean {
    return this.categoriesById.node(id) !== undefined;
  }

  /** Read one registered definition, including its runner and availability rule. */
  definition(id: string): ShortcutDefinition | undefined {
    return this.definitions.node(id);
  }

  // ---------------------------------------------------------------- readings

  /** Every registered category in registration order. */
  categories(): readonly ShortcutCategory[] {
    return this.categoriesById.getSnapshot();
  }

  /** Every registered shortcut, grouped-ready and conflict-checked. */
  shortcuts(): readonly ShortcutView[] {
    const definitions = this.definitions.getSnapshot();
    const enabled = definitions.map((definition) => definition.enabled?.() !== false);
    if (
      this.cached &&
      this.cachedEnabled &&
      this.cachedEnabled.length === enabled.length &&
      this.cachedEnabled.every((value, index) => value === enabled[index])
    ) {
      return this.cached;
    }
    const enabledIds = new Set(
      definitions.filter((_, index) => enabled[index]).map((definition) => definition.id),
    );
    const views: ShortcutView[] = definitions.map((definition) => {
      const { id, category, title, defaults, shared, scope, when } = definition;
      const view: ShortcutView = {
        id,
        category,
        title,
        defaults,
        scope,
        bindings: this.bindingsOf(id),
        overridden: this.overridden(id),
        conflicts: [],
        bindingConflicts: {},
      };
      if (shared) {
        view.shared = shared;
      }
      if (when) {
        view.when = when;
      }
      return view;
    });
    // Conflicts are per written binding, not per command: one command may carry
    // a conflicting alternate while its primary key stays unique.
    const buckets = new Map<string, Record<string, string[]>>(views.map((view) => [view.id, {}]));
    const byBinding = new Map<string, ShortcutView[]>();
    for (const view of views) {
      for (const binding of view.bindings) {
        const text = shortcutConflictKey(binding);
        const list = byBinding.get(text);
        if (list) {
          list.push(view);
        } else {
          byBinding.set(text, [view]);
        }
      }
    }
    for (const [text, list] of byBinding) {
      const contenders = list.filter((view) => !view.shared && enabledIds.has(view.id));
      // Two commands can share a key as long as their scopes never coexist.
      // Parent/child scopes do overlap and therefore still report a collision.
      for (let left = 0; left < contenders.length; left += 1) {
        for (let right = left + 1; right < contenders.length; right += 1) {
          const first = contenders[left];
          const second = contenders[right];
          if (!shortcutScopesOverlap(first.scope, second.scope)) {
            continue;
          }
          (buckets.get(first.id)![text] ??= []).push(second.id);
          (buckets.get(second.id)![text] ??= []).push(first.id);
        }
      }
    }
    for (const view of views) {
      const bucket = buckets.get(view.id)!;
      view.bindingConflicts = bucket;
      view.conflicts = [...new Set(Object.values(bucket).flat())];
    }
    // A keystroke only asks the bindings that name its trigger key.
    const candidateIndex = new Map<string, ShortcutView[]>();
    for (const view of views) {
      const seen = new Set<string>();
      for (const binding of view.bindings) {
        for (const key of shortcutKeys(binding)) {
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const list = candidateIndex.get(key);
          if (list) {
            list.push(view);
          } else {
            candidateIndex.set(key, [view]);
          }
        }
      }
    }
    this.candidateIndex = candidateIndex;
    this.cachedEnabled = Object.freeze(enabled);
    this.cached = Object.freeze(views);
    return this.cached;
  }

  /**
   * Views whose bindings name `eventKey` as one of their keys.
   *
   * Dispatch uses this instead of scanning every registered shortcut; the list
   * keeps registration order, which is the tie-breaker inside one scope.
   */
  viewsForEventKey(eventKey: string): readonly ShortcutView[] {
    if (!this.candidateIndex) {
      this.shortcuts();
    }
    return this.candidateIndex?.get(eventKey) ?? [];
  }

  /** The bindings a shortcut currently answers to. */
  bindingsOf(id: string): Shortcut[] {
    id = id.trim();
    const known = this.parsed.get(id);
    if (known) {
      return [...known];
    }
    const out: Shortcut[] = [];
    for (const text of this.written(id)) {
      const parsed = parseShortcut(text);
      if (parsed.ok) {
        out.push(parsed.shortcut);
      }
    }
    this.parsed.set(id, out);
    return [...out];
  }

  /** The primary binding, for the tooltip and the shortcut chip. */
  primaryOf(id: string): Shortcut | undefined {
    return this.bindingsOf(id)[0];
  }

  // ------------------------------------------------------------------ editing

  /** Appends a binding. A shortcut may answer to as many keys as it likes. */
  addBinding(id: string, shortcut: Shortcut): BindingChange {
    const issue = shortcutIssue(shortcut);
    if (issue) {
      return { ok: false, error: issue };
    }
    const text = canonicalText(shortcut);
    const current = this.written(id);
    if (current.length >= MAX_BINDINGS) {
      return { ok: false, error: "shortcuts.error.tooManyBindings" };
    }
    if (current.includes(text)) {
      return { ok: false, error: "shortcuts.error.alreadyBound" };
    }
    this.set(id, [...current, text]);
    return { ok: true };
  }

  /** Replaces one binding in place, keeping the shortcut's other bindings. */
  replaceBinding(id: string, index: number, shortcut: Shortcut): BindingChange {
    const issue = shortcutIssue(shortcut);
    if (issue) {
      return { ok: false, error: issue };
    }
    const current = this.written(id);
    if (index < 0 || index >= current.length) {
      return { ok: false, error: "shortcuts.error.noSuchBinding" };
    }
    const text = canonicalText(shortcut);
    if (current.includes(text)) {
      return { ok: false, error: "shortcuts.error.alreadyBound" };
    }
    const next = [...current];
    next[index] = text;
    this.set(id, next);
    return { ok: true };
  }

  /** Removes exactly one binding; the shortcut keeps the rest. */
  removeBinding(id: string, index: number): BindingChange {
    const current = this.written(id);
    if (index < 0 || index >= current.length) {
      return { ok: false, error: "shortcuts.error.noSuchBinding" };
    }
    this.set(
      id,
      current.filter((_, position) => position !== index),
    );
    return { ok: true };
  }

  /**
   * Replaces every binding of one shortcut, as an import does.
   *
   * This is the one edit that takes text rather than a value, because its callers
   * have text: the plugin API writing `"CTRL+S"`, and a profile being restored.
   * An id this build does not have is refused rather than stored as an override
   * nothing can read back -the caller got the id wrong, and saying so beats
   * leaving a silent orphan in the profile.
   */
  replaceAllBindings(id: string, bindings: readonly string[]): BindingChange {
    if (!this.definitions.node(id)) {
      return { ok: false, error: "shortcuts.error.notRegistered" };
    }
    const written: string[] = [];
    for (const binding of bindings) {
      const parsed = parseShortcut(binding);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      written.push(canonicalText(parsed.shortcut));
    }
    const issue = this.issueOf(written);
    if (issue) {
      return { ok: false, error: issue };
    }
    this.set(id, written);
    return { ok: true };
  }

  /** Forgets the user's answer for one shortcut, which goes back to its defaults. */
  resetShortcut(id: string): void {
    const definition = this.definitions.node(id);
    if (!definition) {
      return;
    }
    this.set(id, definition.defaults.map(canonicalText));
  }

  /** Forgets every answer this registry knows about. */
  resetAll(): void {
    for (const definition of this.definitions.getSnapshot()) {
      this.set(definition.id, definition.defaults.map(canonicalText));
    }
  }

  /** True when any shortcut this registry knows has moved off its defaults. */
  hasOverrides(): boolean {
    for (const definition of this.definitions.getSnapshot()) {
      if (this.overridden(definition.id)) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- dispatch

  /**
   * The shortcut whose binding matches `event`.
   *
   * A binding with more held keys wins over a shorter one, so `E+MOUSE2` beats
   * a plain `MOUSE2` when both can run. Registration order breaks a tie inside
   * the same chord length, which is deliberate: a pane that wants a key while
   * it is open registers later than the global shortcut and wins.
   */
  match(event: ShortcutEventLike): ShortcutDefinition | undefined {
    const held = heldShortcutKeys();
    let winner: { definition: ShortcutDefinition; keyCount: number } | undefined;
    for (const view of this.viewsForEventKey(shortcutKey(event))) {
      const definition = this.definitions.node(view.id);
      if (!definition || definition.enabled?.() === false) {
        continue;
      }
      for (const binding of view.bindings) {
        if (!matches(event, binding, held)) {
          continue;
        }
        const keyCount = shortcutKeys(binding).length;
        if (!winner || keyCount > winner.keyCount) {
          winner = { definition, keyCount };
        }
      }
    }
    return winner?.definition;
  }

  // -------------------------------------------------------------- observers

  /** Subscribe to registry changes; returns an unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Current views for React's external-store contract. */
  getSnapshot = (): readonly ShortcutView[] => this.shortcuts();

  /** Monotonic registry version, incremented on every observable change. */
  getVersion = (): number => this.version;

  // ------------------------------------------------------------------ values

  /** The value a shortcut's bindings live in. */
  private valueId(id: string): string {
    return `shortcut:${id}`;
  }

  /**
   * Declare a shortcut's bindings at its registered defaults.
   *
   * The declaration is where the profile is read: a value already written under
   * this key arrives with it, so a shortcut whose keys the user changed answers to
   * them from the moment it registers, and a default that moves in a later
   * version reaches everybody who never touched it.
   */
  private defineBindings(definition: ShortcutDefinition): void {
    const valueId = this.valueId(definition.id);
    if (values.byId.has(valueId)) {
      const previousDefaults = this.registeredDefaults.get(valueId);
      const current = values.byId.get<string[]>(valueId);
      const nextDefaults = definition.defaults.map(canonicalText);
      if (previousDefaults && sameBindings(current, previousDefaults)) {
        values.byId.set(valueId, nextDefaults);
      }
    } else {
      defineValue<string[]>({
        id: valueId,
        // The storage key remains the shortcut id so existing profiles keep their bindings.
        storageKey: definition.id,
        ...(definition.legacyStorageKey === undefined
          ? {}
          : { legacyStorageKey: definition.legacyStorageKey }),
        initial: definition.defaults.map(canonicalText),
        persist: SHORTCUTS_SECTION,
        validate: (bindings) => {
          const issue = this.issueOf(bindings);
          if (issue) {
            throw new TypeError(issue);
          }
        },
        equals: sameBindings,
      });
    }
    // A write from anywhere -the settings page, the API, adopting SQLite -comes
    // back through here, so the views and the matcher never hold a stale list.
    this.bindingDisposers.get(valueId)?.();
    this.bindingDisposers.set(
      valueId,
      values.byId.subscribe(valueId, () => this.invalidate()),
    );
    this.registeredDefaults.set(valueId, definition.defaults.map(canonicalText));
  }

  /** The written bindings of a shortcut, as they are on disk. */
  private written(id: string): string[] {
    id = id.trim();
    const valueId = this.valueId(id);
    return values.byId.has(valueId) ? [...values.byId.get<string[]>(valueId)] : [];
  }

  /** Write bindings for a shortcut whose value exists; unknown ids are ignored. */
  private set(id: string, bindings: readonly string[]): void {
    id = id.trim();
    const valueId = this.valueId(id);
    if (!values.byId.has(valueId)) {
      return;
    }
    values.byId.set<string[]>(valueId, [...bindings]);
  }

  /** True when the written bindings differ from the registered defaults. */
  private overridden(id: string): boolean {
    id = id.trim();
    const definition = this.definitions.node(id);
    if (!definition) {
      return false;
    }
    return !sameBindings(this.written(id), definition.defaults.map(canonicalText));
  }

  /**
   * What is wrong with a written list, if anything.
   *
   * The editing methods ask this before writing so they can answer with a
   * `BindingChange`; the value's own rule asks it too, which is what keeps a
   * binding this build cannot read — an unknown syntax, a duplicate, or one key
   * too many — from being adopted out of a hand-edited profile.
   */
  private issueOf(bindings: readonly string[]): string | null {
    if (bindings.length > MAX_BINDINGS) {
      return "shortcuts.error.tooManyBindings";
    }
    const seen = new Set<string>();
    for (const text of bindings) {
      const parsed = parseShortcut(text);
      if (!parsed.ok) {
        return parsed.error;
      }
      const canonical = canonicalText(parsed.shortcut);
      if (seen.has(canonical)) {
        return "shortcuts.error.alreadyBound";
      }
      seen.add(canonical);
    }
    return null;
  }

  /** Drop cached views and parsed bindings, then notify subscribers. */
  private invalidate(): void {
    this.cached = null;
    this.cachedEnabled = null;
    this.candidateIndex = null;
    this.parsed.clear();
    this.version++;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** How many keys one shortcut may answer to before the editor UI gets silly. */
const MAX_BINDINGS = 4;

/** Internal registry used by the public facade and the features that register. */
export const shortcutRegistry = new ShortcutRegistry();
