/** Builds the host recipe view from declarative scripts contributed by enabled Extensions. */
import { getSelectionSession } from "../edit/selection/api.ts";
import type { StepsApplyResult, StepsPlanResult, StepsPlan } from "./steps.ts";
import { applySteps, planSteps, type ExtensionScriptStep } from "./steps.ts";
import { scriptRegistry, type ExtensionScriptSnapshot } from "./scripts.ts";
import type { ExtensionParameterSchema, ExtensionParameterValue } from "./parameters.ts";
import { tRaw } from "../../i18n/index.ts";
import { resolveExtensionText, type ExtensionText, type ExtensionTranslations } from "./i18n.ts";
import type { TrustedExtensionManifest } from "./extensionRuntime.ts";
import { appendScriptRun, type ScriptRunStatus } from "./scriptRunHistory.ts";
import { createValue } from "../state/values.ts";

/** One declarative script as the host recipe API sees it. */
export interface RecipeSnapshot {
  readonly id: string;
  readonly key: string;
  readonly owner: string;
  readonly label: ExtensionText;
  readonly description?: ExtensionText;
  readonly parameters?: ExtensionParameterSchema;
  readonly steps: readonly ExtensionScriptStep[];
  readonly translations?: ExtensionTranslations;
  readonly manifest?: TrustedExtensionManifest;
}

const selectedRecipe = createValue<string>({ initial: "" });
const listeners = new Set<() => void>();
let snapshot: readonly RecipeSnapshot[] = Object.freeze([]);

/** Strip the owner qualifier from a registered script id. */
function scriptIdOf(script: ExtensionScriptSnapshot): string {
  const prefix = `${script.owner}:`;
  return script.id.startsWith(prefix) ? script.id.slice(prefix.length) : script.id;
}

/** Convert a declarative script into a recipe; scripts without steps are skipped. */
function recipeFromScript(script: ExtensionScriptSnapshot): RecipeSnapshot | null {
  if (!script.steps) {
    return null;
  }
  const id = scriptIdOf(script);
  return Object.freeze({
    id,
    key: `${script.owner}:${id}`,
    owner: script.owner,
    label: script.label,
    ...(script.description === undefined ? {} : { description: script.description }),
    ...(script.parameters === undefined ? {} : { parameters: script.parameters }),
    steps: script.steps,
    translations: script.manifest.translations,
    manifest: script.manifest,
  });
}

/** Rebuild the recipe list from currently enabled Extension scripts. */
function refreshSnapshot(): void {
  snapshot = Object.freeze(
    scriptRegistry
      .list()
      .flatMap((script) => {
        const recipe = recipeFromScript(script);
        return recipe ? [recipe] : [];
      })
      .sort((left, right) => left.key.localeCompare(right.key)),
  );
  for (const listener of [...listeners]) {
    listener();
  }
}

refreshSnapshot();
scriptRegistry.subscribe(refreshSnapshot);

/** Application-wide recipe list and the currently selected recipe key. */
export const recipeRegistry = {
  /** All recipes contributed by enabled Extensions. */
  list(): readonly RecipeSnapshot[] {
    return snapshot;
  },
  /** Find one recipe by its owner-qualified key. */
  find(key: string): RecipeSnapshot | null {
    return snapshot.find((recipe) => recipe.key === key) ?? null;
  },
  /** Observe recipe-list changes. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The selected recipe key, or an empty string when none is selected. */
  selected(): string {
    return selectedRecipe.get();
  },
  /** Observe selection changes. */
  subscribeSelection(listener: () => void): () => void {
    return selectedRecipe.subscribe(listener);
  },
  /** Select a recipe; null clears the selection. */
  select(key: string | null): void {
    selectedRecipe.set(key ?? "");
  },
};

/** Resolve a recipe label or description for the active language. */
export function recipeText(recipe: RecipeSnapshot, value: ExtensionText | undefined): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string"
    ? tRaw(value)
    : resolveExtensionText(recipe.owner, recipe.translations, value);
}

/** Plan a recipe against the live selection session without mutating it. */
export function planRecipe(
  recipe: RecipeSnapshot,
  params: Readonly<Record<string, ExtensionParameterValue>> = {},
): StepsPlanResult {
  return planSteps(getSelectionSession(), recipe.steps, params);
}

/** Map an apply result to the persisted run status. */
function runStatus(result: StepsApplyResult): ScriptRunStatus {
  return result.status === "committed"
    ? "committed"
    : result.status === "unchanged"
      ? "unchanged"
      : "failed";
}

/** Apply a planned recipe and record the run for recency ranking. */
export function applyRecipe(
  recipe: RecipeSnapshot,
  plan: StepsPlan,
  params: Readonly<Record<string, ExtensionParameterValue>> = {},
): StepsApplyResult {
  const session = getSelectionSession();
  const result: StepsApplyResult = session
    ? applySteps(session, plan, recipeText(recipe, recipe.label), {
        recipe: {
          id: recipe.key,
          name: recipeText(recipe, recipe.label),
          version: Number.parseInt(recipe.manifest?.version ?? "1", 10) || 1,
          params,
        },
      })
    : { status: "rejected", reason: "Editor runtime is unavailable", plan };
  appendScriptRun({
    owner: recipe.owner,
    scriptId: recipe.id,
    params,
    affectedCount: result.plan.affectedObjectIds.length,
    status: runStatus(result),
  });
  return result;
}
