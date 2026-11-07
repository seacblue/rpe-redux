/**
 * The settings core: the contributed catalog of definitions.
 *
 * A setting does not keep a storage of its own. A registration declares it as a
 * value in the value core — under its key, with the default it starts at and the
 * rule its control imposes — and everything else reads and writes that value. A
 * fixed ID uses a handle; dynamic IDs use `values.byId`. This module owns the
 * catalog, the declaration, and the registry view that features read.
 *
 *   - `settingsRegistry` publishes what features and extensions contribute;
 *   - an Extension registration is qualified under `extension.<owner>.`, so a
 *     package cannot claim a host or another owner's key;
 *   - a registration declares the setting's value, so a key exists before the
 *     first read of it and no read has to carry a fallback of its own.
 */
import type { SettingDefinition, SettingsNavigation } from "./types.ts";
import { defineValue, values } from "../state/values.ts";
import { PREFERENCE_SECTIONS, readPreference, writePreference } from "../state/preferences.ts";
import { Contributions } from "../state/contributions.ts";
import { extensionTextKey, type ExtensionText } from "../extensions/i18n.ts";
import { assertSafeIdentifier } from "../utils/safeIdentifier.ts";

export type { SettingDefinition, SettingsNavigation, SettingValue } from "./types.ts";

/** Internal registry for contributed settings metadata. */
export class SettingsRegistry {
  private readonly navigationEntries = new Contributions<SettingNavigationEntry>();
  private readonly settingEntries = new Contributions<SettingDefinitionEntry>();
  private navigationsView: readonly SettingsNavigation[] = Object.freeze([]);
  private definitionsView: readonly SettingDefinition[] = Object.freeze([]);
  private readonly listeners = new Set<() => void>();
  private readonly ownerSettingKeys = new Map<string, Set<string>>();
  private nextNavigationOrder = 0;
  private nextSettingOrder = 0;

