/**
 * Public facade for declarative chart persistence rules.
 *
 * The editor's save and export paths use the process-wide registry directly;
 * this file provides the capability-gated API view and keeps Extension-owned
 * ids isolated from one another.
 */
import { extensionActionId } from "../extensions/capabilities.ts";
import {
  persistenceRules,
  type PersistenceOutput,
  type PersistenceRuleDefinition,
} from "../global/chart/persistence.ts";
import type { Chart } from "../global/chart/chart.ts";

/** Create a persistence facade for the host or one Extension owner. */
export function createPersistenceApi(owner?: string) {
  const idFor = (id: string): string => (owner ? extensionActionId(owner, id) : id);
  return Object.freeze({
    /** List the host rules, or only this Extension's rules. */
    list: () => persistenceRules.list(owner),
    /** Register one declarative field projection. */
    register: (definition: PersistenceRuleDefinition) =>
      persistenceRules.register({ ...definition, id: idFor(definition.id) }, owner),
    /** Remove one rule owned by this facade. */
    unregister: (id: string) => persistenceRules.unregister(idFor(id), owner),
    /** Enable one rule owned by this facade. */
    enable: (id: string) => persistenceRules.setEnabled(idFor(id), true, owner),
    /** Disable one rule owned by this facade. */
    disable: (id: string) => persistenceRules.setEnabled(idFor(id), false, owner),
    /** Inspect warnings that would be emitted at the selected output boundary. */
    inspect: (chart: Chart, output: PersistenceOutput = "export") =>
      persistenceRules.inspect(chart, output, owner),
    /** Project a detached chart copy for a caller that needs to preview output. */
    project: (chart: Chart, output: PersistenceOutput = "save") =>
      persistenceRules.project(chart, output, owner),
  });
}

/** Complete host facade used by development and automation. */
export const persistence = createPersistenceApi();

export type {
  PersistenceJson,
  PersistenceMatch,
  PersistenceObjectKind,
  PersistenceOutput,
  PersistenceProjection,
  PersistenceRuleDefinition,
  PersistenceRuleStatus,
  PersistenceWarning,
} from "../global/chart/persistence.ts";
