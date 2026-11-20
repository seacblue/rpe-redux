/**
 * Reads one declared value as a settings control sees it.
 *
 * The value keeps the type it was declared with, so a toggle reads a boolean
 * and a numeric row reads its stored text. The subscription is memoised per key
 * because `useSyncExternalStore` compares identities on every render.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { values } from "../../../core/state/values.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";

/**
 * One committed value, as a control reads it.
 *
 * The key has to be declared — a registration declares a setting, an owning module
 * declares every other value — so this is a plain read of that value rather than a
 * lookup that has to invent a missing one.
 *
 * The subscription is built once per key: `useSyncExternalStore` compares the
 * `subscribe` and `snapshot` identities on every render, so a fresh closure each
 * time would unsubscribe and resubscribe the store continuously.
 */
export function useSetting<T>(key: string, fallback: T): T {
  const subscribe = useCallback(
    (listener: () => void) =>
      values.byId.has(key) ? values.byId.subscribe(key, listener) : () => {},
    [key],
  );
  const snapshot = useCallback(
    () => (values.byId.has(key) ? (values.byId.get<T | undefined>(key) ?? fallback) : fallback),
    [key, fallback],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether the user explicitly committed one setting.
 *
 * This is provenance, not a value comparison: a user who edited a value and
 * returned it to its default stays modified until the row's reset runs.
 */
export function useSettingModified(key: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) =>
      values.byId.has(key) ? values.byId.subscribeModified(key, listener) : () => {},
    [key],
  );
  const snapshot = useCallback(() => values.byId.has(key) && values.byId.isModified(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether an optional dependency condition currently matches.
 *
 * `undefined` means the row has no condition; an undeclared dependency key is
 * treated as no match so a malformed contribution cannot bypass a gate.
 */
export function useSettingMatch(
  condition: { key: string; equals?: SettingValue } | undefined,
): boolean {
  const key = condition?.key ?? "";
  const subscribe = useCallback(
    (listener: () => void) =>
      key && values.byId.has(key) ? values.byId.subscribe(key, listener) : () => {},
    [key],
  );
  const snapshot = useCallback(
    () => (key && values.byId.has(key) ? values.byId.get(key) : ""),
    [key],
  );
  useSyncExternalStore(subscribe, snapshot, snapshot);
  if (condition === undefined) {
    return false;
  }
  return (
    values.byId.has(condition.key) && values.byId.get(condition.key) === (condition.equals ?? true)
  );
}

/**
 * A visibility predicate driven by `visibleWhen` declarations.
 *
 * The settings window subscribes once to the union of dependency keys so every
 * row can ask whether it should be shown. Built-in rows use `enabledWhen` and
 * stay visible; the hide path remains available for contributions that need it.
 */
export function useSettingVisibility(
  fields: readonly SettingDefinition[],
): (field: SettingDefinition) => boolean {
  const signature = useMemo(() => {
    const keys = new Set<string>();
    for (const field of fields) {
      if (field.visibleWhen) {
        keys.add(field.visibleWhen.key);
      }
    }
    return [...keys].sort().join("\u0000");
  }, [fields]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = signature
        .split("\u0000")
        .filter((key) => key && values.byId.has(key))
        .map((key) => values.byId.subscribe(key, listener));
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
    [signature],
  );
  const snapshot = useCallback(
    () =>
      signature
        .split("\u0000")
        .filter((key) => key && values.byId.has(key))
        .map((key) => String(values.byId.get(key)))
        .join("\u0000"),
    [signature],
  );
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return useCallback((field: SettingDefinition) => {
    const condition = field.visibleWhen;
    if (condition === undefined) {
      return true;
    }
    return (
      values.byId.has(condition.key) &&
      values.byId.get(condition.key) === (condition.equals ?? true)
    );
  }, []);
}