  /**
   * Register one navigation item and return an idempotent disposer.
   *
   * Validates the key, parent, and label before publishing the catalog. An
   * owner's key is qualified under its namespace; a bare parent that already
   * names a registered navigation (the host's own tree) stays a reference to
   * that row, while an unknown bare parent is treated as owner-local.
   */
  registerNavigation(navigation: SettingsNavigation, owner?: string): () => void {
    assertSafeIdentifier(navigation?.key, "Settings navigation key");
    if (navigation.parent !== undefined) {
      assertSafeIdentifier(navigation.parent, "Settings navigation parent");
    }
    if (typeof navigation?.label !== "string" || navigation.label.trim().length === 0) {
      throw new TypeError("Settings navigation label must be non-empty");
    }
    const order = navigation.order ?? this.nextNavigationOrder;
    this.nextNavigationOrder = Math.max(this.nextNavigationOrder + 1, order + 1);
    const registeredNavigation = owner ? this.scopeNavigation(owner, navigation) : navigation;
    const entry: SettingNavigationEntry = {
      id: registeredNavigation.key,
      order,
      value: { ...registeredNavigation },
    };
    const dispose = this.navigationEntries.register(entry, owner);
    this.publish();
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      dispose();
      this.publish();
    };
  }

  /** Register a feature's navigation entries as one contribution. */
  registerNavigations(navigations: readonly SettingsNavigation[], owner?: string): () => void {
    const disposers = navigations.map((navigation) => this.registerNavigation(navigation, owner));
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      for (const dispose of disposers.reverse()) {
        dispose();
      }
    };
  }

  /**
   * Register one setting, declare its value, and return an idempotent disposer.
   *
   * A malformed definition throws before any catalog or value state changes.
   * An owner registration qualifies its key under the owner namespace, keeps a
   * navigation reference that already names a host page, and offers the former
   * bare key as its one-time persisted-value migration source.
   */
  registerSetting(definition: SettingDefinition, owner?: string): () => void {
    assertSafeIdentifier(definition?.key, "Setting key");
    assertSafeIdentifier(definition?.navigation, "Setting navigation");
    if (typeof definition.group !== "string") {
      throw new TypeError("Setting group must be a string");
    }
    if (definition.label === undefined || definition.label === null) {
      throw new TypeError("Setting label is required");
    }
    validateSettingDefinition(definition);
    const registeredDefinition = owner
      ? this.scopeSettingDefinition(owner, definition)
      : definition;
    const legacyKey =
      owner !== undefined && registeredDefinition.key !== definition.key
        ? definition.key
        : undefined;
    const entry: SettingDefinitionEntry = {
      id: registeredDefinition.key,
      order: this.nextSettingOrder++,
      value: { ...registeredDefinition },
    };
    const dispose = this.settingEntries.register(entry, owner);
    try {
      declareSetting(registeredDefinition, owner, legacyKey);
    } catch (error) {
      dispose();
      throw error;
    }
    if (owner) {
      let keys = this.ownerSettingKeys.get(owner);
      if (!keys) {
        keys = new Set();
        this.ownerSettingKeys.set(owner, keys);
      }
      keys.add(registeredDefinition.key);
    }
    this.publish();
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      dispose();
      this.publish();
    };
  }

  /** Register a feature's definitions as one contribution. */
  registerSettings(definitions: readonly SettingDefinition[], owner?: string): () => void {
    const disposers = definitions.map((definition) => this.registerSetting(definition, owner));
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      for (const dispose of disposers.reverse()) {
        dispose();
      }
    };
  }

  /** Every registered navigation item in contribution order. */
  navigations(): readonly SettingsNavigation[] {
    return this.navigationsView;
  }

  /** Return the direct children of one navigation item in contribution order. */
  navigationChildren(parent?: string): readonly SettingsNavigation[] {
    return this.navigationsView.filter((navigation) => navigation.parent === parent);
  }

  /** Every registered setting definition in contribution order. */
  definitions(): readonly SettingDefinition[] {
    return this.definitionsView;
  }

  /** Subscribe to catalog changes; returns an unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Read one setting definition by key. */
  definition(key: string): SettingDefinition | undefined {
    return this.settingEntries.node(key)?.value;
  }

  /** Remove an Extension's catalog rows while keeping its persisted settings. */
  unregisterOwner(owner: string): void {
    this.navigationEntries.unregisterOwner(owner);
    this.settingEntries.unregisterOwner(owner);
    this.publish();
  }

  /**
   * Remove an Extension's catalog rows and persisted settings during uninstall.
   *
   * Disable and reload call `unregisterOwner` instead; only explicit removal of
   * an installed package may delete the user's stored answers.
   */
  purgeOwner(owner: string): void {
    this.unregisterOwner(owner);
    const keys = this.ownerSettingKeys.get(owner);
    if (!keys?.size) {
      return;
    }
    const section = readPreference<Record<string, unknown>>(PREFERENCE_SECTIONS.settings, {});
    const next = { ...section };
    let changed = false;
    for (const key of keys) {
      if (Object.hasOwn(next, key)) {
        delete next[key];
        changed = true;
      }
    }
    this.ownerSettingKeys.delete(owner);
    if (changed) {
      writePreference(PREFERENCE_SECTIONS.settings, next);
    }
  }

  /**
   * Qualify one owner navigation item and resolve its parent reference.
   *
   * An explicit owner-qualified parent is kept as-is. A bare parent that names
   * an already registered navigation is a reference to that host row; any other
   * bare parent is the owner's own local navigation key and is qualified too.
   */
  private scopeNavigation(owner: string, navigation: SettingsNavigation): SettingsNavigation {
    const key = scopedSettingKey(owner, navigation.key);
    if (navigation.parent === undefined) {
      return { ...navigation, key };
    }
    return { ...navigation, key, parent: this.scopeNavigationParent(owner, navigation.parent) };
  }

  /** Resolve one owner navigation parent key without inventing a host reference. */
  private scopeNavigationParent(owner: string, parent: string): string {
    if (parent.startsWith(`extension.${owner}.`)) {
      return parent;
    }
    if (parent.startsWith("extension.") || parent.startsWith("mod.")) {
      throw new Error(`Extension navigation parent must be local: ${parent}`);
    }
    if (this.navigationEntries.node(parent) !== undefined) {
      return parent;
    }
    return `extension.${owner}.${parent}`;
  }

  /**
   * Localize and namespace one contributed definition.
   *
   * The key moves under the owner namespace. The navigation reference follows
   * the resolution rule in `scopeSettingNavigation`, because a package may
   * deliberately attach a row to a host page rather than own a page of its own.
   */
  private scopeSettingDefinition(owner: string, definition: SettingDefinition): SettingDefinition {
    const localized = localizeSettingDefinition(owner, definition);
    return {
      ...localized,
      key: scopedSettingKey(owner, localized.key),
      navigation: this.scopeSettingNavigation(owner, localized.navigation),
    };
  }

  /**
   * Resolve one owner setting's navigation reference.
   *
   * Preference order:
   *   1. the qualified id, when the package has already registered that page;
   *   2. the bare key, when it names an already registered host navigation row;
   *   3. the qualified id, as a forward reference to a page the package will
   *      register later.
   *
   * Normalizing unconditionally would move a row off a host page such as
   * `help` onto a nonexistent `extension.<owner>.help`, so a bare reference is
   * kept only while it actually resolves to a registered navigation.
   */
  private scopeSettingNavigation(owner: string, navigation: string): string {
    const qualified = scopedSettingKey(owner, navigation);
    if (this.navigationEntries.node(qualified) !== undefined) {
      return qualified;
    }
    if (this.navigationEntries.node(navigation) !== undefined) {
      return navigation;
    }
    return qualified;
  }

  /** Rebuild both catalog views and notify subscribers. */
  private publish(): void {
    this.navigationsView = Object.freeze(
      this.navigationEntries.getSnapshot().map(({ value }) => value),
    );
    this.definitionsView = Object.freeze(
      this.settingEntries.getSnapshot().map(({ value }) => value),
    );
    for (const listener of this.listeners) {
      listener();
    }
  }
}

