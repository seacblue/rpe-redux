/**
 * The batch parameter set, its defaults and its persisted form.
 *
 * Parameter sets are decoded defensively because they come from storage and
 * panel state. Drafts are durable preferences, while applied history belongs
 * to the open chart and is intentionally kept in memory only.
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
  /** Event batch ordering mode; notes leave this absent. */
  eventApplicationMode?: string;
};

/** The event tracks a clone can offset once per target sequence entry. */
export const CLONE_CHANNELS = [
  "moveXEvents",
  "moveYEvents",
  "rotateEvents",
  "alphaEvents",
  "speedEvents",
  "scaleXEvents",
  "scaleYEvents",
] as const;

/** One channel the clone page can distribute across target lines. */
export type CloneChannelType = (typeof CLONE_CHANNELS)[number];

/** Clone channels whose event track is present in the selected event types. */
export function cloneChannelsFor(eventTypes: readonly string[]): CloneChannelType[] {
  const selected = new Set(eventTypes);
  return CLONE_CHANNELS.filter((type) => selected.has(type));
}

/** One clone channel's distribution parameters. */
export interface CloneChannelParameters {
  lower: string;
  upper: string;
  easingType: number;
  disturbance: string;
  /** Multipliers selected by target index; `_` skips this channel there. */
  cycle: string;
}

/** The event clone page's parameter set. */
export interface CloneParameters {
  /** Discriminates a clone draft from the original form batch parameters. */
  mode: "clone";
  /** Target line expression; repeated lines stay separate copies. */
  targets: string;
  /** Horizontal grid lines added for each target sequence entry. */
  increment: string;
  /** Keep the source events after cloning. */
  retainSource: boolean;
  seed: number;
  channels: Record<CloneChannelType, CloneChannelParameters>;
}

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
    ...(kind === "events" ? { eventApplicationMode: "per-line" } : {}),
  };
}

/** Returns one channel at its neutral clone defaults. */
export function defaultCloneChannelParameters(): CloneChannelParameters {
  return { lower: "0", upper: "0", easingType: 1, disturbance: "0", cycle: "1" };
}

