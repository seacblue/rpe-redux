/**
 * Owns the detached recipe-plan lifecycle exposed to packages.
 *
 * A plan is a host-side `StepsPlan` produced by the same planner that runs a
 * declarative script. The package receives counts and ids, never the detached
 * chart. Plans are owner-scoped and applying one consumes it once.
 */
import { chartFingerprint } from "../edit/document/chartRevision.ts";
import { getSelectionSession } from "../edit/selection/api.ts";
import { applySteps, planSteps, type ExtensionScriptStep } from "../extensions/steps.ts";
import { cancelRecipePlan, storeRecipePlan, takeRecipePlan } from "../extensions/recipePlans.ts";
import type { ParamValue } from "../extensions/scriptUi.ts";
import type { Chart } from "../global/chart/chart.ts";
import type { ChartObjectId } from "../global/chart/identity.ts";
import type { TransactionIssue } from "../edit/transaction/contract.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import { availabilityFor, unavailableResult } from "./support.ts";

/** One parameter map accepted by a declarative step plan. */
export type RecipeParameterValues = Readonly<Record<string, ParamValue>>;

/** A request to plan, but not commit, one declarative recipe. */
export interface RecipePlanRequest {
  readonly steps: readonly ExtensionScriptStep[];
  readonly params?: RecipeParameterValues;
  /** Reject when the chart no longer matches this revision. */
  readonly chartFingerprint?: string | null;
  readonly label?: string;
}

/** The bridge-safe summary of one detached recipe plan. */
export interface RecipePlanSummary {
  readonly planId: string | null;
  readonly status: "planned" | "unchanged" | "rejected";
  readonly affectedObjectIds: readonly ChartObjectId[];
  readonly changedObjectIds: readonly ChartObjectId[];
  readonly issues: readonly TransactionIssue[];
  readonly counts: { readonly lines: number; readonly notes: number; readonly events: number };
}

/** The result of committing a previously planned recipe. */
export interface RecipeApplyResult {
  readonly status: "committed" | "unchanged";
  readonly affectedObjectIds: readonly ChartObjectId[];
}

/** Count objects without exposing the detached chart. */
function countChart(chart: Chart): RecipePlanSummary["counts"] {
  let notes = 0;
  let events = 0;
  for (const line of chart.judgeLineList ?? []) {
    notes += line.notes?.length ?? 0;
    for (const layer of [...(line.eventLayers ?? []), line.extended]) {
      if (!layer) {
        continue;
      }
      for (const value of Object.values(layer)) {
        if (Array.isArray(value)) {
          events += value.length;
        }
      }
    }
  }
  return {
    lines: chart.judgeLineList?.length ?? 0,
    notes,
    events,
  };
}

/** Validate the bridge-facing request shape without trusting caller data. */
function validRequest(value: unknown): value is RecipePlanRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const request = value as Record<string, unknown>;
  if (!Array.isArray(request.steps) || request.steps.length === 0) {
    return false;
  }
  if (
    request.params !== undefined &&
    (!request.params || typeof request.params !== "object" || Array.isArray(request.params))
  ) {
    return false;
  }
  if (
    request.chartFingerprint !== undefined &&
    request.chartFingerprint !== null &&
    typeof request.chartFingerprint !== "string"
  ) {
    return false;
  }
  return request.label === undefined || typeof request.label === "string";
}

/** Plan one declarative recipe against the mounted session without committing. */
function planRecipe(owner: string, request: unknown): ApiResult<RecipePlanSummary> {
  if (!validRequest(request)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Invalid recipe plan request" },
    };
  }
  const session = getSelectionSession();
  if (!session) {
    return unavailableResult("No editor recipe runtime connected");
  }
  if (
    typeof request.chartFingerprint === "string" &&
    request.chartFingerprint !== chartFingerprint(session.chart)
  ) {
    return {
      ok: false,
      error: { code: "stale_read", message: "The chart changed before the recipe was planned" },
    };
  }
  const planned = planSteps(session, request.steps, request.params ?? {});
  if (!planned.ok) {
    return {
      ok: true,
      value: {
        planId: null,
        status: "rejected",
        affectedObjectIds: [],
        changedObjectIds: [],
        issues: planned.issues ?? [],
        counts: countChart(session.chart),
      },
    };
  }
  const label = request.label?.trim() || "Recipe";
  const planId = storeRecipePlan(owner, planned.plan, label, request.params ?? {});
  return {
    ok: true,
    value: {
      planId,
      status:
        planned.plan.afterFingerprint === planned.plan.beforeFingerprint ? "unchanged" : "planned",
      affectedObjectIds: planned.plan.affectedObjectIds,
      changedObjectIds: planned.plan.changedObjectIds,
      issues: [],
      counts: countChart(planned.plan.chart),
    },
  };
}

/** Commit one stored plan exactly once, only for its owner. */
function applyRecipe(owner: string, planId: string): ApiResult<RecipeApplyResult> {
  if (typeof planId !== "string" || !planId) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A recipe plan id is required" },
    };
  }
  const entry = takeRecipePlan(owner, planId);
  if (!entry) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Recipe plan is not available" },
    };
  }
  const session = getSelectionSession();
  if (!session) {
    return unavailableResult("No editor recipe runtime connected");
  }
  const applied = applySteps(session, entry.plan, entry.label, {
    recipe: {
      id: entry.id,
      name: entry.label,
      version: 1,
      params: entry.params,
    },
  });
  if (applied.status === "rejected") {
    return { ok: false, error: { code: "rejected", message: applied.reason } };
  }
  return {
    ok: true,
    value: {
      status: applied.status,
      affectedObjectIds: entry.plan.affectedObjectIds,
    },
  };
}

/** Discard one stored plan without committing it. */
function cancelRecipe(owner: string, planId: string): ApiResult<boolean> {
  if (typeof planId !== "string" || !planId) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A recipe plan id is required" },
    };
  }
  return { ok: true, value: cancelRecipePlan(owner, planId) };
}

/** Detached recipe planning exposed to packages. */
export interface RecipeHandle {
  availability(): ApiAvailability;
  plan(request: RecipePlanRequest): ApiResult<RecipePlanSummary>;
  apply(planId: string): ApiResult<RecipeApplyResult>;
  cancel(planId: string): ApiResult<boolean>;
}

/** Build a recipe handle whose plans belong to one owner. */
export function createRecipeHandle(owner: string): RecipeHandle {
  return Object.freeze({
    /** Report whether an editor session can plan a recipe. */
    availability(): ApiAvailability {
      return availabilityFor(getSelectionSession(), "No editor recipe runtime connected");
    },
    /** Plan a recipe without writing history; the result carries a short-lived plan id. */
    plan: (request: RecipePlanRequest): ApiResult<RecipePlanSummary> => planRecipe(owner, request),
    /** Commit a planned recipe once. */
    apply: (planId: string): ApiResult<RecipeApplyResult> => applyRecipe(owner, planId),
    /** Discard a planned recipe without committing it. */
    cancel: (planId: string): ApiResult<boolean> => cancelRecipe(owner, planId),
  });
}

/** Host/Code Cell recipe handle. Package handles are created by the capability gate. */
export const recipe = createRecipeHandle("host");