interface SettingNavigationEntry {
  id: string;
  order: number;
  value: SettingsNavigation;
}

interface SettingDefinitionEntry {
  id: string;
  order: number;
  value: SettingDefinition;
}

/** Process-wide registry of contributed settings and navigation entries. */
export const settingsRegistry = new SettingsRegistry();

/**
 * Qualify an Extension setting or navigation key under its owner namespace.
 *
 * The package keeps using a short local key; the catalog and the preference
 * document see `extension.<owner>.<key>`. An already qualified key in the same
 * namespace is accepted unchanged, while another namespace or the legacy `mod.`
 * spelling is rejected so a package cannot claim a host or another owner's id.
 */
function scopedSettingKey(owner: string, key: string): string {
  const id = key.trim();
  if (!id) {
    throw new Error("Extension setting key must be non-empty");
  }
  if (id.startsWith(`extension.${owner}.`)) {
    return id;
  }
  if (id.startsWith("extension.") || id.startsWith("mod.")) {
    throw new Error(`Extension setting key must be local: ${key}`);
  }
  return `extension.${owner}.${id}`;
}

/** Resolve an extension's localized text value to its catalog key. */
function localizeSettingText(owner: string, value: ExtensionText): string {
  return extensionTextKey(owner, value);
}

/** Resolve label, description, unit, and option text owned by one extension. */
function localizeSettingDefinition(
  owner: string,
  definition: SettingDefinition,
): SettingDefinition {
  const localized: SettingDefinition = {
    ...definition,
    label: localizeSettingText(owner, definition.label),
    ...(definition.description === undefined
      ? {}
      : { description: localizeSettingText(owner, definition.description) }),
  };
  if (localized.control === "range" || localized.control === "number") {
    return {
      ...localized,
      ...(localized.unit === undefined ? {} : { unit: localizeSettingText(owner, localized.unit) }),
    };
  }
  if (localized.control === "select") {
    const options = localized.options.map((option) => ({
      ...option,
      label: localizeSettingText(owner, option.label),
    })) as unknown as typeof localized.options;
    return {
      ...localized,
      options,
    };
  }
  return localized;
}

/**
 * Reject a malformed contributed definition before it reaches a control.
 *
 * The TypeScript union protects host code, not a package loaded at runtime.
 * Checking the few fields the renderer assumes keeps one bad definition from
 * throwing inside the settings window or creating an unreachable value.
 */
