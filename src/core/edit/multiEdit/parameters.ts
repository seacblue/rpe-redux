/**
 * The batch parameter set, its defaults and its persisted form.
 *
 * Parameter sets are decoded defensively because they come from storage and
 * panel state. The stored history limit falls back to the documented default
 * when its settings value is unavailable.
 */
import { t } from "../../../i18n/index.ts";
import { values } from "../../state/values.ts";

/** How many applied parameter sets the panel keeps, newest last. */
export const MULTI_EDIT_HISTORY_LIMIT_KEY = "multi-edit-history-limit";
const DEFAULT_HISTORY_LIMIT = 100;

/** Reads the history limit, falling back when the setting is unregistered or invalid. */
function historyLimit(): number {
  // A unit test, extension host, or early panel may not have registered the
  // setting, so an unknown id uses the documented default.
  const stored = values.byId.has(MULTI_EDIT_HISTORY_LIMIT_KEY)
    ? Number(values.byId.get<number>(MULTI_EDIT_HISTORY_LIMIT_KEY))
    : Number.NaN;
  return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_HISTORY_LIMIT;
}

const storageKey = "multi-edit-v1";
const kinds: readonly MultiEditKind[] = ["notes", "events"];

/** True for an integer easing id in the supported 1-29 range. */
const isEasingType = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 29;

/** True for an unsigned 32-bit integer seed. */
const isSeed = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Which object kind a batch parameter set applies to. */
export type MultiEditKind = "notes" | "events";

/**
 * A batch parameter set for the original (form) batch editing the panel offers.
 *
 * The panel has one editing mode, so this is the whole vocabulary it can
 * express. The type is schema-driven through `defaultBatchParameters`, which is
 * why the decoded copy can cast back to it in one place.
 */
export type BatchParameters = {
  field: string;
  operation: string;
  lower: string;
  upper: string;
  easingType: number;
  cycle: string;
  disturbance: string;
  seed: number;
};

/**
 * Draft storage has a `getItem`/`setItem` shape so the editor can hand in the
 * durable preference store and tests can hand in a map. The default is an
 * in-memory cell, keeping this layer free of any storage technology.
 */
export interface DraftStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: unknown): void;
}

/** In-memory draft storage used when no durable store is supplied. */
const memoryStorage = (): DraftStorage => {
  const cells = new Map<string, unknown>();
  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => cells.set(key, value),
  };
};

/** Returns the default parameter set for one object kind. */
export function defaultBatchParameters(kind: MultiEditKind): BatchParameters {
  return {
    field: kind === "notes" ? "x" : "both",
    operation: "By",
    lower: "0",
    upper: "0",
    easingType: 1,
    cycle: "1",
    disturbance: "0",
    seed: 1,
  };
}

/**
 * Decode stored data into the current parameter shape.
 *
 * Only known keys with valid types are copied, so unsupported or malformed
 * fields cannot reach the planner.
 */
function parameters(kind: MultiEditKind, value: unknown): BatchParameters {
  const defaults = defaultBatchParameters(kind);
  const result: Record<string, unknown> = { ...defaults };
  if (!value || typeof value !== "object") {
    return result as BatchParameters;
  }
  const stored = value as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    if (key === "easingType") {
      if (isEasingType(stored[key])) {
        result.easingType = stored[key];
      }
    } else if (key === "seed") {
      if (isSeed(stored[key])) {
        result.seed = stored[key];
      }
    } else if (typeof stored[key] === "string" || typeof stored[key] === "number") {
      result[key] = stored[key];
    }
  }
  return result as BatchParameters;
}

/**
 * Whether a stored entry came from the form editing mode.
 *
 * Entries from other modes describe edits this panel cannot reproduce, so the
 * loader keeps only form entries.
 */
function isFormMode(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return true;
  }
  const mode = (value as Record<string, unknown>).mode;
  return mode === undefined || mode === "form";
}

/** Loads, validates, and persists batch-edit drafts and their applied history. */
export class MultiEditParameters {
  storage: DraftStorage;
  onError: (message: string) => void;
  drafts: Record<MultiEditKind, BatchParameters>;
  history: Record<MultiEditKind, BatchParameters[]>;

  /** Restores drafts and history from `storage`, reporting errors through `onError`. */
  constructor(
    storage: DraftStorage = memoryStorage(),
    onError: (message: string) => void = () => {},
  ) {
    this.storage = storage;
    this.onError = onError;
    this.drafts = {
      notes: defaultBatchParameters("notes"),
      events: defaultBatchParameters("events"),
    };
    this.history = { notes: [], events: [] };
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(String(storage?.getItem(storageKey) ?? "{}"));
    } catch {
      stored = {};
    }
    if (!stored || typeof stored !== "object") {
      stored = {};
    }
    const section = (name: string): Record<string, unknown> | undefined => {
      const found = stored[name];
      return found && typeof found === "object" ? (found as Record<string, unknown>) : undefined;
    };
    for (const kind of kinds) {
      const draft = section("drafts")?.[kind];
      this.drafts[kind] = isFormMode(draft)
        ? parameters(kind, draft)
        : defaultBatchParameters(kind);
      const history = section("history")?.[kind];
      this.history[kind] = Array.isArray(history)
        ? history
            .filter((value) => isFormMode(value))
            .slice(-historyLimit())
            .map((value) => parameters(kind, value))
        : [];
    }
  }

  /** Writes the current drafts and history; reports storage failures. */
  persist(): void {
    try {
      this.storage?.setItem(
        storageKey,
        JSON.stringify({ drafts: this.drafts, history: this.history }),
      );
    } catch {
      this.onError(t("editor.commands.multiEditParameters.error.storage"));
    }
  }
  /** Returns a copy of the draft for one object kind. */
  read(kind: MultiEditKind): BatchParameters {
    return structuredClone(this.drafts[kind]);
  }
  /** Replaces the draft for one object kind and persists it. */
  update(kind: MultiEditKind, value: unknown): void {
    this.drafts[kind] = parameters(kind, value);
    this.persist();
  }
  /** Append an applied set, newest last; a repeat of an old one is promoted, not duplicated. */
  remember(kind: MultiEditKind, value: unknown): number {
    const next = parameters(kind, value);
    const signature = JSON.stringify(next);
    this.history[kind] = this.history[kind].filter((entry) => JSON.stringify(entry) !== signature);
    this.history[kind].push(next);
    this.history[kind] = this.history[kind].slice(-historyLimit());
    this.persist();
    return this.history[kind].length - 1;
  }
}
