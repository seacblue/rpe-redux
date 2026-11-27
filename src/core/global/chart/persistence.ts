/**
 * Owns declarative, Extension-scoped chart projections used for persistence.
 *
 * A projection never mutates the live editor chart. It copies the chart, walks
 * the JSON-shaped chart objects, and applies enabled field rules to the copy
 * that is about to be written. Keeping the rule language declarative lets the
 * same projection run in the save, recovery, and export paths without loading
 * package code inside a serializer worker.
 */
import type { Chart } from "./chart.ts";
import { workspaceShaderPasses } from "./shader/workspacePasses.ts";

/** JSON values accepted by a persistence rule. */
export type PersistenceJson =
  | string
  | number
  | boolean
  | null
  | readonly PersistenceJson[]
  | { readonly [key: string]: PersistenceJson };

/** Chart object categories that a rule can match. */
export type PersistenceObjectKind =
  "any" | "chart" | "meta" | "judgeLine" | "note" | "event" | "object";

/** Where a projected chart is going to be written. */
export type PersistenceOutput = "save" | "recovery" | "export";

/** One field equality constraint used to select chart objects. */
export type PersistenceMatch = Readonly<Record<string, PersistenceJson>>;

/** User-visible warning emitted when a rule participates in an export. */
export interface PersistenceWarning {
  readonly code: string;
  readonly message: string;
  readonly ruleId: string;
}

/** A declarative field projection registered by an Extension. */
export interface PersistenceRuleDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: PersistenceObjectKind;
  readonly match?: PersistenceMatch;
  /** Fields are assigned after matching; values are copied before insertion. */
  readonly set?: Readonly<Record<string, PersistenceJson>>;
  /** Direct fields removed after matching. */
  readonly remove?: readonly string[];
  readonly enabled?: boolean;
  readonly priority?: number;
  /** A warning is emitted once per rule when an export uses this rule. */
  readonly warning?: {
    readonly code: string;
    readonly message: string;
  };
}

/** Public status for one registered persistence rule. */
export interface PersistenceRuleStatus {
  readonly id: string;
  readonly label: string;
  readonly owner?: string;
  readonly kind: PersistenceObjectKind;
  readonly enabled: boolean;
  readonly priority: number;
}

/** Result of projecting a chart copy for a persistence boundary. */
export interface PersistenceProjection {
  readonly chart: Chart;
  readonly appliedRuleIds: readonly string[];
  readonly warnings: readonly PersistenceWarning[];
}

interface StoredRule {
  readonly definition: PersistenceRuleDefinition;
  readonly owner?: string;
  readonly sequence: number;
  enabled: boolean;
}

const RULE_ID = /^[a-z][a-z0-9._-]{1,127}$/u;
const WARNING_CODE = /^[a-z][a-z0-9._-]{1,127}$/u;