function validateSettingDefinition(definition: SettingDefinition): void {
  const value = definition as unknown as Record<string, unknown>;
  const control = value.control;
  /** Whether the field holds a finite number. */
  const hasNumber = (field: string): boolean => {
    const entry = value[field];
    return typeof entry === "number" && Number.isFinite(entry);
  };
  if (control === "range" || control === "number") {
    if (!hasNumber("default") || !hasNumber("min") || !hasNumber("max")) {
      throw new TypeError(`Numeric setting needs finite default, min and max: ${definition.key}`);
    }
    const min = value.min as number;
    const max = value.max as number;
    const initial = value.default as number;
    if (min > max || initial < min || initial > max) {
      throw new RangeError(`Numeric setting default is outside its range: ${definition.key}`);
    }
    if (value.step !== undefined && (!hasNumber("step") || (value.step as number) <= 0)) {
      throw new RangeError(`Numeric setting step must be positive: ${definition.key}`);
    }
    if (value.integer === true && !Number.isInteger(initial)) {
      throw new TypeError(`Integer setting default is not an integer: ${definition.key}`);
    }
    return;
  }
  if (control === "toggle") {
    if (typeof value.default !== "boolean") {
      throw new TypeError(`Toggle setting needs a boolean default: ${definition.key}`);
    }
    return;
  }
  if (control === "select") {
    if (
      typeof value.default !== "string" ||
      !Array.isArray(value.options) ||
      !value.options.length
    ) {
      throw new TypeError(`Select setting needs a default and options: ${definition.key}`);
    }
    const seen = new Set<string>();
    for (const option of value.options) {
      if (
        !option ||
        typeof option !== "object" ||
        typeof (option as { value?: unknown }).value !== "string" ||
        !(option as { value: string }).value ||
        seen.has((option as { value: string }).value)
      ) {
        throw new TypeError(`Select setting has an invalid option: ${definition.key}`);
      }
      seen.add((option as { value: string }).value);
    }
    if (!seen.has(value.default)) {
      throw new RangeError(`Select setting default is not an option: ${definition.key}`);
    }
    return;
  }
  if (control === "color") {
    if (
      typeof value.default !== "string" ||
      !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value.default)
    ) {
      throw new TypeError(`Colour setting needs a 3, 6, or 8 digit hex default: ${definition.key}`);
    }
    return;
  }
  if (control === "action") {
    const action = value.action as
      | { kind?: unknown; target?: unknown; actionId?: unknown; url?: unknown; icon?: unknown }
      | undefined;
    if (!action) {
      throw new TypeError(`Action setting needs a target: ${definition.key}`);
    }
    if (action.kind === "open-url") {
      if (typeof action.url !== "string") {
        throw new TypeError(`Open-url setting needs a URL: ${definition.key}`);
      }
      let protocol: string;
      try {
        protocol = new URL(action.url).protocol;
      } catch {
        protocol = "";
      }
      if (protocol !== "https:") {
        throw new TypeError(`Open-url setting must use HTTPS: ${definition.key}`);
      }
      if (action.icon !== undefined) {
        assertSafeIdentifier(action.icon, "Setting action icon");
      }
      return;
    }
    if (action.kind !== "navigate" && action.kind !== "action") {
      throw new TypeError(
        `Action setting needs a navigate, action or URL target: ${definition.key}`,
      );
    }
    const target = action.kind === "navigate" ? action.target : action.actionId;
    assertSafeIdentifier(target, "Setting action target");
    return;
  }
  if (control === "file") {
    if (value.default !== undefined && typeof value.default !== "string") {
      throw new TypeError(`File setting default must be a string: ${definition.key}`);
    }
    return;
  }
  if (control === "text" || control === "custom" || control === "beat") {
    if (value.default !== undefined && typeof value.default !== "string") {
      throw new TypeError(`Text setting default must be a string: ${definition.key}`);
    }
    return;
  }
  throw new TypeError(`Unknown setting control: ${String(control)}`);
}

