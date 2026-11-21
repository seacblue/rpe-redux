/**
 * Compile-time check for the code-free recipe path.
 *
 * A recipe can be `parameters` plus `steps`, with no `run` body. The host owns
 * the step planner, so the same data can be recorded, stored, and re-run
 * without shipping arbitrary code. This example composes two batches: a
 * seeded random X offset, then a fade on exactly the notes the first batch
 * changed.
 */
import type { ExtensionScriptDefinition } from "@rpe-redux/extension-sdk";

const recipe: ExtensionScriptDefinition = {
  id: "jitter-x-recipe",
  label: "Jitter and fade X",
  description: "Move the selected notes by a seeded random X offset, then fade them.",
  parameters: {
    parameters: {
      amount: { kind: "number", label: "Max X offset", default: 20, min: 0, step: 1 },
      seed: { kind: "number", label: "Seed", default: 1, step: 1 },
    },
    order: ["amount", "seed"],
  },
  steps: [
    {
      op: "batch",
      kind: "notes",
      parameters: {
        field: "x",
        operation: "By",
        lower: 0,
        upper: 0,
        disturbance: { parameter: "amount" },
        seed: { parameter: "seed" },
        cycle: "1",
        easingType: 1,
      },
    },
    { op: "select", target: "changed" },
    {
      op: "batch",
      kind: "notes",
      parameters: {
        field: "alpha",
        operation: "To",
        lower: 180,
        upper: 255,
        easingType: 3,
      },
    },
  ],
};

void recipe;