/** Whether a value is a plain record that can safely be projected. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  );
}

/** Compare JSON values without allowing object identity to affect matching. */
function sameJson(left: unknown, right: PersistenceJson): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/** Validate a JSON value without accepting functions, cycles, or host objects. */
function isJson(value: unknown, ancestors: Set<object> = new Set()): value is PersistenceJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (!value || typeof value !== "object" || ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? value.every((entry) => isJson(entry, ancestors))
      : isRecord(value) && Object.values(value).every((entry) => isJson(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** Validate one rule before it becomes part of the persistence contract. */
function validateRule(definition: PersistenceRuleDefinition): void {
  if (!RULE_ID.test(definition.id.trim())) {
    throw new Error(`Persistence rule id is invalid: ${definition.id}`);
  }
  if (!definition.label.trim()) {
    throw new Error("Persistence rule label must not be empty");
  }
  if (!definition.kind) {
    throw new Error("Persistence rule kind is required");
  }
  if (definition.priority !== undefined && !Number.isFinite(definition.priority)) {
    throw new Error(`Persistence rule priority is invalid: ${definition.id}`);
  }
  if (definition.set) {
    for (const [field, value] of Object.entries(definition.set)) {
      if (!field.trim() || !isJson(value)) {
        throw new Error(`Persistence rule field is invalid: ${definition.id}.${field}`);
      }
    }
  }
  if (definition.remove?.some((field) => !field.trim())) {
    throw new Error(`Persistence rule remove field is invalid: ${definition.id}`);
  }
  if (definition.match && !isJson(definition.match)) {
    throw new Error(`Persistence rule match is invalid: ${definition.id}`);
  }
  if (definition.warning) {
    if (!WARNING_CODE.test(definition.warning.code.trim())) {
      throw new Error(`Persistence warning code is invalid: ${definition.id}`);
    }
    if (!definition.warning.message.trim()) {
      throw new Error(`Persistence warning message is empty: ${definition.id}`);
    }
  }
}

/** Registry and projection engine for persistent Extension contributions. */
export class PersistenceRuleRegistry {
  private readonly rules = new Map<string, StoredRule>();
  private nextSequence = 0;

  /** Register or replace one owner-scoped rule. */
  register(definition: PersistenceRuleDefinition, owner?: string): PersistenceRuleStatus {
    const normalized = { ...definition, id: definition.id.trim() };
    validateRule(normalized);
    const previous = this.rules.get(normalized.id);
    if (previous && previous.owner !== owner) {
      throw new Error(`Persistence rule is owned by another Extension: ${normalized.id}`);
    }
    const stored: StoredRule = {
      definition: Object.freeze({
        ...normalized,
        ...(normalized.match ? { match: Object.freeze({ ...normalized.match }) } : {}),
        ...(normalized.set ? { set: Object.freeze({ ...normalized.set }) } : {}),
        ...(normalized.remove ? { remove: Object.freeze([...normalized.remove]) } : {}),
      }),
      owner,
      sequence: previous?.sequence ?? this.nextSequence++,
      enabled: normalized.enabled ?? previous?.enabled ?? true,
    };
    this.rules.set(normalized.id, stored);
    return this.status(stored);
  }

  /** Remove one rule, refusing an owner from another Extension. */
  unregister(id: string, owner?: string): boolean {
    const stored = this.rules.get(id);
    if (!stored) {
      return false;
    }
    if (owner !== undefined && stored.owner !== owner) {
      throw new Error(`Persistence rule is owned by another Extension: ${id}`);
    }
    return this.rules.delete(id);
  }

  /** Remove every rule owned by one Extension during deactivation. */
  removeOwner(owner: string): number {
    let removed = 0;
    for (const [id, rule] of this.rules) {
      if (rule.owner === owner) {
        this.rules.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Enable or disable one rule without changing its definition. */
  setEnabled(id: string, enabled: boolean, owner?: string): PersistenceRuleStatus {
    const stored = this.requireOwned(id, owner);
    stored.enabled = enabled;
    return this.status(stored);
  }

  /** List rules in deterministic priority order. */
  list(owner?: string): readonly PersistenceRuleStatus[] {
    return Object.freeze(
      [...this.rules.values()]
        .filter((rule) => owner === undefined || rule.owner === owner)
        .sort(
          (left, right) =>
            (right.definition.priority ?? 0) - (left.definition.priority ?? 0) ||
            left.sequence - right.sequence,
        )
        .map((rule) => this.status(rule)),
    );
  }

  /** Whether a caller must use the materialized, non-streaming persistence path. */
  hasEnabled(): boolean {
    return [...this.rules.values()].some((rule) => rule.enabled);
  }

  /** Project a detached chart copy and collect export warnings. */
  project(chart: Chart, output: PersistenceOutput, owner?: string): PersistenceProjection {
    const cloned = structuredClone(chart) as Chart;
    const active = [...this.rules.values()]
      .filter((rule) => rule.enabled && (owner === undefined || rule.owner === owner))
      .sort(
        (left, right) =>
          (right.definition.priority ?? 0) - (left.definition.priority ?? 0) ||
          left.sequence - right.sequence,
      );
    const applied = new Set<string>();
    const warnings = new Map<string, PersistenceWarning>();
    const visit = (value: unknown, kind: PersistenceObjectKind): void => {
      if (!isRecord(value)) {
        return;
      }
      for (const stored of active) {
        const definition = stored.definition;
        if (definition.kind !== "any" && definition.kind !== kind && definition.kind !== "object") {
          continue;
        }
        if (
          definition.match &&
          Object.entries(definition.match).some(
            ([field, expected]) => !sameJson(value[field], expected),
          )
        ) {
          continue;
        }
        for (const [field, next] of Object.entries(definition.set ?? {})) {
          value[field] = structuredClone(next);
        }
        for (const field of definition.remove ?? []) {
          delete value[field];
        }
        applied.add(definition.id);
        if (output === "export" && definition.warning) {
          warnings.set(definition.id, {
            code: definition.warning.code,
            message: definition.warning.message,
            ruleId: definition.id,
          });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === "META") {
          visit(child, "meta");
          continue;
        }
        if (key === "judgeLineList" && Array.isArray(child)) {
          child.forEach((line) => visit(line, "judgeLine"));
          continue;
        }
        if (Array.isArray(child)) {
          const childKind: PersistenceObjectKind = /(?:Events|effects|shaderEvents)$/u.test(key)
            ? "event"
            : key === "notes"
              ? "note"
              : "object";
          child.forEach((entry) => visit(entry, childKind));
          continue;
        }
        visit(child, "object");
      }
    };
    visit(cloned, "chart");
    return {
      chart: cloned,
      appliedRuleIds: Object.freeze([...applied]),
      warnings: Object.freeze([...warnings.values()]),
    };
  }

  /** Return matching export warnings without exposing the projected copy. */
  inspect(chart: Chart, output: PersistenceOutput, owner?: string): readonly PersistenceWarning[] {
    return this.project(chart, output, owner).warnings;
  }

  private requireOwned(id: string, owner?: string): StoredRule {
    const stored = this.rules.get(id);
    if (!stored) {
      throw new Error(`Persistence rule is not registered: ${id}`);
    }
    if (owner !== undefined && stored.owner !== owner) {
      throw new Error(`Persistence rule is owned by another Extension: ${id}`);
    }
    return stored;
  }

  private status(stored: StoredRule): PersistenceRuleStatus {
    return Object.freeze({
      id: stored.definition.id,
      label: stored.definition.label,
      ...(stored.owner ? { owner: stored.owner } : {}),
      kind: stored.definition.kind,
      enabled: stored.enabled,
      priority: stored.definition.priority ?? 0,
    });
  }
}

/** The process-wide registry used by the public host facade and save paths. */
export const persistenceRules = new PersistenceRuleRegistry();

/** Whether any persistence or workspace shader contribution is enabled. */
export function hasPersistenceContributions(): boolean {
  return persistenceRules.hasEnabled() || workspaceShaderPasses.hasEnabled();
}

/** Apply active persistence rules to a disk-bound chart copy. */
export function prepareChartForPersistence(
  chart: Chart,
  output: PersistenceOutput = "save",
): PersistenceProjection {
  const projection = persistenceRules.hasEnabled()
    ? persistenceRules.project(chart, output)
    : { chart: structuredClone(chart), appliedRuleIds: [], warnings: [] };
  const shaders = workspaceShaderPasses.exportProjection(output === "export" ? "export" : "save");
  if (shaders.metadata.length) {
    projection.chart.META = {
      ...(projection.chart.META ?? {}),
      ReduxWorkspaceShaderPasses: shaders.metadata,
    };
  }
  return {
    chart: projection.chart,
    appliedRuleIds: projection.appliedRuleIds,
    warnings: Object.freeze([
      ...projection.warnings,
      ...shaders.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        ruleId: `shader:${warning.passId}`,
      })),
    ]),
  };
}