/**
 * The rule a definition's control imposes on its value.
 *
 * It rides on the value rather than on a setter, so a write from anywhere — a
 * settings page, a keyboard shortcut, the editor publishing what it loaded — is
 * held to it and a stored value no longer readable is not adopted at all.
 */
function ruleFor(definition: SettingDefinition): ((value: unknown) => void) | undefined {
  if (definition.control === "toggle") {
    return (value) => {
      if (value !== undefined && typeof value !== "boolean") {
        throw new TypeError(`Setting must be true or false: ${definition.key}`);
      }
    };
  }
  if (definition.control === "range" || definition.control === "number") {
    return (value) => {
      if (value === undefined) {
        return;
      }
      const text = String(value);
      const numeric = Number(text);
      if (
        !text.trim() ||
        !Number.isFinite(numeric) ||
        (definition.integer && !Number.isInteger(numeric)) ||
        (definition.min !== undefined && numeric < definition.min) ||
        (definition.max !== undefined && numeric > definition.max)
      ) {
        throw new RangeError(`Setting value is out of range: ${definition.key}`);
      }
    };
  }
  if (definition.control === "select" && definition.options?.length) {
    return (value) => {
      if (
        value !== undefined &&
        !definition.options?.some((option) => option.value === String(value))
      ) {
        throw new TypeError(`Setting value is not an available option: ${definition.key}`);
      }
    };
  }
  if (definition.control === "color") {
    return (value) => {
      if (
        value !== undefined &&
        (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
      ) {
        throw new TypeError(`Setting value is not a hexadecimal colour: ${definition.key}`);
      }
    };
  }
  return undefined;
}

/**
 * Declare one persisted value in the settings section.
 *
 * Two kinds of key end up in that section: one a feature contributes a control
 * for — where the control's rule comes along — and one it does not, where a
 * runtime owner keeps the only default there is. The declaration is the same
 * either way, so both come through here and a key's value exists before the first
 * read of it. An already declared value keeps its initial value and validator:
 * this call returns without replacing it, so a module closer to the value wins.
 * A duplicate setting registration never reaches this point because
 * `SettingsRegistry.registerSetting` rejects an id that is already registered.
 *
 * `legacyKey` names the key this value was stored under before its owner
 * namespace existed. The value core adopts it once when the current key has no
 * stored value and then drops it. A legacy key that is already a declared value
 * id belongs to someone else and is never consumed.
 *
 * A boolean initial makes the value a boolean: only booleans pass validation.
 */
export function declarePersistedValue(
  key: string,
  initial: string | number | boolean | undefined,
  validate?: (value: unknown) => void,
  owner?: string,
  legacyKey?: string,
): void {
  if (values.byId.has(key)) {
    return;
  }
  const boolean = typeof initial === "boolean";
  defineValue(
    {
      id: key,
      initial,
      persist: PREFERENCE_SECTIONS.settings,
      ...(legacyKey !== undefined && legacyKey !== key && !values.byId.has(legacyKey)
        ? { legacyStorageKey: legacyKey }
        : {}),
      validate:
        validate ??
        (boolean
          ? (value) => {
              if (value !== undefined && typeof value !== "boolean") {
                throw new TypeError(`Value must be true or false: ${key}`);
              }
            }
          : undefined),
    },
    owner,
  );
}

/**
 * Declare a setting's value.
 *
 * The default is where the value starts, which is why a setting the user never
 * touched leaves no entry in the file: only a value away from its default is
 * written down. `legacyKey` is the pre-namespace key an owner registration
 * offers for one-time adoption.
 */
function declareSetting(definition: SettingDefinition, owner?: string, legacyKey?: string): void {
  // Action rows invoke an action, not a preference. They still need a runtime-only
  // value cell because the shared field renderer observes every definition.
  if (definition.control === "action") {
    if (!values.byId.has(definition.key)) {
      defineValue<string | undefined>(
        {
          id: definition.key,
          initial: undefined,
        },
        owner,
      );
    }
    return;
  }
  declarePersistedValue(
    definition.key,
    definition.control === "toggle"
      ? definition.default
      : definition.default === undefined
        ? undefined
        : String(definition.default),
    ruleFor(definition),
    owner,
    legacyKey,
  );
}