/** Returns the clone page's defaults, with an optional active line as target. */
export function defaultCloneParameters(targets = ""): CloneParameters {
  return {
    mode: "clone",
    targets,
    increment: "0",
    retainSource: false,
    seed: 1,
    channels: {
      moveXEvents: defaultCloneChannelParameters(),
      moveYEvents: defaultCloneChannelParameters(),
      rotateEvents: defaultCloneChannelParameters(),
      alphaEvents: defaultCloneChannelParameters(),
      speedEvents: defaultCloneChannelParameters(),
      scaleXEvents: defaultCloneChannelParameters(),
      scaleYEvents: defaultCloneChannelParameters(),
    },
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

/** Decode one stored clone channel, falling back per field. */
function cloneChannel(value: unknown): CloneChannelParameters {
  const defaults = defaultCloneChannelParameters();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const stored = value as Record<string, unknown>;
  return {
    lower:
      typeof stored.lower === "string" || typeof stored.lower === "number"
        ? String(stored.lower)
        : defaults.lower,
    upper:
      typeof stored.upper === "string" || typeof stored.upper === "number"
        ? String(stored.upper)
        : defaults.upper,
    easingType: isEasingType(stored.easingType) ? stored.easingType : defaults.easingType,
    disturbance:
      typeof stored.disturbance === "string" || typeof stored.disturbance === "number"
        ? String(stored.disturbance)
        : defaults.disturbance,
    cycle:
      typeof stored.cycle === "string" || typeof stored.cycle === "number"
        ? String(stored.cycle)
        : defaults.cycle,
  };
}

/** Decode stored clone data into the current parameter shape. */
function cloneParameters(value: unknown): CloneParameters {
  const defaults = defaultCloneParameters();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const stored = value as Record<string, unknown>;
  const storedChannels =
    stored.channels && typeof stored.channels === "object"
      ? (stored.channels as Record<string, unknown>)
      : {};
  return {
    mode: "clone",
    targets:
      typeof stored.targets === "string" || typeof stored.targets === "number"
        ? String(stored.targets)
        : defaults.targets,
    increment:
      typeof stored.increment === "string" || typeof stored.increment === "number"
        ? String(stored.increment)
        : defaults.increment,
    retainSource:
      typeof stored.retainSource === "boolean" ? stored.retainSource : defaults.retainSource,
    seed: isSeed(stored.seed) ? stored.seed : defaults.seed,
    channels: {
      moveXEvents: cloneChannel(storedChannels.moveXEvents),
      moveYEvents: cloneChannel(storedChannels.moveYEvents),
      rotateEvents: cloneChannel(storedChannels.rotateEvents),
      alphaEvents: cloneChannel(storedChannels.alphaEvents),
      speedEvents: cloneChannel(storedChannels.speedEvents),
      scaleXEvents: cloneChannel(storedChannels.scaleXEvents),
      scaleYEvents: cloneChannel(storedChannels.scaleYEvents),
    },
  };
}

/** Whether a stored draft came from the form editing mode. */
function isFormMode(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return true;
  }
  const mode = (value as Record<string, unknown>).mode;
  return mode === undefined || mode === "form";
}

/** Loads, validates, and persists batch-edit drafts and their chart-local history. */
export class MultiEditParameters {
  storage: DraftStorage;
  onError: (message: string) => void;
  drafts: Record<MultiEditKind, BatchParameters>;
  history: Record<MultiEditKind, BatchParameters[]>;
  cloneDraft: CloneParameters;
  cloneHistory: CloneParameters[];

  /** Restores durable drafts from `storage`, reporting errors through `onError`. */
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
    this.cloneDraft = defaultCloneParameters();
    this.cloneHistory = [];
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
      // History is deliberately not restored from storage: it belongs to the
      // chart session and is cleared whenever a different chart is opened.
      this.history[kind] = [];
    }
    this.cloneDraft = cloneParameters(stored.clone);
  }

  /** Writes durable drafts; applied history is scoped to the open chart. */
  persist(): void {
    try {
      this.storage?.setItem(
        storageKey,
        JSON.stringify({ drafts: this.drafts, clone: this.cloneDraft }),
      );
    } catch {
      this.onError(t("editor.commands.multiEditParameters.error.storage"));
    }
  }
  /** Returns a copy of the draft for one object kind. */
  read(kind: MultiEditKind): BatchParameters {
    return structuredClone(this.drafts[kind]);
  }
  /** Returns a copy of the clone draft, filling an empty target with the active line. */
  readClone(fallbackTargets = ""): CloneParameters {
    const draft = structuredClone(this.cloneDraft);
    if (!draft.targets && fallbackTargets) {
      draft.targets = fallbackTargets;
    }
    return draft;
  }
  /** Replaces the draft for one object kind and persists it. */
  update(kind: MultiEditKind, value: unknown): void {
    this.drafts[kind] = parameters(kind, value);
    this.persist();
  }
  /** Replaces the clone draft and persists it. */
  updateClone(value: unknown): void {
    this.cloneDraft = cloneParameters(value);
    this.persist();
  }
  /** Clears the applied parameter history for the current chart session. */
  clearHistory(): void {
    for (const kind of kinds) {
      this.history[kind] = [];
    }
    this.cloneHistory = [];
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
  /** Append an applied clone set, newest last; exact repeats are promoted. */
  rememberClone(value: unknown): number {
    const next = cloneParameters(value);
    const signature = JSON.stringify(next);
    this.cloneHistory = this.cloneHistory.filter((entry) => JSON.stringify(entry) !== signature);
    this.cloneHistory.push(next);
    this.cloneHistory = this.cloneHistory.slice(-historyLimit());
    this.persist();
    return this.cloneHistory.length - 1;
  }
}
