/**
 * Owner-scoped detached recipe plans.
 *
 * Plans never cross the sandbox bridge. Keeping the store here, rather than in
 * the API facade, lets the runtime clear one owner's plans during teardown and
 * prevents one package from consuming another package's plan by id.
 */
import type { ParamValue } from "./scriptUi.ts";
import type { StepsPlan } from "./steps.ts";

export interface StoredRecipePlan {
  readonly id: string;
  readonly owner: string;
  readonly label: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly plan: StepsPlan;
  readonly createdAt: number;
}

const MAX_PLANS = 16;
const PLAN_TTL_MS = 5 * 60_000;
const plans = new Map<string, StoredRecipePlan>();
let sequence = 0;

/** Drop expired and excess plans; the map stays bounded for long sessions. */
function prunePlans(now = Date.now()): void {
  for (const [id, entry] of plans) {
    if (now - entry.createdAt > PLAN_TTL_MS) {
      plans.delete(id);
    }
  }
  while (plans.size > MAX_PLANS) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    plans.delete(oldest);
  }
}

/** Store one plan under the owner that created it and return its plan id. */
export function storeRecipePlan(
  owner: string,
  plan: StepsPlan,
  label: string,
  params: Readonly<Record<string, ParamValue>>,
): string {
  prunePlans();
  sequence += 1;
  const id = `recipe-plan-${Date.now().toString(36)}-${sequence.toString(36)}`;
  plans.set(id, {
    id,
    owner,
    label,
    params: Object.freeze({ ...params }),
    plan,
    createdAt: Date.now(),
  });
  return id;
}

/** Remove and return one plan only when its owner matches. */
export function takeRecipePlan(owner: string, id: string): StoredRecipePlan | undefined {
  const entry = plans.get(id);
  if (!entry || entry.owner !== owner) {
    return undefined;
  }
  plans.delete(id);
  return Date.now() - entry.createdAt > PLAN_TTL_MS ? undefined : entry;
}

/** Remove one plan only when its owner matches. */
export function cancelRecipePlan(owner: string, id: string): boolean {
  const entry = plans.get(id);
  if (!entry || entry.owner !== owner) {
    return false;
  }
  plans.delete(id);
  return true;
}

/** Drop every plan for one owner, or every plan when no owner is supplied. */
export function clearRecipePlans(owner?: string): void {
  if (owner === undefined) {
    plans.clear();
    return;
  }
  for (const [id, entry] of plans) {
    if (entry.owner === owner) {
      plans.delete(id);
    }
  }
}
